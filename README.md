# Hawker Wars

P0 contracts, **P2-A offline simulation** and **P2-B replay/evaluation foundations** are implemented. The engine models one independent stall per policy and can be instantiated for the three model policies and rules comparator; this phase exercises deterministic rules and explicitly labeled mocks. Frontend, live adapters and hosted services have later phase exits.

## Setup and commands

Use Node **24.19.0** (`.node-version` / `.nvmrc`) and pnpm **11.25.0** (`packageManager`). From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm check
```

The cloud checkout is `/workspace/hawker-wars`. `pnpm check` runs strict TypeScript checking, Vitest, P0 contract validation, P2-A fixture/development validation and P2-B disk replay/export/static validation. Installation preserves the lockfile and explicitly permits only esbuild's required dependency build script. No provider credentials, database, Docker or services are needed.

```sh
pnpm demo:rules 0 clean
pnpm demo:rules 0 bus
pnpm demo:rules 0 rain
pnpm demo:rules 0 supplier-delay
pnpm validate:p2-a
pnpm reference:p2-a
```

The demo accepts development seeds 0–99 and emits a complete rules-only episode, decision origins, metrics and deterministic hashes. Invalid/held-out seed input fails. The standalone validator executes all 30 frozen fixtures/88 expectations, 400 rules cases twice (800 episode executions), and 40 mixed-action cases twice (80 more executions). All 120 decision ticks and closing settlement execute per episode. The four scenarios are clean, bus, rain and supplier delay, with shocks at tick 60. This engineering coverage consumes no provider quota and does not expand the six-seed paid stress pilot.

The full development validator runs 880 episode executions and takes longer than the unit suite.

Individual unit/contract commands are `pnpm typecheck`, `pnpm test` and `pnpm validate:p0`. The P0 validator's `engineFixturesExecuted: false` describes its own data/schema-only work; `validate:p2-a` reports the executed engine fixtures. P0 fixture and trial-manifest planning labels are preserved as historical input contracts, not rewritten as measured results.

## Implementation and evidence

| Path | Purpose |
|---|---|
| [packages/shared/src](packages/shared/src/index.ts) | Frozen defaults and strict state/observation/decision/evaluation schemas |
| [packages/simulation/src](packages/simulation/src/index.ts) | Demand schedules, immutable transition engine, legality, observations, scoring and canonical state hashing |
| [packages/decisions/src](packages/decisions/src/index.ts) | Rules policy, explicit synchronous mocks and attributed fallback/forced WAIT |
| [fixtures](fixtures/README.md) | Frozen numerical expectations and independently authored SHA-256 vectors |
| [fixtures/reference/rules-development-1.json](fixtures/reference/rules-development-1.json) | Four seed-0 development references with actions, boundary hashes, terminal totals and source/toolchain identity |
| [manifests](manifests/p0-contract.json) | Frozen configuration identity, planned clean 30/stress 6 campaign, disabled providers |
| [docs/p2-a-validation.md](docs/p2-a-validation.md) | P2-A completion evidence, checks and limitations |
| [docs/p2-a-scope-and-review.md](docs/p2-a-scope-and-review.md) | Reviewed scope, lifecycle/attribution decisions and phase boundaries |
| [docs/providers](docs/providers/README.md) | Jev/Zoom documentation, account evidence and outstanding G0-B checks |

Pure reducers produce frozen frames without mutating their input. An explicit stage/tick cursor guards preparation, one action, advancement and settlement. Every transition checks capacities and cash/stock/customer conservation against an explicit opening ledger. Synthetic fixture openings remain test-local; standard episodes retain their full 20,000-cent/42-portion identities.

Schedules are generated before policy execution using keyed SHA-256 streams. Promotion/rain filtering retains potential slots and patience. Queues use seed-free public IDs; private schedule identifiers never enter observation payloads. Observation construction copies allowed fields and validates the actual result. Per-customer resolution events support independently reconciled waiting/satisfaction diagnostics.

`state-hash-1` includes deterministic continuation context (stage, tick, state, ledger, processed events/customer IDs, last five actions and configuration/schedule identities). Operational UUIDs, metadata, latency and billing are excluded. These hashes and repeat-run checks are deterministic execution evidence; P2-B now separately verifies stored-schedule/recorded-action replay.

`pnpm reference:p2-a` detects reference or implementation/toolchain/input drift. After investigating an intentional change and reviewing contract-version implications, a maintainer can regenerate with `pnpm reference:p2-a --write`; rerun the complete check afterward. Do not update expected numerical fixtures merely to match changed code. The reference uses an exact source-content digest because this checkout has no Git commit yet; it does not invent a source SHA or claim remote restoration. The historical P0 trial-manifest reference stays null; P2-B recorded-action replay evidence has its own validator and validation record.

## Provider and budget status

**G0-A and P2-A offline checks pass. Jev’s one approved smoke passed; Zoom G0-B remains incomplete.** No provider SDK or HTTP client is instantiated in offline runs. Jev is configured but its retained smoke reservation leaves insufficient budget for another call. Mock outputs remain labeled offline even when testing a named provider's failure boundary.

Zoom's user-approved caps are **USD 0.25 per paired Standard+Pro run** and **USD 5 for their whole campaign**, including smoke/static work; [approval](docs/providers/zoom-budget-approval.json) is persisted and local reservation enforcement is implemented. Jev's separate **USD 0.003 single-smoke approval** has been used, with its full reservation retained; no Jev evaluation campaign is authorized. Freemium terms remain unknown. None of these unknowns prevents offline development.

P2-C adapters and a local durable reservation ledger are now implemented. Jev's one approved inference smoke passed; its small retained budget cannot fund another request. Zoom still needs maximum-charge evidence and credentialed inference smokes. Run `pnpm providers:status` for configured readiness (which does not include remaining ledger capacity), and consult [adapter activation](docs/providers/activation.md) for measured results and phase limits. Frontend composition and artwork can proceed independently.

## Recorded replay and evaluation workflows

```sh
pnpm record:episode results/my-run 0 clean rules
pnpm replay:episode results/my-run 60
pnpm export:episode results/my-run results/my-export
pnpm static:generate results/my-static
pnpm validate:p2-b
```

Each output directory must be new; existing files are preserved. Recording creates a complete private offline archive. Replay uses the stored schedule and applied actions without invoking a policy, verifies every state/event boundary, and checks snapshot prefixes before continuing from a selected snapshot. JSON/CSV/JSONL exports reload and recompute scores. The default tiny static generation freezes 10 exact labels and two explicit cap rejections from 12 preregistered development candidates; no held-out evaluation occurs.

See [P2-B validation](docs/p2-b-validation.md) and the [dataset card](docs/dataset-card.md). Local phase artifacts include the [replayed demo report](results/p2b-export-2026-10-23/report.json). Generated results are ignored by Git; rerun the commands in a fresh checkout. The static task fixture is evaluator-private and should not be sent wholesale to providers. No live model calls or paid usage occur in these workflows.

For additions that leave P2-A behavior unchanged, `pnpm reference:p2-a --refresh-provenance` explicitly refuses behavioral drift before updating source provenance. Intentional changes to simulation expectations still require the original contract/version review.

## Desktop offline interface (P1)

```sh
pnpm dev:web             # http://localhost:3000
pnpm typecheck:web
pnpm build:web
pnpm demo:web --check    # verify public replay export is reproducible
pnpm test:web           # system Chromium; PLAYWRIGHT_CHROMIUM_PATH overrides its path
```

The Next.js/React interface renders a Phaser pixel arena, recorded playback, four scenario fixtures, analytical metrics, a pinned decision inspector and a local voting preview. All three named stalls explicitly mirror the same real rules trace; they are not model comparison results. Final settlement is a separate timeline position. Rendering and vote previews cannot mutate the fixture. No provider credentials enter the frontend.

The environment and customer art remain original procedural drafts; hawkers now use the versioned atlas described below. Shared voting, live coordinator/reconnect behavior and production assets remain later phases. See [P1 validation](docs/p1-validation.md) for scope and browser evidence.

## Hawker animation assets

`pnpm art:export` regenerates the original hawker, customer, environment, effects and UI pictogram atlases. `pnpm art:check` verifies generated assets and provenance without writing. With the web app running, open `/art/hawker-review.html`, `/art/customer-review.html` or `/art/environment-review.html`; effects and pictograms have `/art/effects-review.html` and `/art/ui-review.html`. See [parallel P3/P4 validation](docs/parallel-p3-p4-validation.md), [P3 asset validation](docs/p3-assets-validation.md) and [G1 art validation](docs/g1-art-validation.md) for scope and remaining acceptance limits.
