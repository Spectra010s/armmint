import "server-only";
import { getNetwork } from "@/lib/networks";

export function getNetworkRpcUrl(chainId: number): string {
  const network = getNetwork(chainId);
  if (!network) throw new Error("Unsupported network");
  const configured = process.env[network.rpcEnv];
  const url = configured === undefined ? network.chain.rpcUrls.default.http[0] : configured.trim();
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error(`Invalid RPC URL in ${network.rpcEnv}`); }
  if (parsed.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && parsed.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)))
    throw new Error(`RPC URL in ${network.rpcEnv} must use HTTPS`);
  return url;
}
