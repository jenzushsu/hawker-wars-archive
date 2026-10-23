# P4 spectator controls: prerequisite and gap review

Reviewed 2026-10-23 against [plan v1.3 sections 5–7, P4 and G3](planning/hawker-wars-implementation-plan-v1.3.md), `apps/web/app/page.tsx`, `apps/web/app/globals.css`, `apps/web/lib/demo.ts`, and `e2e/arena.spec.ts`. This is a source review, with no new test execution. P3 work is ongoing; its asset acceptance is outside this review. **Neither P4 completion nor a G3 pass is claimed.**

The existing offline interface is a usable starting point for P4. The next increment can implement and validate the missing spectator controls against local records without provider calls or a shared service. Full live interaction and authoritative voting evidence still depend on P5; do not describe local preview receipts as accepted votes to fill that gap.

## Implemented and missing

| Requirement | Existing implementation | Remaining work |
|---|---|---|
| Modes and collapse | Cinematic defaults to compact controls; Analytical expands metrics. Mode/shortcut preferences persist locally. Collapse restores focus when its child disappears. Mode changes retain replay position, selected decision and local vote choice. | Add a visible restore-defaults action. Retain tab/scroll state once tabs exist. Verify the specified 160–220 ms collapse transition, with immediate reduced-motion behavior. |
| HUD tabs | One comparison table includes the three explicitly labelled mirrors and separate rules baseline; compact inspector sits beside it. | Implement Match, Decisions and Benchmarks tabs with accessible selection/navigation. There is no decision list, policy filter or benchmark panel today. |
| Analytical history | Recorded tick, chosen action, outcome, pinning, previous/next and jump-to-latest are available. | Add time-ordered committed history and selectable rows/markers; preserve pin identity while playback continues. Clearly distinguish game tick from any wall-clock timestamp. |
| Metrics | Profit has SGD units; utility is labelled points; provisional/final stall profit is explicit. Inspector says provider latency is not measured. | State metric aggregation/window and provisional/final status consistently in analysis. Add quantities and failure badges appropriate to available records. Do not imply measured model comparisons. |
| Compact inspector | Shows policy position, tick, action, consequence and unmeasured latency. Expanded inspector has Observation, Action, Outcome and Technical details. | Add observed-context summary to compact view. Distinguish forced WAIT in its badge as the expanded inspector already does. |
| Inspector evidence | Sanitized JSON and download, previous/next, missing model proposal, native modal title/close/Escape/focus restoration. | Present available schema/config versions and provenance clearly; add copy control. Missing hashes, timestamps, usage and supplied explanations need explicit unavailable states, never fabricated values. |
| Decision states | Demo projection represents valid local rules, forced WAIT and settled state. | UI-05 needs distinct pending, invalid, timeout, fallback and missing-usage examples. Introduce explicitly labelled local presentation fixtures or an appropriate public decision contract; the current rules-only data cannot honestly exercise these as model outcomes. Distinguish proposed, accepted and fallback actions. |
| Loading/no-run/errors | Loading, failed demo fetch with reload, and renderer fallback are implemented. | Add an explicit no-run/empty state and robust malformed/incompatible public-data handling. Test recovery and continued DOM access after renderer/asset failure. Live/reconnecting/degraded states need a separate adapter contract and later P5 evidence. |
| Keyboard and focus | Native controls, stall DOM equivalents, shortcut opt-out, editable-field/modifier guards, modal handling, rail Escape and HUD focus restoration. | Complete one keyboard-only journey through every new tab/history/download/copy/reset control. Test shortcuts inside editable fields and preservation of browser shortcuts, not just disabling shortcuts. |
| Reduced motion and readable state | DOM queue/stock summaries, text attribution, reduced-motion canvas behavior, nonmodal minimum-size notice and zoom-equivalent reflow. | Audit default detail text against the plan's 16 CSS px minimum: several descriptive/technical selectors are 12–14 px. Verify contrast, focus visibility, announcement behavior and motion manually. |
| Voting | Local preview is explicitly unsent and cannot mutate the recording. | Keep this scope honest. P5 owns server windows, acknowledgements, counts/deadlines, rejection/disconnection and receipt restoration. Add the correct unavailable state for any future controlled benchmark context. |

