import assert from "node:assert/strict";
import { test } from "node:test";
import { MINT_NETWORKS, getNetwork, isMintNetwork, networkName, transactionExplorerUrl } from "./networks.ts";
import { getNetworkRpcUrl } from "./server/network-config.ts";

test("registry exposes only verified RH and Ink networks", () => {
  assert.deepEqual(MINT_NETWORKS.map(n => n.chain.id), [46630, 763373, 4663, 57073]);
  assert.equal(getNetwork(46630)!.chain.nativeCurrency.symbol, "ETH");
  assert.equal(getNetwork(46630)!.chain.nativeCurrency.decimals, 18);
  assert.equal(getNetwork(763373)!.chain.nativeCurrency.symbol, "ETH");
  for (const id of [1, 0, 8453, 84532, 5042, 5042002, NaN, "4663"]) assert.equal(isMintNetwork(id), false);
  assert.equal(networkName(8453), "Unknown network (8453)");
});
test("explorer links belong to the persisted chain and reject invalid hashes", () => {
  const hash = `0x${"ab".repeat(32)}`;
  for (const [id, url] of [[4663, "https://robinhoodchain.blockscout.com"], [46630, "https://explorer.testnet.chain.robinhood.com"], [57073, "https://explorer.inkonchain.com"], [763373, "https://explorer-sepolia.inkonchain.com"]] as const)
    assert.equal(transactionExplorerUrl(id, hash), `${url}/tx/${hash}`);
  assert.equal(transactionExplorerUrl(1, hash), null);
  assert.equal(transactionExplorerUrl(8453, hash), null);
  assert.equal(transactionExplorerUrl(4663, "javascript:alert(1)"), null);
});
test("RPC overrides are lazy, per network and cannot redefine chain identity", () => {
  const previous = process.env.RH_TESTNET_RPC_URL;
  try {
    delete process.env.RH_TESTNET_RPC_URL;
    assert.equal(getNetworkRpcUrl(46630), "https://rpc.testnet.chain.robinhood.com");
    process.env.RH_TESTNET_RPC_URL = "https://provider.example/private-key";
    assert.equal(getNetworkRpcUrl(46630), "https://provider.example/private-key");
    assert.equal(getNetworkRpcUrl(763373), "https://rpc-gel-sepolia.inkonchain.com");
    assert.equal(getNetwork(46630)!.chain.id, 46630);
    process.env.RH_TESTNET_RPC_URL = "private-key";
    assert.throws(() => getNetworkRpcUrl(46630), error => error instanceof Error && !error.message.includes("private-key"));
    assert.throws(() => getNetworkRpcUrl(777), /Unsupported/);
  } finally {
    if (previous === undefined) delete process.env.RH_TESTNET_RPC_URL; else process.env.RH_TESTNET_RPC_URL = previous;
  }
});
