import "server-only";

import { headers } from "next/headers";

import { getAuth } from "@/lib/auth";

export async function getCurrentSession() {
  // Enter request scope before initializing runtime dependencies during rendering.
  const requestHeaders = await headers();
  return getAuth().api.getSession({
    headers: requestHeaders,
  });
}

export async function requireCurrentUser() {
  const session = await getCurrentSession();

  if (!session?.user) {
    throw new Error("Unauthorized");
  }

  return session.user;
}
