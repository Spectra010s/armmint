import { arc, arcTestnet, ink, inkSepolia, base, baseSepolia } from "viem/chains";
import type { Chain } from "viem";

// Official Arc/Ink connection docs verified 2026-09-26. Only public metadata
// belongs here: runtime provider overrides live in server/network-config.ts.
const arcTestnetCurrent = {
  ...arcTestnet,
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.io"] } },
  blockExplorers: { default: { name: "Arc Explorer", url: "https://explorer.testnet.arc.io" } },
} as const;
export type Network = {
  chain: Chain;
  rpcEnv: string;
  legacy: boolean;
};
export const NETWORKS = [
  { chain: arcTestnetCurrent, rpcEnv: "ARC_TESTNET_RPC_URL", legacy: false },
  { chain: inkSepolia, rpcEnv: "INK_SEPOLIA_RPC_URL", legacy: false },
  { chain: arc, rpcEnv: "ARC_RPC_URL", legacy: false },
  { chain: ink, rpcEnv: "INK_RPC_URL", legacy: false },
  // Keep existing Base jobs executable and auditable; never offer new ones.
  { chain: base, rpcEnv: "LEGACY_BASE_RPC_URL", legacy: true },
  { chain: baseSepolia, rpcEnv: "LEGACY_BASE_SEPOLIA_RPC_URL", legacy: true },
] as const satisfies readonly Network[];
export type NetworkChainId = (typeof NETWORKS)[number]["chain"]["id"];
export const MINT_NETWORKS = NETWORKS.filter((network) => !network.legacy);
export function getNetwork(chainId: number): Network | undefined {
  return NETWORKS.find((network) => network.chain.id === chainId);
}
export function isMintNetwork(chainId: unknown): chainId is NetworkChainId {
  return typeof chainId === "number" && MINT_NETWORKS.some((network) => network.chain.id === chainId);
}
export function networkName(chainId: number): string {
  const network = getNetwork(chainId);
  return network ? `${network.chain.name}${network.legacy ? " (legacy)" : ""}` : `Unknown network (${chainId})`;
}
export function nativeSymbol(chainId: number): string {
  return getNetwork(chainId)?.chain.nativeCurrency.symbol ?? "native units";
}
export function transactionExplorerUrl(chainId: number, hash: string): string | null {
  const explorer = getNetwork(chainId)?.chain.blockExplorers?.default.url;
  if (!explorer || !/^0x[0-9a-fA-F]{64}$/.test(hash)) return null;
  return `${explorer.replace(/\/$/, "")}/tx/${hash}`;
}
