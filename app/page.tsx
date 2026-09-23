import Link from "next/link";
import { GoogleSignInButton } from "@/components/google-sign-in-button";
import { getCurrentSession } from "@/lib/server/session";

export default async function Home() {
  const session = await getCurrentSession();
  return (
    <main className="min-h-screen overflow-hidden bg-neutral-950 text-white">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-5 py-6 sm:px-8">
        <span className="text-lg font-semibold tracking-tight">ArmMint</span>
        {session?.user ? <Link href="/dashboard" className="rounded-lg border border-white/15 px-4 py-2 text-sm font-medium hover:bg-white/5">Open dashboard</Link> : null}
      </nav>
      <section className="mx-auto max-w-6xl px-5 pb-20 pt-16 sm:px-8 sm:pt-24">
        <div className="max-w-3xl">
          <p className="mb-5 text-xs font-semibold uppercase tracking-[.25em] text-emerald-400">Automated NFT minting</p>
          <h1 className="text-5xl font-semibold leading-[1.02] tracking-[-.04em] sm:text-7xl">Be ready when the mint goes live.</h1>
          <p className="mt-7 max-w-xl text-base leading-7 text-neutral-400 sm:text-lg">ArmMint schedules and executes NFT mints from a dedicated burner wallet, with Telegram as your command center and real-time transaction updates.</p>
          <div className="mt-9 max-w-xs">{session?.user ? <Link href="/dashboard" className="inline-block rounded-lg bg-white px-5 py-3 text-sm font-semibold text-black">Go to dashboard</Link> : <GoogleSignInButton />}</div>
        </div>
        <div className="mt-28 grid gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 md:grid-cols-3">
          {[["01","Connect","Sign in with Google, add a dedicated burner wallet, then securely link Telegram."],["02","Schedule","Create and review mint jobs from your linked Telegram account."],["03","Execute","ArmMint signs, submits, recovers when needed, and keeps you updated."]].map(([n,t,d]) => <div key={n} className="bg-neutral-950 p-6 sm:p-8"><span className="font-mono text-xs text-neutral-600">{n}</span><h2 className="mt-8 text-lg font-semibold">{t}</h2><p className="mt-2 text-sm leading-6 text-neutral-500">{d}</p></div>)}
        </div>
      </section>
    </main>
  );
}
