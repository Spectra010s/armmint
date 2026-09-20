import { NextResponse } from "next/server";

import { getServerConfig } from "@/lib/server/config";
import { requireCurrentUser } from "@/lib/server/session";
import { issueTelegramLinkToken } from "@/lib/server/telegram-link-service";

function telegramDeepLink(botUsername: string, token: string): string {
  const username = botUsername.startsWith("@")
    ? botUsername.slice(1)
    : botUsername;

  return `https://t.me/${username}?start=${token}`;
}

export async function POST() {
  try {
    const user = await requireCurrentUser();
    const link = await issueTelegramLinkToken(user.id);
    const config = getServerConfig();

    return NextResponse.json({
      url: telegramDeepLink(config.TELEGRAM_BOT_USERNAME, link.token),
      expiresAt: link.expiresAt.toISOString(),
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    throw error;
  }
}
