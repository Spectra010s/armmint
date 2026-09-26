import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("generated migration preserves Base data and enforces same-network replacement identity", async () => {
  const db = new PGlite();
  try {
    const directory = new URL("../drizzle/", import.meta.url);
    const files = (await readdir(directory)).filter(f => f.endsWith(".sql")).sort();
    for (const file of files.filter(f => !f.startsWith("0005"))) await db.exec(await readFile(new URL(file, directory), "utf8"));
    await db.exec(`
      INSERT INTO users (id,name,email) VALUES ('u','Legacy','legacy@test');
      INSERT INTO wallets (id,user_id,address,encrypted_private_key,encryption_iv,encryption_auth_tag,encryption_key_version) VALUES ('w','u','0xabc','cipher','iv','tag',1);
      INSERT INTO mint_jobs (id,user_id,wallet_id,chain_id,contract_address,scheduled_for,idempotency_key) VALUES ('j','u','w',8453,'0xdef',now(),'legacy');
      INSERT INTO execution_attempts (id,mint_job_id,attempt_number) VALUES ('a','j',1);
      INSERT INTO transactions (id,execution_attempt_id,chain_id,nonce,hash) VALUES ('t','a',8453,7,'hash');
    `);
    await db.exec(await readFile(new URL(files.find(f => f.startsWith("0005"))!, directory), "utf8"));
    assert.equal((await db.query<{chain_id: number}>("SELECT chain_id FROM mint_jobs")).rows[0].chain_id, 8453);
    assert.equal((await db.query<{chain_id: number}>("SELECT chain_id FROM transactions")).rows[0].chain_id, 8453);
    await assert.rejects(db.exec("INSERT INTO transactions (id,execution_attempt_id,chain_id,nonce,replaces_transaction_id) VALUES ('bad','a',5042002,7,'t')"));
    await assert.rejects(db.exec("INSERT INTO transactions (id,execution_attempt_id,chain_id,nonce,replaces_transaction_id) VALUES ('bad','a',8453,8,'t')"));
    await db.exec("INSERT INTO transactions (id,execution_attempt_id,chain_id,nonce,replaces_transaction_id) VALUES ('replacement','a',8453,7,'t')");
    await db.exec("INSERT INTO transactions (id,execution_attempt_id,chain_id,nonce,hash) VALUES ('arc','a',5042002,7,'hash')");
    await assert.rejects(db.exec("INSERT INTO transactions (id,execution_attempt_id,chain_id,nonce,hash) VALUES ('duplicate','a',5042002,8,'hash')"));
  } finally { await db.close(); }
});
