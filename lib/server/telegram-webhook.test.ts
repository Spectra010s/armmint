import assert from "node:assert/strict";
import test from "node:test";

import {
  parseTelegramLinkMessage,
  parseTelegramStartToken,
} from "./telegram-webhook.ts";

test("extracts a deep-link token from /start", () => {
  const token = "A".repeat(43);
  assert.equal(parseTelegramStartToken(`/start ${token}`), token);
});

test("accepts a bot-addressed /start command", () => {
  const token = "aB0_-".repeat(8) + "abc";
  assert.equal(token.length, 43);
  assert.equal(parseTelegramStartToken(`/start@ArmMintBot ${token}`), token);
});

test("rejects missing and malformed start parameters", () => {
  assert.equal(parseTelegramStartToken(undefined), null);
  assert.equal(parseTelegramStartToken("/start"), null);
  assert.equal(parseTelegramStartToken("/start not-a-valid-token"), null);
});

const token = "A".repeat(43);
const message = {
  from: { id: 123, username: "alice", is_bot: false },
  chat: { id: 123, type: "private" },
  text: `/start ${token}`,
};

test("takes the identity from the Telegram sender", () => {
  assert.deepEqual(parseTelegramLinkMessage({ message }), {
    token,
    chatId: 123,
    identity: { id: BigInt(123), username: "alice" },
  });
});

test("rejects user IDs appended to or substituted for the start token", () => {
  for (const text of [
    `/start ${token} 456`,
    "/start 456",
    `/start ${token}:456`,
  ]) {
    assert.equal(
      parseTelegramLinkMessage({ message: { ...message, text } }),
      null,
    );
  }
});

test("ignores malformed updates without throwing", () => {
  for (const update of [
    null,
    [],
    42,
    {},
    { message: null },
    { message: [] },
    { message: { ...message, text: 123 } },
    { message: { ...message, from: null } },
  ]) {
    assert.equal(parseTelegramLinkMessage(update), null);
  }
});

test("rejects missing, non-positive, fractional, and unsafe sender IDs", () => {
  for (const id of [
    undefined,
    "123",
    0,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    assert.equal(
      parseTelegramLinkMessage({
        message: {
          ...message,
          from: { id },
          chat: { id, type: "private" },
        },
      }),
      null,
    );
  }
});

test("requires the sender's private chat and rejects bot senders", () => {
  for (const chat of [
    { id: -123, type: "group" },
    { id: 456, type: "private" },
    { id: 123, type: "channel" },
    undefined,
  ]) {
    assert.equal(
      parseTelegramLinkMessage({ message: { ...message, chat } }),
      null,
    );
  }
  assert.equal(
    parseTelegramLinkMessage({
      message: {
        ...message,
        from: { ...message.from, is_bot: true },
      },
    }),
    null,
  );
});

test("does not require a Telegram username", () => {
  assert.deepEqual(
    parseTelegramLinkMessage({ message: { ...message, from: { id: 123 } } }),
    {
      token,
      chatId: 123,
      identity: { id: BigInt(123), username: null },
    },
  );
});

const { parseTelegramInput } = await import("./telegram-webhook.ts");
test("parses callbacks using the clicking user, not the bot message author", () => {
  const result = parseTelegramInput({
    update_id: 10,
    callback_query: {
      id: "query",
      data: "jobs:0",
      from: message.from,
      message: { ...message, from: { id: 999, is_bot: true } },
    },
  });
  assert.equal(result?.identity.id, 123n);
  assert.equal(result?.callback?.data, "jobs:0");
});
test("rejects callback impersonation, group chats, inline-only callbacks and invalid update IDs", () => {
  const query = { id: "query", data: "jobs:0", from: message.from, message };
  for (const update of [
    { update_id: -1, message },
    { update_id: 1.5, message },
    { message },
    { update_id: 1, callback_query: { ...query, from: { id: 456 } } },
    {
      update_id: 1,
      callback_query: { ...query, from: { id: 123, is_bot: true } },
    },
    {
      update_id: 1,
      callback_query: {
        ...query,
        message: { ...message, chat: { id: 123, type: "group" } },
      },
    },
    {
      update_id: 1,
      callback_query: {
        ...query,
        message: undefined,
        inline_message_id: "inline",
      },
    },
    { update_id: 1, callback_query: { ...query, data: "é".repeat(33) } },
  ])
    assert.equal(parseTelegramInput(update), null);
});
