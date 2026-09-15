# ArmMint Architecture

## Overview

ArmMint is a Telegram-first NFT automation system. Telegram is an interface for configuring and monitoring jobs; it is not part of the transaction execution path.

The core execution layer is interface-agnostic so the web app, Telegram bot, and a future Sell Arm can all use the same job/execution services.

## Runtime boundaries

```text
                    ┌─────────────────────┐
                    │   Web / Mini App    │
                    │ sensitive setup/UI  │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │    Next.js Server   │
                    │ auth + application  │
                    │ API/service layer   │
                    └──────┬───────┬──────┘
                           │       │
                    ┌──────▼───┐ ┌─▼─────────────┐
                    │ Postgres │ │ Telegram Bot  │
                    │   data   │ │ interface     │
                    └──────┬───┘ └───────────────┘
                           │
                    ┌──────▼──────────────┐
                    │   Worker / Executor │
                    │ scheduler + tx core │
                    └──────────┬──────────┘
                               │
                         ┌─────▼─────┐
                         │ Blockchain │
                         └───────────┘
```

### Next.js server

Owns authenticated application requests, job creation/cancellation, wallet setup, account linking, and read APIs. It must not perform long-running scheduled execution in request handlers.

### Worker

Owns polling/claiming due jobs and invoking the transaction execution layer. It must be restartable and safe to run concurrently. Telegram is not required for execution.

### Transaction execution layer

Owns pre-flight simulation, signing, nonce handling, submission, replacement/retry, confirmation tracking, and idempotency. This layer receives a domain-level execution request rather than Telegram-specific input.

### Telegram

Provides the primary user interface for onboarding, job creation/status, cancellation, and notifications. Private keys must not be collected through ordinary Telegram messages. Sensitive wallet setup goes through the authenticated web/Mini App surface.

## Core domain model

### User

Represents the authenticated ArmMint account. A User owns their Wallet and MintJobs. Authentication provider records and Telegram linkage belong to the account layer rather than transaction execution.

### Wallet

Represents the single V1 burner wallet associated with a User. A Wallet cannot be used to execute a job owned by another User. The plaintext private key exists only in server memory for the minimum time needed for signing.

### MintJob

Represents one logical requested mint operation. It owns a stable `idempotencyKey` that identifies that logical execution across worker claims, retries, restarts, and reconciliation. A MintJob can produce multiple ExecutionAttempts, but only one successful logical mint outcome is allowed.

### ExecutionAttempt

Represents a bounded worker attempt to execute a MintJob. Attempt numbers are monotonically increasing per job and must be unique within that job. An attempt never changes ownership or moves to another MintJob.

### Transaction

Represents one prepared or submitted on-chain transaction associated with an ExecutionAttempt. When a submitted transaction is replaced, the old Transaction record becomes `REPLACED` and a new Transaction record tracks the replacement hash using the same nonce. The successor stores `replacesTransactionId` so the replacement chain is explicit. All records remain under the same logical MintJob execution.

## Ownership and lifecycle invariants

- A Wallet belongs to exactly one User in V1.
- A MintJob belongs to one User and references a Wallet owned by that same User.
- An ExecutionAttempt belongs to exactly one MintJob.
- A Transaction belongs to exactly one ExecutionAttempt.
- Terminal entity states cannot transition back into active states.
- Cancellation is only allowed while a job is `SCHEDULED` or `CLAIMED`; once simulation/signing begins the worker owns the lifecycle and must reconcile it instead of accepting a user cancellation.
- Worker retries do not create a new logical MintJob.
- A successful logical execution prevents another successful execution for the same MintJob identity.

## MintJob state machine

```text
SCHEDULED
   │
   ▼
CLAIMED ───────────────► CANCELLED
   │
   ▼
SIMULATING
   │
   ├──────────────► FAILED
   │
   ▼
SIGNING
   │
   ▼
SUBMITTING
   │
   ▼
SUBMITTED
   │
   ▼
CONFIRMING
   │
   ├──────────────► SUCCEEDED
   ├──────────────► FAILED
   │
   ▼
RETRYING ────────► SUBMITTING / SUBMITTED / CONFIRMING
```

A `SCHEDULED` job may also transition directly to `CANCELLED`. `SUBMITTING`, `SUBMITTED`, and `CONFIRMING` may enter `RETRYING` when persisted transaction state requires another safe execution/reconciliation step. A retry never resets the job to an earlier pre-signing phase.

