import { GoogleSignInButton } from "@/components/google-sign-in-button";
import { getCurrentSession } from "@/lib/server/session";

export default async function Home() {
  const session = await getCurrentSession();

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-6 text-zinc-950 dark:bg-black dark:text-zinc-50">
      <section className="w-full max-w-md space-y-6 rounded-2xl border border-zinc-200 bg-white p-8 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="space-y-2">
          <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
            ArmMint
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">
            Automated NFT minting, starting on Base.
          </h1>
        </div>

        {session?.user ? (
          <div className="space-y-1 text-sm">
            <p className="font-medium">Signed in as {session.user.name}</p>
            <p className="text-zinc-500 dark:text-zinc-400">
              {session.user.email}
            </p>
          </div>
        ) : (
          <GoogleSignInButton />
        )}
      </section>
    </main>
  );
}
