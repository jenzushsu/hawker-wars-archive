# P2-B replay and evaluation foundation

23 October 2026 (Asia/Singapore).

## Implemented scope

- A versioned, checksummed file archive containing the complete stored demand schedule, opening state, 120 committed decision records, terminal result, private snapshots and sanitized public snapshots.
- Exact replay from **recorded applied actions**, including fallback attribution, using the **stored schedule**. Replay does not regenerate demand from the seed, choose rules actions, or call a provider.
- Snapshot correctness/seek validation, per-boundary state hashes, event comparisons, final-state/score/metric recomputation and trace-hash verification.
- JSON and CSV reports plus typed episode/static JSONL exports and strict reloaders.
- Reachable development static-task generation, exact rational finite-horizon labels, preregistered branch/state caps, explicit exclusions, frozen development artifacts and a dataset card.

Work was divided among archive/store, oracle, exports, static generation and independent-review agents; the primary agent integrated recording/replay execution, CLI workflows, references and comprehensive validation. No live-provider implementation, model dispatch or paid usage is included.

## Tested commands

From the repository root:

```sh
pnpm install --frozen-lockfile --offline
pnpm check
pnpm record:episode results/my-run 0 clean rules
pnpm replay:episode results/my-run 60
pnpm export:episode results/my-run results/my-export
pnpm static:generate results/my-static
```

Use a new output directory: commands preserve existing directories and files and refuse overwrite. Generated `results/` artifacts are ignored by Git. The concrete demo created for this phase is `results/p2b-demo-2026-10-23`, with exports in `results/p2b-export-2026-10-23` and static output in `results/p2b-static-2026-10-23`.

`pnpm validate:p2-b` writes/reads 24 temporary archives: development seeds 0, 1 and 7 × four scenarios × rules/mixed. It performs 72 replay runs (opening and verified snapshots at sequences 60/120), 72 report reloads across JSON/CSV/JSONL, then independently regenerates/reloads the frozen default static dataset. Root temporary validation directories are removed on completion; the demonstration artifacts remain available.

The complete unit suite passes **268 tests across 13 files**, with strict TypeScript checking. Unit/adversarial coverage includes corrupt/truncated/reordered/duplicate files or rows, wrong versions/configuration, saved metric/event/snapshot mismatch, unsupported private/public fields, shared sequence boundaries, one-step independently computed oracle expectations, exact rational ties, hard exploration caps and cross-split exclusions. Replay tests replace seed generation, policy decisions and fetch with throwing functions, including a recorded fallback case.

## Artifact and reference semantics

Archive files use private permissions (0600, enclosing directory 0700), bounded regular-file reads, no symlink files, fixed filenames, content digests and per-record chains. Publication stages complete files and renames them into an exclusively reserved target; readers reject incomplete archives. Checksums detect corruption and inconsistency, not a forged history by someone able to rewrite every digest. A seed in a stored schedule is provenance metadata: the stored, validated inputs are the replay authority, not a claim that replay re-proved the original random generator's seed history.

Snapshots are verified against replayed prefixes before a selected snapshot is used to continue the suffix. This establishes correctness, not a constant-time seek guarantee. Recording publishes a complete offline episode; live per-tick crash durability and lease/fencing recovery remain P5 work. An interrupted unpublished recording is not advertised as recoverable.

Public snapshots contain a strict economy/queue-count whitelist. Episode exports omit evaluator seeds, private schedules, source payloads and arbitrary metadata. Export reload recomputes arithmetic from the included validated state/resolutions; **trajectory proof comes from archive replay**, not merely loading a report. Static datasets contain evaluator metadata and oracle labels and are explicitly evaluator-private; providers receive only the allowed observation/legal choices.

The P2-A deterministic behavior references remain unchanged. Added P2-B implementation files/workspace configuration change the source-content digest, so `pnpm reference:p2-a --refresh-provenance` updates only provenance after refusing any behavioral-reference change. The original P2-A source digest was `5312a4ddd2c3b1306b74b8e8baf437a6cc6cf3c2a4f33e0274998f7d616b0c70`. No Git SHA is invented for the unborn checkout. The historical P0 trial manifest remains dispatch-disabled with a null replay reference; actual recorded-action replay proof is reported separately here and by the P2-B validator.

## Static dataset evidence and limitations

The [preregistered manifest](../manifests/static-task-1.json) enumerates seeds 2000/2001 × rules/mixed prefixes × ticks 117–119, before seeing labels. Default limits are 20,000 states and 20,000 branches per task. The checked [JSON](../fixtures/static/development-1.json) and [JSONL](../fixtures/static/development-1.jsonl) contain **12 candidates, 10 exact labels and two explicit oracle-cap rejections**, with no canonical duplicates. Dataset hash: `0e4e973c9e4c162354ab158b3127d1a7629d4f9f17b81233deecaaa6923341d7`.

No held-out cases were generated or evaluated. Diagnostic tests deliberately use lower recorded caps; their smaller label counts are separate from the frozen default artifact. Labels use exact BigInt rational probabilities induced by the declared finite 32-bit demand distributions. Capped cases never receive approximate labels.

At ticks 117–119, replenishment/promotion deadlines make this mostly a SERVE/WAIT family. Its exact labels validate the evaluator foundation, not broad operational decision quality or a research leaderboard. Earlier-horizon/300–500-case expansion needs a separately preregistered task manifest and is deferred. See the [dataset card](dataset-card.md) for distribution, splits, deduplication, rights and publication limitations.

## Remaining phase boundaries

P2-B provides offline file persistence, replay and evaluation/export foundations. Supabase/live recovery, frontend/arena, provider G0-B, production cost enforcement, paid comparisons, publication and deployment remain outside this phase. All live provider flags remain disabled; no trial allowance or Zoom budget was consumed.