## Independently actionable next increment

Implement an **offline P4 controls slice**, retaining the existing public fixture boundary:

1. Add the three HUD tabs with preserved selection and scroll position across collapse/mode changes. Match contains the current metrics. Decisions exposes a bounded, time-ordered history with policy filtering and row-to-inspector selection. Benchmarks states that no model benchmark results are loaded and exposes truthful available provenance/downloads and the rules baseline; it must not invent uncertainty or sample counts.
2. Complete compact/expanded inspector details, copy/download feedback and restore-defaults behavior. Preserve replay/scenario/selected-record state on presentation changes; resetting preferences must not reset recorded results.
3. Add no-run and invalid-data states. Build clearly labelled fixture-only decision-state examples for UI-05 without modifying or relabelling the rules replay. Make unavailable provenance/usage explicit. Keep outcome pending until supplied by the record.
4. Extend browser coverage to tab keyboard navigation and scroll retention, filtered history/pinning, previous/next boundaries, downloads/copy payloads, preference reset, malformed data, empty state, editable-field shortcuts and renderer failure. Keep external-request/write guards and the existing four viewport projects.
5. Capture both modes and crowded HUD/rail/inspector combinations after those changes. Run the web typecheck, build and browser suite, plus root validation where projection/source identity changes require it. Record exact evidence and unresolved manual checks rather than promoting the existing P1 results to P4 results.

This increment can be reviewed without paid calls, database work or live transport. P3 remains P4's declared prerequisite: integrate against its stable renderer/asset-failure contract and retain authoritative-result invariance. Consult [P3 asset validation](p3-assets-validation.md) and [P3 browser validation](p3-browser-validation.md) for current evidence; this review does not approve those gates.

## Evidence limits and manual acceptance

The existing browser source covers attribution, playback/settlement, scenario reset, pinning through mode changes, modal focus/Escape, shortcut opt-out persistence, local vote isolation, HUD focus restoration, fetch failure, reduced motion and layout captures. [P1 validation](p1-validation.md) records its historical results. These tests do not exercise missing tabs or live behavior. Many setup interactions use mouse clicks, and slider seeking often dispatches synthetic input; they do not establish a complete keyboard-only journey.

Before an integrated interaction sign-off, the frontend/accessibility owner should record:

- Actual 200% browser zoom at both desktop sizes, across default/HUD/inspector/vote combinations. Device scale factor 2 with half-size CSS viewports is useful reflow coverage, not that manual result.
- A complete keyboard-only walkthrough, including native dialog behavior, focus after close/collapse, tab/history navigation, browser shortcuts and disabled character shortcuts.
- Representative spoken screen-reader flows: stall summary, score units/status, decision history and pinning, modal sections, important errors and local vote disclosure. Verify announcements remain useful and are not emitted every score tick.
- Text/control contrast, detail sizing, visible focus, readable labels and scroll access under crowded layouts; verify all three stalls remain identifiable.
- Browser/OS versions selected for Chrome, Edge, Firefox and Safari, including Windows/macOS focus behavior. Current Chromium automation alone cannot establish that matrix.
- A later live-state walkthrough with P5's authoritative service, including voting receipt/reconnect behavior. Until then, record acceptance as an offline controls slice with live portions explicitly open.

No new implementation, commands, screenshots or gate evidence were produced by this review; only this document was added.

## Subsequent parallel increment

The [parallel P3/P4 increment](parallel-p3-p4-validation.md) implements strict public replay validation, explicit empty-recording recovery and the compact forced-WAIT badge. These address part of the loading and inspector gaps above. Tabs, history/filtering, richer inspector controls, reset preferences and remaining G3 acceptance are still outstanding.

The [offline P4 controls increment](p4-controls-validation.md) subsequently implements tabs, bounded policy/action history, inspector copy/provenance details and view-default recovery, with automated keyboard and resilience coverage. The table above is the original gap review; current remaining acceptance limits are recorded in the new validation document.

The [UI-05 decision-state increment](p4-decision-states-validation.md) subsequently adds isolated labelled examples with contract and browser coverage. The remaining manual G3 checks and shared-service requirements remain open. See [P5-A voting core](p5-a-voting-core.md) for the next backend preparation slice.
