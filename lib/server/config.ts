import "server-only";

const REQUIRED_ENV = [
  "DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "ARMINT_ENCRYPTION_KEY",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_WEBHOOK_SECRET",
  "RPC_URL",
] as const;

export type ServerConfig = {
  [K in (typeof REQUIRED_ENV)[number]]: string;
};

function requireNonEmpty(name: (typeof REQUIRED_ENV)[number]): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required server environment variable: ${name}`);
  }

  return value;
}

function validateUrl(name: "DATABASE_URL" | "RPC_URL", value: string): void {
  try {
    new URL(value);
  } catch {
    throw new Error(`Invalid URL in server environment variable: ${name}`);
  }
}

function validateEncryptionKey(value: string): void {
  const decoded = Buffer.from(value, "base64");
  const canonical = decoded.toString("base64").replace(/=+$/, "");
  const supplied = value.replace(/=+$/, "");

  if (decoded.length !== 32 || canonical !== supplied) {
    throw new Error(
      "ARMINT_ENCRYPTION_KEY must be a base64-encoded 32-byte key",
    );
  }
}

export function getServerConfig(): ServerConfig {
  const config = Object.fromEntries(
    REQUIRED_ENV.map((name) => [name, requireNonEmpty(name)]),
  ) as ServerConfig;

  validateUrl("DATABASE_URL", config.DATABASE_URL);
  validateUrl("RPC_URL", config.RPC_URL);
  validateEncryptionKey(config.ARMINT_ENCRYPTION_KEY);

  return config;
}
