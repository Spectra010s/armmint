import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db";
import { wallets } from "@/lib/db/schema";
import { requireCurrentUser } from "@/lib/server/session";
import { encryptWalletPrivateKey } from "@/lib/server/wallet-key-service";

type WalletSetupBody = {
  address?: unknown;
  privateKey?: unknown;
  burnerWalletAcknowledged?: unknown;
};

async function saveWallet(request: NextRequest) {
  const user = await requireCurrentUser();

  let body: WalletSetupBody;
  try {
    body = (await request.json()) as WalletSetupBody;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  if (!body || typeof body !== "object" || Array.isArray(body))
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  if (body.burnerWalletAcknowledged !== true) {
    return NextResponse.json(
      { error: "Burner wallet acknowledgement is required" },
      { status: 400 },
    );
  }

  if (
    typeof body.address !== "string" ||
    !body.address.trim() ||
    typeof body.privateKey !== "string" ||
    !body.privateKey
  ) {
    return NextResponse.json(
      { error: "Wallet address and private key are required" },
      { status: 400 },
    );
  }

  const encrypted = encryptWalletPrivateKey(body.privateKey);

  const [wallet] = await db
    .insert(wallets)
    .values({
      id: randomUUID(),
      userId: user.id,
      address: body.address.trim(),
      ...encrypted,
    })
    .onConflictDoNothing({ target: wallets.userId })
    .returning({ id: wallets.id, address: wallets.address });

  if (!wallet) {
    const [existing] = await db
      .select({ id: wallets.id, address: wallets.address })
      .from(wallets)
      .where(eq(wallets.userId, user.id))
      .limit(1);

    return NextResponse.json(
      {
        error: "A wallet is already configured for this account",
        wallet: existing ?? null,
      },
      { status: 409 },
    );
  }

  return NextResponse.json({ wallet }, { status: 201 });
}

export async function POST(request: NextRequest) {
  try {
    return await saveWallet(request);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error && error.message === "Unauthorized"
            ? "Unauthorized"
            : "Unable to complete wallet setup. Please try again.",
      },
      {
        status:
          error instanceof Error && error.message === "Unauthorized"
            ? 401
            : 503,
      },
    );
  }
}
