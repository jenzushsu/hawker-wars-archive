# Parallel P3 effects/UI and scoped P4 validation

This increment adds effect artwork and UI pictograms to the offline rules replay, and a limited P4 slice for public-data loading, empty/error states and the forced-WAIT badge. **It does not complete P3/P4 or record a G2/G3 pass.** [P4 scope review](p4-scope-review.md) remains the roadmap for tabs, history/filtering, inspector/provenance controls, preferences and broader interaction acceptance. Earlier customer/environment evidence remains in [P3 asset validation](p3-assets-validation.md) and [P3 browser validation](p3-browser-validation.md).

## Implemented behavior

The original, code-authored effects atlas contains 25 32×32 frames across steam, service, shortage, delivery, bus, rain and supplier-delay clips. The UI atlas contains nine pictograms at 16×16 and 24×24: inventory, queue, time, latency, warning, validation, vote, sound and expand. Editable rectangle sources, PNG/JSON atlases, contact sheets, local review pages and provenance metadata are exported deterministically. The production UI uses pictograms beside text; decorative icons are hidden from accessible names. The sound pictogram labels the existing sound-off state.

Effects illustrate committed facts. Steam requires active cooking; service requires a recorded served-customer event; shortage requires a nonempty queue with no ready or raw portions; delivery requires an actual `restock-delivered` engine event. Bus, rain and supplier-delay cues require the corresponding active recorded effect. Settlement clears every effect. Seeking reconstructs effects from the selected record, with no event backlog or new simulation action. Pause freezes the presentation clock. Reduced motion removes steam and holds the other cues at frame zero while recorded playback remains usable.

P4 loading now validates untrusted public JSON before rendering. A valid empty collection displays “No recorded run is available.” Malformed, incompatible or unavailable data displays a recoverable load error without mounting the arena. Loading and recovery messages remain explicit that the replay uses no provider request. The validator checks the declared schema/provenance, competitors/scenarios, all 120 committed ticks and settlement, numeric fields, action/observation structure, mirror agreement and customer activity consistency. This is validation of the public display contract, not cryptographic verification of an arbitrary remote replay.

The compact inspector distinguishes “Forced WAIT” from a validated rules decision, matching the expanded inspector. The current rules-only recording does not supply model-pending, invalid proposal, timeout, provider fallback or usage examples; none are fabricated to fill those UI states.

## Public fixture migration

`web-demo-3` adds `effectActivity: { delivered: boolean }` to each committed turn and terminal frame. The generator derives this boolean from typed prepared/committed engine events, not an order action, stock inference or human-readable event summary. Existing customer activity remains unchanged. A separate direct engine execution checks delivery evidence across all four scenarios and all 480 turns. Terminal flags are derived from settlement events.

The generated public fixture and consuming application must be deployed together. The new loader deliberately rejects `web-demo-2`; there is no automatic migration or silent inference of missing delivery evidence. Regenerate and verify the fixture with `pnpm demo:web` and `pnpm demo:web --check`, then ship it with the matching application. Browser asset paths must resolve to the corresponding generated atlases. This work performs no deployment.

The three named stalls remain explicitly labelled mirrors of one local rules trace, with a separate rules baseline. No model inference, measured provider latency, model comparison, accepted audience vote, campaign or paid call is introduced.

## Reproduction and evidence ledger

Use the pinned Node/pnpm versions from the root manifest:

```sh
pnpm demo:web --check
pnpm art:check
pnpm check
pnpm typecheck:web
pnpm build:web
pnpm test:web
```

Do not build concurrently with the development server in the same Next output directory. Browser tests can reuse an explicitly running `http://localhost:3000` server through `PLAYWRIGHT_BASE_URL`.

