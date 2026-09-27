import assert from "node:assert/strict";
import { test } from "node:test";
import { MINT_NETWORKS, getNetwork, isMintNetwork, networkName, transactionExplorerUrl } from "./networks.ts";
import { getNetworkRpcUrl } from "./server/network-config.ts";

test("registry exposes only verified Arc and Ink networks and labels Base history", () => {
  assert.deepEqual(MINT_NETWORKS.map(n => n.chain.id), [5042002, 763373, 5042, 57073]);
  assert.equal(getNetwork(5042002)!.chain.nativeCurrency.symbol, "USDC");
  assert.equal(getNetwork(5042002)!.chain.nativeCurrency.decimals, 18);
  assert.equal(getNetwork(763373)!.chain.nativeCurrency.symbol, "ETH");
  for (const id of [1, 0, 8453, 84532, NaN, "5042"]) assert.equal(isMintNetwork(id), false);
  assert.equal(networkName(8453), "Base (legacy)");
});
test("explorer links belong to the persisted chain and reject invalid hashes", () => {
  const hash = `0x${"ab".repeat(32)}`;
  for (const [id, url] of [[5042, "https://explorer.arc.io"], [5042002, "https://explorer.testnet.arc.io"], [57073, "https://explorer.inkonchain.com"], [763373, "https://explorer-sepolia.inkonchain.com"], [8453, "https://basescan.org"]] as const)
    assert.equal(transactionExplorerUrl(id, hash), `${url}/tx/${hash}`);
  assert.equal(transactionExplorerUrl(1, hash), null);
  assert.equal(transactionExplorerUrl(5042, "javascript:alert(1)"), null);
});
test("RPC overrides are lazy, per network and cannot redefine chain identity", () => {
  const previous = process.env.ARC_TESTNET_RPC_URL;
  try {
    delete process.env.ARC_TESTNET_RPC_URL;
    assert.equal(getNetworkRpcUrl(5042002), "https://rpc.testnet.arc.io");
    process.env.ARC_TESTNET_RPC_URL = "https://provider.example/private-key";
    assert.equal(getNetworkRpcUrl(5042002), "https://provider.example/private-key");
    assert.equal(getNetworkRpcUrl(763373), "https://rpc-gel-sepolia.inkonchain.com");
    assert.equal(getNetwork(5042002)!.chain.id, 5042002);
    process.env.ARC_TESTNET_RPC_URL = "private-key";
    assert.throws(() => getNetworkRpcUrl(5042002), error => error instanceof Error && !error.message.includes("private-key"));
    assert.throws(() => getNetworkRpcUrl(777), /Unsupported/);
  } finally {
    if (previous === undefined) delete process.env.ARC_TESTNET_RPC_URL; else process.env.ARC_TESTNET_RPC_URL = previous;
  }
});
