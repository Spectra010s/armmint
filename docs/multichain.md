# RH and Ink networks

Each mint job explicitly stores an EVM `chain_id`. `lib/networks.ts` is the typed allowlist for network identity, native currency, viem definitions and explorer links. New jobs must select one of:

| Network | Chain ID | Currency | Public RPC | Explorer |
| --- | --- | --- | --- | --- |
| Robinhood Chain Testnet | 46630 | ETH, 18 decimals | https://rpc.testnet.chain.robinhood.com | https://explorer.testnet.chain.robinhood.com |
| Ink Sepolia | 763373 | ETH, 18 decimals | https://rpc-gel-sepolia.inkonchain.com | https://explorer-sepolia.inkonchain.com |
| Robinhood Chain | 4663 | ETH, 18 decimals | https://rpc.mainnet.chain.robinhood.com | https://robinhoodchain.blockscout.com |
| Ink | 57073 | ETH, 18 decimals | https://rpc-gel.inkonchain.com | https://explorer.inkonchain.com |

Verified 2026-10-07 against [Robinhood Chain docs](https://docs.robinhood.com/chain/add-network-to-wallet) and [Ink network information](https://docs.inkonchain.com/general/network-information). viem has no built-in Robinhood Chain, so both RH networks are explicit `defineChain` entries. Existing `valueWei` storage represents native base units on each chain. One burner wallet covers every network: the same key yields the same address on all EVM chains, nonces are independent per chain, each chain just needs its own ETH funding.

## Execution and configuration

`job.chainId → registry → runtime RPC → viem adapter → existing transaction engine`.
A single worker handles all networks. No global chain ID or single RPC selects the network. Optional `RH_RPC_URL`, `RH_TESTNET_RPC_URL`, `INK_RPC_URL` and `INK_SEPOLIA_RPC_URL` overrides are read only in server runtime code. Production overrides require HTTPS, are never returned to the client, and cannot change the registry chain ID. The adapter checks `eth_chainId` before preparation, simulation, nonce queries, signing, submission recovery and receipt polling. A wrong endpoint cannot confirm an unrelated transaction or cause signing for another network.

Wallet decryption stays inside the existing signing callback. Recovery loads the persisted transaction request, checks its network against the job, and polls the correct client before considering signing. Reservations filter by chain ID; wallet locking serializes concurrent reservations. Identical wallet nonces on different networks are independent. Replacement requests retain chain ID and nonce, and store guards also compare the active job and signing request. Hash uniqueness is `(chain_id, hash)`.

## Schema and deployment

Jobs and transactions already persisted `chain_id`; no new identity column or backfill is needed. Migration `0005_multichain_transaction_identity.sql` changes hash uniqueness and adds a composite replacement foreign key over original ID, chain ID, nonce and execution attempt. Its referenced unique constraint is ordered before the foreign key (Drizzle's generated statement order required correction). Existing invalid replacement relationships make migration fail rather than silently rewriting records.

No Base jobs were ever created in production, so there is no legacy registry: any other chain ID (including historical Base 8453/84532) displays as unknown and fails execution closed. Old Base Telegram drafts are discarded and must restart with an explicit supported network.

Generate/apply migrations through the usual Drizzle deployment process, taking a database backup first. Apply this migration before deploying the new web and worker versions together. The migration tests replay the historical SQL files against a disposable database with Base rows before upgrading. No production database is involved in tests.

## User flows

Web: Dashboard → Mint jobs → New mint. Choose a network, contract, encoded mint calldata, total native value and time; review before confirming. The authenticated POST `/api/mint-jobs` uses the shared job service and per-user idempotency. It accepts only the selected chain and public mint inputs, never a caller-supplied user/wallet identity. Retries reuse a request ID; using that request ID for a different network is rejected.

Telegram: `/mint` → select network → contract → method/quantity or calldata → total native value → schedule → review. Changing network clears contract/value inputs. Lists, details, reviews and explorer buttons identify the selected chain. Wallet setup stays on the authenticated website.

## Verification and testnet smoke test

Tests cover real viem signing with encrypted wallet fixtures and controlled RPC transports for both testnets, nonce isolation, replacement/retry routing, wrong-network recovery, UI/API/Telegram selection, migration constraints and unknown-network handling. CI runs PGlite and PostgreSQL suites, a production Next build with no runtime configuration, and both Docker targets.

For an on-chain smoke test, fund the single burner address on Robinhood Chain Testnet with test ETH and Ink Sepolia with test ETH. Deploy or choose a verified test mint contract on each chain. Configure runtime endpoints, create one reviewed job per network from web or Telegram, and verify each receipt through its own explorer. Restart the worker while a job is pending and confirm that the same transaction is recovered. Automated verification does not fund wallets or broadcast to public chains.

## Single-chain audit

- Config / env / adapter factory: removed global Base selection; lazy per-network RPC resolution.
- Mint schema / transaction schema: existing IDs retained; chain-scoped hash uniqueness and replacement FK added.
- Nonce / leases / retries / replacements: retained engine and locks; cross-network request/recovery guards added.
- Confirmations / restart: verify RPC network before all receipt/nonce operations, including persisted hashes.
- APIs / web: new authenticated creation path and explicit network selector; history uses transaction chain for links.
- Telegram: network step, chain-aware currency, lists and explorers; stale drafts cannot be repurposed.
- Tests / docs / Docker: new multichain paths covered, no runtime config at imports.
