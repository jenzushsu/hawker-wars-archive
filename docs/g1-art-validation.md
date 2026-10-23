# G1 hawker animation and atlas validation

The desktop prototype now uses an original, deterministic hawker atlas in Phaser. Three palettes each have all six specified clips: idle (4 frames at 4 fps), preparation (6 at 8 fps), serving (6 at 10 fps), waiting (4 at 4 fps), shortage (4 at 6 fps), and celebration (8 at 10 fps). This completes the implemented hawker clip inventory, not the full customer/environment/effects production inventory.

## Editable source and reproducible export

- Source: `packages/art/src/hawker.ts`, authored integer pixel rectangles and pose controls.
- Exporter: `scripts/export-hawker.ts`; Node's PNG/zlib path, no image service or external artwork.
- Assets: `assets/atlases/hawker*`, with identical browser copies under `apps/web/public/art/`.
- Atlas: 96 frames, 640×240 PNG, 32×32 untrimmed/unrotated frames, fixed bottom-centre origin, two pixels of edge extrusion and two pixels of transparent outer padding.
- Review: `/art/hawker-review.html` exposes the six clips and three palettes, a replay control, and reduced-motion handling. `hawker-contact-sheet.png` exposes every frame.
- Provenance: `hawker-source.json` records source and atlas SHA-256 hashes. Export output contains no current timestamps.

Run `pnpm art:export` to regenerate. Run `pnpm art:check` to verify all 12 source-derived atlas/review/provenance artifacts without creating or overwriting files. Tests verify that check mode preserves stale user content and file timestamps on success.

Aseprite/LibreSprite is unavailable in this environment. The editable TypeScript source is a documented authoring fallback, not a native `.aseprite` file. Native-editor import/export review remains outstanding; no full G2 asset-pipeline acceptance is claimed.

## Replay projection

`apps/web/lib/animation.ts` selects the pose from committed public state. A recorded SERVE takes precedence, cooking selects preparation, an empty-stock queue selects shortage, and other queues/restocks select waiting. Celebration requires terminal settlement and positive final profit; provisional profit cannot trigger it. These remain rules-demo mirrors, not model performance or a declared winner.

The renderer never awards sales or changes inventory. The presentation clock resets at a new tick/scenario, freezes on pause, and holds the final frame of a non-looping clip. Seeking reconstructs the current tick's pose instead of playing a backlog. Reduced motion selects frame zero. Automatic playback allows the settled tick's 800 ms presentation interval before pausing, permitting the eight-frame celebration to complete. A manual seek to settlement remains paused.

Sprite feet are behind the counter at logical y112; serving hands align with its top. The initial in-scene pass caught feet above the counter. One correction and confirmation pass verified the placement at both desktop sizes and equivalent zoom layouts.

## Validation evidence

Validation date: 2026-10-23.

- Six art tests cover clip cadence, distinct frames, transparent borders, fixed feet, atlas bounds/pivots/non-overlap, extrusion/padding, PNG pixel round-trip, export determinism and read-only check mode.
- Three projection tests cover committed outcomes, shortage/wait distinctions, frame cadence, one-shot clamping, seek independence and reduced motion.
- All 64 browser cases passed (44 existing plus 20 new across four viewports); 8 capture-confirmation cases passed after the placement correction. No external/write HTTP requests or uncaught browser errors were observed in the full suite.
- Every clip was exercised from actual recorded fixture states. Browser tests verify fetched atlas assets, real canvas/frame changes, pause/seek/scenario resets, terminal celebration and accessibility-tree semantics.
- Contact-sheet and in-scene review found no remaining blocking visual issue in this scope. Screenshots: `results/g1-ui-review/{reference,minimum}/clips/` and `results/p1-ui-review/{reference,minimum,reference-200-percent-equivalent,minimum-200-percent-equivalent}/`.
- All 342 Vitest tests and root typechecking passed. `art:check` verified all generated assets without writing, and `demo:web --check` reproduced the public replay exactly. The optimized production build passed. Production-browser smoke loaded all 96 atlas frames, advanced the rendered frame from 0 to 3, paused successfully, and served the review page with HTTP 200 and no page errors. P0/P2-A passed with 800 rules and 80 mixed episode executions; P2-B passed: 24 archives, 72 replay executions and 72 report reloads; the static dataset hash remained unchanged.

See [G1 accessibility evidence](g1-accessibility.md) for the exact limits of the automated accessibility checks. Headless zoom-key probes did not change browser zoom. No spoken screen reader is installed. Neither equivalent viewport tests nor Chromium's accessibility tree is presented as actual browser-zoom or screen-reader validation.

## Gate status and next work

The hawker atlas, six-clip integration and scoped desktop composition are implemented and reviewed. Full G1 remains open for real browser-zoom/spoken screen-reader review and the native-art-source workflow decision. These limitations do not block further offline P3 customer/environment/effects work, but they must not be represented as completed acceptance. G2–G5, live voting and paid evaluation remain outside this change.

Source-tree identity for this validation: `bed8ed1f84bbabd9de6836c46144384513e3d224866263d6be12533b357b3d51`. Guarded provenance refresh preserved all frozen behavioral references.
