# Authentication and account linking

ArmMint uses Better Auth with Google OAuth and the Drizzle PostgreSQL adapter.
The browser signs in through `/api/auth/sign-in/social`, Google returns to
`/api/auth/callback/google`, and Better Auth persists the user, Google account,
and session in `users`, `accounts`, and `sessions`. OAuth state is stored in
`verifications` and bound to the initiating browser's signed cookie.

## Google application configuration

Create a Google OAuth **Web application** client. Register the application origin
as an authorized JavaScript origin and the exact callback URI:

```
https://your-armmint-host/api/auth/callback/google
```

For local development, register `http://localhost:3000` and its matching callback
separately. Set `BETTER_AUTH_URL` to the actual application origin and configure
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and a strong `BETTER_AUTH_SECRET`.
Use HTTPS outside local development. Configure the Google consent screen and
its test users or publishing status for the intended audience.

Keep these credentials server-side. Google account tokens are encrypted by
Better Auth using its auth secret. Google identities are not implicitly merged
into existing accounts by matching email. Browser sessions are checked against
the database, so expiry and revocation apply to authenticated operations.

## User flow

1. On the home page, select **Continue with Google** and complete Google consent.
2. The home page displays the signed-in account and secure burner-wallet setup.
3. Select **Link Telegram**, then **Open Telegram and press Start**.
4. Return to ArmMint and select **I’ve pressed Start — check link**. The page
   displays the linked identity and removes the credential link. Reloading the
   page also shows the persisted status.
5. Use the Telegram bot to manage mint jobs, or **Sign out** to end the web session.

OAuth cancellations and callback failures lead to a fixed recovery page with a
fresh sign-in button. Provider error descriptions are not displayed in the page
or forwarded in recovery URLs. Network failures leave the controls available
for retry.

Telegram credentials expire after ten minutes, are stored only as digests, and
are committed as consumed before linking starts. Concurrent issuance is
serialized so only the newest unconsumed credential remains valid. Database
uniqueness constraints prevent either identity from being assigned twice. An
already-linked web account cannot issue a replacement link. Telegram callbacks
resolve their sender through the existing linked-account ownership boundary.

Link creation is a same-origin authenticated POST with no request body; user IDs
and Telegram identities cannot be selected by the browser. Link status is read
from the authenticated account. Both responses are non-cacheable. Wallet setup
uses authenticated user context and returns generic failures without key data.

Notification delivery happens after linking commits. Delivery failure does not
undo the link, and a repeated `/start` from the linked identity reports that its
account is already linked without consuming the credential again or changing
ownership.

## Verification

The auth integration suite runs the actual Better Auth HTTP handlers, Google
provider, Drizzle adapter, session lookup, authenticated link endpoint, and
Telegram authorization against an ephemeral database. Google's token endpoint
is controlled by the tests; no real Google credentials or live consent flow are
used. Tests cover state-cookie binding, callback replay, encrypted account
persistence, repeat sign-in, account conflicts, expired/revoked sessions,
concurrent link issuance and consumption, and delivery failures.

React DOM interaction tests exercise the real sign-in, linking, sign-out, and
error-page components with controlled network responses. GitHub Actions runs
these with the full suite and repeats auth integration against PostgreSQL 16.
