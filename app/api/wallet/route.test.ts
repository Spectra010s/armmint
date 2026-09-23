import assert from "node:assert/strict";
import { before, beforeEach, after, mock, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { pushSchema } from "drizzle-kit/api";

import { users, wallets } from "../../../lib/db/schema.ts";

process.env.ARMINT_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");

const client = new PGlite();
const db = drizzle(client);
const databaseMock = mock.module("@/lib/db", { exports: { db } });

let currentUserId: string | null = "alice";
const sessionMock = mock.module("@/lib/server/session", {
  exports: {
    requireCurrentUser: async () => {
      if (!currentUserId) throw new Error("Unauthorized");
      return { id: currentUserId };
    },
    getCurrentSession: async () =>
      currentUserId ? { user: { id: currentUserId } } : null,
  },
});

const { POST } = await import("./route.ts");

before(async () => {
  const schema = await pushSchema({ users, wallets }, db);
  await schema.apply();
});

beforeEach(async () => {
  currentUserId = "alice";
  await db.delete(wallets);
  await db.delete(users);
  await db
    .insert(users)
    .values({ id: "alice", name: "Alice", email: "alice@example.test" });
});

after(async () => {
  sessionMock.restore();
  databaseMock.restore();
  await client.close();
});

function walletRequest(body: unknown) {
  return {
    json: async () => body,
  } as unknown as Parameters<typeof POST>[0];
}

test("rejects wallet setup without explicit burner acknowledgement", async () => {
  for (const body of [
    { address: "0xabc", privateKey: "secret" },
    { address: "0xabc", privateKey: "secret", burnerWalletAcknowledged: false },
    {
      address: "0xabc",
      privateKey: "secret",
      burnerWalletAcknowledged: "true",
    },
  ]) {
    const response = await POST(walletRequest(body));
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: "Burner wallet acknowledgement is required",
    });
  }

  assert.equal((await db.select().from(wallets)).length, 0);
});

test("requires an address and private key without echoing secrets", async () => {
  const secret = `0x${"cc".repeat(32)}`;

  for (const body of [
    { address: "  ", privateKey: secret, burnerWalletAcknowledged: true },
    { address: "0xabc", privateKey: "", burnerWalletAcknowledged: true },
    { address: "0xabc", burnerWalletAcknowledged: true },
  ]) {
    const response = await POST(walletRequest(body));
    assert.equal(response.status, 400);
    const payload = (await response.json()) as { error: string };
    assert.equal(payload.error, "Wallet address and private key are required");
    assert.equal(JSON.stringify(payload).includes(secret), false);
  }

  assert.equal((await db.select().from(wallets)).length, 0);
});

test("stores an acknowledged wallet encrypted and never returns key material", async () => {
  const response = await POST(
    walletRequest({
      address: "  0xabc  ",
      privateKey: `0x${"dd".repeat(32)}`,
      burnerWalletAcknowledged: true,
    }),
  );

  assert.equal(response.status, 201);
  const body = (await response.json()) as {
    wallet: { id: string; address: string };
  };
  assert.equal(body.wallet.address, "0xabc");
  assert.ok(body.wallet.id);

  const serialized = JSON.stringify(body);
  assert.equal(serialized.includes("dd".repeat(8)), false);
  assert.equal(serialized.includes("encryptedPrivateKey"), false);
  assert.equal(serialized.includes("encryptionIv"), false);
  assert.equal(serialized.includes("encryptionAuthTag"), false);

  const [stored] = await db.select().from(wallets);
  assert.equal(stored.address, "0xabc");
  assert.equal(stored.userId, "alice");
  assert.notEqual(stored.encryptedPrivateKey, `0x${"dd".repeat(32)}`);
});

test("rejects a second wallet for the same account without leaking key material", async () => {
  const first = await POST(
    walletRequest({
      address: "0xabc",
      privateKey: "first-secret",
      burnerWalletAcknowledged: true,
    }),
  );
  assert.equal(first.status, 201);

  const second = await POST(
    walletRequest({
      address: "0xdef",
      privateKey: "second-secret",
      burnerWalletAcknowledged: true,
    }),
  );
  assert.equal(second.status, 409);
  const body = (await second.json()) as { error: string };
  assert.equal(body.error, "A wallet is already configured for this account");
  assert.equal(JSON.stringify(body).includes("second-secret"), false);
});

test("missing authenticated context returns 401 without processing wallet secrets", async () => {
  currentUserId = null;
  const result = await POST(
    walletRequest({ privateKey: "private-wallet-input" }),
  );
  assert.equal(result.status, 401);
  assert.deepEqual(await result.json(), { error: "Unauthorized" });
  assert.equal((await db.select().from(wallets)).length, 0);
});

test("malformed authenticated wallet bodies fail without exceptions", async () => {
  for (const body of [null, [], "private-wallet-input"]) {
    const response = await POST(walletRequest(body));
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "Invalid request" });
  }
});
