# P5-E durable voting foundation

This increment adds durable vote windows, signed anonymous sessions, accepted receipts and submission limits. Database time determines eligibility, and operator pause/resume preserves the remaining window duration. The current rules worker still records `votingEnabled: false`, and the browser remains a local preview. Winning-effect resolution and worker integration are the next increment; deploying this foundation does not activate audience voting.

## Activation boundary

The service-only window-opening RPC requires a current worker lease, an active rules-only exhibition at committed tick 30, the rules worker version marker and an explicit private `votingEnabled: true` value. It opens a single 20-second window per round and cannot reset an existing deadline. The current worker rejects that opt-in recovery shape. A database guard also rejects tick advancement for opted-in rounds until effect integration is implemented. Operators must not manually toggle private recovery to bypass this boundary.

Local database/HTTP tests use deliberately synthetic, opted-in fixtures at tick 30. They demonstrate voting persistence and permission behavior, not an end-to-end voting exhibition. Clean/stress/replay/benchmark and ordinary voting-disabled rounds cannot open a window.

## Durable acceptance and timing

Each signed session has one current option: `bus`, `rain` or `supplier-delay`. A new accepted request can change that selection before the strict deadline. Acceptance is acknowledged only after the database commits its receipt and current selection. Retrying the same request ID and option returns the original receipt without restoring an older choice. Reusing an ID with a different option returns HTTP 409. A fresh server instance reads the durable selection and receipts; no in-memory vote history is authoritative.

Pause stores the remaining duration using database time. Resume restores that duration without consuming paused wall time. Pausing after expiry cannot reopen the window. Stop disables new submissions; accepted receipts remain available for private recovery. Accepted retries remain idempotent after closure, pause or stop. The public projection contains only lifecycle, deadline, aggregate counts and eligible options, with no session identities, private receipts or seeds.

New accepted submissions are bounded per window: 20 per rolling second globally, two per rolling second per session, 400 receipts overall and 20 per session. Limit violations return HTTP 429 without accepting a vote. Exact accepted retries do not consume another slot. These bounds are shared across API processes because they are enforced under the database lock. They are operational safeguards, not proof that a hosted 20-submissions/second load target has passed.

## Signed sessions and API

Apply all four migrations before deploying the matching server. Configure `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `HAWKER_VOTE_SESSION_KEY` and `HAWKER_PUBLIC_ORIGIN` only on the server. The signing key must be separate from operator and provider credentials, generated from at least 32 random bytes and encoded as unpadded base64url. The origin must be the exact canonical HTTPS site origin, without a trailing slash or path. Missing configuration leaves the endpoint unavailable.

`POST /api/votes` accepts JSON and requires an exact matching Origin header. It does not trust forwarded host headers. The three request shapes are:

```json
{"action":"session","roundId":"11111111-1111-4111-8111-111111111111"}
```

```json
{"action":"status","roundId":"11111111-1111-4111-8111-111111111111"}
```

```json
{"action":"submit","roundId":"11111111-1111-4111-8111-111111111111","requestId":"22222222-2222-4222-8222-222222222222","optionId":"rain"}
```

Session creation requires a published eligible window. The server sets a round-bound, HMAC-signed, one-hour `__Host-hawker-session` cookie with HttpOnly, Secure, SameSite=Strict and Path=/. Reusing a valid cookie preserves its identity and expiry. Status returns only that session's current receipt; submissions derive identity from the verified cookie. Client-supplied identity, time, seed or effect parameters are rejected. The single cookie is intended for the one active exhibition; opening another round replaces it.

Bodies are limited to 1 KiB with a two-second read deadline. Responses are uncached, errors omit backend details, and uncertain writes are not automatically retried. After an unconfirmed result, resend the identical request with its original request ID and session, then read status. A local click or disconnected queue is not acceptance. The browser integration must present these states truthfully before activation.

Anonymous cookies provide exhibition deduplication, not one-human/one-vote protection: clearing cookies can create another identity. Session issuance is stateless; deployment-level abuse protection and request limits remain required for public release. Rotating the signing key invalidates existing sessions, so preserve it across ordinary restarts and plan rotations around exhibitions. Database receipts are retained even if the browser loses its session cookie.

## Validation and remaining work

TypeScript and all 501 tests across 37 files pass, including independent signed-session tests and gateway/client validation. Local PostgreSQL checks cover permissions, bounded acceptance, changed selections, concurrent duplicate submissions, pause/resume and a lock-waiting vote rejected after expiry. Actual PostgREST checks pass for signed-cookie gateway flows, isolated receipts, lost acknowledgements, exactly 20 accepted concurrent new submissions with the next rejected, deadlines and the effect-integration guard. Existing rules-worker/control HTTP regression checks also pass.

The production Next.js build passes with `/api/votes`; a local production smoke verifies the homepage returns 200, unconfigured voting returns uncached 503, and GET returns 405. These checks use synthetic fixtures and local infrastructure, not hosted Realtime or public-release acceptance. The complete `pnpm check` passes: P0 contracts, 800 rules and 80 mixed engine episodes, and 24 archives with 72 replays and 72 report reloads. Behavioral references and static dataset hash `0e4e973c9e4c162354ab158b3127d1a7629d4f9f17b81233deecaaa6923341d7` remain unchanged. Refreshed source-tree identity: `8beae46dc48daeb8c2228228e5d7f2199c28ffc85a8570701c92b5494bfa3006`. No provider calls or hosted migrations/deployments are part of this increment.

Reproduce database checks with `P5_POSTGRES_CONTAINER=hawker-p5-postgres pnpm validate:p5-store` and voting HTTP checks with `P5_POSTGRES_CONTAINER=hawker-p5-postgres pnpm validate:p5-votes`, using an isolated disposable Postgres container. Run the two HTTP runners sequentially because they share its loopback gateway port.

Next: deterministically resolve accepted counts, persist tie/no-vote audit evidence, and apply the resolved event at one atomic tick boundary with exact recovery/replay. Then add live snapshot/cursor/Realtime reconnect and acknowledged voting UI, followed by multi-viewer, hosted-permission and load acceptance. No full P5 exit is claimed here.
