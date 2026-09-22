import assert from "node:assert/strict";
import test from "node:test";

import { createJsonRpcEvmClient, type JsonRpcTransport } from "./json-rpc-client.ts";

test("JSON-RPC client simulates and resolves pending nonce", async () => {
  const calls: Array<[string, readonly unknown[]]> = [];
  const transport: JsonRpcTransport = {
    async request<T>(method: string, params: readonly unknown[]) {
      calls.push([method, params]);
      if (method === "eth_getTransactionCount") return "0xc" as T;
      return "0x" as T;
    },
  };
  const client = createJsonRpcEvmClient(transport);
  const request = {
    chainId: 84532,
    from: "0x1111111111111111111111111111111111111111" as const,
    to: "0x2222222222222222222222222222222222222222" as const,
    data: "0x1234" as const,
    value: 2n,
  };

  await client.simulate(request);
  assert.equal(await client.getPendingNonce(request.from), 12);
  assert.equal(calls[0]?.[0], "eth_call");
  assert.equal(calls[1]?.[0], "eth_getTransactionCount");
});

test("JSON-RPC client classifies successful and reverted receipts", async () => {
  const makeClient = (status: "0x0" | "0x1") =>
    createJsonRpcEvmClient({
      async request<T>() {
        return {
          transactionHash:
            "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          status,
        } as T;
      },
    });

  assert.equal((await makeClient("0x1").receipt("0xabc")).state, "CONFIRMED");
  assert.equal((await makeClient("0x0").receipt("0xabc")).state, "REVERTED");
});

test("JSON-RPC client submits only raw transactions from the signing boundary", async () => {
  const calls: Array<[string, readonly unknown[]]> = [];
  const transport: JsonRpcTransport = {
    async request<T>(method: string, params: readonly unknown[]) {
      calls.push([method, params]);
      return "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as T;
    },
  };
  const client = createJsonRpcEvmClient(transport, {
    async broadcast(request) {
      return { rawTransaction: "0xdeadbeef", nonce: request.nonce };
    },
  });

  const submitted = await client.broadcast({
    chainId: 84532,
    from: "0x1111111111111111111111111111111111111111",
    to: "0x2222222222222222222222222222222222222222",
    data: "0x",
    nonce: 12,
  });

  assert.equal(calls[0]?.[0], "eth_sendRawTransaction");
  assert.deepEqual(calls[0]?.[1], ["0xdeadbeef"]);
  assert.equal(submitted.nonce, 12);
});

test("JSON-RPC client rejects a signing boundary that changes the reserved nonce", async () => {
  const client = createJsonRpcEvmClient(
    { async request<T>() { return "0xhash" as T; } },
    { async broadcast() { return { rawTransaction: "0xdeadbeef", nonce: 13 }; } },
  );

  await assert.rejects(
    client.broadcast({
      chainId: 84532,
      from: "0x1111111111111111111111111111111111111111",
      to: "0x2222222222222222222222222222222222222222",
      data: "0x",
      nonce: 12,
    }),
    /changed the reserved transaction nonce/,
  );
});
