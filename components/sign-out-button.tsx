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
    <div>
      <button
        type="button"
        disabled={busy}
        onClick={signOut}
        className="text-sm underline disabled:opacity-50"
      >
        {busy ? "Signing out…" : "Sign out"}
      </button>
      {failed && <p role="alert">Unable to sign out. Please try again.</p>}
    </div>
  );
}
