# Hawker Wars tiny static task dataset card

## Status and intended use

This is the local **static-task-1** development task family implemented in P2-B. It validates dataset generation, exact finite-horizon reference labels, hashing, export/loading and split controls. It is not a published dataset, a measured live-model result, or the planned 300–500-case research release. No provider calls or credentials are needed to generate or solve it.

Task and generator settings are preregistered in [static-task-1.json](../manifests/static-task-1.json). The manifest hash identifies these settings. Each generated/frozen dataset also records its actual solver limits, distribution, candidate/rejection counts and content hash. Lower diagnostic limits may be explicitly selected and are recorded; capped tasks never receive approximate labels.

## Task definition

Each task captures a **reachable prepared decision boundary** at tick 117, 118 or 119. The controller selects one of the canonical legal actions and then acts optimally through the ordinary closing settlement at tick 120. Labels maximize expected final `utility-1` under this declared finite horizon and terminal valuation. This is not a ground-truth label for the complete 120-minute lunch-service problem.

The oracle receives only the validated initial simulator state, `horizonEndTick: 120` and an empty future-event list. It never receives an evaluator seed or realized future demand schedule. Future demand is enumerated from explicitly declared independent finite-32-bit `demand-1` probabilities, including off-peak count masses, patience, active promotion and rain effects where present. This is a specified stochastic task distribution, not a claim to infer the original episode seed's hidden future. All tie-equivalent optimal first actions are retained using reduced exact rational arithmetic, not a float tolerance. `rules-1` generates some reachable prefixes and is never the accuracy oracle.

## Generation and selection

The default small development generation uses seeds **2000 and 2001**, two frozen behavior policies (`rules` and `mixed`), and all three task ticks: **12 raw candidate slots**. The clean demand scenario is fixed. Each prefix is run through the actual engine from its normal initial ledger, without changing `runEpisode`'s separate development-seed contract.

- `rules`: the frozen ordered `rules-1` policy.
- `mixed`: a deterministic legal-action selector using SHA-256 of `hawker-wars|static-generator-1|mixed|seed|tick`; it does not consume demand draws or consult oracle/provider labels.

Selection includes every preregistered seed/policy/tick slot before labels are seen. Categories are assigned from state only: `serve-available`, `stockout-queue`, or `no-queued-service`. These categories do not impose balanced quotas, and forced-WAIT tasks are retained. No candidate is selected because models disagree, a provider performs poorly, or a label is convenient.

The default oracle ceiling is **20,000 explored states and 20,000 explored branches per task**. A task exceeding either ceiling is recorded with its identity, exceeded limit and counters, and excluded from the exact-labeled split. No partial or approximate label replaces it. Every raw generator slot is represented once as an exact label, cap rejection, or canonical duplicate rejection. The dataset records all counts; exact-split counts must not be confused with raw candidate counts.

## Splits and canonical deduplication

Development generator seeds are **2000–2099**. Held-out generator seeds **3000–3099** are declared but are not generated or evaluated by the default P2-B workflow. Generating held-out states requires explicit `enableHeldOut` and explicit held-out seeds. No held-out model comparison or tuning is claimed.

Deduplication hashes the canonical complete simulator state after deterministic cosmetic-ID normalization. Batch IDs are renumbered in expiry order; customer IDs are renumbered by arrival tick in the existing FIFO order. The hash excludes evaluator seed, split, task ID, generator policy and action-history metadata. It retains all actual state, economic counters, queue deadlines and other simulator facts. Two histories leading to the same canonical state cannot evade deduplication merely through different IDs or recent-action histories.

Known opposite-split canonical hashes can be passed as exclusions during generation. A later held-out release must use the frozen development index and verify disjointness against the completed development dataset, including cap-rejected candidate identities. Cross-split comparison is an explicit validation step; merely declaring distinct seed ranges does not prove different canonical states.

## Record schema and formats

`StaticTaskSchema` stores task ID/version, split, pre-label category, canonical state hash, initial state, allowlisted `observation-2`, legal actions, horizon, no future events and generator provenance. `StaticLabeledTaskSchema` adds the exact solver result: all legal-action expected final/remaining utilities as rational strings, the complete optimal-action set, solver version and explored-state/branch counts. Remaining utility must subtract that task state's sunk utility exactly.

`StaticDatasetSchema` contains the frozen manifest/hash, task distribution, generation choices/counts, actual solver limits, exact labeled records, cap rejections and dataset content hash. Loading validates strict field schemas, action/reference consistency, provenance, generation-slot conservation, duplicate/excluded state identities and content hashes. Parsing does not re-run the potentially costly oracle; independent recomputation can be run separately.

The dataset can be frozen as canonical-content-identified JSON and exported as validated JSONL through the local export tooling. Reduced rational numerators and denominators remain strings. Dataset schema/version, manifest, rejection data and counts must accompany row exports. Optional Parquet and Hugging Face publication are deferred; do not describe an untested conversion as supported.

## Privacy and controller visibility

The dataset is **evaluator-private by default**: task IDs and generator metadata contain seeds, and oracle labels are withheld from controllers. A provider receives only the allowlisted observation and legal choices through the adapter boundary, never the full task/dataset, canonical evaluator metadata, hidden schedules or labels. No provider outputs, API keys, voter identifiers or personal data are included in generated task records.

## Limitations and release requirements

- This small terminal-horizon task family contains many easy or forced-WAIT states and has narrow operational coverage.
- Generator behavior and cap rejection can bias the retained exact split. Report category, raw/deduplicated/labeled/rejected counts and solver limits.
- Exact optimality applies only to the declared finite horizon/distribution/utility, not full-episode business performance, real restaurant operations or an external leaderboard.
- Prefixes and labels come from the same versioned engine; unit fixtures and independent tiny oracle checks are required alongside deterministic reruns.
- No broad policy-level correlation or model ranking can be inferred from these development fixtures.
- Public release, licence, attribution and provider-output sharing review remain outstanding. Do not infer a publication licence from this internal artifact. Record actual source revision/content identity, dependency lock and dataset version for any later release.
