import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";

export default async function DashboardPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/auth/sign-in");

  return (
    <main className="min-h-screen bg-neutral-950 text-white">
      <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8">
        <header className="mb-10 flex items-center justify-between border-b border-white/10 pb-5">
          <div><p className="text-xs font-semibold uppercase tracking-[.24em] text-emerald-400">ArmMint</p><h1 className="mt-1 text-2xl font-semibold">Dashboard</h1></div>
          <div className="text-right"><p className="text-sm font-medium">{session.user.name}</p><p className="text-xs text-neutral-500">{session.user.email}</p></div>
        </header>

        <section className="mb-8">
          <p className="text-sm text-neutral-400">Welcome back</p>
          <h2 className="mt-1 max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">Your minting command center.</h2>
          <p className="mt-3 max-w-xl text-sm leading-6 text-neutral-400">Connect Telegram, secure your burner wallet, and manage automated NFT mint jobs from one place.</p>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          <SetupCard number="01" title="Burner wallet" description="Add the dedicated wallet ArmMint uses to sign mint transactions." href="/dashboard/wallet" action="Set up wallet" />
          <SetupCard number="02" title="Telegram" description="Link your Telegram account securely to create and control mint jobs." href="/dashboard/telegram" action="Connect Telegram" />
          <SetupCard number="03" title="Mint jobs" description="See scheduled, running and completed mints, or create a new one." href="/dashboard/jobs" action="View jobs" />
        </section>

        <section className="mt-8 rounded-2xl border border-white/10 bg-white/[.03] p-5 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-xs font-medium uppercase tracking-widest text-neutral-500">Quick start</p><h3 className="mt-2 text-lg font-semibold">Create your next mint</h3><p className="mt-1 text-sm text-neutral-400">Once your wallet and Telegram account are connected, schedule a mint from Telegram.</p></div><a href="/dashboard/jobs" className="inline-flex shrink-0 items-center justify-center rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-black transition hover:bg-neutral-200">Open mint jobs →</a></div>
        </section>
      </div>
    </main>
  );
}

function SetupCard({ number, title, description, href, action }: { number: string; title: string; description: string; href: string; action: string }) {
  return <article className="flex min-h-56 flex-col rounded-2xl border border-white/10 bg-white/[.03] p-5 transition hover:border-white/20"><span className="text-xs font-mono text-neutral-600">{number}</span><h3 className="mt-6 text-lg font-semibold">{title}</h3><p className="mt-2 flex-1 text-sm leading-6 text-neutral-400">{description}</p><a href={href} className="mt-6 text-sm font-medium text-emerald-400 hover:text-emerald-300">{action} →</a></article>;
}
