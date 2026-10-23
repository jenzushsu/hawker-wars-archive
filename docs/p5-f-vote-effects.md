# P5-F deterministic vote effects in the rules worker

Rules-only exhibitions can now opt into one audience vote. The tick-30 commit opens the window atomically, database time closes it after 20 unpaused seconds, and the worker applies the durable result at the next legal tick. The browser remains an offline replay; this increment connects the voting API and worker, not the spectator UI. Provider dispatch remains disabled, and multi-policy integration remains pending.

## Resolution and simulation boundary

The resolver locks the same private round record as submissions and worker commits. It counts each session's current accepted selection once. No votes produce no event. Ties sort option IDs lexically and use the existing `demand-1` keyed `vote_tie` draw for the stored seed, window index zero and draw index zero. The private resolution retains counts, tied IDs, digest, integer draw and the chosen simulation boundary. Public results expose counts, winner, effect interval and whether application committed; they omit private draw evidence and voter identities.

Resolution is durable before simulation application. If the response is lost, the next worker retrieves the same result. Applying the event, persisting recovery, publishing the tick and marking the result applied happen in one database transaction. A failure rolls them all back. A pause after resolution revokes worker ownership and preserves the pending result; resume applies it at the same tick. No event can begin at closing. Exact accepted commit retries retain their original payload semantics.

The original clean demand schedule stays immutable. Rain and supplier delay retain all stored arrival potentials. Bus adds exactly six arrivals at its resolved tick. Existing base and promotion IDs, patience and filtering data are preserved; only promotion slot positions at the bus tick move to accommodate the additions. The six new bus patience values use keyed draws. This is a transformation of recorded potentials, not regeneration of an offline stress scenario. Every resumed worker validates the stored resolved schedule against this transformation and checks the full deterministic frame/history before advancing.

Before application, state hashes use the base schedule. From the effect boundary onward, they use the resolved schedule and scenario. The committed private recovery stores both schedules, resolution evidence, frame and recent actions. Replaying that recovery applies the recorded event exactly once and never invokes a provider. A no-vote resolution records the base schedule as its resolved schedule, retaining the same demand and state behavior.

## Running a voting exhibition

Apply all five checked-in migrations, deploy the matching worker/API version, and configure the server-only Supabase, vote session key and exact HTTPS origin settings described in [P5-E](p5-e-durable-voting.md). Voting defaults off. Explicitly create a new published rules round with voting enabled:

```sh
pnpm worker:rules --round YOUR_NEW_ROUND_UUID --create --seed 7 --publish --voting --steps 121
```

Do not repeat `--create` when resuming. Resume a paused/stalled process with the same round UUID after checking operator status; voting mode comes from persisted recovery:

```sh
pnpm worker:rules --round YOUR_ROUND_UUID --steps 121
```

The CLI never changes an existing round's voting mode. Legacy opt-in envelopes without `voteWorkerVersion: rules-voting-1` remain blocked. The current worker accepts only rules policy exhibitions and development seeds 0–99. A private round cannot accept public votes; publication is explicit at creation. Existing operator pause/resume/stop controls and five-second database pacing remain in force.

The vote API can issue a session only once the published window exists. Use its signed session cookie for submissions and status. Status now returns `{window, receipt, result}`; `result` is null before resolution and has `applied: false` until the atomic application tick commits. A resolved winner must not be presented as already active while that flag is false. The existing browser voting panel remains labeled as a local preview until it is connected to these acknowledgements and live state.

## Validation

Targeted tests pass for all three effects, deterministic ties, no votes, altered evidence and corrupted recovery. Complete 121-boundary worker rounds match an independent engine/decision driver across restarts. Actual PostgreSQL checks verify atomic opening/application, private commit permissions, immutable evidence, exact retries and a deadline expiring during a commit: tick, events and pacing all roll back.

The effects HTTP runner exercises real worker commits through PostgREST, signed session submissions, SQL/TypeScript tie agreement, lost resolution and commit acknowledgements, pause before application, fresh clients on restart and complete round scores. A second no-vote round preserves clean behavior. Only visual pacing is overridden in that disposable test database to avoid a ten-minute wait per round; real 20-second vote deadlines are retained. The separate existing HTTP suite continues to verify production five-second pacing and controls, and the voting HTTP suite continues to verify receipt/rate-limit/privacy behavior.

TypeScript and all 532 tests across 41 files pass. The production Next.js build passes after separating wire validation from simulation dependencies; a local production smoke confirms the homepage works and unconfigured voting/operator endpoints return uncached 503 responses without dispatching work. The complete `pnpm check` passes: P0 contracts, 800 rules and 80 mixed engine episodes, and 24 archives with 72 replays and 72 report reloads. Behavioral references and static dataset hash `0e4e973c9e4c162354ab158b3127d1a7629d4f9f17b81233deecaaa6923341d7` are unchanged. Refreshed source-tree identity: `7dbf29a0797cd0417b30d2be5ba6209f2c15902cee771c15b7cc7f3d2e3fe489`. Tests use disposable local databases and synthetic credentials; no hosted migrations or provider calls are part of this increment.

Reproduce the integrated effect check with `P5_POSTGRES_CONTAINER=hawker-p5-postgres pnpm validate:p5-effects` against the disposable isolated Postgres container.

## Remaining P5 and deployment work

Connect live snapshot/cursor recovery and acknowledged voting UI, then prove multiple viewers observe the same round without additional simulation or inference. Extend the one-policy worker only after proving the same recorded effect reaches every configured policy at the same boundary. Hosted Supabase permission/Realtime tests, Vercel deployment checks, a supervised durable worker and public-load acceptance remain open. This increment does not claim a full P5 exit or production deployment.
