import assert from "node:assert/strict";
import test from "node:test";

import { createHttpJsonRpcTransport } from "./http-json-rpc.ts";

test("HTTP transport sends JSON-RPC requests and returns result", async () => {
  let body = "";
  const fetcher = async (_url: string | URL | Request, init?: RequestInit) => {
    body = String(init?.body);
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0xc" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const transport = createHttpJsonRpcTransport("https://rpc.example.test", fetcher as typeof fetch);
  assert.equal(await transport.request("eth_getTransactionCount", ["0xabc", "pending"]), "0xc");

  const parsed = JSON.parse(body);
  assert.equal(parsed.method, "eth_getTransactionCount");
  assert.deepEqual(parsed.params, ["0xabc", "pending"]);
});

test("HTTP transport rejects JSON-RPC errors without exposing request data", async () => {
  const fetcher = async () =>
    new Response(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32000, message: "execution failed" },
    }), { status: 200 });

  const transport = createHttpJsonRpcTransport("https://rpc.example.test", fetcher as typeof fetch);
  await assert.rejects(
    transport.request("eth_call", [{ data: "0xsensitive" }, "pending"]),
    /RPC request failed \(-32000\): execution failed/,
  );
});
