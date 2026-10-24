# Rules-only staging rollout

This runbook is the P5-H staging handoff for the implemented polling viewer and durable audience voting. It does not activate Jev or Zoom, claim Realtime delivery, or authorize a production migration. Use the isolated Supabase staging project, the Vercel staging deployment and the persistent Coolify worker. Record the exact Git revision for all three services.

## Current readiness

The rules-only stack is deployed: Vercel serves `https://hawker-wars-staging.vercel.app`, Supabase project `csgyhgamvpcmemlhrwdk` stores durable state, and Coolify hosts `hawker-wars-staging-worker`. Coolify is the worker host going forward; Codex runs deployment and acceptance tooling, not the persistent simulation loop. See [Coolify worker operations](coolify-worker.md).

Vercel deployment `dpl_GhcHZRV8JR9aJR33JtrXfrnSQoLQ` serves web revision `98e7658049fd795287733b872a94a188419238da`. The worker is pinned to `c99d3db624a8e15e947711cccb3555851f1df337`; that commit adds the supervisor without changing the web implementation. Vercel Deployment Protection remains enabled. A published round is visible to viewers who can access staging; publication does not bypass deployment access controls.

Provide project identifiers and URLs as ordinary configuration. Put credentials in each host's secret settings, never in chat, Git, screenshots or evidence reports. The repository does not automatically load `.env.example`.

## Configuration by host

| Host | Required settings | Purpose |
|---|---|---|
| Vercel server | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Read public projections and perform validated vote/operator RPCs |
| Vercel server | `HAWKER_PUBLIC_ORIGIN`, `HAWKER_VOTE_SESSION_KEY` | Exact canonical HTTPS origin and signed anonymous sessions |
| Vercel server | `HAWKER_OPERATOR_TOKEN`, `HAWKER_OPERATOR_ID` | Dedicated machine-only controls and audit identity |
| Coolify worker | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `HAWKER_ROUND_ID` | Fenced rules execution of one explicitly selected round |

Keep these values server-only, without `NEXT_PUBLIC_` prefixes. Generate the operator token and voting key independently from at least 32 random bytes, encoded as unpadded base64url. Preserve the voting key across normal restarts. Use a stable staging domain: the configured origin must exactly match the browser origin, with no path or trailing slash. Preview domains need their own matching environment and must never mutate production data.

Vercel import needs repository access and project/team selection. Automated provisioning additionally needs the selected Vercel project/team identifiers and an appropriate credential; these are not runtime application variables. Applying migrations needs authorized staging database access, not just the application's service-role API key. Record the worker host and who operates its supervisor separately.

## Rollout order

1. Review the seven files in `supabase/migrations/` and apply them in filename order to the isolated staging project through its migration workflow. Do not edit an already applied migration or expose `live_private`. Retain migration history and the deployment revision as evidence. The local SQL test runner creates disposable databases; it is not the hosted migration command.
2. Import the repository into Vercel with Root Directory `apps/web`, workspace access outside that directory enabled, the Next.js preset and Node 24. Use checked-in `vercel.json` installation/build commands. Configure the server values above before building the matching revision.
3. From the repository root, run the appropriate local shape check in a trusted environment with that host’s staging variables. For Vercel, use trusted CI/build tooling with the same environment configuration; Vercel does not provide an interactive application-host shell:

   ```sh
   pnpm deployment:preflight --target web
   pnpm deployment:preflight --target worker
   ```

   Run only the check for that host's role. A successful result means required variable shapes are valid; it does not authenticate credentials, check migrations, contact services or establish deployment readiness. Missing/invalid configuration returns a nonzero exit code and only variable names/reason codes.
4. Configure the private Git repository through Coolify's existing `jenzushsu-coolify` GitHub App, with repository root `/` and Compose path `/compose.worker.yaml`. Pin the reviewed worker revision. Keep all three worker variables runtime-only; disable build-time availability. No public port or HTTP health check is needed. The supervisor's Docker restart policy is `unless-stopped`, with a 120-second graceful stop period.
5. Create one development-seed exhibition round with a fresh UUID from trusted operator tooling. Creation is explicit and separate from container startup:

   ```sh
   pnpm worker:rules --round YOUR_ROUND_UUID --create --seed 7 --publish --voting
   ```

   This command creates the round and performs one bounded step. Set `HAWKER_ROUND_ID` to that UUID in Coolify and deploy; the persistent supervisor performs subsequent ticks. Do not run a second CLI worker loop alongside Coolify. Never put `--create` in a restart command. Database pacing remains five seconds with no staging override. If creation acknowledgement is lost, inspect authoritative state before retrying. Preserve the one active exhibition constraint.
6. Share `https://YOUR_STAGING_HOST/live/YOUR_ROUND_UUID` with two separate browser sessions and execute acceptance below. Record evidence without credentials or signed cookies. Do not promote a live deployment based solely on a successful build or preflight.

## Hosted acceptance checklist

For each check, record revision, staging project, UTC time, result and sanitized evidence. Mark unexecuted checks **not run**, not passed.

