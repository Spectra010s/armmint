import "server-only";

import { getServerConfig } from "@/lib/server/config";
import { createHttpEvmChainAdapter } from "./create-evm-adapter";
import type { RawTransactionBroadcaster } from "./json-rpc-client";

export function createBaseTransactionAdapter(
  broadcaster?: RawTransactionBroadcaster,
) {
  const config = getServerConfig();
  return createHttpEvmChainAdapter({
    rpcUrl: config.BASE_RPC_URL,
    broadcaster,
  });
}
