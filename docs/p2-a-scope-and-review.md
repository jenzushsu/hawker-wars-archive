# P2-A scope and review

22 October 2026 (Asia/Singapore). Original implementation scope/review, now delivered. See [P2-A validation](p2-a-validation.md) for executed completion evidence; scope text below preserves the reviewed requirements.

## Outcome and entry status

Build a working, deterministic, offline 120-minute simulation and frozen rules baseline from the P0 contracts. A developer must be able to run a local development-seed episode, inspect decisions and terminal results, and execute every numerical acceptance case without credentials or provider requests.

Entry review: **ready to implement**. The existing `pnpm check` passed TypeScript, 76 tests and P0 artifact validation during this review. G0-A is complete for contract conformance. All providers remain disabled. Jev's unknown commercial terms and Zoom's unfinished G0-B do not block this phase. The approved Zoom budget remains a separate approval record and is not consumed by offline work.

## Included work

| Work package | Concrete behavior | Required evidence |
|---|---|---|
| 1. Deterministic demand and scenario inputs | Implement keyed SHA-256 draws, demand phases, patience, stable customer slots, promotion opportunities, rain filtering, bus arrivals and supplier-delay scheduling. Generate potential schedules independently of policy actions. | Golden input/digest/draw vectors; same schedule for the same development seed; policy divergence does not consume different random streams. |
| 2. Pure transition engine | Initialize the opening ledger; implement tick preparation, all five actions, reservations, delivery/cooking timers, ready expiry, FIFO admission/service, abandonment and closing settlement at 120. Implement the exact eight-stage contract through an in-memory commit boundary. | All mechanics/boundary fixtures execute; state transitions preserve cash, portions and customers; duplicate/out-of-order tick/action application is rejected. |
| 3. Action legality and rules policy | Compute legal actions from prepared state in canonical order; implement all eight first-legal-match `rules-1` priorities and inclusive thresholds. | Existing RULE fixtures plus explicit cases for illegal rule matches, competing priorities, cooldown/capacity/deadline edges. |
| 4. Observation and decision boundary | Construct `observation-2` with an allowlist; expose current/history facts and legal choices; maintain five own action summaries and stable seed-free IDs. | Tests against the actual serialized request reject seed/schedule/private-state leaks; two independent policies never see each other's state. |
| 5. Offline mock outcomes and fallback | Support scripted success, invalid shape, illegal action, error, rate-limit and late/timeout outcomes; apply `rules-1` to the captured observation on failure; forced WAIT invokes no controller. | FALL fixtures execute; proposed action, provider outcome and applied fallback stay separate; zero retry/one attempt and forced-wait attribution verified with virtual elapsed time. |
| 6. Scoring, diagnostics and local runner | Compute profit, utility, shared ranks and diagnostics; run all 120 decisions and terminal settlement; expose a rules-only local CLI and development-seed validation runner. | SCORE fixtures execute; repeated runs reproduce actions, per-boundary hashes and terminal scores; the runner reports actual completed episodes and zero network dispatch. |

The engine produces typed in-memory transition events and an in-memory trace sufficient to validate these behaviors. Durable event-file replay, exports and live persistence have separate phase exits.

## Proposed code ownership

- `packages/simulation/src/`: demand, schedule types, initialization, prepare-tick/action/settlement reducers, legality, scoring, invariant checks and canonical simulator hashing.
- `packages/decisions/src/`: deterministic rules policy, explicit mock outcomes and common offline result validation/fallback.
- `scripts/`: local rules demo and development-seed conformance entry points.
- `tests/`: fixture execution, golden vectors, lifecycle/properties, projection and independent episode validation.
- `fixtures/reference/`: versioned development-only reference actions, state hashes and terminal totals once execution establishes them.

Reuse the existing toolchain and shared schemas. Standard-library hashing is sufficient; new infrastructure or provider SDK dependencies are unnecessary. File/module names and new command names are proposals until implemented and verified. The existing `pnpm check` must continue to pass and include the new checks.

## Review findings and implementation decisions

### Tick lifecycle must be explicit

`SimulatorStateSchema` describes decision, committed and terminal states. A pre-tick fixture can contain expired stock or due deliveries; those facts must be processed before constructing an observation. Define a narrow internal pre-tick cursor/input type, then validate at the public boundaries. Do not force a partially settled tick-120 state through a schema that requires completed terminal settlement.

Use separate pure operations for preparing tick t, applying exactly one validated action, committing t, and settling at 120. Carry an explicit tick/phase guard so a second action at a committed boundary is rejected. Illegal direct reducer actions fail without mutation; invalid controller proposals use the explicit fallback path instead. No rendering clock or wall-clock timestamp participates in transitions.

### Stable potential slots precede filtering

Assign slots in base, bus, promotion order before filtering inactive promotion/rain arrivals. Rain removes base arrivals without renumbering remaining customer slots or changing their patience draws. FIFO uses the specified source/ordinal order for same-tick customers; do not sort arbitrary seed-prefixed private strings and assume that reproduces it. Private IDs and public/provider IDs need an explicit stable mapping.

Golden-vector tests must fix exact UTF-8 bytes, decimal formatting, digest prefix byte order and integer mapping. Compare boundary samples for each stream, and verify promotion/rain do not alter unrelated draws. A few sampled episode arrival totals cannot prove a distribution; expected demand is a mathematical contract, not a required count in every seed.

