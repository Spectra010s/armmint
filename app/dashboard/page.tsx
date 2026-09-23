import Link from "next/link";
import { redirect } from "next/navigation";
import { SignOutButton } from "@/components/sign-out-button";
import { getUserWallet, listMintJobs } from "@/lib/server/mint-job-service";
import { getCurrentSession } from "@/lib/server/session";
import { getTelegramLinkStatus } from "@/lib/server/telegram-link-service";

export default async function DashboardPage() {
  const session = await getCurrentSession();
  if (!session?.user) redirect("/");
  const [wallet, telegram, jobs] = await Promise.all([getUserWallet(session.user.id), getTelegramLinkStatus(session.user.id), listMintJobs(session.user.id)]);
  const visibleJobs = jobs.slice(0, 5);
  return <main className="min-h-screen bg-neutral-950 text-white"><div className="mx-auto max-w-6xl px-5 py-8 sm:px-8">
    <header className="mb-10 flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-5"><div><Link href="/" className="text-xs font-semibold uppercase tracking-[.24em] text-emerald-400">ArmMint</Link><h1 className="mt-1 text-2xl font-semibold">Dashboard</h1></div><div className="flex items-center gap-4"><div className="text-right"><p className="text-sm font-medium">{session.user.name}</p><p className="text-xs text-neutral-500">{session.user.email}</p></div><SignOutButton /></div></header>
    <section className="mb-8"><p className="text-sm text-neutral-400">Welcome back</p><h2 className="mt-1 max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">Your minting command center.</h2><p className="mt-3 max-w-xl text-sm leading-6 text-neutral-400">Set up once on the web, then create and control mint jobs from Telegram.</p></section>
    <section className="grid gap-4 md:grid-cols-3"><Card n="01" title="Burner wallet" detail={wallet ? short(wallet.address) : "Not configured"} ready={Boolean(wallet)} href="/dashboard/wallet"/><Card n="02" title="Telegram" detail={telegram.linked ? telegram.username ? `@${telegram.username}` : "Linked" : "Not linked"} ready={telegram.linked} href="/dashboard/telegram"/><Card n="03" title="Mint jobs" detail={`${visibleJobs.length} recent job${visibleJobs.length === 1 ? "" : "s"}`} ready={visibleJobs.length > 0} href="/dashboard/jobs"/></section>
    <section className="mt-8 rounded-2xl border border-white/10 bg-white/[.03] p-5 sm:p-6"><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-xs font-medium uppercase tracking-widest text-neutral-500">Next step</p><h3 className="mt-2 text-lg font-semibold">{!wallet ? "Secure a burner wallet" : !telegram.linked ? "Connect Telegram" : "ArmMint is ready"}</h3><p className="mt-1 text-sm text-neutral-400">{!wallet ? "ArmMint needs a dedicated wallet before it can execute a mint." : !telegram.linked ? "Link the Telegram account you will use to schedule mints." : "Open Telegram to create a mint, then track execution here."}</p></div><Link href={!wallet ? "/dashboard/wallet" : !telegram.linked ? "/dashboard/telegram" : "/dashboard/jobs"} className="inline-flex shrink-0 items-center justify-center rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-black">Continue →</Link></div></section>
  </div></main>;
}
function short(value:string){return `${value.slice(0,6)}…${value.slice(-4)}`}
function Card({n,title,detail,ready,href}:{n:string;title:string;detail:string;ready:boolean;href:string}){return <Link href={href} className="flex min-h-48 flex-col rounded-2xl border border-white/10 bg-white/[.03] p-5 transition hover:border-white/25"><div className="flex items-center justify-between"><span className="font-mono text-xs text-neutral-600">{n}</span><span className={`rounded-full px-2 py-1 text-[11px] font-medium ${ready?"bg-emerald-400/10 text-emerald-300":"bg-white/5 text-neutral-500"}`}>{ready?"Ready":"Setup"}</span></div><h3 className="mt-8 text-lg font-semibold">{title}</h3><p className="mt-2 text-sm text-neutral-400">{detail}</p><span className="mt-auto pt-6 text-sm font-medium text-emerald-400">Manage →</span></Link>}
