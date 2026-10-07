import { defineChain } from "viem";
import { ink, inkSepolia } from "viem/chains";
import type { Chain } from "viem";

// Official RH/Ink connection docs verified 2026-10-07 (docs.robinhood.com/chain,
// docs.inkonchain.com). Only public metadata belongs here: runtime provider
// overrides live in server/network-config.ts. viem has no built-in Robinhood
// Chain, so both RH networks are defined explicitly. Single burner wallet
// covers all networks: one key yields the same address on every EVM chain,
// nonces are independent per chain, each chain just needs its own funding.
export const robinhoodTestnet = defineChain({
  id: 46630,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.chain.robinhood.com"] } },
  blockExplorers: {
    default: {
      name: "RH Explorer",
      url: "https://explorer.testnet.chain.robinhood.com",
    },
  },
  testnet: true,
});

export const robinhood = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
  blockExplorers: {
    default: { name: "RH Explorer", url: "https://robinhoodchain.blockscout.com" },
  },
});
export type Network = {
  chain: Chain;
  rpcEnv: string;
};
// No Base jobs were ever created in production, so no legacy registry remains.
// Any historical row with another chain ID displays as unknown and fails closed.
export const NETWORKS = [
  { chain: robinhoodTestnet, rpcEnv: "RH_TESTNET_RPC_URL" },
  { chain: inkSepolia, rpcEnv: "INK_SEPOLIA_RPC_URL" },
  { chain: robinhood, rpcEnv: "RH_RPC_URL" },
  { chain: ink, rpcEnv: "INK_RPC_URL" },
] as const satisfies readonly Network[];
export type NetworkChainId = (typeof NETWORKS)[number]["chain"]["id"];
export const MINT_NETWORKS = NETWORKS;
export function getNetwork(chainId: number): Network | undefined {
  return NETWORKS.find((network) => network.chain.id === chainId);
}
export function isMintNetwork(chainId: unknown): chainId is NetworkChainId {
  return typeof chainId === "number" && MINT_NETWORKS.some((network) => network.chain.id === chainId);
}
export function networkName(chainId: number): string {
  const network = getNetwork(chainId);
  return network ? network.chain.name : `Unknown network (${chainId})`;
}
export function nativeSymbol(chainId: number): string {
  return getNetwork(chainId)?.chain.nativeCurrency.symbol ?? "native units";
}
export function transactionExplorerUrl(chainId: number, hash: string): string | null {
  const explorer = getNetwork(chainId)?.chain.blockExplorers?.default.url;
  if (!explorer || !/^0x[0-9a-fA-F]{64}$/.test(hash)) return null;
  return `${explorer.replace(/\/$/, "")}/tx/${hash}`;
}
