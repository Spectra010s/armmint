import { getServerConfig } from "../lib/server/config";
import { callTelegram } from "../lib/server/telegram-api";

async function main() {
  const config = getServerConfig();
  const webhook = new URL("/api/telegram/webhook", config.BETTER_AUTH_URL);
  if (webhook.protocol !== "https:") throw new Error("Webhook requires HTTPS");
  const commands = [
    { command: "start", description: "Open ArmMint and resume a draft" },
    { command: "mint", description: "Create a mint job" },
    { command: "jobs", description: "List your mint jobs and status" },
    { command: "wallet", description: "Open secure wallet setup" },
    { command: "cancel", description: "Discard the current mint draft" },
    { command: "back", description: "Return to the previous mint step" },
    { command: "help", description: "How ArmMint works" },
  ];
  const commandsSet = await callTelegram(
    config.TELEGRAM_BOT_TOKEN,
    "setMyCommands",
    { commands, scope: { type: "all_private_chats" } },
  );
  if (!commandsSet) throw new Error("Command registration failed");
  const webhookSet = await callTelegram(
    config.TELEGRAM_BOT_TOKEN,
    "setWebhook",
    {
      url: webhook.toString(),
      secret_token: config.TELEGRAM_WEBHOOK_SECRET,
      allowed_updates: ["message", "callback_query"],
      max_connections: 1,
    },
  );
  if (!webhookSet) throw new Error("Webhook registration failed");
  console.info("Telegram commands and webhook configured.");
}
main().catch(() => {
  console.error(
    "Telegram setup failed. Check the HTTPS app URL, bot configuration and connectivity.",
  );
  process.exitCode = 1;
});
