# P1 desktop composition validation

Scope: the offline desktop composition prototype described by [PRODUCT.md](../PRODUCT.md), [DESIGN.md](../DESIGN.md), and [plan v1.3 sections 4–9](planning/hawker-wars-implementation-plan-v1.3.md#4-desktop-screen-composition). This document separates implemented behavior from pending review evidence. **The scoped offline composition is validated. Full G1 art/animation acceptance and G2–G5 are not claimed.**

## Implementation

- `apps/web` uses Next.js App Router, React, Tailwind CSS and a dynamically loaded Phaser renderer. Accessible DOM controls surround a 480×240 logical canvas, with uniform integer scaling when space permits and smaller scaling for accessibility reflow. Typography includes self-hosted Barlow Condensed.
- The original procedural scene contains three adjacent stalls, hawkers, equipment, customers and communal tables. Presentation animation cannot advance the simulation or change results; reduced motion stops decorative animation. The hawkers now use the atlas and six-clip inventory described in [G1 art validation](g1-art-validation.md); environment/customer/effects art remains a prototype.
- Cinematic and Analytical modes, collapsible analysis, replay play/pause/seek, recorded-scenario selection, selected-stall inspection, pinned decisions, previous/next navigation, and sanitized downloads are implemented. The native modal inspector provides Observation, Action, Outcome and Technical details. Help exposes the keyboard map and a persisted shortcut toggle; mode preference is also local.
- A reserved vote-preview rail offers bus arrival, rain and supplier delay. Selection is local, explicitly says “No vote sent,” and cannot change the recording. There is no accepted server vote, countdown, window lifecycle, shared audience state or live coordination.

## Data and provenance boundaries

`pnpm demo:web` records and replays local `rules-1` episodes through the existing offline engine, validates the projection, and writes `apps/web/public/demo.json`. Four scenarios (`clean`, `bus`, `rain`, `supplier-delay`) each contain 120 committed turns and a separate tick-120 terminal settlement. Turn scores are provisional; terminal scores are final. The generator verifies replay agreement and zero replay network calls.

TypeSafe Jev, Zoom Decisions and Zoom Decisions Pro are explicitly labelled display mirrors of the same rules trace. They are not three model runs or a model-performance comparison. A separate rules-baseline row remains visible in analysis. Provider latency is not measured and no model proposal is supplied. No provider calls, billing, inference or benchmark results are part of this prototype.

The public projection excludes private seed/schedule identities and misleading model fields. Generator assertions check mirror equality, action legality and final settlement. Browser rendering imports only public projection types/helpers, not engine or provider execution. The downloadable demo is a public UI fixture, not a full private episode archive.

Source identity includes `.tsx`, CSS, web configuration and the generated public demo JSON alongside existing implementation/toolchain inputs. It excludes generated `.next` output and `apps/web/next-env.d.ts`; build products are not source evidence. See `scripts/source-identity.ts` for the exact allowlist and exclusions.

## Reproduction

Use Node `>=24.19.0 <25` and pnpm `11.25.0` as pinned in the root package manifest. From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm demo:web --check
pnpm check
pnpm typecheck:web
pnpm build:web
pnpm test:web
```

`pnpm demo:web` regenerates the fixture; `--check` verifies deterministic equality without writing it. `pnpm check` runs root typechecking, Vitest, and P0/P2-A/P2-B validation. It does not include the web build or browser suite. `pnpm dev:web` starts development; `pnpm --filter @hawker-wars/web start` serves the production build.

Playwright starts the development server automatically, or reuses an existing server outside CI. The default browser executable is `/usr/bin/chromium`; override with `PLAYWRIGHT_CHROMIUM_PATH`. `PLAYWRIGHT_BASE_URL` selects an already running target. Reports go to `results/p1-playwright-report`; traces and failure screenshots go to `results/p1-playwright-artifacts`.

## Evidence ledger

| Check | Evidence/status |
|---|---|
| Deterministic public fixture, root checks and provenance regeneration | 333 Vitest tests and root typechecking passed; public fixture `--check` reproduced exact bytes. Guarded provenance refresh confirmed frozen behavioral references unchanged. P0 and P2-A passed: 30 engine fixture cases/88 expectations, 800 rules episode executions and 80 mixed executions, no held-out seeds or network calls. P2-B passed: 24 archives, 72 replay executions, 72 report reloads; static dataset hash unchanged. `pnpm check` completed successfully. |
| Web typecheck and production build | Final web typecheck and optimized Next.js production build passed, including static prerendering. A production-browser smoke hydrated all three stalls and sought tick120 with no page errors; clean terminal baseline matched 127 served, SGD346.00 profit, 33070 utility points. |
| Browser interactions | 44/44 Playwright tests passed on final code across four viewports, with no external/write HTTP requests and no uncaught page errors. Covers honest attribution, playback/settlement, scenario reset, pinned inspection, dialog focus/Escape, preferences, local vote isolation, HUD focus restoration, load failure and reduced motion |
| 1920×1080 and 1366×768 composition | Confirmed default, expanded HUD + vote preview, and modal inspector states. All three stalls remain visible; minimum crowded canvas is 2× integer-scaled, baseline fits the HUD, and vote rail reserves width. Rail scrolls internally when needed. |
| 200% equivalent reflow | Passed at 960×540 and 683×384 CSS viewports with device scale factor 2; controls reflow vertically without horizontal clipping. These approximate zoomed layout dimensions and do not establish actual browser-zoom or screen-reader coverage |
| Animated hawker and pixel scale | Original hawker poses and decorative animation implemented; reduced-motion canvas stability tested. Pixel composition visually reviewed at both desktop sizes. The six hawker clips and contact sheet are now implemented and reviewed; see [G1 art validation](g1-art-validation.md). The broader production animation inventory remains open. |
| G1 decision | Offline composition review found no blocking visual issues. Hawker animation/source work subsequently progressed in [G1 art validation](g1-art-validation.md). Native-editor workflow and actual zoom/spoken screen-reader acceptance remain open; no full production-art pass recorded. |

Validation date: 2026-10-23. Screenshots: `results/p1-ui-review/{reference,minimum,reference-200-percent-equivalent,minimum-200-percent-equivalent}/{default,crowded,dialog}.png` (12 files). The initial visual pass found vote-text compression and collapsed zoom layout; one correction/confirmation pass fixed both. An independent reviewer found no remaining blocking visual issue in this scope. Tests establish the assertions exercised, not all plan acceptance criteria.

P1 validation source-tree identity (historical; later G1 work has a new identity): `e1b65673a514336383f237cdc5448482b51368dd52324d27b65ed28f2d42327d`. The initial check rejected changed source identity as designed; the guarded refresh preserved all simulation reference values. Do not run `next build` concurrently with the development server in the same output directory.

## Remaining priorities

1. Complete G1 evidence and address any crowded-layout, readability or animation defects before scaling art production. Review actual browser zoom and representative screen-reader flows in addition to equivalent viewport tests.
2. P3/G2: editable sprite sources, complete clips and event mapping, deterministic PNG/JSON atlas export, provenance manifest, contact sheets and validation for pivots, frames, padding and texture bleed. The procedural prototype does not satisfy this gate.
3. P4/G3: full Match/Decisions/Benchmarks tabs, timeline/filter behavior, preference reset, integrated state/failure journeys and cross-browser accessibility review. Current offline controls are a subset of that phase.
4. P5: authoritative shared runs, server-acknowledged votes, reconnect, permissions and operator recovery. P2-C provider verification remains separate from this offline frontend.
5. P6/P7: declared evaluation campaigns and reproducible exports, followed by deployment, performance and public release rehearsal. This local composition is not a released spectator service.
