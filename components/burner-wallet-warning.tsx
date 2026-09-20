"use client";

import { useState } from "react";

export function BurnerWalletWarning() {
  const [acknowledged, setAcknowledged] = useState(false);

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

      <button
        type="button"
        disabled={!acknowledged}
        className="rounded-lg bg-zinc-950 px-4 py-2 font-medium text-white disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-950"
      >
        Continue wallet setup
      </button>
    </section>
  );
}
