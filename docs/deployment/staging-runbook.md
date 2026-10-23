# Rules-only staging rollout

This runbook is the P5-H staging handoff for the implemented polling viewer and durable audience voting. It does not activate Jev or Zoom, claim Realtime delivery, or authorize a production migration. Use an isolated Supabase staging project, a Vercel staging deployment and a separate durable Node worker host. Record the exact Git revision for all three services.

## Current readiness

Local implementation and integration checks passed through P5-G. Hosted acceptance is blocked: this cloud environment currently has no Vercel project binding, Supabase staging URL/credentials, public HTTPS origin or worker host configuration. Its network allowlist also lacks the target deployment hosts. Add the specific staging hosts through environment network configuration before attempting hosted requests; a local preflight does not verify network access.

Provide project identifiers and URLs as ordinary configuration. Put credentials in each host's secret settings, never in chat, Git, screenshots or evidence reports. The repository does not automatically load `.env.example`.

## Configuration by host

| Host | Required settings | Purpose |
|---|---|---|
| Vercel server | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Read public projections and perform validated vote/operator RPCs |
| Vercel server | `HAWKER_PUBLIC_ORIGIN`, `HAWKER_VOTE_SESSION_KEY` | Exact canonical HTTPS origin and signed anonymous sessions |
| Vercel server | `HAWKER_OPERATOR_TOKEN`, `HAWKER_OPERATOR_ID` | Dedicated machine-only controls and audit identity |
| Worker | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Fenced rules execution and durable recovery |

Keep these values server-only, without `NEXT_PUBLIC_` prefixes. Generate the operator token and voting key independently from at least 32 random bytes, encoded as unpadded base64url. Preserve the voting key across normal restarts. Use a stable staging domain: the configured origin must exactly match the browser origin, with no path or trailing slash. Preview domains need their own matching environment and must never mutate production data.

Vercel import needs repository access and project/team selection. Automated provisioning additionally needs the selected Vercel project/team identifiers and an appropriate credential; these are not runtime application variables. Applying migrations needs authorized staging database access, not just the application's service-role API key. Record the worker host and who operates its supervisor separately.

## Rollout order

1. Review the six files in `supabase/migrations/` and apply them in filename order to the isolated staging project through its migration workflow. Do not edit an already applied migration or expose `live_private`. Retain migration history and the deployment revision as evidence. The local SQL test runner creates disposable databases; it is not the hosted migration command.
2. Import the repository into Vercel with Root Directory `apps/web`, workspace access outside that directory enabled, the Next.js preset and Node 24. Use checked-in `vercel.json` installation/build commands. Configure the server values above before building the matching revision.
3. From the repository root, run the appropriate local shape check in a trusted environment with that host’s staging variables. For Vercel, use trusted CI/build tooling with the same environment configuration; Vercel does not provide an interactive application-host shell:

   ```sh
   pnpm deployment:preflight --target web
   pnpm deployment:preflight --target worker
   ```

   Run only the check for that host's role. A successful result means required variable shapes are valid; it does not authenticate credentials, check migrations, contact services or establish deployment readiness. Missing/invalid configuration returns a nonzero exit code and only variable names/reason codes.
4. Install the same revision with the pinned pnpm and Node versions on the worker host. Configure process ownership, logs and restart procedures. The current CLI performs bounded work and exits; it is not a continuously scheduling supervisor. Do not configure a restart command containing `--create`. Pause/completion are normal exits; stop automatic restarts until the operator explicitly resumes the intended round.
5. After hosted permissions and configuration checks below, create one development-seed exhibition round with a fresh UUID. This command publishes the sanitized view and opts into voting:

   ```sh
   pnpm worker:rules --round YOUR_ROUND_UUID --create --seed 7 --publish --voting
   pnpm worker:rules --round YOUR_ROUND_UUID --steps 121
   ```

   The second command resumes stored state and never repeats creation. Database pacing remains five seconds; no staging override is allowed. If creation acknowledgement is lost, inspect authoritative round state before deciding what to do. The one active exhibition constraint must remain enabled.
6. Share `https://YOUR_STAGING_HOST/live/YOUR_ROUND_UUID` with two separate browser sessions and execute acceptance below. Record evidence without credentials or signed cookies. Do not promote a live deployment based solely on a successful build or preflight.

## Hosted acceptance record

For each check, record revision, staging project, UTC time, result and sanitized evidence. Mark unexecuted checks **not run**, not passed.

| Check | Required observation |
|---|---|
| Migration and role permissions | All six migrations applied; anonymous/authenticated private reads and all authoritative writes denied; allowed public projections contain no recovery, seed or session identity |
| Vercel build and assets | Production build completes with workspace dependencies; `/`, `/live` and the live route load; no server credentials in browser bundles or responses |
| Two viewers | Both receive the same committed tick/scores; viewer reads neither create a round nor advance simulation; provider dispatch stays disabled |
| Control and recovery | Authorized pause/resume preserves boundary and voting time; unauthorized controls fail; worker termination/restart resumes persisted state without duplicate commits |
| HTTPS voting | Explicit Join voting sets a Secure, HttpOnly, SameSite=Strict, Path=/ host cookie; exact origin accepted and foreign origin rejected; UI reports acceptance only after receipt |
| Uncertain acknowledgement | Same-session manual retry preserves request ID and returns original receipt; no automatic vote submission after reconnect; expired session explains uncertainty |
| Audience effect | Counts resolve deterministically, pending application is distinct from committed application, and restart does not apply an effect twice |
| Cursor recovery | Disconnect/reconnect catches missed events without duplicate history or regressing scores; withdrawn/private round becomes unavailable |
| Completion and stop | Completed round remains readable and adds no ticks; operator stop is durable and prevents further execution |

Public-load acceptance and Supabase Realtime are separate pending work. Keep this first staging exercise to two viewers and rules-only execution. Provider access, spending gates and reservation durability remain unchanged.

## Stop and rollback

Use the authenticated operator stop action to end an active exhibition, then stop its worker process/scheduled invocations. Prefer pause for a recoverable interruption. Preserve audit records and recovery state. A frontend rollback must use a version compatible with the installed schema and recovery format; do not undo additive migrations or restore an older database over accepted votes as an automatic rollback. Investigate the failed acceptance check before restarting or promoting.

## Handoff verification

On 2026-10-23 the offline preflight's 20 tests passed, including CLI exit codes, malformed configuration, secret redaction and reused-credential rejection. An independent source review found no material issues after clarifying Vercel's CI/build execution context. Direct checks of this environment correctly reported web and worker configuration **blocked**, with zero network calls. No hosted deployments, migrations or provider calls were made.

The complete `pnpm check` passed: 590 tests across 44 files, TypeScript, P0 contracts, 800 rules and 80 mixed episodes, 24 archives, 72 replays and 72 report reloads. Provenance-only refresh preserved behavioral references and the static dataset hash. Source identity: `b4bc953ad8cd37f0a71bfa1645e5b7891b24b65d2a07b50742a14b4f1159b360`.
