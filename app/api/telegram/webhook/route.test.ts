import assert from "node:assert/strict";
import { after, beforeEach, mock, test } from "node:test";
import { NextRequest } from "next/server";
const config = mock.module("@/lib/server/config", {
  exports: {
    getServerConfig: () => ({
      TELEGRAM_WEBHOOK_SECRET: "secret",
      TELEGRAM_BOT_TOKEN: "credential-not-for-logs",
      BETTER_AUTH_URL: "https://armmint.example",
    }),
  },
});
let processed = 0;
let failure = false;
const handler = mock.module("@/lib/server/telegram-interface", {
  exports: {
    handleTelegramInput: async () => {
      processed++;
      if (failure) throw new Error("private-internal-error");
      return { text: "Mint created successfully." };
    },
  },
});
const { POST } = await import("./route.ts");
const bodies: { url: string; body: Record<string, unknown> }[] = [];
let transportFailure = false;
let apiFailure = false;
const fetchMock = mock.method(
  globalThis,
  "fetch",
  async (url: string | URL | Request, options?: RequestInit) => {
    bodies.push({
      url: String(url),
      body: JSON.parse(options!.body as string),
    });
    if (transportFailure) throw new Error("credential-not-for-logs");
    return new Response(JSON.stringify({ ok: !apiFailure }), {
      status: apiFailure ? 429 : 200,
    });
  },
);
after(() => {
  fetchMock.mock.restore();
  handler.restore();
  config.restore();
});
beforeEach(() => {
  processed = 0;
  failure = false;
  transportFailure = false;
  apiFailure = false;
  bodies.length = 0;
});
function request(body: unknown, secret = "secret") {
  return new NextRequest("https://armmint.example/api/telegram/webhook", {
    method: "POST",
    headers: {
      "x-telegram-bot-api-secret-token": secret,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}
const message = {
  from: { id: 101 },
  chat: { id: 101, type: "private" },
  text: "/jobs",
};
test("authenticates before dispatch and ignores unsupported updates", async () => {
  assert.equal(
    (await POST(request({ update_id: 1, message }, "wrong"))).status,
    401,
  );
  assert.equal(
    (
      await POST(
        request({
          update_id: 1,
          message: { ...message, chat: { id: -1, type: "group" } },
        }),
      )
    ).status,
    200,
  );
  assert.equal(processed, 0);
  assert.equal(bodies.length, 0);
});
test("acknowledges callback and sends structured reply to verified private chat", async () => {
  assert.equal(
    (
      await POST(
        request({
          update_id: 1,
          callback_query: {
            id: "callback",
            data: "jobs:0",
            from: { id: 101 },
            message,
          },
        }),
      )
    ).status,
    200,
  );
  assert.equal(processed, 1);
  assert.ok(bodies[0].url.endsWith("/answerCallbackQuery"));
  assert.equal(bodies[0].body.callback_query_id, "callback");
  assert.equal(bodies[1].body.chat_id, 101);
});
test("delivery exceptions and Telegram API errors cannot retry committed actions or leak credentials", async () => {
  const log = mock.method(console, "error", () => {});
  try {
    transportFailure = true;
    const result = await POST(request({ update_id: 1, message }));
    assert.equal(result.status, 200);
    assert.equal(
      JSON.stringify(await result.json()).includes("credential"),
      false,
    );
    transportFailure = false;
    apiFailure = true;
    assert.equal((await POST(request({ update_id: 2, message }))).status, 200);
    assert.equal(log.mock.callCount(), 0);
  } finally {
    log.mock.restore();
  }
});
test("processing failures return retryable status with sanitized responses", async () => {
  failure = true;
  const response = await POST(request({ update_id: 1, message }));
  assert.equal(response.status, 503);
  assert.equal(
    JSON.stringify(bodies).includes("private-internal-error"),
    false,
  );
  assert.equal(
    JSON.stringify(await response.json()).includes("private-internal-error"),
    false,
  );
});
test("malformed JSON returns 400 without processing", async () => {
  const req = new NextRequest("https://armmint.example/api/telegram/webhook", {
    method: "POST",
    headers: { "x-telegram-bot-api-secret-token": "secret" },
    body: "{",
  });
  assert.equal((await POST(req)).status, 400);
  assert.equal(processed, 0);
});
