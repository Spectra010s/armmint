import { NextRequest, NextResponse } from "next/server";

import { getServerConfig } from "@/lib/server/config";
import { consumeTelegramLinkToken } from "@/lib/server/telegram-link-service";
import { parseTelegramStartToken } from "@/lib/server/telegram-webhook";

type TelegramUpdate = {
  message?: {
    chat?: { id?: number };
    from?: { id?: number; username?: string };
    text?: string;
  };
};

export async function POST(request: NextRequest) {
  const config = getServerConfig();
  const secret = request.headers.get("x-telegram-bot-api-secret-token");

  if (secret !== config.TELEGRAM_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return NextResponse.json({ error: "Invalid update" }, { status: 400 });
  }

  const message = update.message;
  const token = parseTelegramStartToken(message?.text);
  const telegramUserId = message?.from?.id;

  if (!token || !Number.isSafeInteger(telegramUserId)) {
    return NextResponse.json({ ok: true });
  }

  const result = await consumeTelegramLinkToken(token, {
    id: BigInt(telegramUserId!),
    username: message?.from?.username ?? null,
  });

  if (message?.chat?.id !== undefined) {
    const text =
      result.status === "linked"
        ? "Your Telegram account is now linked to ArmMint."
        : result.status === "invalid_token"
          ? "This ArmMint link is invalid or expired. Generate a new link from ArmMint."
          : "This Telegram or ArmMint account is already linked. Unlink it before linking another account.";

    await fetch(
      `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: message.chat.id, text }),
      },
    );
  }

  return NextResponse.json({ ok: true });
}
