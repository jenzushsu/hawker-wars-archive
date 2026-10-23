# P0 acceptance fixtures

`poc-1-acceptance.json` encodes the complete numerical acceptance table from the revised v1.3 implementation plan as 30 concrete scenarios. `sourceId` maps expanded cash/capacity/time/fallback variants back to the original table ID. MECH-11A and MECH-11B are separate timelines.

These are **hand-calculated expected results**, not recorded simulator outputs. P0 validates their data, coverage, and independent arithmetic. P2-A must execute mechanics/baseline/fallback fixtures against the transition engine; P2-B must execute replay checks. No engine readiness is implied by parsing these files.

Each scenario includes a fully initialized compact state, the input boundary (`givenPhase`), a typed operation, and typed assertions. `at` identifies the boundary where an assertion applies. `path` names a state/result field in the future fixture-runner projection. `equals`, `contains`, `notContains`, and `containsSubset` specify expected comparisons. Derived projections such as `readyPortions`, `queueIds`, and `computedRestockDueTick` are runner outputs rather than additional simulator state.

`setupMode: synthetic-local` injects a local state to isolate one boundary or legality rule. These cases do **not** claim reachability from the normal 20,000-cent/42-portion opening. The cash=3,999 fixture is deliberately such a synthetic legality input: ordinary PoC cash transitions are in multiples of 500 cents. For these cases, conservation is relative to the injected opening ledger. Existing stock/customer totals need not reconstruct a fictional preceding episode. Test global round invariants separately on real episode prefixes.

`setupMode: episode` uses the normal opening identities. SCORE-01 is a specified terminal ledger, not a measured episode; its global stock/cash arithmetic must balance. SCORE-02 begins at tick zero with the real initial state and an explicit empty arrival schedule. SCORE-03 isolates the closing customer's score delta rather than claiming the complete episode score.

For `MECH-02`, `MECH-04`, and `MECH-06`, unspecified intervening actions are WAIT and arrivals are explicitly empty. Their future assertions isolate background timers without introducing additional decisions. A queue already present in the input is processed at each indicated tick normally. Event range endpoints are inclusive. The supplier-delay event starting at 115 can have a nominal 10-minute interval extending beyond closing, but no simulation tick at/after 120 executes it.

`tick-order-1.json` names all eight active tick stages, terminal settlement rules, demand-draw encoding, streams, and stable arrival order. The plan remains the canonical prose rationale. Neither file creates an engine or dispatches a provider.

`../manifests/trial-eval-1.json` is a planned, dispatch-disabled evaluator manifest. All three external providers are unverified, no model identifier is asserted, and no budget or trial capacity is invented. Its configurationHash matches the checked P0 configuration freeze; referenceChecksum remains null until P2 produces a deterministic engine/replay reference. The fixed sequential seed lists are evaluator-private and must never appear in provider observations.

## P2-A execution evidence

The original JSON files retain their P0 expected-data labels. P2-A now executes all 30 cases/88 frozen expectations against the actual engine/rules/scoring/fallback implementation via `tests/p2-fixtures.test.ts` and `pnpm validate:p2-a`. These results are separate from the unchanged expected data. See [P2-A validation](../docs/p2-a-validation.md). Golden demand/state vectors and deterministic development references live in [reference](reference/rules-development-1.json); durable recorded-action replay remains P2-B.
