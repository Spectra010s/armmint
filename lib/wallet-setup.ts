import { isAddress, zeroAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export type WalletSetupPayload = {
  address: string;
  privateKey: string;
  burnerWalletAcknowledged: true;
};

export type WalletSetupInput = {
  address: string;
  privateKey: string;
  burnerWalletAcknowledged: boolean;
};

export const WALLET_SETUP_ACK_ERROR = "Burner wallet acknowledgement is required";
export const WALLET_SETUP_REQUIRED_ERROR =
  "Wallet address and private key are required";
export const WALLET_SETUP_GENERIC_ERROR =
  "Unable to complete wallet setup. Please try again.";
export const WALLET_SETUP_CONFLICT_ERROR =
  "A wallet is already configured for this account";

const SAFE_SERVER_ERRORS = new Set([
  "Invalid request",
  WALLET_SETUP_ACK_ERROR,
  WALLET_SETUP_REQUIRED_ERROR,
  WALLET_SETUP_CONFLICT_ERROR,
]);

export function buildWalletSetupPayload(
  input: WalletSetupInput,
): WalletSetupPayload {
  if (input.burnerWalletAcknowledged !== true) {
    throw new Error(WALLET_SETUP_ACK_ERROR);
  }

  const address = input.address.trim();

  if (
    !address ||
    !input.privateKey ||
    address.length > 64 ||
    input.privateKey.length > 128 ||
    !isAddress(address) ||
    address.toLowerCase() === zeroAddress ||
    !/^0x[0-9a-fA-F]{64}$/.test(input.privateKey)
  ) {
    throw new Error(WALLET_SETUP_REQUIRED_ERROR);
  }

  try {
    if (
      privateKeyToAccount(input.privateKey as `0x${string}`).address.toLowerCase() !==
      address.toLowerCase()
    ) {
      throw new Error(WALLET_SETUP_REQUIRED_ERROR);
    }
  } catch (error) {
    if (error instanceof Error && error.message === WALLET_SETUP_REQUIRED_ERROR) throw error;
    throw new Error(WALLET_SETUP_REQUIRED_ERROR, { cause: error });
  }

  return {
    address,
    privateKey: input.privateKey,
    burnerWalletAcknowledged: true,
  };
}

export function parseWalletSetupServerError(body: unknown): string | null {
  if (typeof body !== "object" || body === null || !("error" in body)) {
    return null;
  }

  const error = (body as { error: unknown }).error;

  if (typeof error !== "string" || !SAFE_SERVER_ERRORS.has(error)) {
    return null;
  }

  return error;
}

export function getWalletSetupErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (
      error.message === WALLET_SETUP_ACK_ERROR ||
      error.message === WALLET_SETUP_REQUIRED_ERROR ||
      error.message === WALLET_SETUP_CONFLICT_ERROR
    ) {
      return error.message;
    }
  }

  return WALLET_SETUP_GENERIC_ERROR;
}
