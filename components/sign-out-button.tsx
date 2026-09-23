"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export function SignOutButton() {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function signOut() {
    setBusy(true);
    setFailed(false);
    try {
      const result = await authClient.signOut();
      if (result.error) throw new Error();
      window.location.assign("/");
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={busy}
        onClick={signOut}
        className="text-xs font-medium text-neutral-500 hover:text-white disabled:opacity-50"
      >
        {busy ? "Signing out…" : "Sign out"}
      </button>
      {failed && (
        <p role="alert" className="text-xs text-red-400">
          Unable to sign out. Please try again.
        </p>
      )}
    </div>
  );
}
