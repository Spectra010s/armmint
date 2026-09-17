import assert from "node:assert/strict";
import test from "node:test";

import {
  TELEGRAM_LINK_TOKEN_TTL_MS,
  digestTelegramLinkToken,
  generateTelegramLinkToken,
  telegramLinkTokenExpiresAt,
  telegramLinkTokenMatches,
} from "./telegram-link-token";

test("generates unique base64url Telegram link tokens", () => {
  const first = generateTelegramLinkToken();
  const second = generateTelegramLinkToken();

  assert.notEqual(first, second);
  assert.match(first, /^[A-Za-z0-9_-]{43}$/);
  assert.match(second, /^[A-Za-z0-9_-]{43}$/);
});

test("digests tokens deterministically without storing the raw token", () => {
  const token = "example-token";
  const digest = digestTelegramLinkToken(token);

  assert.equal(digest, digestTelegramLinkToken(token));
  assert.notEqual(digest, token);
  assert.match(digest, /^[a-f0-9]{64}$/);
});

test("matches only the token that produced the expected digest", () => {
  const token = generateTelegramLinkToken();
  const digest = digestTelegramLinkToken(token);

  assert.equal(telegramLinkTokenMatches(token, digest), true);
  assert.equal(telegramLinkTokenMatches(`${token}x`, digest), false);
  assert.equal(telegramLinkTokenMatches(token, "00"), false);
});

test("expires link tokens after the configured TTL", () => {
  const now = new Date("2026-09-17T12:00:00.000Z");
  const expiresAt = telegramLinkTokenExpiresAt(now);

  assert.equal(expiresAt.getTime() - now.getTime(), TELEGRAM_LINK_TOKEN_TTL_MS);
  assert.equal(expiresAt.toISOString(), "2026-09-17T12:10:00.000Z");
});
