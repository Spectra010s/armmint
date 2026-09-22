import type { PreparedTransaction, TransactionRequest } from "./types";

export type JsonRpcTransport = {
  request<T>(method: string, params: readonly unknown[]): Promise<T>;
};

export type RpcReceipt = {
  transactionHash: `0x${string}`;
  status: "0x0" | "0x1";
};

export function createJsonRpcEvmClient(transport: JsonRpcTransport) {
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
      throw new Error(
        "Raw transaction signing/broadcast must be supplied by the signing boundary",
      );
    },

    async receipt(hash: `0x${string}`) {
      const receipt = await transport.request<RpcReceipt | null>(
        "eth_getTransactionReceipt",
        [hash],
      );
      if (!receipt) throw new Error("Transaction receipt not found");
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
  };
}
