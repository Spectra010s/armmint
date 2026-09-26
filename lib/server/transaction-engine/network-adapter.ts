import "server-only";

import { getNetworkRpcUrl } from "@/lib/server/network-config";
import { createHttpEvmChainAdapter } from "./create-evm-adapter";
import type { RawTransactionBroadcaster } from "./json-rpc-client";

export function createNetworkTransactionAdapter(
  chainId: number,
  broadcaster?: RawTransactionBroadcaster,
) {
  return createHttpEvmChainAdapter({
    rpcUrl: getNetworkRpcUrl(chainId),
    broadcaster,
  });
}
