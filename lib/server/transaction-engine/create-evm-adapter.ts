import { createEvmChainAdapter, type EvmRpcClient } from "./evm-adapter";
import { createHttpJsonRpcTransport } from "./http-json-rpc";
import {
  createJsonRpcEvmClient,
  type RawTransactionBroadcaster,
} from "./json-rpc-client";
import type { TransactionChainAdapter } from "./types";

export type EvmChainAdapterOptions = {
  rpcUrl: string;
  broadcaster?: RawTransactionBroadcaster;
  fetcher?: typeof fetch;
};

export function createHttpEvmChainAdapter(
  options: EvmChainAdapterOptions,
): TransactionChainAdapter {
  const transport = createHttpJsonRpcTransport(options.rpcUrl, options.fetcher);
  const client = createJsonRpcEvmClient(
    transport,
    options.broadcaster,
  ) satisfies EvmRpcClient;

  return createEvmChainAdapter(client);
}
