import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { isAddress, zeroAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { db } from "@/lib/db";
import { wallets } from "@/lib/db/schema";
import { getServerConfig } from "@/lib/server/config";
import { requireCurrentUser } from "@/lib/server/session";
import { encryptWalletPrivateKey } from "@/lib/server/wallet-key-service";

const headers = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
};

type WalletSetupBody = {
  address?: unknown;
  privateKey?: unknown;
  burnerWalletAcknowledged?: unknown;
};

async function saveWallet(request: NextRequest) {
  const user = await requireCurrentUser();

  try {
    const config = getServerConfig();
    if (
      request.headers.get("origin") !== new URL(config.BETTER_AUTH_URL).origin
    )
      return NextResponse.json(
        { error: "Invalid request origin" },
        { status: 403, headers },
      );
  } catch {
    return NextResponse.json(
      { error: "Unable to complete wallet setup. Please try again." },
      { status: 503, headers },
    );
  }

  let body: WalletSetupBody;
  try {
    body = (await request.json()) as WalletSetupBody;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400, headers });
  }

  if (!body || typeof body !== "object" || Array.isArray(body))
    return NextResponse.json({ error: "Invalid request" }, { status: 400, headers });

  if (body.burnerWalletAcknowledged !== true) {
    return NextResponse.json(
      { error: "Burner wallet acknowledgement is required" },
      { status: 400, headers },
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
      { status: 400, headers },
    );
  }

  const address = body.address.trim();
  const privateKey = body.privateKey;
  if (
    address.length > 64 ||
    privateKey.length > 128 ||
    !isAddress(address) ||
    address.toLowerCase() === zeroAddress ||
    !/^0x[0-9a-fA-F]{64}$/.test(privateKey)
  ) {
    return NextResponse.json(
      { error: "Wallet address and private key are required" },
      { status: 400, headers },
    );
  }
  try {
    if (
      privateKeyToAccount(privateKey as `0x${string}`).address.toLowerCase() !==
      address.toLowerCase()
    ) {
      return NextResponse.json(
        { error: "Wallet address and private key are required" },
        { status: 400, headers },
      );
    }
  } catch {
    return NextResponse.json(
      { error: "Wallet address and private key are required" },
      { status: 400, headers },
    );
  }

  const encrypted = encryptWalletPrivateKey(privateKey);

  const [wallet] = await db
    .insert(wallets)
    .values({
      id: randomUUID(),
      userId: user.id,
      address,
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
      { status: 409, headers },
    );
  }

  return NextResponse.json({ wallet }, { status: 201, headers });
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
        headers,
      },
    );
  }
}
