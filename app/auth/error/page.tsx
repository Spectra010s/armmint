import Link from "next/link";
import { GoogleSignInButton } from "@/components/google-sign-in-button";
export default function AuthError() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <section className="w-full max-w-md space-y-5 rounded-2xl border p-8">
        <h1 className="text-2xl font-semibold">Sign-in wasn’t completed</h1>
        <p>
          The request may have expired or Google sign-in was cancelled. Try
          again to return to your ArmMint account.
        </p>
        <GoogleSignInButton />
        <Link href="/" className="block underline">
          Back to ArmMint
        </Link>
      </section>
    </main>
  );
}
