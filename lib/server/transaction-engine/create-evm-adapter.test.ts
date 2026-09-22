import assert from "node:assert/strict";
import test from "node:test";

import { createHttpEvmChainAdapter } from "./create-evm-adapter.ts";

test("HTTP EVM adapter composes transport and RPC client", async () => {
  const methods: string[] = [];
  const fetcher = async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    methods.push(body.method);
    const result =
      body.method === "eth_getTransactionCount" ? "0x7" : "0x";
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const adapter = createHttpEvmChainAdapter({
    rpcUrl: "https://rpc.example.test",
    fetcher: fetcher as typeof fetch,
  });
  const request = {
    chainId: 84532,
    from: "0x1111111111111111111111111111111111111111" as const,
    to: "0x2222222222222222222222222222222222222222" as const,
    data: "0x" as const,
  };

  await adapter.simulate(request);
  assert.equal(await adapter.getPendingNonce(request.from), 7);
  assert.deepEqual(methods, ["eth_call", "eth_getTransactionCount"]);
});
