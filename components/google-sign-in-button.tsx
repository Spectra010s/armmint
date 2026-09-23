"use client";

import { useState } from "react";

import { authClient } from "@/lib/auth-client";

export function GoogleSignInButton() {
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    setIsPending(true);
    setError(null);

    try {
      const { error: signInError } = await authClient.signIn.social({
        provider: "google",
        callbackURL: "/",
        errorCallbackURL: "/auth/error",
      });
      if (signInError)
        setError("Unable to sign in with Google. Please try again.");
    } catch {
      setError("Unable to sign in with Google. Please try again.");
    } finally {
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
