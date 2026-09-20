import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const TOKEN_BYTES = 32;

export const TELEGRAM_LINK_TOKEN_TTL_MS = 10 * 60 * 1000;

export function generateTelegramLinkToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function digestTelegramLinkToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function telegramLinkTokenMatches(
  token: string,
  expectedDigest: string,
): boolean {
  const actual = Buffer.from(digestTelegramLinkToken(token), "hex");
  const expected = Buffer.from(expectedDigest, "hex");

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function telegramLinkTokenExpiresAt(now = new Date()): Date {
  return new Date(now.getTime() + TELEGRAM_LINK_TOKEN_TTL_MS);
}
