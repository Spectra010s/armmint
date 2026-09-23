import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";

import { db } from "@/lib/db";
import { telegramAccounts, telegramLinkTokens, users } from "@/lib/db/schema";
import {
  digestTelegramLinkToken,
  generateTelegramLinkToken,
  telegramLinkTokenExpiresAt,
} from "@/lib/server/telegram-link-token";

export type TelegramIdentity = {
  id: bigint;
  username?: string | null;
};

export type TelegramLinkResult =
  | { status: "linked"; userId: string }
  | { status: "invalid_token" }
  | { status: "telegram_already_linked" }
  | { status: "user_already_linked" };

export class TelegramAlreadyLinkedError extends Error {}

export async function issueTelegramLinkToken(userId: string) {
  const token = generateTelegramLinkToken();
  const expiresAt = telegramLinkTokenExpiresAt();

  await db.transaction(async (tx) => {
    // Serialize issuers so concurrent requests leave only the newest token valid.
    const [user] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      .for("update");
    if (!user) throw new Error("Unauthorized");
    const [existing] = await tx
      .select({ id: telegramAccounts.id })
      .from(telegramAccounts)
      .where(eq(telegramAccounts.userId, userId));
    if (existing)
      throw new TelegramAlreadyLinkedError("Telegram is already linked");
    await tx
      .delete(telegramLinkTokens)
      .where(
        and(
          eq(telegramLinkTokens.userId, userId),
          isNull(telegramLinkTokens.consumedAt),
        ),
      );

    await tx.insert(telegramLinkTokens).values({
      id: randomUUID(),
      userId,
      tokenDigest: digestTelegramLinkToken(token),
      expiresAt,
    });
  });

  return { token, expiresAt };
}

export async function consumeTelegramLinkToken(
  rawToken: string,
  identity: TelegramIdentity,
  now = new Date(),
): Promise<TelegramLinkResult> {
  const tokenDigest = digestTelegramLinkToken(rawToken);

  // Commit the conditional update before touching accounts. A link conflict or
  // failed account transaction must never make a presented token reusable.
  const token = await db.transaction(async (tx) => {
    const [consumed] = await tx
      .update(telegramLinkTokens)
      .set({ consumedAt: now })
      .where(
        and(
          eq(telegramLinkTokens.tokenDigest, tokenDigest),
          isNull(telegramLinkTokens.consumedAt),
          gt(telegramLinkTokens.expiresAt, now),
        ),
      )
      .returning({ userId: telegramLinkTokens.userId });

    return consumed;
  });

  if (!token) return { status: "invalid_token" };

  return db.transaction(async (tx) => {
    // The unique indexes arbitrate races on either identity. Never overwrite
    // an existing link, including when another request wins after consumption.
    const [linked] = await tx
      .insert(telegramAccounts)
      .values({
        id: randomUUID(),
        userId: token.userId,
        telegramUserId: identity.id,
        username: identity.username ?? null,
        linkedAt: now,
      })
      .onConflictDoNothing()
      .returning({ userId: telegramAccounts.userId });

    if (linked) return { status: "linked", userId: linked.userId };

    const [telegramOwner] = await tx
      .select({ userId: telegramAccounts.userId })
      .from(telegramAccounts)
      .where(eq(telegramAccounts.telegramUserId, identity.id))
      .limit(1);

    if (telegramOwner && telegramOwner.userId !== token.userId) {
      return { status: "telegram_already_linked" };
    }

    const [existingForUser] = await tx
      .select({ telegramUserId: telegramAccounts.telegramUserId })
      .from(telegramAccounts)
      .where(eq(telegramAccounts.userId, token.userId))
      .limit(1);

    if (existingForUser?.telegramUserId === identity.id) {
      return { status: "linked", userId: token.userId };
    }

    return { status: "user_already_linked" };
  });
}

export async function resolveTelegramUser(
  telegramUserId: bigint,
): Promise<string | null> {
  const [account] = await db
    .select({ userId: telegramAccounts.userId })
    .from(telegramAccounts)
    .where(eq(telegramAccounts.telegramUserId, telegramUserId))
    .limit(1);

  return account?.userId ?? null;
}

export async function getTelegramLinkStatus(userId: string) {
  const [account] = await db
    .select({ username: telegramAccounts.username })
    .from(telegramAccounts)
    .where(eq(telegramAccounts.userId, userId));
  return { linked: Boolean(account), username: account?.username ?? null };
}
