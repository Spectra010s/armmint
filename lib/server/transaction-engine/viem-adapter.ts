import "server-only";
import {
  BaseError,
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  TransactionNotFoundError,
  TransactionReceiptNotFoundError,
  type Chain,
  type Transport,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { withDecryptedWalletPrivateKeyAsync } from "@/lib/server/wallet-key-service";
import type { EncryptedPrivateKey } from "@/lib/server/wallet-crypto";
import { TransactionEngineError } from "./errors";
import type { TransactionChainAdapter, TransactionRequest } from "./types";

export function createViemTransactionAdapter(options: {
  chain: Chain;
  rpcUrl?: string;
  transport?: Transport;
  address: `0x${string}`;
  loadEncryptedWallet: () => Promise<EncryptedPrivateKey>;
  confirmations?: number;
}): TransactionChainAdapter {
  const transport =
    options.transport ??
    http(options.rpcUrl, { retryCount: 0, timeout: 8_000 });
  const publicClient = createPublicClient({
    chain: options.chain,
    transport,
    cacheTime: 0,
  });
  const confirmations = options.confirmations ?? 2;
  if (!Number.isSafeInteger(confirmations) || confirmations < 1)
    throw new Error("Invalid confirmation count");
  const rpcError = () =>
    new TransactionEngineError(
      "RPC_FAILED",
      "Blockchain RPC request failed",
      true,
    );
  function validate(request: TransactionRequest) {
    if (
      request.chainId !== options.chain.id ||
      request.from.toLowerCase() !== options.address.toLowerCase()
    ) {
      throw new TransactionEngineError(
        "INVALID_EXECUTION",
        "Transaction account or chain does not match wallet",
      );
    }
  }
  return {
    async prepare(request) {
      validate(request);
      try {
        if ((await publicClient.getChainId()) !== request.chainId)
          throw new TransactionEngineError(
            "INVALID_EXECUTION",
            "RPC chain does not match job",
          );
        const fees = await publicClient.estimateFeesPerGas({ type: "eip1559" });
        const gas = await publicClient.estimateGas({
          account: request.from,
          to: request.to,
          data: request.data,
          value: request.value ?? 0n,
        });
        return {
          ...request,
          gas,
          maxFeePerGas: fees.maxFeePerGas,
          maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
        };
      } catch (error) {
        if (error instanceof TransactionEngineError) throw error;
        if (isRevert(error))
          throw new TransactionEngineError(
            "SIMULATION_FAILED",
            "Mint simulation reverted",
          );
        throw rpcError();
      }
    },
    async simulate(request) {
      validate(request);
      try {
        await publicClient.call({
          account: request.from,
          to: request.to,
          data: request.data,
          value: request.value ?? 0n,
          gas: request.gas,
          blockTag: "pending",
        });
      } catch (error) {
        if (isRevert(error))
          throw new TransactionEngineError(
            "SIMULATION_FAILED",
            "Mint simulation reverted",
          );
        throw rpcError();
      }
    },
    async getPendingNonce(address) {
      try {
        return await publicClient.getTransactionCount({
          address,
          blockTag: "pending",
        });
      } catch {
        throw rpcError();
      }
    },
    async getLatestNonce(address) {
      try {
        return await publicClient.getTransactionCount({
          address,
          blockTag: "latest",
        });
      } catch {
        throw rpcError();
      }
    },
    async isKnown(hash) {
      try {
        await publicClient.getTransaction({ hash });
        return true;
      } catch (error) {
        if (error instanceof TransactionNotFoundError) return false;
        throw rpcError();
      }
    },
    async submit(request, onSigned) {
      validate(request);
      if (
        !onSigned ||
        request.gas === undefined ||
        request.maxFeePerGas === undefined ||
        request.maxPriorityFeePerGas === undefined
      ) {
        throw new TransactionEngineError(
          "INVALID_EXECUTION",
          "Signing requires prepared inputs and a durable hash checkpoint",
        );
      }
      const { gas, maxFeePerGas, maxPriorityFeePerGas } = request;
      let serialized: `0x${string}`;
      try {
        const encrypted = await options.loadEncryptedWallet();
        serialized = await withDecryptedWalletPrivateKeyAsync(
          encrypted,
          async (privateKey) => {
            const account = privateKeyToAccount(privateKey as `0x${string}`);
            if (account.address.toLowerCase() !== request.from.toLowerCase())
              throw new Error("Account mismatch");
            const wallet = createWalletClient({
              account,
              chain: options.chain,
              transport,
            });
            // Fully prepared inputs: signing does not discover a different nonce or fee.
            return wallet.signTransaction({
              chain: options.chain,
              type: "eip1559",
              to: request.to,
              data: request.data,
              value: request.value ?? 0n,
              gas,
              maxFeePerGas,
              maxPriorityFeePerGas,
              nonce: request.nonce,
            });
          },
        );
      } catch {
        // viem error causes can contain the signed payload. Never retain them.
        throw new TransactionEngineError(
          "SIGNING_FAILED",
          "Wallet could not sign transaction",
        );
      }
      const hash = keccak256(serialized);
      await onSigned(hash);
      try {
        const returned = await publicClient.sendRawTransaction({
          serializedTransaction: serialized,
        });
        if (returned !== hash) throw new Error("Unexpected RPC hash");
        return { hash, nonce: request.nonce };
      } catch {
        throw new TransactionEngineError(
          "SUBMISSION_FAILED",
          "Transaction submission outcome is unknown",
          true,
        );
      }
    },
    async waitForReceipt(hash) {
      try {
        const receipt = await publicClient.getTransactionReceipt({ hash });
        const head = await publicClient.getBlockNumber({ cacheTime: 0 });
        if (
          head < receipt.blockNumber ||
          head - receipt.blockNumber + 1n < BigInt(confirmations)
        )
          return { state: "PENDING", hash };
        return {
          state: receipt.status === "success" ? "CONFIRMED" : "REVERTED",
          hash,
        };
      } catch (error) {
        if (error instanceof TransactionReceiptNotFoundError)
          return { state: "PENDING", hash };
        throw new TransactionEngineError(
          "CONFIRMATION_FAILED",
          "Transaction receipt lookup failed",
          true,
        );
      }
    },
  };
}
function isRevert(error: unknown) {
  return (
    error instanceof BaseError &&
    !!error.walk(
      (cause) =>
        cause instanceof Error &&
        (cause.name === "ExecutionRevertedError" ||
          cause.name === "ContractFunctionRevertedError" ||
          ("code" in cause && cause.code === 3)),
    )
  );
}
