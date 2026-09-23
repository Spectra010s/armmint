"use client";
import { useState } from "react";

export function TelegramLinkPanel() {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  async function link() {
    setBusy(true);
    setError(false);
    setUrl(null);
    try {
      const response = await fetch("/api/telegram/link", { method: "POST" });
      if (!response.ok) throw new Error();
      const body = await response.json();
      if (typeof body.url !== "string" || !body.url.startsWith("https://t.me/"))
        throw new Error();
      setUrl(body.url);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-3 rounded-xl border border-zinc-300 p-4 dark:border-zinc-700">
      <h2 className="font-semibold">Use ArmMint in Telegram</h2>
      <p className="text-sm">
        Link your account to create, review, and track mint jobs in the bot.
        Wallet keys stay in this authenticated web setup.
      </p>
      <button
        type="button"
        onClick={link}
        disabled={busy}
        className="rounded-lg bg-blue-700 px-4 py-2 text-white disabled:opacity-50"
      >
        {busy ? "Creating link…" : "Link Telegram"}
      </button>
      {url && (
        <p>
          <a href={url} rel="noreferrer" className="underline">
            Open Telegram and press Start
          </a>
          <span className="block text-sm">
            This single-use link expires in 10 minutes.
          </span>
        </p>
      )}
      {error && (
        <p role="alert">
          Unable to create a link. Sign in again or try once more.
        </p>
      )}
    </section>
  );
}
