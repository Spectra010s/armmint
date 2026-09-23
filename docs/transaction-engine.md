# Transaction execution

Run `pnpm worker` with Node 24.19+ and the server environment from `lib/server/config.ts` (including `DATABASE_URL`, `BASE_RPC_URL` and `ARMINT_ENCRYPTION_KEY`). The worker reads `.env`, claims due jobs, reuses their execution attempt and invokes `createProductionTransactionEngine().executeClaimedJob(jobId, attemptId)`. Each tick processes one job. Multiple worker processes may share the database.

## Mint inputs

A scheduled mint job supplies its owning user and wallet, Base (8453) or Base Sepolia (84532) chain ID, target contract, encoded `calldata`, and decimal-string `valueWei`. Calldata must include the contract's actual mint selector and arguments (quantity, allowlist proof, recipient, etc.); the engine does not assume that every NFT contract uses the same ABI. Missing calldata fails closed. The configured RPC must report the job's chain ID. Use a separate worker/database deployment for each configured Base network.

The loader validates wallet ownership and public address. Public RPC calls estimate gas and EIP-1559 fees and simulate the mint. The viem signing adapter alone loads the encrypted wallet and calls the existing temporary-decryption service; it also verifies that the derived account matches the job. Plaintext keys and serialized signed transactions are not stored or logged. JavaScript strings cannot be reliably zeroed; plaintext/account references stay inside the signing callback and are not cached.

## Durable submission and recovery

Before signing, the engine commits an immutable public request (destination, calldata, value, gas and fees) and nonce. A wallet row lock serializes nonce allocation across jobs. Acquiring an execution lease holds both the engine lease and the claim lease for 60 seconds, and the engine renews both before every long RPC (receipt polls, nonce lookups, simulation, signing, submission) so a second worker can never satisfy the claim query's both-leases-expired condition mid-execution. Losing the lease aborts before any signing side effect; the signed-hash checkpoint enforces the same ownership check. All retries of an existing request reuse its stored nonce and inputs. Before broadcasting, the signing adapter commits the locally calculated transaction hash. The provider's returned hash must match it.

If a process dies or a response is lost, the worker reclaims expired leases in all active job states. It checks receipts for every signed candidate, including an original that was replaced locally. A known submission is monitored without decrypting or signing. A missing, ambiguously broadcast request can be signed again deterministically and rebroadcast with the same bytes/hash. A definitely unsigned failed job's nonce gap may be reused; a signed reservation is never released based on a network error.

Confirmation defaults to two blocks. A receipt below that depth remains pending. Confirmations and reverts update the transaction, attempt and job together under row locks. A terminal parent prevents partial writes from late submissions, confirmations or failures. If the account's latest nonce advances before a candidate receipt is available, the engine stops signing and keeps observing; it never retries the mint at a new nonce. Ethereum nonces are sequential, so latest > reserved proves the reservation was consumed by a different transaction — but receipts can lag, so the engine waits a 5-minute grace period first. After the grace period it marks the reservation `DROPPED` (hash retained, nonce stays occupied so future jobs skip it) and fails the job closed with `NONCE_CONSUMED`. A still-mineable pending transaction (latest == reserved) is never declared dropped; it stays under confirmation monitoring.

## Retries and replacements

The default policy allows three execution attempts in total (initial submission plus two retry/replacement opportunities), with a 12.5% upward-rounded bump to both EIP-1559 fees. A submitted transaction becomes eligible for replacement after 120 seconds. Its gas, calldata, value and nonce stay unchanged, and the replacement is simulated before signing. Only a signed (broadcast or checkpointed) transaction may be replaced, only one direct replacement of a candidate can be reserved, and a self-referential database foreign key rejects orphan replacement links. Same-nonce reuse is enforced both by the application and by the single-child uniqueness constraint.

RPC errors are not evidence that a transaction was dropped. Pending or no-longer-visible submissions follow the same bounded, same-nonce replacement policy. On retry exhaustion, an unsigned execution fails; a potentially broadcast execution stops signing but remains under confirmation monitoring. This avoids declaring a mint failed while a miner can still include it. Stable failure codes explain failures without provider error bodies, credentials, keys or signed payloads.

## Verification

`pnpm lint`, `pnpm typecheck` and `pnpm test` run without production credentials. Tests use real viem transaction signing, encrypted wallet records and controlled RPC responses. PGlite supplies isolated PostgreSQL semantics locally. CI additionally runs the production execution suite against PostgreSQL 16 with separate connections, covering nonce reservation and competing executor locks. `ENGINE_TEST_DATABASE_URL` selects a disposable database for that suite; never point it at application data because fixtures reset its test tables.

Tests do not spend funds or send transactions to Base. On-chain execution still depends on the configured contract, wallet balance, RPC availability and the applied database schema.
