import type { JsonRpcTransport } from "./json-rpc-client";

export function createHttpJsonRpcTransport(
  url: string,
  fetcher: typeof fetch = fetch,
  timeoutMs = 15000,
): JsonRpcTransport {
  let requestId = 0;

  return {
    async request<T>(method: string, params: readonly unknown[]): Promise<T> {
      const response = await fetcher(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: ++requestId,
          method,
          params,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) {
        throw new Error(`RPC HTTP request failed with status ${response.status}`);
      }

      const payload = await response.json() as {
        result?: T;
        error?: { code?: number; message?: string };
      };

      if (payload.error) {
        throw new Error(
          `RPC request failed${payload.error.code === undefined ? "" : ` (${payload.error.code})`}: ${payload.error.message ?? "unknown error"}`,
        );
      }

      if (!("result" in payload)) {
        throw new Error("RPC response did not include a result");
      }

      return payload.result as T;
    },
  };
}
