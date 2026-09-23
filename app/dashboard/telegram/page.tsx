import Link from "next/link";
import { redirect } from "next/navigation";
import { TelegramLinkPanel } from "@/components/telegram-link-panel";
import { getCurrentSession } from "@/lib/server/session";
import { getTelegramLinkStatus } from "@/lib/server/telegram-link-service";

export default async function TelegramPage(){const session=await getCurrentSession();if(!session?.user)redirect("/");const status=await getTelegramLinkStatus(session.user.id);return <main className="min-h-screen bg-neutral-950 text-white"><div className="mx-auto max-w-2xl px-5 py-8"><Link href="/dashboard" className="text-sm text-neutral-500 hover:text-white">← Dashboard</Link><p className="mt-8 text-xs font-semibold uppercase tracking-[.2em] text-emerald-400">Command center</p><h1 className="mt-2 text-3xl font-semibold">Telegram</h1><p className="mt-2 max-w-xl text-sm leading-6 text-neutral-400">Create, review and track mint jobs from your linked Telegram account. Linking credentials are short-lived and single-use.</p><div className="mt-8 rounded-2xl border border-white/10 bg-white/[.03] p-5 sm:p-6 text-neutral-200"><TelegramLinkPanel initialStatus={status}/></div></div></main>}
