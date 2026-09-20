import assert from "node:assert/strict";
import test from "node:test";

import { parseTelegramLinkMessage, parseTelegramStartToken } from "./telegram-webhook.ts";

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
    token, chatId: 123, identity: { id: BigInt(123), username: "alice" },
  });
});

test("rejects user IDs appended to or substituted for the start token", () => {
  for (const text of [`/start ${token} 456`, "/start 456", `/start ${token}:456`]) {
    assert.equal(parseTelegramLinkMessage({ message: { ...message, text } }), null);
  }
});

test("ignores malformed updates without throwing", () => {
  for (const update of [null, [], 42, {}, { message: null }, { message: [] },
    { message: { ...message, text: 123 } }, { message: { ...message, from: null } }]) {
    assert.equal(parseTelegramLinkMessage(update), null);
  }
});

test("rejects missing, non-positive, fractional, and unsafe sender IDs", () => {
  for (const id of [undefined, "123", 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(parseTelegramLinkMessage({ message: {
      ...message, from: { id }, chat: { id, type: "private" },
    } }), null);
  }
});

test("requires the sender's private chat and rejects bot senders", () => {
  for (const chat of [{ id: -123, type: "group" }, { id: 456, type: "private" },
    { id: 123, type: "channel" }, undefined]) {
    assert.equal(parseTelegramLinkMessage({ message: { ...message, chat } }), null);
  }
  assert.equal(parseTelegramLinkMessage({ message: {
    ...message, from: { ...message.from, is_bot: true },
  } }), null);
});

test("does not require a Telegram username", () => {
  assert.deepEqual(parseTelegramLinkMessage({ message: { ...message, from: { id: 123 } } }), {
    token, chatId: 123, identity: { id: BigInt(123), username: null },
  });
});
