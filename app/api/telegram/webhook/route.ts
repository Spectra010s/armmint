import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getServerConfig } from "@/lib/server/config";
import { callTelegram } from "@/lib/server/telegram-api";
import { handleTelegramInput } from "@/lib/server/telegram-interface";
import { parseTelegramInput } from "@/lib/server/telegram-webhook";

export async function POST(request: NextRequest) {
  const config = getServerConfig();
  const supplied = Buffer.from(
    request.headers.get("x-telegram-bot-api-secret-token") ?? "",
  );
  const expected = Buffer.from(config.TELEGRAM_WEBHOOK_SECRET);
  if (
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  )
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let update: unknown;
  try {
    update = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid update" }, { status: 400 });
  }
  const input = parseTelegramInput(update);
  if (!input) return NextResponse.json({ ok: true });
  if (input.callback)
    await callTelegram(config.TELEGRAM_BOT_TOKEN, "answerCallbackQuery", {
      callback_query_id: input.callback.id,
    });
  try {
    const reply = await handleTelegramInput(input, {
      appUrl: config.BETTER_AUTH_URL,
      chainId: config.BASE_CHAIN_ID,
    });
    // State is committed before notification. Delivery failures must not rerun a
    // confirmed mint; /start, /jobs and Resume recover the current durable state.
    if (reply)
      await callTelegram(config.TELEGRAM_BOT_TOKEN, "sendMessage", {
        chat_id: input.chatId,
        ...reply,
      });
    return NextResponse.json({ ok: true });
  } catch {
    await callTelegram(config.TELEGRAM_BOT_TOKEN, "sendMessage", {
      chat_id: input.chatId,
      text: "ArmMint could not process this action. Please try again, or use /jobs to check whether your mint was created.",
    });
    // Failed database transactions roll back, allowing Telegram to retry safely.
    return NextResponse.json(
      { error: "Unable to process update" },
      { status: 503 },
    );
  }
}
