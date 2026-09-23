export function parseTelegramStartToken(text: unknown): string | null {
  if (typeof text !== "string") return null;

  const match = text.trim().match(/^\/start(?:@\w+)?\s+([A-Za-z0-9_-]{43})$/);

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

export function parseTelegramInput(
  update: unknown,
): import("./telegram-types").TelegramInput | null {
  if (
    !isRecord(update) ||
    !Number.isSafeInteger(update.update_id) ||
    (update.update_id as number) < 0
  )
    return null;
  const callback = isRecord(update.callback_query)
    ? update.callback_query
    : null;
  const message = callback ? callback.message : update.message;
  if (!isRecord(message) || !isRecord(message.chat)) return null;
  const from = callback ? callback.from : message.from;
  if (
    !isRecord(from) ||
    typeof from.id !== "number" ||
    !Number.isSafeInteger(from.id) ||
    from.id <= 0 ||
    from.is_bot === true ||
    message.chat.type !== "private" ||
    message.chat.id !== from.id
  )
    return null;
  if (
    callback &&
    (typeof callback.id !== "string" ||
      callback.id.length > 256 ||
      typeof callback.data !== "string" ||
      Buffer.byteLength(callback.data) > 64)
  )
    return null;
  if (
    !callback &&
    typeof message.text === "string" &&
    message.text.length > 8192
  )
    return null;
  if (
    typeof from.username === "string" &&
    from.username.length > 64
  )
    return null;
  return {
    updateId: update.update_id as number,
    chatId: from.id,
    identity: {
      id: BigInt(from.id),
      username: typeof from.username === "string" ? from.username : null,
    },
    text:
      !callback && typeof message.text === "string" ? message.text : undefined,
    callback: callback
      ? { id: callback.id as string, data: callback.data as string }
      : undefined,
  };
}
