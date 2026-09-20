import { NextRequest, NextResponse } from "next/server";

import { getServerConfig } from "@/lib/server/config";
import { consumeTelegramLinkToken } from "@/lib/server/telegram-link-service";
import { parseTelegramLinkMessage } from "@/lib/server/telegram-webhook";

export async function POST(request: NextRequest) {
  const config = getServerConfig();
  const secret = request.headers.get("x-telegram-bot-api-secret-token");

  if (secret !== config.TELEGRAM_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let update: unknown;
  try {
    update = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid update" }, { status: 400 });
  }

  const message = parseTelegramLinkMessage(update);

  if (!message) {
    return NextResponse.json({ ok: true });
  }

  const result = await consumeTelegramLinkToken(message.token, message.identity);

  const text =
    result.status === "linked"
      ? "Your Telegram account is now linked to ArmMint."
      : result.status === "invalid_token"
        ? "This ArmMint link is invalid or expired. Generate a new link from ArmMint."
        : "This Telegram or ArmMint account is already linked. Unlink it before linking another account.";

  // Notification delivery is best-effort. The link result is already committed,
  // so a Telegram API failure must not make Telegram retry the processed update.
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: message.chatId, text }),
      },
    );

    if (!response.ok) {
      console.error("Failed to send Telegram link notification", {
        status: response.status,
      });
    }
  } catch (error) {
    console.error("Failed to send Telegram link notification", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }

  return NextResponse.json({ ok: true });
}
