import assert from "node:assert/strict";
import test from "node:test";

import { parseTelegramStartToken } from "./telegram-webhook";

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
