import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/server/session";
import { MintJobForm } from "@/components/mint-job-form";
export default async function NewMintPage() {
  const session = await getCurrentSession();
  if (!session?.user) redirect("/");
  return <main className="mx-auto max-w-3xl px-5 py-8"><Link href="/dashboard/jobs">← Mint jobs</Link><h1 className="mt-6 text-3xl font-semibold">Create a mint job</h1><MintJobForm /></main>;
}
