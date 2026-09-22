import type { PreparedTransaction, TransactionRequest } from "./types";

export type JsonRpcTransport = {
  request<T>(method: string, params: readonly unknown[]): Promise<T>;
};

export type RawTransactionBroadcaster = {
  broadcast(request: PreparedTransaction): Promise<{
    rawTransaction: `0x${string}`;
    nonce: number;
  }>;
};

export type RpcReceipt = {
  transactionHash: `0x${string}`;
  status: "0x0" | "0x1";
};

export function createJsonRpcEvmClient(
  transport: JsonRpcTransport,
  broadcaster?: RawTransactionBroadcaster,
) {
  return {
    async simulate(request: TransactionRequest) {
      await transport.request("eth_call", [toRpcRequest(request), "pending"]);
    },

    async getPendingNonce(address: `0x${string}`) {
      const nonce = await transport.request<string>("eth_getTransactionCount", [
        address,
        "pending",
      ]);
      return Number(BigInt(nonce));
    },

    async broadcast(request: PreparedTransaction) {
      if (!broadcaster) {
        throw new Error(
          "Raw transaction signing/broadcast must be supplied by the signing boundary",
        );
      }

      const prepared = await broadcaster.broadcast(request);
      if (prepared.nonce !== request.nonce) {
        throw new Error("Signing boundary changed the reserved transaction nonce");
      }

      const hash = await transport.request<`0x${string}`>(
        "eth_sendRawTransaction",
        [prepared.rawTransaction],
      );
      return { hash, nonce: request.nonce };
    },

    async receipt(hash: `0x${string}`) {
      const receipt = await transport.request<RpcReceipt | null>(
        "eth_getTransactionReceipt",
        [hash],
      );
      if (!receipt) return { state: "PENDING" as const, hash };
      return receipt.status === "0x1"
        ? { state: "CONFIRMED" as const, hash: receipt.transactionHash }
        : { state: "REVERTED" as const, hash: receipt.transactionHash };
    },
  };
}

function toRpcRequest(request: TransactionRequest) {
  return {
    from: request.from,
    to: request.to,
    data: request.data,
    ...(request.value === undefined
      ? {}
      : { value: `0x${request.value.toString(16)}` }),
    ...(request.maxFeePerGas === undefined
      ? {}
      : { maxFeePerGas: `0x${request.maxFeePerGas.toString(16)}` }),
    ...(request.maxPriorityFeePerGas === undefined
      ? {}
      : {
          maxPriorityFeePerGas: `0x${request.maxPriorityFeePerGas.toString(16)}`,
        }),
  };
}
