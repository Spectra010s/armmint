"use client";
import { useState } from "react";

// Truncated by default so a 42-char address never overflows small screens.
// The eye toggle reveals the full value; nothing secret is ever shown here.
export function WalletAddress({ address }: { address: string }) {
  const [revealed, setRevealed] = useState(false);
  const short =
    address.length > 24
      ? `${address.slice(0, 12)}…${address.slice(-8)}`
      : address;
  return (
    <span className="inline-flex max-w-full items-center gap-2">
      <span className="truncate font-mono text-sm" title={address}>
        {revealed ? address : short}
      </span>
      <button
        type="button"
        onClick={() => setRevealed((value) => !value)}
        aria-label={revealed ? "Hide full address" : "Show full address"}
        aria-pressed={revealed}
        className="shrink-0 rounded px-1 text-sm text-neutral-500 hover:text-white"
      >
        {revealed ? "🙈" : "👁"}
      </button>
    </span>
  );
}
