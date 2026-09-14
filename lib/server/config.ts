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

export function getServerConfig(): ServerConfig {
  const missing = REQUIRED_ENV.filter((name) => !process.env[name]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required server environment variables: ${missing.join(", ")}`,
    );
  }

  return Object.fromEntries(
    REQUIRED_ENV.map((name) => [name, process.env[name]!]),
  ) as ServerConfig;
}
