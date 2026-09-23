import assert from "node:assert/strict";
import { after, before, beforeEach, mock, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as pgliteDrizzle } from "drizzle-orm/pglite";
import { drizzle as pgDrizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { pushSchema } from "drizzle-kit/api";
import { NextRequest } from "next/server";
import * as schema from "./db/schema.ts";
const {
  users,
  sessions,
  accounts,
  verifications,
  telegramAccounts,
  telegramLinkTokens,
  telegramConversations,
  transactions,
  executionAttempts,
  mintJobs,
  wallets,
} = schema;
const pool = process.env.AUTH_TEST_DATABASE_URL
  ? new Pool({ connectionString: process.env.AUTH_TEST_DATABASE_URL })
  : null;
const client = pool ? null : new PGlite();
const db = pool ? pgDrizzle(pool) : pgliteDrizzle(client!);
const databaseMock = mock.module("@/lib/db", { exports: { db } });
const origin = "https://armmint.test";
const configMock = mock.module("@/lib/server/config", {
  exports: {
    getServerConfig: () => ({
      BETTER_AUTH_URL: origin,
      BETTER_AUTH_SECRET:
        "integration-secret-with-at-least-thirty-two-characters",
      GOOGLE_CLIENT_ID: "google-client-id",
      GOOGLE_CLIENT_SECRET: "google-client-secret",
      TELEGRAM_BOT_USERNAME: "ArmMintBot",
      TELEGRAM_BOT_TOKEN: "bot-token",
      TELEGRAM_WEBHOOK_SECRET: "webhook-secret",
      BASE_CHAIN_ID: 8453,
    }),
    getWalletEncryptionKey: () => Buffer.alloc(32, 9),
  },
});
let requestHeaders = new Headers();
const headerMock = mock.module("next/headers", {
  exports: { headers: async () => requestHeaders },
});
let profile = {
  sub: "google-alice",
  email: "alice@example.test",
  name: "Alice",
  email_verified: true,
};
let providerFailure = false;
let notificationFailure = false;
let tokenExchanges = 0;
const messages: string[] = [];
const fetchMock = mock.method(
  globalThis,
  "fetch",
  async (input: string | URL | Request) => {
    const url = String(input);
    if (url.startsWith("https://api.telegram.org/")) {
      if (notificationFailure) throw new Error("private-bot-token");
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json" },
      });
    }
    assert.equal(url, "https://oauth2.googleapis.com/token");
    tokenExchanges++;
    if (providerFailure)
      throw new Error("private-provider-token private-google-code");
    const encode = (v: unknown) =>
      Buffer.from(JSON.stringify(v)).toString("base64url");
    // Controlled HTTPS token endpoint; Better Auth's Google code-flow provider
    // reads these claims from the provider's token response.
    const jwt = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ ...profile, iss: "https://accounts.google.com", aud: "google-client-id", iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 })}.test-signature`;
    return new Response(
      JSON.stringify({
        access_token: "private-access-token",
        refresh_token: "private-refresh-token",
        token_type: "Bearer",
        expires_in: 3600,
        id_token: jwt,
        scope: "openid email profile",
      }),
      { headers: { "content-type": "application/json" } },
    );
  },
);
const loggerMock = mock.method(console, "error", (...args: unknown[]) => {
  messages.push(JSON.stringify(args));
});
const { GET: authGET, POST: authPOST } =
  await import("../app/api/auth/[...all]/route.ts");
const { GET: linkGET, POST: linkPOST } =
  await import("../app/api/telegram/link/route.ts");
const { POST: walletPOST } = await import("../app/api/wallet/route.ts");
const { POST: webhookPOST } =
  await import("../app/api/telegram/webhook/route.ts");
const { getCurrentSession } = await import("./server/session.ts");
const { consumeTelegramLinkToken, issueTelegramLinkToken } =
  await import("./server/telegram-link-service.ts");
const { handleTelegramInput } = await import("./server/telegram-interface.ts");

before(async () => {
  const result = await pushSchema(schema, db);
  await result.apply();
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
    sessions,
    accounts,
    verifications,
    users,
  ].filter(Boolean))
    await db.delete(table);
  requestHeaders = new Headers();
  profile = {
    sub: "google-alice",
    email: "alice@example.test",
    name: "Alice",
    email_verified: true,
  };
  providerFailure = false;
  notificationFailure = false;
  tokenExchanges = 0;
  messages.length = 0;
});
after(async () => {
  loggerMock.mock.restore();
  fetchMock.mock.restore();
  headerMock.restore();
  configMock.restore();
  databaseMock.restore();
  if (pool) await pool.end();
  if (client) await client.close();
});
function cookies(response: Response) {
  return response.headers
    .getSetCookie()
    .map((s) => s.split(";")[0])
    .filter((s) => !s.endsWith("="))
    .join("; ");
}
async function start() {
  const response = await authPOST(
    new Request(`${origin}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({
        provider: "google",
        callbackURL: "/",
        errorCallbackURL: "/auth/error",
      }),
    }),
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  const url = new URL(body.url);
  assert.equal(url.origin, "https://accounts.google.com");
  assert.equal(
    url.searchParams.get("redirect_uri"),
    `${origin}/api/auth/callback/google`,
  );
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.ok(url.searchParams.get("code_challenge"));
  return { state: url.searchParams.get("state")!, cookie: cookies(response) };
}
async function callback(
  flow: Awaited<ReturnType<typeof start>>,
  overrides = "",
) {
  return authGET(
    new Request(
      `${origin}/api/auth/callback/google?state=${flow.state}&${overrides || "code=private-google-code"}`,
      { headers: { cookie: flow.cookie } },
    ),
  );
}
async function login() {
  const response = await callback(await start());
  assert.equal(response.status, 302);
  assert.equal(
    new URL(response.headers.get("location")!, origin).pathname,
    "/",
  );
  requestHeaders = new Headers({ cookie: cookies(response) });
  const session = await getCurrentSession();
  assert.ok(session?.user);
  return session;
}
function linkRequest(body?: unknown, requestOrigin = origin) {
  return new NextRequest(`${origin}/api/telegram/link`, {
    method: "POST",
    headers: { origin: requestOrigin },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

test("real Google code flow persists user/account/session and authenticates requests", async () => {
  const session = await login();
  assert.equal(session.user.email, "alice@example.test");
  assert.equal(tokenExchanges, 1);
  const [account] = await db.select().from(accounts);
  assert.equal(account.providerId, "google");
  assert.equal(account.accountId, "google-alice");
  assert.equal(account.userId, session.user.id);
  assert.notEqual(account.accessToken, "private-access-token");
  assert.notEqual(account.refreshToken, "private-refresh-token");
  assert.equal((await db.select().from(sessions)).length, 1);
  assert.equal((await db.select().from(verifications)).length, 0);
  const again = await login();
  assert.equal(again.user.id, session.user.id);
  assert.equal((await db.select().from(users)).length, 1);
  assert.equal((await db.select().from(accounts)).length, 1);
});

test("OAuth state needs the initiating browser and cannot be replayed", async () => {
  const flow = await start();
  const wrong = await callback({ ...flow, cookie: "" });
  assert.equal(wrong.headers.get("location"), `${origin}/auth/error`);
  assert.equal(tokenExchanges, 0);
  assert.equal((await db.select().from(sessions)).length, 0);
  assert.equal((await callback(flow)).headers.get("location"), "/");
  const replay = await callback(flow);
  assert.equal(replay.headers.get("location"), `${origin}/auth/error`);
  assert.equal(tokenExchanges, 1);
});

test("provider cancellation and failed exchange expose only the fixed recovery URL", async () => {
  const response = await callback(
    await start(),
    "error=access_denied&error_description=private-provider-token",
  );
  assert.equal(response.headers.get("location"), `${origin}/auth/error`);
  providerFailure = true;
  const failure = await callback(await start());
  assert.equal(failure.headers.get("location"), `${origin}/auth/error`);
  assert.equal(messages.join().includes("private-"), false);
  assert.equal((await db.select().from(sessions)).length, 0);
});

test("separate Google subjects cannot take over an existing email's ArmMint account", async () => {
  await login();
  profile = { ...profile, sub: "other-google-identity" };
  const response = await callback(await start());
  assert.equal(response.headers.get("location"), `${origin}/auth/error`);
  assert.equal((await db.select().from(accounts)).length, 1);
});

test("expired and revoked sessions cannot initiate linking or access wallet operations", async () => {
  await login();
  await db.update(sessions).set({ expiresAt: new Date(0) });
  assert.equal(await getCurrentSession(), null);
  assert.equal((await linkPOST(linkRequest())).status, 401);
  assert.equal(
    (
      await walletPOST(
        new NextRequest(`${origin}/api/wallet`, { method: "POST", body: "{}" }),
      )
    ).status,
    401,
  );
  await login();
  const response = await authPOST(
    new Request(`${origin}/api/auth/sign-out`, {
      method: "POST",
      headers: { origin, cookie: requestHeaders.get("cookie")! },
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(await getCurrentSession(), null);
});

test("authenticated linking rejects cross-origin and supplied identities then authorizes the correct Telegram user", async () => {
  const session = await login();
  assert.equal(
    (await linkPOST(linkRequest(undefined, "https://evil.example"))).status,
    403,
  );
  assert.equal(
    (
      await linkPOST(
        linkRequest({ userId: "another-user", telegramUserId: 777 }),
      )
    ).status,
    400,
  );
  const response = await linkPOST(linkRequest());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  const token = new URL(body.url).searchParams.get("start")!;
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(
    JSON.stringify(await db.select().from(telegramLinkTokens)).includes(token),
    false,
  );
  assert.deepEqual(
    await consumeTelegramLinkToken(token, { id: 101n, username: "alice" }),
    { status: "linked", userId: session.user.id },
  );
  assert.deepEqual(await (await linkGET()).json(), {
    linked: true,
    username: "alice",
  });
  assert.equal((await linkPOST(linkRequest())).status, 409);
  const reply = await handleTelegramInput(
    {
      updateId: 1,
      chatId: 101,
      identity: { id: 101n, username: null },
      text: "/jobs",
    },
    { appUrl: origin, chainId: 8453 },
  );
  assert.match(reply!.text, /No mint jobs/);
  const stranger = await handleTelegramInput(
    {
      updateId: 2,
      chatId: 202,
      identity: { id: 202n, username: null },
      text: "/jobs",
    },
    { appUrl: origin, chainId: 8453 },
  );
  assert.match(stranger!.text, /Sign in to ArmMint/);
});

test("parallel authenticated issuance leaves a single usable credential", async () => {
  const session = await login();
  const issued = await Promise.all([
    issueTelegramLinkToken(session.user.id),
    issueTelegramLinkToken(session.user.id),
  ]);
  const rows = await db.select().from(telegramLinkTokens);
  assert.equal(rows.length, 1);
  const results = await Promise.all(
    issued.map((item) => consumeTelegramLinkToken(item.token, { id: 101n })),
  );
  assert.deepEqual(results.map((r) => r.status).sort(), [
    "invalid_token",
    "linked",
  ]);
});

test("notification failure preserves linking and a repeated start reports existing authorization", async () => {
  await login();
  const body = await (await linkPOST(linkRequest())).json();
  const token = new URL(body.url).searchParams.get("start")!;
  notificationFailure = true;
  const update = {
    update_id: 1,
    message: {
      from: { id: 101 },
      chat: { id: 101, type: "private" },
      text: `/start ${token}`,
    },
  };
  const response = await webhookPOST(
    new NextRequest(`${origin}/api/telegram/webhook`, {
      method: "POST",
      headers: { "x-telegram-bot-api-secret-token": "webhook-secret" },
      body: JSON.stringify(update),
    }),
  );
  assert.equal(response.status, 200);
  assert.equal((await db.select().from(telegramAccounts)).length, 1);
  assert.equal(
    (await consumeTelegramLinkToken(token, { id: 101n })).status,
    "invalid_token",
  );
  const replay = await handleTelegramInput(
    {
      updateId: 2,
      chatId: 101,
      identity: { id: 101n, username: null },
      text: `/start ${token}`,
    },
    { appUrl: origin, chainId: 8453 },
  );
  assert.match(replay!.text, /already linked/);
  assert.equal(messages.join().includes("private-"), false);
});

test("anonymous and malformed session cookies have no linking context", async () => {
  for (const cookie of ["", "better-auth.session_token=forged"]) {
    requestHeaders = new Headers({ cookie });
    assert.equal((await linkGET()).status, 401);
    assert.equal((await linkPOST(linkRequest())).status, 401);
  }
  assert.equal((await db.select().from(telegramLinkTokens)).length, 0);
});

test("competing accounts cannot share a Telegram identity and both tokens stay burned", async () => {
  const alice = await login();
  await db
    .insert(users)
    .values({ id: "bob", name: "Bob", email: "bob@example.test" });
  const credentials = await Promise.all([
    issueTelegramLinkToken(alice.user.id),
    issueTelegramLinkToken("bob"),
  ]);
  const results = await Promise.all(
    credentials.map((c) => consumeTelegramLinkToken(c.token, { id: 303n })),
  );
  assert.deepEqual(results.map((r) => r.status).sort(), [
    "linked",
    "telegram_already_linked",
  ]);
  assert.equal((await db.select().from(telegramAccounts)).length, 1);
  for (const credential of credentials)
    assert.equal(
      (await consumeTelegramLinkToken(credential.token, { id: 404n })).status,
      "invalid_token",
    );
  assert.ok(
    (await db.select().from(telegramLinkTokens)).every((row) => row.consumedAt),
  );
});

test("link-storage failures are sanitized and never return credentials", async () => {
  await login();
  const failing = mock.method(db, "transaction", async () => {
    throw new Error("private-token database connection string");
  });
  try {
    const response = await linkPOST(linkRequest());
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: "Unable to access Telegram linking. Please try again.",
    });
    assert.equal(messages.join().includes("private-token"), false);
  } finally {
    failing.mock.restore();
  }
});
