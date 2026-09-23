import { NextRequest, NextResponse } from "next/server";
import { getServerConfig } from "@/lib/server/config";
import { requireCurrentUser } from "@/lib/server/session";
import {
  getTelegramLinkStatus,
  issueTelegramLinkToken,
  TelegramAlreadyLinkedError,
} from "@/lib/server/telegram-link-service";
const headers = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
};
function failure(error: unknown) {
  if (error instanceof Error && error.message === "Unauthorized")
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers },
    );
  if (error instanceof TelegramAlreadyLinkedError)
    return NextResponse.json(
      { error: "Telegram is already linked" },
      { status: 409, headers },
    );
  return NextResponse.json(
    { error: "Unable to access Telegram linking. Please try again." },
    { status: 503, headers },
  );
}
export async function GET() {
  try {
    return NextResponse.json(
      await getTelegramLinkStatus((await requireCurrentUser()).id),
      { headers },
    );
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: NextRequest) {
  try {
    const user = await requireCurrentUser();
    const config = getServerConfig();
    // This is a browser-initiated, bodyless operation. The session is the only
    // source of ownership; no user ID or Telegram identity can be supplied.
    if (
      request.headers.get("origin") !== new URL(config.BETTER_AUTH_URL).origin
    )
      return NextResponse.json(
        { error: "Invalid request origin" },
        { status: 403, headers },
      );
    if (request.body !== null)
      return NextResponse.json(
        { error: "This request must not contain a body" },
        { status: 400, headers },
      );
    const link = await issueTelegramLinkToken(user.id);
    const username = config.TELEGRAM_BOT_USERNAME.replace(/^@/, "");
    return NextResponse.json(
      {
        url: `https://t.me/${username}?start=${link.token}`,
        expiresAt: link.expiresAt.toISOString(),
      },
      { headers },
    );
  } catch (error) {
    return failure(error);
  }
}
