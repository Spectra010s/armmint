import assert from "node:assert/strict";
import { after, before, beforeEach, mock, test } from "node:test";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as pgliteDrizzle } from "drizzle-orm/pglite";
import { drizzle as pgDrizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { pushSchema } from "drizzle-kit/api";
import { eq } from "drizzle-orm";
import { decodeFunctionData, parseAbi } from "viem";
import {
  users,
  wallets,
  telegramAccounts,
  telegramConversations,
  telegramLinkTokens,
  mintJobs,
  executionAttempts,
  transactions,
  mintJobState,
  executionAttemptState,
  transactionState,
} from "@/lib/db/schema";
import type { TelegramInput, TelegramReply } from "./telegram-types";

const pool = process.env.TELEGRAM_TEST_DATABASE_URL
  ? new Pool({ connectionString: process.env.TELEGRAM_TEST_DATABASE_URL })
  : null;
const client = pool ? null : new PGlite();
const db = pool ? pgDrizzle(pool) : pgliteDrizzle(client!);
const databaseMock = mock.module("@/lib/db", { exports: { db } });
const { handleTelegramInput } = await import("./telegram-interface.ts");
const {
  createMintJob,
  cancelMintJob,
  getMintJob,
  listMintJobs,
  validateMintConfiguration,
} = await import("./mint-job-service.ts");
const { runWorkerTick } = await import("./worker-loop.ts");
const { claimNextDueMintJob } = await import("./mint-job-claim.ts");
const { buildMintTransaction } =
  await import("./transaction-engine/claimed-job.ts");
const { issueTelegramLinkToken } = await import("./telegram-link-service.ts");
const config = { appUrl: "https://armmint.example" };
const now = new Date("2026-09-23T12:00:00Z");
const contract = `0x${"ab".repeat(20)}`;
const walletAddress = `0x${"12".repeat(20)}`;
let sequence = 0;

before(async () => {
  const schema = await pushSchema(
    {
      users,
      wallets,
      telegramAccounts,
      telegramConversations,
      telegramLinkTokens,
      mintJobs,
      executionAttempts,
      transactions,
      mintJobState,
      executionAttemptState,
      transactionState,
    },
    db,
  );
  await schema.apply();
});
beforeEach(async () => {
  for (const table of [
    transactions,
    executionAttempts,
    mintJobs,
    telegramConversations,
    telegramAccounts,
    telegramLinkTokens,
    wallets,
    users,
  ])
    await db.delete(table);
  sequence = 0;
  await db.insert(users).values([
    { id: "alice", name: "Alice", email: "alice@example.test" },
    { id: "bob", name: "Bob", email: "bob@example.test" },
  ]);
  await db.insert(telegramAccounts).values([
    { id: "a", userId: "alice", telegramUserId: 101n },
    { id: "b", userId: "bob", telegramUserId: 202n },
  ]);
  await db
    .insert(wallets)
    .values({
      id: "wallet-a",
      userId: "alice",
      address: walletAddress,
      encryptedPrivateKey: "ciphertext",
      encryptionIv: "iv",
      encryptionAuthTag: "tag",
      encryptionKeyVersion: 1,
    });
});
after(async () => {
  databaseMock.restore();
  if (pool) await pool.end();
  if (client) await client.close();
});
function input(text: string, identity = 101): TelegramInput {
  return {
    updateId: ++sequence,
    chatId: identity,
    identity: { id: BigInt(identity), username: null },
    text,
  };
}
async function send(text: string, identity = 101, at = now) {
  return handleTelegramInput(input(text, identity), config, at);
}
function callback(data: string, identity = 101): TelegramInput {
  return {
    ...input("", identity),
    text: undefined,
    callback: { id: String(sequence), data },
  };
}
async function click(
  response: TelegramReply | null,
  label: string,
  identity = 101,
  at = now,
) {
  const b = response?.reply_markup?.inline_keyboard
    .flat()
    .find((candidate) => candidate.text === label);
  assert.ok(b && "callback_data" in b, `Missing button ${label}`);
  assert.ok(Buffer.byteLength(b.callback_data) <= 64);
  return handleTelegramInput(callback(b.callback_data, identity), config, at);
}
async function review(method = "mint(uint256)") {
  await click(await send("/mint"), "Ink Sepolia (testnet)");
  let r = await send(contract);
  r = await click(r, method);
  r = await send(method === "Encoded calldata" ? "0x12345678" : "2");
  r = await send("0.02");
  return click(r, "Mint now");
}
const mint = () => ({
  chainId: 763373,
  contractAddress: contract,
  calldata: "0x12345678",
  valueWei: "0",
  scheduledFor: now.toISOString(),
});

test("onboarding and wallet setup use authenticated web links without exposing secrets", async () => {
  const unlinked = await send("/start", 303);
  assert.match(unlinked!.text, /Link Telegram/);
  assert.equal(
    (unlinked!.reply_markup!.inline_keyboard[0][0] as { url: string }).url,
    "https://armmint.example/",
  );
  assert.match((await send("/help"))!.text, /\/mint/);
  assert.match((await send("/wallet"))!.text, new RegExp(walletAddress));
  assert.match(
    (await send("/mint", 202))!.text,
    /Set up a valid burner wallet/,
  );
  assert.equal(
    JSON.stringify(await send("/wallet")).includes("ciphertext"),
    false,
  );
});

test("secure linking remains the real single-use token service", async () => {
  await db.delete(telegramAccounts).where(eq(telegramAccounts.userId, "bob"));
  const { token } = await issueTelegramLinkToken("bob");
  const r = await send(`/start ${token}`, 303, new Date());
  assert.match(r!.text, /linked successfully/);
  assert.match(
    (await send(`/start ${token}`, 303, new Date()))!.text,
    /already linked/,
  );
  const [linked] = await db
    .select()
    .from(telegramAccounts)
    .where(eq(telegramAccounts.userId, "bob"));
  assert.equal(linked.telegramUserId, 303n);
});

test("guided review creates a real scheduled job and existing worker builds its execution request", async () => {
  const r = await review("mint(address,uint256)");
  assert.match(r!.text, /Review mint/);
  assert.match(r!.text, /Total value: 0.02 ETH/);
  assert.equal((await db.select().from(mintJobs)).length, 0);
  const created = await click(r, "Confirm mint");
  assert.match(created!.text, /created successfully/);
  const [job] = await db.select().from(mintJobs);
  assert.equal(job.userId, "alice");
  assert.equal(job.walletId, "wallet-a");
  assert.equal(job.state, "SCHEDULED");
  assert.equal(job.valueWei, "20000000000000000");
  const decoded = decodeFunctionData({
    abi: parseAbi(["function mint(address to, uint256 quantity) payable"]),
    data: job.calldata as `0x${string}`,
  });
  assert.deepEqual(decoded.args, [walletAddress, 2n]);
  let called = false;
  await runWorkerTick(
    async (claimed, attemptId) => {
      called = true;
      assert.equal(claimed.id, job.id);
      assert.ok(attemptId);
      const request = buildMintTransaction(claimed, {
        id: "wallet-a",
        userId: "alice",
        address: walletAddress,
      });
      assert.equal(request.to, contract);
      assert.equal(request.value, 20000000000000000n);
    },
    "telegram-test",
    now,
  );
  assert.equal(called, true);
  assert.equal((await db.select().from(executionAttempts)).length, 1);
});

test("duplicate updates and concurrent confirmation clicks create exactly one mint", async () => {
  const r = await review();
  const b = r!
    .reply_markup!.inline_keyboard.flat()
    .find((candidate) => candidate.text === "Confirm mint")!;
  assert.ok("callback_data" in b);
  const first = callback(b.callback_data);
  const second = callback(b.callback_data);
  await Promise.all([
    handleTelegramInput(first, config, now),
    handleTelegramInput(second, config, now),
  ]);
  assert.equal(await handleTelegramInput(first, config, now), null);
  assert.equal((await db.select().from(mintJobs)).length, 1);
  assert.equal((await db.select().from(telegramConversations))[0].draft, null);
});

test("validation rejects invalid addresses, quantities, ETH precision, calldata, and dates without advancing", async () => {
  await click(await send("/mint"), "Ink Sepolia (testnet)");
  assert.match((await send("bad-address"))!.text, /valid, non-zero/);
  let r = await send(contract);
  r = await click(r, "mint(uint256)");
  for (const invalid of ["0", "101", "1.5", "-1"])
    assert.match((await send(invalid))!.text, /whole number/);
  await send("2");
  for (const invalid of ["-1", "1e2", "0.0000000000000000001", "NaN"])
    assert.match((await send(invalid))!.text, /non-negative ETH/);
  await send("0");
  for (const invalid of [
    "yesterday",
    "2026-09-23T11:00:00Z",
    "2027-02-30T12:00:00Z",
    "2026-10-01T12:00:00+01:00",
  ])
    assert.match((await send(invalid))!.text, /future UTC time/);
  assert.match((await send("2026-10-01T12:00:00Z"))!.text, /Review mint/);
  assert.equal((await db.select().from(mintJobs)).length, 0);
  await click(await send("/mint"), "Ink Sepolia (testnet)");
  r = await send(contract);
  await click(r, "Encoded calldata");
  for (const invalid of ["0x123", "0xGGGGGGGG", `0x${"aa".repeat(1801)}`])
    assert.match((await send(invalid))!.text, /valid encoded calldata/);
});

test("likely private keys and seed phrases are neither stored nor echoed", async () => {
  await click(await send("/mint"), "Ink Sepolia (testnet)");
  let r = await send(contract);
  await click(r, "Encoded calldata");
  for (const secret of [
    `0x${"ef".repeat(32)}`,
    "alpha beta gamma delta echo foxtrot golf hotel india juliet kilo lima",
  ]) {
    r = await send(secret);
    assert.match(r!.text, /Do not send private keys/);
    assert.equal(JSON.stringify(r).includes(secret), false);
    assert.equal(
      JSON.stringify(await db.select().from(telegramConversations)).includes(
        secret,
      ),
      false,
    );
  }
});

test("back, cancel, restart and expiry prevent stale draft confirmation", async () => {
  const old = await review();
  assert.match((await send("/back"))!.text, /When should/);
  assert.match((await click(old, "Confirm mint"))!.text, /older step/);
  await send("/cancel");
  assert.match(
    (await click(old, "Confirm mint"))!.text,
    /No active mint draft/,
  );
  await review();
  assert.match(
    (await send("/start", 101, new Date(now.getTime() + 31 * 60_000)))!.text,
    /ArmMint/,
  );
  assert.equal((await db.select().from(telegramConversations))[0].draft, null);
  await click(await send("/mint"), "Ink Sepolia (testnet)");
  assert.match((await click(old, "Confirm mint"))!.text, /older step/);
  assert.equal((await db.select().from(mintJobs)).length, 0);
});

test("ownership applies to listing, status, cancellation and forged draft callbacks", async () => {
  const r = await review();
  assert.match(
    (await click(r, "Confirm mint", 202))!.text,
    /No active mint draft/,
  );
  await click(r, "Confirm mint");
  const [job] = await db.select().from(mintJobs);
  for (const action of [`job:${job.id}`, `cancel:${job.id}`, `stop:${job.id}`])
    assert.match(
      (await handleTelegramInput(callback(action, 202), config, now))!.text,
      /not found in your account/,
    );
  assert.equal(await getMintJob("bob", job.id), null);
  assert.equal(await cancelMintJob("bob", job.id, now), "not_found");
  assert.deepEqual(await listMintJobs("bob"), []);
  assert.match((await send("/jobs", 202))!.text, /No mint jobs/);
  assert.equal((await db.select().from(mintJobs))[0].state, "SCHEDULED");
});

test("listing paginates and status reflects actual lifecycle and explorer transaction", async () => {
  for (let i = 0; i < 7; i++)
    await createMintJob("alice", mint(), `job-${i}`, now);
  const first = await send("/jobs");
  assert.equal(
    first!
      .reply_markup!.inline_keyboard.flat()
      .filter((b) => "callback_data" in b && b.callback_data.startsWith("job:"))
      .length,
    5,
  );
  assert.match((await click(first, "Next"))!.text, /page 2/);
  const [job] = await db.select().from(mintJobs);
  await db
    .update(mintJobs)
    .set({ state: "SUCCEEDED" })
    .where(eq(mintJobs.id, job.id));
  await db
    .insert(executionAttempts)
    .values({
      id: "attempt",
      mintJobId: job.id,
      attemptNumber: 1,
      state: "SUCCEEDED",
      failureMessage: "PRIVATE_ERROR_DO_NOT_ECHO",
    });
  await db
    .insert(transactions)
    .values({
      id: "tx",
      executionAttemptId: "attempt",
      chainId: 763373,
      nonce: 0,
      state: "CONFIRMED",
      hash: `0x${"cd".repeat(32)}`,
    });
  const status = await send(`/status ${job.id}`);
  assert.match(status!.text, /transaction confirmed/);
  assert.equal(
    JSON.stringify(status).includes("PRIVATE_ERROR_DO_NOT_ECHO"),
    false,
  );
  assert.ok(
    status!
      .reply_markup!.inline_keyboard.flat()
      .some((b) => "url" in b && b.url.includes("explorer-sepolia.inkonchain.com/tx/")),
  );
});

test("cancellation requires confirmation and stops scheduled work", async () => {
  const job = await createMintJob("alice", mint(), randomUUID(), now);
  const prompt = await send(`/cancel ${job.id}`);
  assert.equal((await db.select().from(mintJobs))[0].state, "SCHEDULED");
  assert.match(
    (await click(prompt, "Yes, cancel job"))!.text,
    /cancelled successfully/,
  );
  assert.equal(await claimNextDueMintJob("worker", now), null);
  assert.equal(await cancelMintJob("alice", job.id, now), "cancelled");
});

test("claim/cancel race never cancels a claimed job", async () => {
  const job = await createMintJob("alice", mint(), randomUUID(), now);
  const [claim, cancelled] = await Promise.all([
    claimNextDueMintJob("worker", now),
    cancelMintJob("alice", job.id, now),
  ]);
  const [stored] = await db.select().from(mintJobs);
  if (claim) {
    assert.equal(cancelled, "unsafe");
    assert.equal(stored.state, "CLAIMED");
  } else {
    assert.equal(cancelled, "cancelled");
    assert.equal(stored.state, "CANCELLED");
  }
});

test("every execution/terminal state refuses cancellation, and signed scheduled anomalies remain protected", async () => {
  const job = await createMintJob("alice", mint(), randomUUID(), now);
  for (const state of mintJobState.enumValues.filter(
    (s) => !["SCHEDULED", "CANCELLED"].includes(s),
  )) {
    await db.update(mintJobs).set({ state }).where(eq(mintJobs.id, job.id));
    assert.equal(await cancelMintJob("alice", job.id, now), "unsafe");
  }
  await db
    .update(mintJobs)
    .set({ state: "SCHEDULED" })
    .where(eq(mintJobs.id, job.id));
  await db
    .insert(executionAttempts)
    .values({ id: "signed-attempt", mintJobId: job.id, attemptNumber: 1 });
  await db
    .insert(transactions)
    .values({
      id: "signed-tx",
      executionAttemptId: "signed-attempt",
      chainId: 763373,
      nonce: 0,
      hash: `0x${"ab".repeat(32)}`,
    });
  assert.equal(await cancelMintJob("alice", job.id, now), "unsafe");
});

test("custom calldata schedules exactly and an overdue review must be corrected", async () => {
  const r = await review("Encoded calldata");
  await click(r, "Back");
  const scheduled = await send("2026-09-23T12:02:00Z");
  assert.match(
    (await click(
      scheduled,
      "Confirm mint",
      101,
      new Date("2026-09-23T12:05:00Z"),
    ))!.text,
    /future time/,
  );
  assert.equal((await db.select().from(mintJobs)).length, 0);
  await click(scheduled, "Confirm mint");
  const [job] = await db.select().from(mintJobs);
  assert.equal(job.calldata, "0x12345678");
  assert.equal(job.scheduledFor.toISOString(), "2026-09-23T12:02:00.000Z");
  assert.equal(await claimNextDueMintJob("worker", now), null);
});

test("shared validation and idempotency enforce backend invariants", async () => {
  for (const bad of [
    { ...mint(), chainId: 1 },
    { ...mint(), contractAddress: "0x0" },
    { ...mint(), calldata: `0x${"ab".repeat(32)}` },
    { ...mint(), valueWei: "-1" },
    { ...mint(), scheduledFor: "not-a-date" },
  ])
    assert.throws(() => validateMintConfiguration(bad, now));
  const first = await createMintJob("alice", mint(), "same", now);
  const second = await createMintJob("alice", mint(), "same", now);
  assert.equal(first.id, second.id);
  await assert.rejects(
    createMintJob("bob", mint(), "same", now),
    /Set up a valid burner wallet/,
  );
});

test("Telegram requires explicit network selection and clears inputs when changing networks", async () => {
  let r = await send("/mint");
  assert.match(r!.text, /Choose the mint network/);
  assert.match((await send(contract))!.text, /Choose the mint network/);
  r = await click(r, "Arc Testnet (testnet)");
  assert.match(r!.text, /Arc Testnet/);
  r = await send(contract);
  await send("/back");
  r = await send("/back");
  r = await click(r, "Ink Sepolia (testnet)");
  const [conversation] = await db.select().from(telegramConversations);
  assert.equal(conversation.draft!.chainId, 763373);
  assert.equal(conversation.draft!.contractAddress, undefined);
  assert.match(r!.text, /contract address/);
});

test("Arc Telegram review, job creation, listing and explorer use USDC and the selected chain", async () => {
  await click(await send("/mint"), "Arc Testnet (testnet)");
  let r = await send(contract);
  await click(r, "mint(uint256)");
  r = await send("1");
  assert.match(r!.text, /TOTAL USDC/);
  await send("0.25");
  r = await click(await send("/start").then(menuReply => click(menuReply, "Resume draft")), "Mint now");
  assert.match(r!.text, /0.25 USDC/);
  await click(r, "Confirm mint");
  const [job] = await db.select().from(mintJobs);
  assert.equal(job.chainId, 5042002);
  assert.equal(job.valueWei, "250000000000000000");
  assert.match(JSON.stringify(await send("/jobs")), /Arc Testnet/);
  assert.match((await send(`/status ${job.id}`))!.text, /Arc Testnet/);
});

test("new jobs reject legacy and unsupported networks while historical Base stays labelled", async () => {
  for (const chainId of [8453, 84532, 1, 0, 999999])
    assert.throws(() => validateMintConfiguration({ ...mint(), chainId }, now), /supported/);
  const job = await createMintJob("alice", mint(), randomUUID(), now);
  await db.update(mintJobs).set({ chainId: 8453 }).where(eq(mintJobs.id, job.id));
  assert.match((await send(`/status ${job.id}`))!.text, /Base \(legacy\)/);
});
