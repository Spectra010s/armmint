"use client";

import { useState, type FormEvent } from "react";

import {
  buildWalletSetupPayload,
  getWalletSetupErrorMessage,
  parseWalletSetupServerError,
  WALLET_SETUP_GENERIC_ERROR,
} from "@/lib/wallet-setup";

type SetupStatus = "idle" | "success";

export function BurnerWalletWarning() {
  const [acknowledged, setAcknowledged] = useState(false);
  const [address, setAddress] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<SetupStatus>("idle");
  const [savedAddress, setSavedAddress] = useState<string | null>(null);

  const canSubmit =
    acknowledged && address.trim().length > 0 && privateKey.length > 0;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    let payload;
    try {
      payload = buildWalletSetupPayload({
        address,
        privateKey,
        burnerWalletAcknowledged: acknowledged,
      });
    } catch (submitError) {
      setPrivateKey("");
      setError(getWalletSetupErrorMessage(submitError));
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch("/api/wallet", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }

      if (!response.ok) {
        setError(
          parseWalletSetupServerError(body) ?? WALLET_SETUP_GENERIC_ERROR,
        );
        return;
      }

      const walletAddress =
        typeof body === "object" &&
        body !== null &&
        "wallet" in body &&
        typeof (body as { wallet?: unknown }).wallet === "object" &&
        (body as { wallet: { address?: unknown } }).wallet !== null &&
        typeof (body as { wallet: { address?: unknown } }).wallet.address ===
          "string"
          ? (body as { wallet: { address: string } }).wallet.address
          : payload.address;

      setSavedAddress(walletAddress);
      setStatus("success");
      setAddress(walletAddress);
    } catch {
      setError(WALLET_SETUP_GENERIC_ERROR);
    } finally {
      setPrivateKey("");
      setIsSubmitting(false);
    }
  }

  return (
    <section className="space-y-4 rounded-xl border border-amber-300 bg-amber-50 p-5 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
      <div className="space-y-2">
        <h2 className="text-base font-semibold">Use a dedicated burner wallet only</h2>
        <p>
          Do not use your primary wallet or a wallet holding valuable assets.
          ArmMint stores the private key you submit encrypted on the server so
          it can execute mint jobs you authorize.
        </p>
        <p>
          Private-key setup must happen here in the authenticated ArmMint app.
          ArmMint will never ask you to send a private key in Telegram chat.
        </p>
      </div>

      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(event) => setAcknowledged(event.target.checked)}
          className="mt-1"
        />
        <span>
          I understand and confirm that I will only use a dedicated burner
          wallet for ArmMint.
        </span>
      </label>

      {status === "success" ? (
        <output className="block rounded-lg border border-zinc-200 bg-white p-3 text-zinc-950 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50">
          Burner wallet connected{savedAddress ? ` for ${savedAddress}` : ""}.
          The private key was never displayed and is stored encrypted
          server-side.
        </output>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1">
            <label htmlFor="burner-wallet-address" className="font-medium">
              Burner wallet address
            </label>
            <input
              id="burner-wallet-address"
              type="text"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              disabled={!acknowledged || isSubmitting}
              autoComplete="off"
              spellCheck={false}
              placeholder="0x…"
              className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-zinc-950 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="burner-wallet-private-key" className="font-medium">
              Burner wallet private key
            </label>
            <input
              id="burner-wallet-private-key"
              type="password"
              value={privateKey}
              onChange={(event) => setPrivateKey(event.target.value)}
              disabled={!acknowledged || isSubmitting}
              autoComplete="new-password"
              spellCheck={false}
              className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-zinc-950 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50"
            />
            <p className="text-xs opacity-80">
              Enter it here only. ArmMint never requests private keys in
              Telegram chat.
            </p>
          </div>

          {error ? (
            <p role="alert" className="text-sm font-medium text-red-700 dark:text-red-300">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={!canSubmit || isSubmitting}
            className="rounded-lg bg-zinc-950 px-4 py-2 font-medium text-white disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-950"
          >
            {isSubmitting ? "Connecting…" : "Continue wallet setup"}
          </button>
        </form>
      )}
    </section>
  );
}