### Synthetic fixtures stay test-only

Thirty fixture cases cover 22 source acceptance IDs. Some inject states such as cash 3,999, which cannot arise under ordinary cash increments. Fixture harnesses validate local opening ledgers and relative deltas; full episodes always use the standard 20,000-cent/42-portion identities. Do not add a production flag that silently disables accounting validation.

Each fixture assertion must read an actual engine result or derived projection. Existing hand-calculated expected values remain fixed. If execution exposes an incorrect expectation, record the discrepancy and rationale rather than rewriting it to match implementation. Fixture operation phases and `at` labels must become explicit harness boundaries.

### Turn attribution needs a typed wrapper

`DecisionResultSchema` has success/fallback/error, while the plan also requires `forced_wait` with no controller invocation. Add a separate local turn/outcome wrapper with an origin such as rules, mock, fallback or forced_wait; keep provider identity and result attribution in their existing fields. Never claim mock success as a real Jev/Zoom result.

Map fixture input diagnostics such as `illegal_action` explicitly to the normalized fallback reason `illegal`; preserve the source diagnostic separately. Do not change the frozen provider result enum to accommodate a fixture label accidentally. Tests should inject elapsed time rather than sleep for four seconds; real transport cancellation and durable attempt recovery are P2-C/P5 work.

### Diagnostic metrics need resolution information

Current state totals hold total wait but do not independently retain served-only wait or satisfaction sums. Emit typed customer-resolution records with wait and outcome, and compute these secondary metrics in a deterministic in-memory episode projection. Also count stockout observations explicitly. This avoids inventing metrics from insufficient terminal counters or adding unversioned fields to strict state/observation schemas.

Primary profit and utility remain derivable from authoritative state counters. If implementation instead adds authoritative state fields, review and version that schema/hash change explicitly before freezing reference results.

### Separate configuration identity from execution references

The P0 configuration hash identifies frozen defaults. Implement `state-hash-1` over an explicitly defined deterministic simulator envelope, including required scenario/configuration/schedule references and policy state. Define whether recent-action history is included or reconstructible from the committed action trace so restart/projection behavior stays unambiguous. Exclude UUIDs, timestamps, latency, request IDs, billing and presentation data from the simulator comparison.

Freeze a **development reference** only after the real engine and independently checked fixtures pass. Record the exact serializer/envelope, dependency lock, configuration version and source provenance. The current repository has no commits: do not invent a Git SHA or claim a remotely restorable revision. Use an exact source-tree content digest until a real revision exists.

The trial manifest is P0 dispatch-disabled and currently requires `referenceChecksum: null`. Leave that trial field unchanged in P2-A. Store development references separately; P2-B owns validated replay references and any deliberate manifest-schema evolution. Re-running deterministic rules is not the same evidence as replaying recorded actions.

## Validation and exit checklist

1. Existing 76 P0 tests remain green; type checking and configuration-drift checks pass.
2. All 30 numerical fixtures execute against engine/rules/scoring/fallback functions, with counts reported and no skipped assertions or substituted constants.
3. Run complete rules episodes for development seeds **0–99**, in clean and three separately named single-shock scenarios (bus, rain, supplier delay at tick 60): **400 completed episode executions**. Repeat this suite to compare decisions, boundary hashes and terminal totals. These are engineering checks, not paid campaigns or research results.
4. Assert stock/cash/customer identities, capacity, action legality and monotonic tick/phase progression after each public transition. Closing resolves all queues/ready stock exactly once and has zero in-flight quantities.
5. Golden demand/hash vectors pass; repeatability survives changed wall-clock/metadata values and interleaved execution order of independent policies.
6. Add deterministic mixed legal-action schedules on development seeds to cover states the rules heuristic does not visit. Record generator seed and coverage; never use held-out seeds to tune defaults.
7. Validate actual observation construction, historical action summaries, stable ID mapping and complete request serialization for private-state/future leakage.
8. Prove sole WAIT causes zero mock/controller calls and every scripted failure produces a legal, clearly attributed fallback. No adapter or network client is instantiated.
9. Provide a tested local rules-only demo command and development validation command, with counts, source/configuration identity and explicit no-live-model labeling. Freeze reviewed development references after these checks pass.

Four scenarios per seed are deliberate engineering coverage. They do not expand or execute the six-seed provider stress pilot. Held-out sequential seeds 1000+ and static held-out generator seeds 3000+ remain outside P2-A tuning/reference generation.

## Deferred phase boundaries

- **P2-B:** durable file-backed snapshots/logs and replay from recorded actions, exports/recomputed scores, exact static oracle and dataset preparation.
- **P2-C / G0-B:** Jev/Zoom SDK/HTTP adapters, credentialed calls, live latency, real usage/cost normalization, budget enforcement and smoke tests.
- **P1/P3/P4:** browser, Phaser, artwork, HUD and accessibility implementation.
- **P5:** database, leases/fencing, durable exactly-once tick commits, public realtime recovery, voting and operator controls.
- **P6/P7:** held-out comparative campaigns, public report and deployment.

Review conclusion: no external prerequisite blocks P2-A. Resolve the internal lifecycle, event/outcome and hash-envelope definitions in the first implementation increment; preserve frozen mechanics, keep claims scoped to executed offline evidence, and use the exit checklist above for completion.
