"use client";

import { useState } from "react";

import { authClient } from "@/lib/auth-client";

export function GoogleSignInButton() {
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    setIsPending(true);
    setError(null);

    const { error: signInError } = await authClient.signIn.social({
      provider: "google",
      callbackURL: "/",
    });

    if (signInError) {
      setError(signInError.message ?? "Unable to sign in with Google");
      setIsPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={signIn}
        disabled={isPending}
        className="rounded-lg bg-black px-5 py-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-black"
      >
        {isPending ? "Redirecting…" : "Continue with Google"}
      </button>
      {error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}
