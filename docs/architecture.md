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

Represents the authenticated ArmMint account.

- `id`
- authentication/account linkage
- optional Telegram identity
- timestamps

A User owns their Wallet and MintJobs.

### Wallet

Represents the single V1 burner wallet associated with a User.

- `id`
- `userId`
- public address
- encrypted private-key material
- encryption metadata/version
- timestamps

The plaintext private key exists only in server memory for the minimum time needed for signing.

### MintJob

Represents one requested mint operation.

- `id`
- `userId`
- `walletId`
- target contract/chain/mint parameters
- scheduled execution time
- lifecycle state
- idempotency key
- timestamps

A MintJob can produce execution attempts, but a successful job must resolve to one successful transaction outcome.

### ExecutionAttempt

Represents one worker attempt to execute a MintJob.

- `id`
- `mintJobId`
- attempt number
- execution state
- error/failure metadata safe for logs
- timestamps

Retries of the same logical execution remain associated with the same MintJob and must not accidentally create a second logical mint.

### Transaction

Represents an on-chain transaction associated with an execution attempt.

- `id`
- `executionAttemptId`
- chain/network
- transaction hash
- nonce
- gas parameters
- transaction state
- timestamps

Replacement transactions use the same nonce and are tracked as part of the same logical execution.

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
   ├──────────────► RETRYING ─────► SUBMITTED
   │
   ▼
CONFIRMING
   │
   ├──────────────► FAILED
   │
   ▼
SUCCEEDED
```

Terminal states are `SUCCEEDED`, `FAILED`, and `CANCELLED`.

The exact persistence model may represent some execution phases as attempt/transaction states rather than duplicating every transient state on MintJob. The important invariant is that invalid transitions are rejected and worker restarts can recover from persisted state.

## Idempotency

Each MintJob has a stable execution identity/idempotency key. Worker retries must first inspect persisted execution/transaction state before creating a new transaction.

A network timeout after submission must be treated as an unknown outcome until the existing transaction can be reconciled. The worker must not assume "no response" means "not submitted".

Database uniqueness constraints and atomic claim/update operations are part of the duplicate-execution protection.

## Sell Arm extension

Automated selling is not part of V1. The execution layer is nevertheless designed around a generic execution request so a future Sell Arm can reuse:

- wallet/key handling
- nonce management
- transaction submission
- replacement/retry logic
- idempotency
- transaction tracking

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
