import {
  mintJobState,
  executionAttemptState,
  transactionState,
} from "@/lib/db/schema";
import assert from "node:assert/strict";
import { after, before, beforeEach, mock, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as pgliteDrizzle } from "drizzle-orm/pglite";
import { drizzle as pgDrizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { pushSchema } from "drizzle-kit/api";
import { eq } from "drizzle-orm";
import {
  custom,
  keccak256,
  parseTransaction,
  recoverTransactionAddress,
  type Hex,
  type TransactionSerialized,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  users,
  wallets,
  mintJobs,
  executionAttempts,
  transactions,
} from "@/lib/db/schema";
import * as keyService from "../wallet-key-service.ts";

const client = process.env.ENGINE_TEST_DATABASE_URL ? null : new PGlite();
const pool = process.env.ENGINE_TEST_DATABASE_URL
  ? new Pool({ connectionString: process.env.ENGINE_TEST_DATABASE_URL })
  : null;
const db = pool ? pgDrizzle(pool) : pgliteDrizzle(client!);
const dbMock = mock.module("@/lib/db", { exports: { db } });
const events: string[] = [];
let decryptions = 0;
const keyMock = mock.module("@/lib/server/wallet-key-service", {
  exports: {
    ...keyService,
    withDecryptedWalletPrivateKeyAsync: async <T>(
      encrypted: Parameters<
        typeof keyService.withDecryptedWalletPrivateKeyAsync
      >[0],
      operation: (key: string) => Promise<T>,
    ) => {
      decryptions++;
      events.push("decrypt");
      return keyService.withDecryptedWalletPrivateKeyAsync(
        encrypted,
        operation,
      );
    },
  },
});
const { createProductionTransactionEngine } = await import("./engine.ts");
const { runWorkerTick } = await import("../worker-loop.ts");
const { startExecutionAttempt } = await import("../mint-job-lifecycle.ts");
const { markTransactionSubmitted } = await import("./store.ts");
const { completeConfirmedExecution } = await import("./completion.ts");
const { failExecution } = await import("./failure.ts");

const key = `0x${"11".repeat(32)}` as Hex;
const address = privateKeyToAccount(key).address;
const target = `0x${"22".repeat(20)}` as Hex;
const calldata =
  "0xa0712d680000000000000000000000000000000000000000000000000000000000000002";
const broadcasts: Hex[] = [];
const visible = new Set<string>();
const receipts = new Map<string, "success" | "reverted">();
let pendingNonce = 7;
let latestNonce = 7;
let failMethod: string | null = null;
let sendMode: "normal" | "accept_then_throw" | "throw_before" = "normal";
let immediateReceipt: "success" | "reverted" | null = null;
let simulationReverts = false;
let beforeBroadcast: (() => Promise<void>) | null = null;
let blockNumber = 11n;
let simulateHook: (() => Promise<void>) | null = null;
const zeroHash = `0x${"00".repeat(32)}`;
const block = {
  number: "0xa",
  hash: zeroHash,
  parentHash: zeroHash,
  baseFeePerGas: "0x64",
  timestamp: "0x1",
  gasLimit: "0x1c9c380",
  gasUsed: "0x0",
  transactions: [],
  miner: target,
  nonce: "0x0000000000000000",
  difficulty: "0x0",
  totalDifficulty: "0x0",
  extraData: "0x",
  logsBloom: `0x${"00".repeat(256)}`,
  receiptsRoot: zeroHash,
  stateRoot: zeroHash,
  transactionsRoot: zeroHash,
  sha3Uncles: zeroHash,
  size: "0x1",
  uncles: [],
};
const rpc = {
  async request({
    method,
    params,
  }: {
    method: string;
    params?: readonly unknown[];
  }) {
    events.push(method);
    if (method === failMethod)
      throw new Error(`secret-provider-payload ${key}`);
    const args = params as unknown[] | undefined;
    switch (method) {
      case "eth_chainId":
        return "0x14a34";
      case "eth_getBlockByNumber":
        return block;
      case "eth_blockNumber":
        return `0x${blockNumber.toString(16)}`;
      case "eth_maxPriorityFeePerGas":
        return "0x2";
      case "eth_estimateGas":
        return "0x186a0";
      case "eth_call": {
        if (simulateHook) await simulateHook();
        if (simulationReverts)
          throw { code: 3, message: `execution reverted ${key}` };
        return "0x";
      }
      case "eth_getTransactionCount":
        return `0x${(args?.[1] === "latest" ? latestNonce : pendingNonce).toString(16)}`;
      case "eth_sendRawTransaction": {
        const raw = args![0] as Hex;
        const hash = keccak256(raw);
        // The hash must already be durable even if the provider accepts then disconnects.
        const [persisted] = await db
          .select()
          .from(transactions)
          .where(eq(transactions.hash, hash));
        assert.ok(persisted, "hash must be committed before broadcasting");
        if (beforeBroadcast) await beforeBroadcast();
        broadcasts.push(raw);
        if (sendMode !== "throw_before") visible.add(hash);
        if (immediateReceipt) receipts.set(hash, immediateReceipt);
        if (sendMode !== "normal") throw new Error(`transport lost ${raw}`);
        return hash;
      }
      case "eth_getTransactionReceipt": {
        const hash = args![0] as string;
        const status = receipts.get(hash);
        if (!status) return null;
        return {
          transactionHash: hash,
          transactionIndex: "0x0",
          blockHash: zeroHash,
          blockNumber: "0xa",
          from: address,
          to: target,
          contractAddress: null,
          cumulativeGasUsed: "0x100",
          gasUsed: "0x100",
          effectiveGasPrice: "0x64",
          logs: [],
          logsBloom: block.logsBloom,
          status: status === "success" ? "0x1" : "0x0",
          type: "0x2",
        };
      }
      case "eth_getTransactionByHash": {
        const hash = args![0] as string;
        if (!visible.has(hash)) return null;
        return {
          hash,
          nonce: "0x7",
          from: address,
          to: target,
          input: calldata,
          value: "0x0",
          gas: "0x186a0",
          gasPrice: "0x64",
          type: "0x2",
          chainId: "0x14a34",
          maxFeePerGas: "0x7a",
          maxPriorityFeePerGas: "0x2",
          blockHash: null,
          blockNumber: null,
          transactionIndex: null,
          r: zeroHash,
          s: zeroHash,
          v: "0x0",
          yParity: "0x0",
        };
      }
      default:
        throw new Error(`Unexpected test RPC method: ${method}`);
    }
  },
};
const transport = custom(rpc, { retryCount: 0 });

before(async () => {
  process.env.ARMINT_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
  const schema = await pushSchema(
    {
      mintJobState,
      executionAttemptState,
      transactionState,
      users,
      wallets,
      mintJobs,
      executionAttempts,
      transactions,
    },
    db,
  );
  await schema.apply();
});
beforeEach(async () => {
  await db.delete(transactions);
  await db.delete(executionAttempts);
  await db.delete(mintJobs);
  await db.delete(wallets);
  await db.delete(users);
  events.length = 0;
  broadcasts.length = 0;
  visible.clear();
  receipts.clear();
  decryptions = 0;
  pendingNonce = 7;
  latestNonce = 7;
  failMethod = null;
  sendMode = "normal";
  immediateReceipt = null;
  simulationReverts = false;
  beforeBroadcast = null;
  blockNumber = 11n;
  simulateHook = null;
  await db
    .insert(users)
    .values({ id: "user", name: "Test", email: "test@example.test" });
  await db
    .insert(wallets)
    .values({
      id: "wallet",
      userId: "user",
      address,
      ...keyService.encryptWalletPrivateKey(key),
    });
  await insertJob("job");
});
after(async () => {
  keyMock.restore();
  dbMock.restore();
  if (client) await client.close();
  if (pool) await pool.end();
});
async function insertJob(id: string) {
  await db
    .insert(mintJobs)
    .values({
      id,
      userId: "user",
      walletId: "wallet",
      chainId: 84532,
      contractAddress: target,
      calldata,
      valueWei: "42",
      scheduledFor: new Date(0),
      idempotencyKey: id,
    });
}
async function tick(policy?: {
  maxAttempts: number;
  gasBumpBps: number;
  replacementAfterMs?: number;
}) {
  const engine = await createProductionTransactionEngine({
    transport,
    retryPolicy: policy,
  });
  return runWorkerTick(async (job, attemptId) => {
    await engine.executeClaimedJob(job.id, attemptId);
  }, "test-worker");
}
async function recover(policy?: {
  maxAttempts: number;
  gasBumpBps: number;
  replacementAfterMs?: number;
}) {
  await db.update(mintJobs).set({ claimExpiresAt: new Date(0) });
  return tick(policy);
}
async function state() {
  return {
    jobs: await db.select().from(mintJobs),
    attempts: await db.select().from(executionAttempts),
    txs: await db.select().from(transactions),
  };
}
const replacementPolicy = {
  maxAttempts: 3,
  gasBumpBps: 1250,
  replacementAfterMs: 0,
};

test("claimed worker job simulates, temporarily decrypts, signs real mint, checkpoints hash, submits and succeeds", async () => {
  immediateReceipt = "success";
  await tick();
  const s = await state();
  assert.equal(s.jobs[0].state, "SUCCEEDED");
  assert.equal(s.attempts[0].state, "SUCCEEDED");
  assert.equal(s.txs[0].state, "CONFIRMED");
  assert.equal(decryptions, 1);
  assert.ok(events.indexOf("eth_call") < events.indexOf("decrypt"));
  const signed = parseTransaction(broadcasts[0]);
  assert.equal(signed.nonce, 7);
  assert.equal(signed.to?.toLowerCase(), target);
  assert.equal(signed.data, calldata);
  assert.equal(signed.value, 42n);
  assert.equal(
    await recoverTransactionAddress({
      serializedTransaction: broadcasts[0] as TransactionSerialized,
    }),
    address,
  );
  assert.equal(s.txs[0].hash, keccak256(broadcasts[0]));
  assert.equal(JSON.stringify(s).includes(key), false);
  assert.equal(JSON.stringify(s).includes(broadcasts[0]), false);
  await recover();
  assert.equal(broadcasts.length, 1);
});

test("restart observes a pending submission without signing and later completes the same attempt", async () => {
  await tick();
  let s = await state();
  assert.equal(s.jobs[0].state, "CONFIRMING");
  await recover();
  assert.equal(decryptions, 1);
  assert.equal(broadcasts.length, 1);
  receipts.set(s.txs[0].hash!, "success");
  await recover();
  s = await state();
  assert.equal(s.jobs[0].state, "SUCCEEDED");
  assert.equal(s.attempts.length, 1);
  assert.equal(s.txs.length, 1);
});

test("accept-then-disconnect recovers durable hash without signing again", async () => {
  sendMode = "accept_then_throw";
  await tick();
  const s = await state();
  assert.equal(s.txs[0].state, "CREATED");
  assert.ok(s.txs[0].hash);
  sendMode = "normal";
  await recover();
  assert.equal(decryptions, 1);
  assert.equal(broadcasts.length, 1);
  assert.equal((await state()).txs[0].state, "CONFIRMING");
});

test("unknown submission is rebroadcast with identical signed bytes and nonce", async () => {
  sendMode = "throw_before";
  await tick();
  sendMode = "normal";
  await recover();
  assert.equal(broadcasts.length, 2);
  assert.equal(broadcasts[0], broadcasts[1]);
  assert.equal((await state()).txs.length, 1);
});

test("unsigned reservation survives restart and ignores a newer pending nonce", async () => {
  let calls = 0;
  simulateHook = async () => {
    if (++calls === 2) throw new Error("Worker interrupted before signing");
  };
  await tick();
  assert.equal(decryptions, 0);
  assert.equal((await state()).txs[0].nonce, 7);
  simulateHook = null;
  pendingNonce = 20;
  await recover();
  assert.equal(parseTransaction(broadcasts[0]).nonce, 7);
  assert.equal((await state()).txs.length, 1);
});

test("preflight revert fails without decrypting or broadcasting and sanitizes provider errors", async () => {
  simulationReverts = true;
  await tick();
  const s = await state();
  assert.equal(s.jobs[0].state, "FAILED");
  assert.equal(decryptions, 0);
  assert.equal(broadcasts.length, 0);
  assert.equal(s.attempts[0].failureCode, "SIMULATION_FAILED");
  assert.equal(JSON.stringify(s).includes(key), false);
});

test("RPC failure retries only to the explicit limit before signing", async () => {
  failMethod = "eth_estimateGas";
  await tick();
  await recover();
  await recover();
  const s = await state();
  assert.equal(s.jobs[0].state, "FAILED");
  assert.equal(s.attempts[0].failureCode, "RETRY_EXHAUSTED");
  assert.equal(decryptions, 0);
  assert.equal(JSON.stringify(s).includes(key), false);
});

test("receipt RPC failure never labels a submitted transaction dropped or mints again", async () => {
  await tick();
  failMethod = "eth_getTransactionReceipt";
  await recover();
  assert.equal((await state()).txs[0].state, "CONFIRMING");
  assert.equal(broadcasts.length, 1);
  failMethod = null;
  await recover();
  assert.equal(decryptions, 1);
});

test("reverted receipt fails the same transaction, attempt and job", async () => {
  immediateReceipt = "reverted";
  await tick();
  const s = await state();
  assert.equal(s.jobs[0].state, "FAILED");
  assert.equal(s.attempts[0].failureCode, "REVERTED");
  assert.equal(s.txs[0].state, "REVERTED");
  await recover();
  assert.equal(broadcasts.length, 1);
});

test("receipt below confirmation depth stays pending", async () => {
  immediateReceipt = "success";
  blockNumber = 10n;
  await tick();
  assert.equal((await state()).jobs[0].state, "CONFIRMING");
  blockNumber = 11n;
  await recover();
  assert.equal((await state()).jobs[0].state, "SUCCEEDED");
  assert.equal(decryptions, 1);
});

test("pending replacements bump both fees, retain nonce and stop at retry limit while monitoring", async () => {
  await tick(replacementPolicy);
  await recover(replacementPolicy);
  await recover(replacementPolicy);
  await recover(replacementPolicy);
  assert.equal(broadcasts.length, 3);
  const parsed = broadcasts.map(parseTransaction);
  assert.deepEqual(
    parsed.map((tx) => tx.nonce),
    [7, 7, 7],
  );
  assert.equal(
    parsed[1].maxFeePerGas,
    (parsed[0].maxFeePerGas! * 11250n + 9999n) / 10000n,
  );
  assert.equal(
    parsed[1].maxPriorityFeePerGas,
    (parsed[0].maxPriorityFeePerGas! * 11250n + 9999n) / 10000n,
  );
  const s = await state();
  assert.equal(s.attempts[0].failureCode, "RETRY_EXHAUSTED");
  assert.equal(s.jobs[0].state, "CONFIRMING");
  receipts.set(keccak256(broadcasts[0]), "success"); // Original can still win the nonce race.
  await recover(replacementPolicy);
  assert.equal((await state()).jobs[0].state, "SUCCEEDED");
  assert.equal(broadcasts.length, 3);
});

test("competing executions of a single claimed job sign once", async () => {
  await db.update(mintJobs).set({ state: "CLAIMED" });
  const attempt = await startExecutionAttempt("job");
  const engine = await createProductionTransactionEngine({ transport });
  await Promise.all([
    engine.executeClaimedJob("job", attempt.id),
    engine.executeClaimedJob("job", attempt.id),
  ]);
  assert.equal(broadcasts.length, 1);
  assert.equal((await state()).txs.length, 1);
});

test("different jobs sharing a wallet reserve distinct nonces under contention", async () => {
  await insertJob("job-2");
  await db.update(mintJobs).set({ state: "CLAIMED" });
  const first = await startExecutionAttempt("job"),
    second = await startExecutionAttempt("job-2");
  const engine = await createProductionTransactionEngine({ transport });
  await Promise.all([
    engine.executeClaimedJob("job", first.id),
    engine.executeClaimedJob("job-2", second.id),
  ]);
  assert.deepEqual(
    broadcasts.map((raw) => parseTransaction(raw).nonce).sort(),
    [7, 8],
  );
});

test("advanced account nonce stops signing rather than creating a second mint", async () => {
  await tick();
  latestNonce = 8;
  pendingNonce = 9;
  await recover(replacementPolicy);
  assert.equal(broadcasts.length, 1);
  assert.equal((await state()).txs[0].nonce, 7);
  receipts.set(keccak256(broadcasts[0]), "success");
  await recover();
  assert.equal((await state()).jobs[0].state, "SUCCEEDED");
});

test("late submission and failure cannot reopen a terminal execution", async () => {
  beforeBroadcast = async () => {
    await db.update(mintJobs).set({ state: "CANCELLED" });
  };
  await tick();
  const s = await state();
  const row = s.txs[0];
  assert.equal(s.jobs[0].state, "CANCELLED");
  assert.equal(row.state, "CREATED");
  assert.equal(await markTransactionSubmitted(row.id, row.hash!), null);
  assert.equal(await completeConfirmedExecution(row.id), null);
  assert.equal(
    await failExecution(
      row.id,
      { code: "REVERTED", message: "late" },
      "REVERTED",
    ),
    null,
  );
  assert.equal((await state()).txs[0].state, "CREATED");
});

test("terminal state during simulation prevents decryption and broadcast", async () => {
  simulateHook = async () => {
    await db.update(mintJobs).set({ state: "CANCELLED" });
  };
  await tick();
  assert.equal(decryptions, 0);
  assert.equal(broadcasts.length, 0);
  assert.equal((await state()).jobs[0].state, "CANCELLED");
});

test("signing boundary checks the private key against the job's public address", async () => {
  await db
    .update(wallets)
    .set(keyService.encryptWalletPrivateKey(`0x${"33".repeat(32)}`));
  await tick();
  const s = await state();
  assert.equal(s.attempts[0].failureCode, "SIGNING_FAILED");
  assert.equal(broadcasts.length, 0);
});

test("invalid calldata and wallet ownership fail closed without signing", async () => {
  await db.update(mintJobs).set({ calldata: null });
  await tick();
  assert.equal(decryptions, 0);
  assert.equal((await state()).jobs[0].state, "FAILED");
});

test("an expired executor stops after another worker completes the job", async () => {
  await db.update(mintJobs).set({ state: "CLAIMED" });
  const attempt = await startExecutionAttempt("job");
  const engine = await createProductionTransactionEngine({ transport });
  let resume!: () => void;
  let entered!: () => void;
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const barrier = new Promise<void>((resolve) => {
    resume = resolve;
  });
  simulateHook = async () => {
    entered();
    await barrier;
  };
  const stale = engine.executeClaimedJob("job", attempt.id);
  await waiting;
  await db.update(mintJobs).set({ engineLeaseExpiresAt: new Date(0) });
  simulateHook = null;
  immediateReceipt = "success";
  await engine.executeClaimedJob("job", attempt.id);
  resume();
  await stale;
  assert.equal(decryptions, 1);
  assert.equal(broadcasts.length, 1);
  assert.equal((await state()).jobs[0].state, "SUCCEEDED");
});

test("failure before signing releases only an unsigned nonce gap", async () => {
  await db
    .update(wallets)
    .set({ encryptionAuthTag: Buffer.alloc(16).toString("base64") });
  await tick();
  assert.equal((await state()).jobs[0].state, "FAILED");
  await db.update(wallets).set(keyService.encryptWalletPrivateKey(key));
  await insertJob("next-job");
  await tick();
  assert.equal(parseTransaction(broadcasts[0]).nonce, 7);
});

test("ambiguous broadcast exhaustion stops signing but still observes eventual success", async () => {
  sendMode = "throw_before";
  await tick();
  await recover();
  await recover();
  await recover();
  assert.equal(broadcasts.length, 3);
  assert.equal(decryptions, 3);
  assert.equal(new Set(broadcasts).size, 1);
  receipts.set(keccak256(broadcasts[0]), "success");
  await recover();
  assert.equal((await state()).jobs[0].state, "SUCCEEDED");
  assert.equal(decryptions, 3);
});

test("mismatched job and attempt do not fail a different job", async () => {
  await db.update(mintJobs).set({ state: "CLAIMED" });
  const attempt = await startExecutionAttempt("job");
  const engine = await createProductionTransactionEngine({ transport });
  await engine.executeClaimedJob("not-this-job", attempt.id);
  assert.equal((await state()).jobs[0].state, "CLAIMED");
  assert.equal(decryptions, 0);
});

test("wallet ownership mismatch is rejected before reading encrypted key material", async () => {
  await db
    .insert(users)
    .values({ id: "other-user", name: "Other", email: "other@example.test" });
  await db.update(mintJobs).set({ userId: "other-user" });
  await tick();
  assert.equal((await state()).jobs[0].state, "FAILED");
  assert.equal(decryptions, 0);
});

test("default worker invokes the production HTTP/viem engine", async () => {
  const previous = process.env.BASE_RPC_URL;
  process.env.BASE_RPC_URL = "https://rpc.example.test";
  immediateReceipt = "success";
  const fetchMock = mock.method(
    globalThis,
    "fetch",
    async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const result = await rpc.request(body);
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id: body.id, result }),
        { headers: { "content-type": "application/json" } },
      );
    },
  );
  try {
    await runWorkerTick();
    assert.equal((await state()).jobs[0].state, "SUCCEEDED");
    assert.equal(decryptions, 1);
  } finally {
    fetchMock.mock.restore();
    if (previous === undefined) delete process.env.BASE_RPC_URL;
    else process.env.BASE_RPC_URL = previous;
  }
});
