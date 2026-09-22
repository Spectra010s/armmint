import assert from "node:assert/strict";
import test from "node:test";

import {
  buildWalletSetupPayload,
  getWalletSetupErrorMessage,
  parseWalletSetupServerError,
  WALLET_SETUP_ACK_ERROR,
  WALLET_SETUP_GENERIC_ERROR,
  WALLET_SETUP_REQUIRED_ERROR,
} from "./wallet-setup.ts";

test("requires explicit burner acknowledgement before building a payload", () => {
  assert.throws(
    () =>
      buildWalletSetupPayload({
        address: "0xabc",
        privateKey: "secret",
        burnerWalletAcknowledged: false,
      }),
    new RegExp(WALLET_SETUP_ACK_ERROR),
  );
});

test("requires a wallet address and private key without echoing secrets", () => {
  const secret = `0x${"ff".repeat(32)}`;

  for (const input of [
    { address: "   ", privateKey: secret, burnerWalletAcknowledged: true },
    { address: "0xabc", privateKey: "", burnerWalletAcknowledged: true },
  ]) {
    try {
      buildWalletSetupPayload(input);
      assert.fail("expected wallet setup validation to throw");
    } catch (error) {
      assert.equal((error as Error).message, WALLET_SETUP_REQUIRED_ERROR);
      assert.equal((error as Error).message.includes(secret), false);
    }
  }
});

test("trims the address and keeps server-side acknowledgement authoritative", () => {
  const payload = buildWalletSetupPayload({
    address: "  0xabc  ",
    privateKey: "secret",
    burnerWalletAcknowledged: true,
  });

  assert.deepEqual(payload, {
    address: "0xabc",
    privateKey: "secret",
    burnerWalletAcknowledged: true,
  });
});

test("only surfaces allow-listed server errors", () => {
  assert.equal(
    parseWalletSetupServerError({ error: WALLET_SETUP_ACK_ERROR }),
    WALLET_SETUP_ACK_ERROR,
  );
  assert.equal(
    parseWalletSetupServerError({
      error: "A wallet is already configured for this account",
    }),
    "A wallet is already configured for this account",
  );
  assert.equal(parseWalletSetupServerError({ error: "boom 0xsecret" }), null);
  assert.equal(parseWalletSetupServerError({ wallet: { id: "1" } }), null);
  assert.equal(parseWalletSetupServerError(null), null);
});

test("maps unknown failures to a generic message without secrets", () => {
  const secret = `0x${"aa".repeat(32)}`;

  assert.equal(
    getWalletSetupErrorMessage(new Error(WALLET_SETUP_ACK_ERROR)),
    WALLET_SETUP_ACK_ERROR,
  );
  assert.equal(
    getWalletSetupErrorMessage(new Error(`failed with ${secret}`)),
    WALLET_SETUP_GENERIC_ERROR,
  );
  assert.equal(
    getWalletSetupErrorMessage(new Error(secret)).includes(secret),
    false,
  );
  assert.equal(
    getWalletSetupErrorMessage("string failure"),
    WALLET_SETUP_GENERIC_ERROR,
  );
});