| Check | Required observation |
|---|---|
| Migration and role permissions | All seven migrations applied; anonymous/authenticated private reads and all authoritative writes denied; allowed public projections contain no recovery, seed or session identity |
| Vercel build and assets | Production build completes with workspace dependencies; `/`, `/live` and the live route load; no server credentials in browser bundles or responses |
| Two viewers | Both receive the same committed tick/scores; viewer reads neither create a round nor advance simulation; provider dispatch stays disabled |
| Control and recovery | Authorized pause/resume preserves boundary and voting time; unauthorized controls fail; worker termination/restart resumes persisted state without duplicate commits |
| HTTPS voting | Explicit Join voting sets a Secure, HttpOnly, SameSite=Strict, Path=/ host cookie; exact origin accepted and foreign origin rejected; UI reports acceptance only after receipt |
| Uncertain acknowledgement | Same-session manual retry preserves request ID and returns original receipt; no automatic vote submission after reconnect; expired session explains uncertainty |
| Audience effect | Counts resolve deterministically, pending application is distinct from committed application, and restart does not apply an effect twice |
| Cursor recovery | Disconnect/reconnect catches missed events without duplicate history or regressing scores; withdrawn/private round becomes unavailable |
| Completion and stop | Completed round remains readable and adds no ticks; operator stop is durable and prevents further execution |

Public-load acceptance and Supabase Realtime are separate pending work. Keep this first staging exercise to two viewers and rules-only execution. Provider access, spending gates and reservation durability remain unchanged.

## Integrated Coolify exhibition — 2026-10-25 (Singapore)

Round: [`3651e688-9ee3-4d97-a9a8-b01458e4d9bb`](https://hawker-wars-staging.vercel.app/live/3651e688-9ee3-4d97-a9a8-b01458e4d9bb).
This is a published, rules-only exhibition with voting enabled. It was created
explicitly from trusted operator tooling; all simulation ticks were executed by
the Coolify supervisor. No Jev or Zoom calls were enabled. Web and worker revisions
are recorded under Current readiness above.

| Check | Observed result |
|---|---|
| Hosted animation | Presentation clock advanced; operator pause froze it; resume continued it. Reduced-motion poses had no vertical displacement. |
| Reconnect | Aborted viewer API requests froze animation; explicit reconnect restored live activity and clock progression. |
| Audience voting | Two independent browser sessions explicitly joined and submitted Bus arrival. Both showed confirmed receipts. |
| Cookie security | `__Host-hawker-session` had Secure, HttpOnly, SameSite=Strict and Path=/ attributes. Cookie values were not recorded. |
| Request boundaries | Foreign-origin session request returned 403; unauthenticated operator control returned 401. |
| Audience effect | Bus arrival won with counts `{bus: 2, rain: 0, supplier-delay: 0}` and was applied at tick 34. The effective tick is determined by durable resolution, not a hard-coded browser timer. |
| Active worker restart | Restart was requested after application of the effect. The replacement container recovered at tick 38 and committed tick 39 onward, retaining the same applied vote result. |
| Public response privacy | Hosted viewer response used `Cache-Control: no-store` and contained no recovery, seed, actor ID, session ID or request ID. |
| Completion and history | Completed at tick 120, sequence 121. All 121 events had consecutive ticks 0–120 and sequences 1–121, with no gaps or duplicates. The sequence stayed unchanged after an additional 11 seconds. |
| Two desktop viewers | At 1920×1080 and 1366×768, both browsers displayed identical final results and Service complete. Animation stayed frozen after completion; no browser runtime errors occurred. |

Final results: SGD 615 cash, SGD 331 profit, 31,630 utility points, 124 served and
zero abandoned. The Coolify container remains running and idle on this completed
round. The result remains published for review. Sanitized machine-readable
evidence is in [the acceptance record](evidence/2026-10-25-coolify-exhibition.json).

The active restart deployment is `e1jkr8yq227pmn0sjrycas2a`. The earlier private
Coolify test also verified that durable stop survives restart; see the worker
runbook. Server reboot, load testing, Supabase Realtime, provider dispatch and a
fresh hosted lost-acknowledgement drill were not part of this run. Migration role
permissions were not re-audited in this run; the checklist above remains the
broader rollout checklist, not a claim that every check was repeated.

## Stop and rollback

Use the authenticated operator stop action to end an active exhibition, then stop the Coolify application if desired. The supervisor otherwise stays running and idle after durable stop or completion. Prefer pause for a recoverable interruption. Preserve audit records and recovery state. A frontend rollback must use a version compatible with the installed schema and recovery format; do not undo additive migrations or restore an older database over accepted votes as an automatic rollback. Investigate the failed acceptance check before restarting or promoting.

## Historical offline handoff verification

On 2026-10-23 the offline preflight's 20 tests passed, including CLI exit codes, malformed configuration, secret redaction and reused-credential rejection. An independent source review found no material issues after clarifying Vercel's CI/build execution context. Direct checks of this environment correctly reported web and worker configuration **blocked**, with zero network calls. No hosted deployments, migrations or provider calls were made.

The complete `pnpm check` passed: 590 tests across 44 files, TypeScript, P0 contracts, 800 rules and 80 mixed episodes, 24 archives, 72 replays and 72 report reloads. Provenance-only refresh preserved behavioral references and the static dataset hash. Source identity: `b4bc953ad8cd37f0a71bfa1645e5b7891b24b65d2a07b50742a14b4f1159b360`.
