import assert from "node:assert/strict";
import { after, before, beforeEach, mock, test } from "node:test";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { pushSchema } from "drizzle-kit/api";

import { users, telegramAccounts, telegramLinkTokens } from "../db/schema.ts";
import { digestTelegramLinkToken } from "./telegram-link-token.ts";

const client = new PGlite();
const db = drizzle(client);
const databaseMock = mock.module("@/lib/db", { exports: { db } });
const { consumeTelegramLinkToken, issueTelegramLinkToken, resolveTelegramUser } =
  await import("./telegram-link-service.ts");

const now = new Date("2026-09-18T12:00:00Z");

before(async () => {
  // Apply the actual table definitions to an ephemeral PostgreSQL database.
  // No migration files or application database are involved.
  const schema = await pushSchema({ users, telegramAccounts, telegramLinkTokens }, db);
  await schema.apply();
});

beforeEach(async () => {
  await db.delete(telegramLinkTokens);
  await db.delete(telegramAccounts);
  await db.delete(users);
  await db.insert(users).values([
    { id: "alice", name: "Alice", email: "alice@example.test" },
    { id: "bob", name: "Bob", email: "bob@example.test" },
  ]);
});

after(async () => {
  databaseMock.restore();
  await client.close();
});

async function tokenFor(userId = "alice", expiresAt = new Date(now.getTime() + 60_000)) {
  const token = randomUUID();
  await db.insert(telegramLinkTokens).values({
    id: randomUUID(), userId, tokenDigest: digestTelegramLinkToken(token), expiresAt,
  });
  return token;
}

async function assertBurned(token: string) {
  const [stored] = await db.select().from(telegramLinkTokens)
    .where(eq(telegramLinkTokens.tokenDigest, digestTelegramLinkToken(token)));
  assert.equal(stored.consumedAt?.getTime(), now.getTime());
  assert.deepEqual(await consumeTelegramLinkToken(token, { id: BigInt(999) }, now), {
    status: "invalid_token",
  });
}

test("issues short-lived digest-only tokens and invalidates earlier unused links", async () => {
  const started = Date.now();
  const first = await issueTelegramLinkToken("alice");
  const second = await issueTelegramLinkToken("alice");
  assert.match(second.token, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first.token, second.token);
  assert.ok(second.expiresAt.getTime() >= started + 600_000);
  assert.ok(second.expiresAt.getTime() <= Date.now() + 600_000);
  const rows = await db.select().from(telegramLinkTokens);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].tokenDigest, digestTelegramLinkToken(second.token));
  assert.equal(JSON.stringify(rows).includes(second.token), false);
  assert.deepEqual(await consumeTelegramLinkToken(first.token, { id: BigInt(101) }), {
    status: "invalid_token",
  });
  assert.deepEqual(await consumeTelegramLinkToken(second.token, { id: BigInt(101) }), {
    status: "linked", userId: "alice",
  });
});

test("rejects unknown, expired, and exactly-expiring tokens", async () => {
  for (const token of ["unknown", await tokenFor("alice", new Date(now.getTime() - 1)),
    await tokenFor("alice", now)]) {
    assert.deepEqual(await consumeTelegramLinkToken(token, { id: BigInt(101) }, now), {
      status: "invalid_token",
    });
  }
  assert.equal((await db.select().from(telegramAccounts)).length, 0);
});

test("links successfully, resolves the owner, and rejects replay", async () => {
  const token = await tokenFor();
  assert.deepEqual(await consumeTelegramLinkToken(token, { id: BigInt(101), username: "alice" }, now), {
    status: "linked", userId: "alice",
  });
  const [account] = await db.select().from(telegramAccounts);
  assert.equal(account.telegramUserId, BigInt(101));
  assert.equal(account.username, "alice");
  assert.equal(await resolveTelegramUser(BigInt(101)), "alice");
  assert.equal(await resolveTelegramUser(BigInt(102)), null);
  await assertBurned(token);
  assert.deepEqual(await consumeTelegramLinkToken(token, { id: BigInt(101) }, now), {
    status: "invalid_token",
  });
});

test("burns tokens when the Telegram identity belongs to another user", async () => {
  await consumeTelegramLinkToken(await tokenFor("bob"), { id: BigInt(101) }, now);
  const token = await tokenFor();
  assert.deepEqual(await consumeTelegramLinkToken(token, { id: BigInt(101) }, now), {
    status: "telegram_already_linked",
  });
  await assertBurned(token);
  assert.equal(await resolveTelegramUser(BigInt(101)), "bob");
  // Removing the conflict still must not revive the token.
  await db.delete(telegramAccounts);
  await assertBurned(token);
});

test("burns tokens when the ArmMint user already has another Telegram identity", async () => {
  await consumeTelegramLinkToken(await tokenFor(), { id: BigInt(101) }, now);
  const token = await tokenFor();
  assert.deepEqual(await consumeTelegramLinkToken(token, { id: BigInt(102) }, now), {
    status: "user_already_linked",
  });
  await assertBurned(token);
  assert.equal(await resolveTelegramUser(BigInt(101)), "alice");
  assert.equal(await resolveTelegramUser(BigInt(102)), null);
});

test("a fresh token for the same linked pair cannot change the existing account", async () => {
  await consumeTelegramLinkToken(await tokenFor(), { id: BigInt(101), username: "original" }, now);
  const token = await tokenFor();
  assert.deepEqual(await consumeTelegramLinkToken(token, { id: BigInt(101), username: "changed" }, now), {
    status: "linked", userId: "alice",
  });
  const rows = await db.select().from(telegramAccounts);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].username, "original");
  await assertBurned(token);
});

// PGlite serializes transactions. These exercise competing service calls and
// real unique indexes, but not PostgreSQL locking across multiple connections.
test("only one concurrent consumption of the same token succeeds", async () => {
  const token = await tokenFor();
  const results = await Promise.all([
    consumeTelegramLinkToken(token, { id: BigInt(101) }, now),
    consumeTelegramLinkToken(token, { id: BigInt(102) }, now),
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), ["invalid_token", "linked"]);
  assert.equal((await db.select().from(telegramAccounts)).length, 1);
  await assertBurned(token);
});

test("competing users cannot claim the same Telegram identity", async () => {
  const tokens = [await tokenFor("alice"), await tokenFor("bob")];
  const results = await Promise.all(tokens.map((token) =>
    consumeTelegramLinkToken(token, { id: BigInt(101) }, now)));
  assert.deepEqual(results.map((result) => result.status).sort(), ["linked", "telegram_already_linked"]);
  assert.equal((await db.select().from(telegramAccounts)).length, 1);
  for (const token of tokens) await assertBurned(token);
});

test("competing Telegram identities cannot claim the same ArmMint user", async () => {
  const tokens = [await tokenFor(), await tokenFor()];
  const results = await Promise.all(tokens.map((token, index) =>
    consumeTelegramLinkToken(token, { id: BigInt(101 + index) }, now)));
  assert.deepEqual(results.map((result) => result.status).sort(), ["linked", "user_already_linked"]);
  assert.equal((await db.select().from(telegramAccounts)).length, 1);
  for (const token of tokens) await assertBurned(token);
});

test("an account transaction failure cannot roll back the committed token burn", async () => {
  const token = await tokenFor();
  // PostgreSQL's bigint range rejects the account insert inside its transaction.
  await assert.rejects(consumeTelegramLinkToken(token, { id: BigInt("9223372036854775808") }, now));
  assert.equal((await db.select().from(telegramAccounts)).length, 0);
  await assertBurned(token);
});
