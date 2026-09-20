export function parseTelegramStartToken(
  text: unknown,
): string | null {
  if (typeof text !== "string") return null;

  const match = text
    .trim()
    .match(/^\/start(?:@\w+)?\s+([A-Za-z0-9_-]{43})$/);

  return match?.[1] ?? null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseTelegramLinkMessage(update: unknown) {
  if (!isRecord(update) || !isRecord(update.message)) return null;

  const { from, chat, text } = update.message;
  if (!isRecord(from) || !isRecord(chat)) return null;

  const token = parseTelegramStartToken(text);
  // Link only in the sender's private chat. Identity always comes from the
  // authenticated Telegram update, never from the deep-link payload.
  if (
    !token ||
    typeof from.id !== "number" ||
    !Number.isSafeInteger(from.id) ||
    from.id <= 0 ||
    from.is_bot === true ||
    chat.type !== "private" ||
    chat.id !== from.id
  ) {
    return null;
  }

  return {
    token,
    chatId: from.id,
    identity: {
      id: BigInt(from.id),
      username: typeof from.username === "string" ? from.username : null,
    },
  };
}
