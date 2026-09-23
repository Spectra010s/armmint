import "server-only";

// Never log transport exceptions: their URL can contain the bot credential.
export async function callTelegram(
  token: string,
  method:
    "sendMessage" | "answerCallbackQuery" | "setMyCommands" | "setWebhook",
  body: unknown,
): Promise<boolean> {
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${token}/${method}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!response.ok) return false;
    const result: unknown = await response.json();
    return (
      typeof result === "object" &&
      result !== null &&
      "ok" in result &&
      result.ok === true
    );
  } catch {
    return false;
  }
}
