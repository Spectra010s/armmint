# Build and runtime configuration

Production images are built without application credentials. Coolify supplies configuration when the web or worker container runs; Postgres remains a separate resource.

## Initialization audit

| Location | Classification | Initialization boundary |
| --- | --- | --- |
| `lib/auth.ts` | Runtime: auth URL/secret, Google credentials, server validation | Cached `getAuth()` on first request; failed validation is not cached |
| `app/api/auth/[...all]/route.ts` | Runtime: auth handlers and redirect configuration | Request handler |
| `lib/server/session.ts` | Runtime: session and auth | Await Next request headers before calling `getAuth()`; authenticated pages render dynamically |
| `lib/db/index.ts` | Runtime: `DATABASE_URL`, connection pool | First pool operation via the lazy pool proxy |
| `lib/server/config.ts` | Runtime: all required server values, chain ID, current/previous wallet encryption keys, production URL rules | Explicit validation/accessor calls |
| Wallet, Telegram link and webhook routes | Runtime: origin, Telegram and server configuration | Request handlers |
| Wallet key service and rotation service | Runtime: encryption keys | Encrypt/decrypt/rotation operation |
| Transaction engine and Base/viem adapters | Runtime: RPC URL, public/wallet clients, signing | Explicit factory/execution calls; signing key remains inside signing boundary |
| Worker loop and job/scheduler services | Runtime: database and transaction engine | Called operations; imports only define functions |
| `scripts/worker.ts`, Telegram setup and wallet rotation scripts | Runtime executable entrypoints | Explicit CLI invocation; never imported by routes |
| `drizzle.config.ts` | Database tooling: `DATABASE_URL` | Explicit Drizzle command; not application build configuration |
| `lib/auth-client.ts` | Browser client, no server credentials | Safe client construction using same-origin auth endpoint |
| Schema, domain constants, registration hooks | Build-safe definitions/tooling | No application environment validation or network connections |
| Next/PostCSS/TypeScript/package configuration | Build configuration | Static settings; no application credentials |
| Docker and Actions | Build/runtime platform settings | Node mode, telemetry, web host/port are nonsecret; credentials are not build arguments |
| Test fixtures | Test-only configuration | Isolated tests; never supplied to the production build |

The lazy pool from `7f4a610` is retained: the installed Drizzle driver stores the supplied client without accessing its properties or connecting. The proxy binds methods to the real cached Pool, preserving query/transaction and shutdown behavior. A regression test imports every API route and library module without runtime configuration and verifies that actual auth/database/key use still fails validation.

CI also performs a production Next build with an empty inherited environment (apart from PATH, HOME and telemetry), and builds both Docker targets on pushes and pull requests. Docker excludes `.env` files. The publish workflow uses the same Dockerfile with no runtime credentials and publishes separate web and worker images; only the web image exposes port 3000.
