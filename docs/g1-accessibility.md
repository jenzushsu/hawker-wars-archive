# G1 browser accessibility evidence

This is a Chromium automation record, not a spoken screen reader review or a complete accessibility audit. The arena remains an offline rules recording. No provider calls are needed for these checks.

## Checks and reproduction

`pnpm exec playwright test e2e/hawker.spec.ts` exercises the live Phaser client at the four viewports in `playwright.config.ts`. It checks atlas loading, all six clips against recorded states, visible canvas changes while playing, presentation-clock resets, pause stability, 800 ms replay ticks, the terminal celebration and reduced motion. Chromium's accessibility tree is attached to the test report for the text alternatives, rules table and native modal checks. Existing `e2e/arena.spec.ts` separately covers keyboard operation, modal focus restoration, shortcuts and vote-preview isolation.

The accessibility tree checks establish that the three stall buttons have names and text descriptions, the replay slider and rules table are exposed, the modal has a name and modal state, and background controls are absent from the active modal tree. They do not establish spoken announcement order, screen reader commands, pronunciation or usability with assistive technology.

On 2026-10-23, `PLAYWRIGHT_BASE_URL=http://localhost:3000 pnpm exec playwright test e2e/arena.spec.ts e2e/hawker.spec.ts` passed **64/64 cases** (44 existing interaction/composition cases and 20 new animation/accessibility cases) in Chromium. All cases rejected external HTTP requests and local write requests; none were attempted, and no uncaught browser errors occurred. The new spec also passed a standalone strict TypeScript check with ES2022, DOM and Bundler module resolution.

The initial visual pass found that the new full-body sprites needed a lower anchor so their feet sit behind the counter. After that placement correction, one confirmation capture batch passed **8/8 cases** and refreshed `results/p1-ui-review/{project}/{default,crowded,dialog}.png` for all four viewports and the six recorded clip reset frames under `results/g1-ui-review/{reference,minimum}/clips/`. The HTML report at `results/p1-playwright-report/` is replaced by each targeted run; the persistent screenshot and AX evidence paths below survive those replacements. Desktop crowded captures retain all three hawkers, the baseline row and reserved vote rail; the minimum rail scrolls internally. Equivalent reflow cases retain controls without horizontal overflow. The clip screenshots show committed states; animation progression and rendered canvas changes are checked separately by assertions.

Four AX-only cases then passed to export persistent accessibility-tree evidence to `results/g1-accessibility/{project}.json`; these exports survive replacement of Playwright's report directory by later runs. They include the ordinary analytical view and the modal inspector.

## Actual browser zoom: unavailable in this environment

The four automated projects include 960×540 and 683×384 CSS viewport layouts with device scale factor 2. Those are **200% equivalent reflow checks**, not actual browser zoom.

The cloud environment has no configured `DISPLAY`, `Xvfb`, `xvfb-run` or `xdotool`. A browser accelerator probe using five `Control++` presses in headless Chromium produced identical before/after measurements: inner/outer viewport 1366×768, device pixel ratio 1, visual viewport scale 1. Actual browser zoom was not observed. No CSS zoom or CDP page-scale substitution is used as evidence of browser zoom. A headed browser at 100% and 200% remains a manual review requirement.

## Spoken screen reader: unavailable in this environment

`orca`, `espeak`, `espeak-ng` and `speech-dispatcher` executables are unavailable. No actual screen reader session was performed. Chromium accessibility-tree inspection is the available structural evidence; representative screen reader flows remain open.

Manual follow-up should cover stall selection and descriptions, Play/Pause and seeking, the baseline table, pinned decision inspection, modal navigation/Escape/focus return, reduced motion, shortcut opt-out and the local vote receipt. Record the browser, operating system, screen reader/version and real zoom level with the findings.

Environment/tooling checks: 2026-10-23. No system packages were installed for these checks.
