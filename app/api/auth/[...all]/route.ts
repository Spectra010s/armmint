import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth";
import { getServerConfig } from "@/lib/server/config";
const handlers = toNextJsHandler(auth);

async function handle(request: Request, method: "GET" | "POST") {
  try {
    const response = await handlers[method](request);
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "no-store");
    headers.set("Referrer-Policy", "no-referrer");
    const location = headers.get("location");
    if (location) {
      const destination = new URL(location, getServerConfig().BETTER_AUTH_URL);
      // Do not forward provider error descriptions or state into a browser URL.
      if (
        destination.searchParams.has("error") ||
        destination.searchParams.has("error_description") ||
        destination.pathname === "/auth/error"
      ) {
        headers.set(
          "location",
          new URL("/auth/error", getServerConfig().BETTER_AUTH_URL).toString(),
        );
      }
    }
    if (response.status >= 400)
      return Response.json(
        { error: "Unable to complete authentication. Please try again." },
        { status: response.status, headers },
      );
    return new Response(response.body, { status: response.status, headers });
  } catch {
    return Response.json(
      { error: "Unable to complete authentication. Please try again." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
export const GET = (request: Request) => handle(request, "GET");
export const POST = (request: Request) => handle(request, "POST");
