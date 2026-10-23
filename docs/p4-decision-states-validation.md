# UI-05 decision state examples

The `/decision-states` route provides explicitly labelled presentation examples for pending, invalid, timeout, rules fallback and missing-usage decisions. They use a generic Example policy and are separate from the recorded rules replay. The Help link opens a separate tab so inspecting examples preserves the original replay position, pin and results.

## Contract and presentation

The browser-safe `decision-state-1` contract requires `classification: presentation-example`. Proposed, accepted and fallback actions remain separate fields. A pending, rejected or timed-out decision cannot claim an accepted action or committed outcome. A fallback is rules-authored and cannot be credited to the model. The missing-usage example shows that an accepted action does not imply supplied token usage or cost; unknown values remain null and display as not supplied, never zero. Explanations are not fabricated.

The parser rejects unknown fields and contradictory states before presentation. This narrow example contract is not a live provider record, a stored simulation decision or a migration of the public replay. Examples never feed the engine, change a score, invoke an adapter or modify the existing recording.

The page uses a native labelled selector, readable definition lists, a polite state announcement and navigation back to the replay. Every state retains its presentation-only disclosure. Reduced-motion behavior requires no animation; no state predicts an outcome or shows invented numerical results.

## Validation

Root and web TypeScript checks and all 393 unit tests pass, including seven decision-state contract tests. Independent review found no remaining contract or presentation blockers.

All 28 scoped Chromium cases pass across reference, minimum and both 200%-equivalent reflow viewports: 16 new state-example cases plus 12 affected Help, shortcut and preference-reset regressions. They verify all five states, keyboard selection, polite status text, unavailable values, layout bounds and preservation of the paused replay and pinned inspector through the separate Help tab. Context-wide request guards permit only local read-only HTTP requests; no uncaught page errors occurred. The initial run passed 12 of 16 cases; four failed because a test expected only the primary availability text while the page also supplied explanatory text. The corrected assertions check the full text. Runtime behavior was unchanged.

Desktop visual review of pending, fallback and missing-usage captures found no clipping or hierarchy defects. Captures are retained under `results/p4-decision-states/{reference,minimum}/`; the final scoped browser report is under `results/p1-playwright-report/`. Equivalent reflow and DOM announcements do not establish actual browser zoom or spoken assistive-technology acceptance.

The optimized production build passes and statically generates `/decision-states`. A production Chromium smoke passed for replay readiness, the Help popup, fallback and missing-usage selection, local read-only requests and absence of page errors. The production preview runs on port 3000.

P0, P2-A and P2-B checks pass, including 800 rules and 80 mixed episode executions, 24 persisted archives, 72 replay executions and 72 report reloads. Guarded provenance refresh preserved all frozen behavioral references. Source-tree identity is `ff10a7de1e996dc317106c24f56e89908c8b07bd2be22de78a7de7eeea29749d`; the static dataset remains unchanged.

## Acceptance limits

These examples establish scoped UI-05 presentation behavior, not a live provider smoke test or full G3 acceptance. Actual browser zoom, spoken screen-reader review, cross-browser/OS coverage, remaining interaction/motion acceptance, and live reconnect/voting remain open. Native-art-source and broader G2 sign-off are unchanged. No provider calls or campaign spending are part of this increment.
