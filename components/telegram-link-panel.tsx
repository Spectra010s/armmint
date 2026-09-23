"use client";
import { useState } from "react";

export function TelegramLinkPanel({
  initialStatus,
}: {
  initialStatus: { linked: boolean; username: string | null };
}) {
  const [status, setStatus] = useState(initialStatus);
  const [checked, setChecked] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  async function check() {
    setBusy(true);
    setError(false);
    try {
      const response = await fetch("/api/telegram/link", { cache: "no-store" });
      if (!response.ok) throw new Error();
      const body = await response.json();
      if (typeof body.linked !== "boolean") throw new Error();
      setChecked(true);
      setStatus({
        linked: body.linked,
        username: typeof body.username === "string" ? body.username : null,
      });
      if (body.linked) setUrl(null);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  async function link() {
    setBusy(true);
    setError(false);
    setUrl(null);
    try {
      const response = await fetch("/api/telegram/link", { method: "POST" });
      if (response.status === 409) {
        await check();
        return;
      }
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
      {status.linked ? (
        <output>
          Telegram is linked{status.username ? ` as @${status.username}` : ""}.
          Open your bot chat to create and track mints.
        </output>
      ) : (
        <button
          type="button"
          onClick={link}
          disabled={busy}
          className="rounded-lg bg-blue-700 px-4 py-2 text-white disabled:opacity-50"
        >
          {busy ? "Creating link…" : "Link Telegram"}
        </button>
      )}
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
      {checked && !status.linked && (
        <p>
          No Telegram link yet. Open Telegram and press Start, then check again.
        </p>
      )}
      {!status.linked && (
        <button
          type="button"
          onClick={check}
          disabled={busy}
          className="block text-sm underline"
        >
          I’ve pressed Start — check link
        </button>
      )}
      {error && (
        <p role="alert">
          Unable to check or create a link. Sign in again or try once more.
        </p>
      )}
    </section>
  );
}
