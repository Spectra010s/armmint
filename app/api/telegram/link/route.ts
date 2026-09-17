import { NextResponse } from "next/server";

import { requireCurrentUser } from "@/lib/server/session";
import { issueTelegramLinkToken } from "@/lib/server/telegram-link-service";

export async function POST() {
  try {
    const user = await requireCurrentUser();
    const link = await issueTelegramLinkToken(user.id);

    return NextResponse.json({
      token: link.token,
      expiresAt: link.expiresAt.toISOString(),
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    throw error;
  }
}
