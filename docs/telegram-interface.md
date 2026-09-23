# Telegram interface

ArmMint's private-chat bot lets a linked account create, review, schedule, inspect,
and cancel mint jobs. Jobs use the same persistence, worker and transaction engine
as other execution entry points.

## Setup

Create the bot through BotFather and configure `TELEGRAM_BOT_TOKEN`,
`TELEGRAM_BOT_USERNAME`, and a random `TELEGRAM_WEBHOOK_SECRET`. Set
`BETTER_AUTH_URL` to the public HTTPS application origin. Set `BASE_CHAIN_ID` to
`8453` for Base or `84532` for Base Sepolia, matching `BASE_RPC_URL`. The default
is Base. The execution adapter also checks the RPC network before signing.

After deploying the application with its current database schema, run
`pnpm telegram:setup` to register the private-chat command menu and webhook.
It subscribes to messages and callbacks with one webhook connection so updates
normally arrive in order. It does not discard pending updates. Run `pnpm worker`
as a separate long-running process to execute and monitor jobs.

Sign in to the web application, choose **Link Telegram**, then open the generated
single-use link and press Start. Set up the dedicated burner wallet on the
signed-in web page. Telegram only links to this page; it cannot import a wallet
and never requests or returns private keys or seed phrases.

## Mint flow

1. Choose **New mint** or `/mint`.
2. Enter the contract address on the deployment's displayed network.
3. Choose `mint(uint256)`, `mint(address,uint256)`, or encoded calldata. Verify
   the function against the contract ABI. The two standard methods ask for a
   quantity (1–100); the recipient variant uses the configured burner wallet.
   Other functions and allowlist proofs use public encoded calldata, up to
   1,800 bytes. The bot does not infer an ABI or obtain allowlist proofs.
4. Enter the **total** ETH value for the whole call, excluding gas.
5. Choose **Mint now** or enter a future UTC timestamp within one year.
6. Review the network, contract, wallet, method/quantity, selector, call size,
   total ETH and scheduled time. **Confirm mint** creates the real scheduled job.

A worker claims the due job, simulates, signs using the encrypted wallet boundary,
submits, and observes the outcome. Scheduling is best-effort; a successful
pre-flight does not guarantee a mint. Custom calldata is not repeated in bot
responses, as it may contain allowlist proof data.

`/jobs` lists five jobs per page. Job details and **Refresh** read the current
persisted lifecycle. A transaction link is shown once a hash exists. Cancellation
has a confirmation step and is allowed only while the job remains scheduled and
has no signed transaction. Cancellation and worker claims lock the same job row.
Once the worker claims a job, the bot cannot cancel it.

## Conversation and delivery behavior

Validated draft fields live in `telegram_conversations`, with a 30-minute idle
expiry. `/back`, **Resume draft**, `/cancel`, and **Restart** provide recovery.
Restart replaces the draft, not an existing job. Menu and status actions retain
an unexpired draft. Expired drafts are cleared on the next update.

The linked account row serializes conversation updates across application
instances. Update IDs suppress duplicate and older deliveries; a draft revision
prevents old buttons from confirming changed inputs. Confirmation clears the
draft in the same transaction that creates the job, with a draft-specific
idempotency key. Every job lookup and mutation is scoped to the resolved owner.

Bot delivery is best-effort after database commit. A Telegram API failure does
not rerun the committed action. If a reply is missing, `/start` can resume the
draft and `/jobs` can find a created job. Processing failures return a retryable
webhook response without exposing internal errors. Callback queries are
acknowledged even if the update was already processed. Raw incoming messages,
transport exceptions, and wallet secrets are never logged.

## Verification

`pnpm test` covers the guided flows, ownership checks, malformed updates, stale
buttons, expiry, duplicate confirmation, validation, cancellation races, and
notification failures. The production execution suite includes a Telegram-created
job going through real viem signing and confirmation with controlled RPC replies.
GitHub Actions also runs the Telegram and production integration suites against
PostgreSQL 16 with separate connections.
