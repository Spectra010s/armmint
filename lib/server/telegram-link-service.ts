import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";

import { db } from "@/lib/db";
import { telegramAccounts, telegramLinkTokens } from "@/lib/db/schema";
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

export async function issueTelegramLinkToken(userId: string) {
  const token = generateTelegramLinkToken();
  const expiresAt = telegramLinkTokenExpiresAt();

  await db.transaction(async (tx) => {
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

  return db.transaction(async (tx) => {
    const [token] = await tx
      .select({ id: telegramLinkTokens.id, userId: telegramLinkTokens.userId })
      .from(telegramLinkTokens)
      .where(
        and(
          eq(telegramLinkTokens.tokenDigest, tokenDigest),
          isNull(telegramLinkTokens.consumedAt),
          gt(telegramLinkTokens.expiresAt, now),
        ),
      )
      .for("update")
      .limit(1);

    if (!token) return { status: "invalid_token" };

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

    if (existingForUser && existingForUser.telegramUserId !== identity.id) {
      return { status: "user_already_linked" };
    }

    if (!existingForUser) {
      await tx.insert(telegramAccounts).values({
        id: randomUUID(),
        userId: token.userId,
        telegramUserId: identity.id,
        username: identity.username ?? null,
        linkedAt: now,
      });
    }

    const consumed = await tx
      .update(telegramLinkTokens)
      .set({ consumedAt: now })
      .where(
        and(
          eq(telegramLinkTokens.id, token.id),
          isNull(telegramLinkTokens.consumedAt),
        ),
      )
      .returning({ id: telegramLinkTokens.id });

    if (consumed.length !== 1) return { status: "invalid_token" };

    return { status: "linked", userId: token.userId };
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
