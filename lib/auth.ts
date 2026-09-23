import "server-only";

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { getServerConfig } from "@/lib/server/config";

function createAuth() {
  const config = getServerConfig();
  return betterAuth({
    appName: "ArmMint",
    baseURL: config.BETTER_AUTH_URL,
    secret: config.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema,
      usePlural: true,
    }),
    trustedOrigins: [new URL(config.BETTER_AUTH_URL).origin],
    account: {
      // ArmMint has one login provider; do not implicitly merge separate identities.
      accountLinking: { enabled: false },
      encryptOAuthTokens: true,
      storeStateStrategy: "database",
    },
    session: { cookieCache: { enabled: false } },
    // Provider/adapter exceptions may contain OAuth codes or tokens.
    logger: {
      level: "error",
      log: () => console.error("Authentication request failed"),
    },
    onAPIError: { errorURL: "/auth/error" },
    emailAndPassword: {
      enabled: false,
    },
    socialProviders: {
      google: {
        clientId: config.GOOGLE_CLIENT_ID,
        clientSecret: config.GOOGLE_CLIENT_SECRET,
      },
    },
  });
}

let auth: ReturnType<typeof createAuth> | undefined;

// Route collection must not validate runtime secrets or initialize auth.
export function getAuth() {
  return (auth ??= createAuth());
}