| Check | Current evidence |
|---|---|
| Public delivery evidence and projection | Six effects tests passed, including independent engine reconciliation across 480 turns, rejection of malformed delivery fields, no invented cues, shortage conditions, reduced motion and seek reconstruction. The three existing customer projection tests also passed after the schema update. |
| Deterministic public fixture | `pnpm demo:web` regenerated `web-demo-3`; `pnpm demo:web --check` reproduced it exactly, with zero model calls. |
| Root TypeScript check | Integrated root and web TypeScript checks passed. |
| Effects exports, bounds, pivots, extrusion and regeneration | Asset owner reports six effects-art tests, root TypeScript and read-only exporter `--check` passed. The 320×160 atlas uses fixed 32×32 frames, pivot `(0.5, 1)`, two-pixel extrusion and two-pixel padding. Contact sheet inspected. Integrated read-only verification passed for all five art families. |
| UI exports and pictograms | Asset owner reports five UI-art tests and read-only exporter `--check` passed. The deterministic 288×64 atlas contains 18 frames with two-pixel extrusion and at least two-pixel padding, provenance hashes, a nine-column contact sheet and a local review page. `Pictogram` uses `aria-hidden="true"` with adjacent text retained. Integrated read-only verification passed for all five art families. |
| Loading-contract validation | Eleven loader tests pass for the valid fixture, malformed structures, provenance, boundaries, mirror inconsistencies and the empty-recording state. |
| Browser effects, loading/recovery and existing interactions | Six new tests across four viewport projects add 24 cases to the existing 80. The full 104-case batch passed 102 cases; two existing customer-animation cases exposed a non-atomic test read of time and poses. After reading both in one DOM evaluation, all four viewport variants of that test passed (12.2 s), with exact motion assertions unchanged. No runtime change was needed. All 104 cases are covered by passing results across these runs. The initial full report is retained at `results/parallel-initial-browser-report/`; `results/p1-playwright-report/` contains the four-case confirmation. Browser checks cover atlas decode/bounds, local-only requests, actual recorded effects, pause/seek, reduced motion, malformed-data recovery and the empty-recording state. |
| Visual review | Contact sheets and initial reference/minimum scene captures were visually reviewed; cues and icons remain readable, all three stalls are visible, and no visual correction was required. Effect captures are `results/p3-effects-ui/{reference,minimum}/{delivery,service,shortage,bus,rain,supplier-delay}.png`; the crowded minimum composition was also reviewed with the cues and icons. These are real recorded states, not synthetic effects. |
| Web typecheck/build and P0/P2 regression checks | Root/web typechecks and optimized production build passed. P0 passed; P2-A passed 800 rules and 80 mixed episode executions; P2-B passed 24 persisted archives, 72 replay executions and 72 report reloads. Final-source P2-A confirmation also passed after the test-only atomic-read correction. |
| Source identity | Final source-tree identity: `c8fd07db1e3ef4e57c20dc8e5f49b544b0d3804b0e4b18345d9f84f27baa60fd`. Guarded refresh preserved frozen behavioral references. Static dataset identity remains `0e4e973c9e4c162354ab158b3127d1a7629d4f9f17b81233deecaaa6923341d7`. |

Production Chromium smoke passed: all five atlas JSON files and review pages loaded, with 96 hawker frames, 480 customer frames, three environment layers, 25 effect frames and 18 pictograms. The presentation clock advanced to 316 ms, service reached frame 2, pause worked and no page errors occurred. The production preview runs on port 3000.

Validation date: 2026-10-23. Unit evidence: 375 tests passed in the integrated batch, followed by all 11 newly completed art tests (six effects, five UI) plus a loader recheck: 386 distinct unit tests passed. No external/write requests or uncaught browser errors occurred in the completed browser cases.

## Remaining acceptance limits

The atlases use original editable rectangle source. Native-editor/Aseprite source acceptance, full art inventory/sign-off, complete scene/event timing acceptance, cross-browser review and any remaining G2 requirements are not established by this increment.

Chromium automation and half-size CSS viewport/device-scale-factor checks do not establish actual browser zoom or spoken screen reader usability. Those environmental gaps and the distinction from accessibility-tree inspection remain recorded in [G1 accessibility evidence](g1-accessibility.md). A complete keyboard-only journey, manual contrast/detail-size review and the planned browser/OS matrix remain open.

P4 still needs its planned HUD tabs, bounded decision history and policy filtering, expanded truthful provenance/copy/download feedback, restore-defaults behavior, additional decision-state examples and interaction acceptance. P5 owns authoritative votes, shared runs, transport/reconnect and live/degraded service states. Provider verification and campaign budgets remain separate gates; this frontend evidence does not advance them.
