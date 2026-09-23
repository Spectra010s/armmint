import "server-only";

const REQUIRED_ENV = [
  "DATABASE_URL",
  "BETTER_AUTH_URL",
  "BETTER_AUTH_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "ARMINT_ENCRYPTION_KEY",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_BOT_USERNAME",
  "TELEGRAM_WEBHOOK_SECRET",
  "BASE_RPC_URL",
] as const;

export type ServerConfig = {
  [K in (typeof REQUIRED_ENV)[number]]: string;
} & { BASE_CHAIN_ID: number };

function requireNonEmpty(name: (typeof REQUIRED_ENV)[number]): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required server environment variable: ${name}`);
  }

  return value;
}

function validateUrl(
  name: "DATABASE_URL" | "BETTER_AUTH_URL" | "BASE_RPC_URL",
  value: string,
): void {
  if (!URL.canParse(value)) {
    throw new Error(`Invalid URL in server environment variable: ${name}`);
  }
}

function decodeEncryptionKey(value: string): Buffer {
  const decoded = Buffer.from(value, "base64");
  const canonical = decoded.toString("base64").replace(/=+$/, "");
  const supplied = value.replace(/=+$/, "");

  if (decoded.length !== 32 || canonical !== supplied) {
    throw new Error(
      "ARMINT_ENCRYPTION_KEY must be a base64-encoded 32-byte key",
    );
  }

  return decoded;
}

function validateTelegramBotUsername(value: string): void {
  const username = value.startsWith("@") ? value.slice(1) : value;

  if (!/^[A-Za-z0-9_]{5,32}$/.test(username)) {
    throw new Error("Invalid TELEGRAM_BOT_USERNAME");
  }
}

export function getWalletEncryptionKey(): Buffer {
  return decodeEncryptionKey(requireNonEmpty("ARMINT_ENCRYPTION_KEY"));
}

export function getServerConfig(): ServerConfig {
  const required = Object.fromEntries(
    REQUIRED_ENV.map((name) => [name, requireNonEmpty(name)]),
  ) as { [K in (typeof REQUIRED_ENV)[number]]: string };
  const rawChainId = process.env.BASE_CHAIN_ID?.trim();
  if (!rawChainId) {
    throw new Error("Missing required server environment variable: BASE_CHAIN_ID");
  }
  const config: ServerConfig = {
    ...required,
    BASE_CHAIN_ID: Number(rawChainId),
  };

  if (![8453, 84532].includes(config.BASE_CHAIN_ID))
    throw new Error("BASE_CHAIN_ID must be 8453 or 84532");
  validateUrl("DATABASE_URL", config.DATABASE_URL);
  validateUrl("BETTER_AUTH_URL", config.BETTER_AUTH_URL);
  validateUrl("BASE_RPC_URL", config.BASE_RPC_URL);
  validateTelegramBotUsername(config.TELEGRAM_BOT_USERNAME);
  decodeEncryptionKey(config.ARMINT_ENCRYPTION_KEY);

  return config;
}
