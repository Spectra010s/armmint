import { getServerConfig } from "@/lib/server/config";
import { requireCurrentUser } from "@/lib/server/session";
import { createMintJob, MintInputError } from "@/lib/server/mint-job-service";
const headers = { "Cache-Control": "no-store" };
export async function POST(request: Request) {
  try {
    const user = await requireCurrentUser();
    if (request.headers.get("origin") !== new URL(getServerConfig().BETTER_AUTH_URL).origin)
      return Response.json({ error: "Invalid request origin" }, { status: 403, headers });
    const reader = request.body?.getReader();
    let body = "";
    if (reader) {
      const decoder = new TextDecoder();
      let bytes = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > 8192) {
            void reader.cancel().catch(() => {});
            return Response.json({ error: "Request is too large" }, { status: 413, headers });
          }
          body += decoder.decode(value, { stream: true });
        }
        body += decoder.decode();
      } finally { reader.releaseLock(); }
    }
    let input: Record<string, unknown>;
    try { input = JSON.parse(body); } catch { throw new MintInputError("Enter a valid mint configuration."); }
    if (!input || typeof input !== "object" || Array.isArray(input) ||
      Object.keys(input).some((key) => !["chainId", "contractAddress", "calldata", "valueWei", "scheduledFor", "idempotencyKey"].includes(key)) ||
      typeof input.chainId !== "number" || typeof input.contractAddress !== "string" ||
      typeof input.calldata !== "string" || typeof input.valueWei !== "string" ||
      typeof input.scheduledFor !== "string" || typeof input.idempotencyKey !== "string" ||
      !/^[a-f0-9-]{36}$/.test(input.idempotencyKey))
      throw new MintInputError("Enter a valid mint configuration.");
    const job = await createMintJob(user.id, {
      chainId: input.chainId, contractAddress: input.contractAddress,
      calldata: input.calldata, valueWei: input.valueWei, scheduledFor: input.scheduledFor,
    }, `web:${input.idempotencyKey}`);
    return Response.json({ id: job.id, chainId: job.chainId, state: job.state }, { status: 201, headers });
  } catch (error) {
    const unauthorized = error instanceof Error && error.message === "Unauthorized";
    return Response.json({ error: unauthorized ? "Unauthorized" : error instanceof MintInputError ? error.message : "Unable to create mint. Try again." },
      { status: unauthorized ? 401 : error instanceof MintInputError ? 400 : 503, headers });
  }
}