Terminal MintJob states are `SUCCEEDED`, `FAILED`, and `CANCELLED`.

## ExecutionAttempt state machine

```text
PENDING
   │
   ▼
RUNNING ─────────► SUCCEEDED
   │
   ├─────────────► FAILED
   │
   ▼
RETRYING ────────► RUNNING
```

A `PENDING` attempt may fail before it reaches `RUNNING`. `SUCCEEDED` and `FAILED` are terminal attempt states. A retry represents continuation of the same logical MintJob execution, not permission to duplicate a mint.

## Transaction state machine

```text
CREATED
   │
   ▼
SUBMITTED ───────► REPLACED
   │              DROPPED
   │              REVERTED
   ▼
CONFIRMING ──────► REPLACED
   │              DROPPED
   │              REVERTED
   ▼
CONFIRMED
```

A `CREATED` transaction may become `DROPPED` if it is abandoned before successful submission. `CONFIRMED`, `REPLACED`, `DROPPED`, and `REVERTED` are terminal states for an individual transaction record. A `REPLACED` record has a successor transaction with the same nonce; that successor references the old record through `replacesTransactionId`.

The exact persistence model may represent some execution phases as attempt/transaction states rather than duplicating every transient state on MintJob. Invalid transitions must be rejected and worker restarts must recover from persisted state.

## Idempotency and execution identity

`MintJob.idempotencyKey` is the stable identity of one requested mint. It is created once and is never regenerated merely because a worker retries or restarts.

Before creating or submitting transaction material, the worker must reconcile persisted attempts and transactions for that identity. A network timeout after submission is an unknown outcome, not evidence that submission failed. Existing transaction state must be reconciled before another submission is considered.

The database layer must enforce the invariants with uniqueness constraints and atomic claim/update operations. In particular, attempt numbers are unique per MintJob, execution claims cannot be concurrently won by multiple workers, and transaction nonce/replacement records remain associated with the same logical execution.

## Configuration boundaries

ArmMint V1 has no required public runtime configuration. `DATABASE_URL`, `BETTER_AUTH_SECRET`, Google OAuth credentials, `ARMINT_ENCRYPTION_KEY`, Telegram credentials, and `RPC_URL` are server-only. They must not use the `NEXT_PUBLIC_` prefix or be imported into client components.

Server configuration is read through `lib/server/config.ts`, which is guarded by `server-only`. Required values are validated before use; database/RPC values must be valid URLs and the wallet encryption key must decode to exactly 32 bytes. Invalid configuration must fail with the variable name and validation problem, never the secret value.

### Private-key boundary

The authenticated sensitive setup surface may accept a burner-wallet private key only over the server boundary. The plaintext value must be passed directly to the encryption service, must never be persisted or returned to the client, and must be released from application references after the operation completes. Workers may decrypt it only immediately before signing. Telegram handlers must never accept private keys as ordinary chat input.

### Logging and errors

Logs and error payloads may include stable identifiers such as job IDs, attempt IDs, transaction hashes, state names, and non-secret error codes. They must not include private keys, decrypted or encrypted key material, encryption IV/auth tags, signed raw transactions, auth/session secrets, OAuth secrets, Telegram tokens/webhook secrets, database credentials, or RPC credentials embedded in URLs.

Errors crossing an API or Telegram boundary must be sanitized. Internal errors may identify which configuration variable is invalid but must never echo its value. Secret-bearing request bodies and configuration objects must not be logged wholesale.

## Sell Arm extension

Automated selling is not part of V1. The execution layer is nevertheless designed around a generic execution request so a future Sell Arm can reuse wallet/key handling, nonce management, transaction submission, replacement/retry logic, idempotency, and transaction tracking.

The future feature should add a new job/action type rather than create a second transaction engine.

## Security boundaries

- Private keys are server-only data.
- Encrypted key material is never sent back to clients after storage.
- Private keys and signed payloads must never be logged.
- Server encryption secrets are never exposed through client bundles.
- Users must use burner wallets only.
- Telegram messages are treated as untrusted input.

## V1 exclusions

- Multi-wallet support
- EIP-7702
- Sponsored gas
- Automated selling implementation
- Complex portfolio management
