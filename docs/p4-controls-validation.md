# Offline P4 spectator controls

This increment adds analysis tabs, bounded recorded decision history and filtering, inspector copy/provenance details, and view-preference recovery. It extends the offline rules replay; it does not introduce model results, shared voting or a live service. Full G3 acceptance remains open.

## Behavior

Match retains the three explicitly labelled rules-demo mirrors and a separate rules baseline. Decisions shows committed records through the selected playback tick, filtered by display policy. Selecting a row pins that policy and tick while playback continues. Benchmarks explains that no model benchmark results are loaded and exposes the available recording versions and download.

Tabs support arrow keys, Home/End and one tab stop. The analysis component remains mounted while hidden so tab, filter and history scroll state survive collapse and mode changes. Hidden controls are removed from keyboard navigation. Scenario changes retain meaningful presentation preferences without carrying an unrelated pinned record.

The compact inspector adds the observed queue and stock context. Expanded details include schema, policy, simulator and scorer versions, with unavailable timing, usage and state hashes explicit. Copy and download use the same public record. Clipboard failure offers download recovery; delayed clipboard completion cannot label a different selected record as copied. Next navigation cannot advance beyond the current playback boundary.

Restore view defaults selects Cinematic, collapses analysis and enables shortcuts. It retains replay position, scenario, pinned record and local vote selection. Closing the Help dialog restores focus to an available control.

## Validation

Root and web TypeScript checks and all 386 unit tests passed. The two new browser spec files also pass a standalone strict TypeScript check. Independent source review found no remaining history-boundary, pin-identity, hidden-focus or clipboard-race blocker.

The full 144-case Chromium batch passed 142 cases. Two existing playback timing checks failed because the installed test clock continued advancing during Play clicks. The test now pauses its clock before measuring the 750/100 ms boundary; exact tick, terminal-frame and final-score assertions remain unchanged.

Initial desktop visual review found that Decisions filters consumed the minimum-size panel before the first row. A single CSS correction keeps inline filters and compact table spacing at 16px. Confirmation captures and geometry assertions now show the first complete decision row at both desktop sizes, while retaining all three stalls and the separate rules baseline. History is internally bounded at reflow sizes. Persistent captures are under `results/p4-controls/{reference,minimum}/` and `results/p1-ui-review/`.

The 32-case P4 confirmation passed 28 cases; four failures were a new empty-filter test's incorrect assumption that no PROMOTE existed before tick 22. The real fixture has PROMOTE at tick 12. The test now uses the actual tick-zero SERVE state for its empty PROMOTE check, then restores tick 22 and the pinned selection. No recording or runtime logic changed for either test correction. All 12 final targeted cases passed across four viewport projects: exact playback timing, bounded/empty-filter history, and the original crowded compositions. Together with the earlier full batch and 28 passing confirmation cases, all 144 cases have passing coverage on the corrected implementation. The optimized production build passed.

Initial and confirmation HTML reports are retained at `results/p4-initial-browser-report/` and `results/p4-confirmation-browser-report/`. The most recent targeted run writes `results/p1-playwright-report/`. Browser coverage includes tabs, both filters, pinning through playback, preserved scroll, clipboard success/failure/stale completion, downloads, defaults, missing-atlas recovery, form-field shortcuts and modifier-key preservation. All HTTP traffic stays local and read-only.

The production Chromium smoke passed with all three stalls and atlas readiness, history selection, the inspector boundary, the unavailable-benchmark disclosure and preference reset. No page errors occurred. The production preview is available on port 3000.

P0 and P2 regression checks passed: 800 rules and 80 mixed episode executions, 24 persisted archives, 72 replay executions and 72 report reloads. Final-source P2-A confirmation also passed after CSS/test corrections. Guarded provenance refresh preserved every frozen behavioral reference. Source-tree identity is `6119265c5a94c3269265b4b0e42b89206118a4f9146067be4a1c5aef16ccd80a`; static dataset identity remains `0e4e973c9e4c162354ab158b3127d1a7629d4f9f17b81233deecaaa6923341d7`.

Validation date: 2026-10-23.

## Acceptance limits

Actual browser zoom, spoken screen-reader review, cross-browser/OS coverage, native-art-source acceptance and the remaining G2/G3 sign-off remain open. Chromium's accessibility tree and smaller CSS viewports are useful automated checks, not those manual results. The subsequent [UI-05 increment](p4-decision-states-validation.md) supplies an explicit presentation contract and labelled pending/invalid/timeout/fallback/missing-usage fixtures; the rules replay still cannot establish real provider behavior. Shared voting, reconnect and multi-viewer behavior remain P5 work.

No provider calls or campaign spending are part of this increment.
