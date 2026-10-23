# P3 customer and environment assets

Implemented on 2026-10-23 as an offline P3 increment.

- Customer source: `packages/art/src/customer.ts`; six variants, six clips, four directions, 480 frames at 24×32 in a 1024×600 atlas.
- Environment source: `packages/art/src/environment.ts`; original geometry and palette extracted into three 480×240 layers in a 488×744 atlas. People remain separate sprites.
- Both families include editable TypeScript source, deterministic PNG/JSON exports, source provenance, contact sheets and browser review pages. Native-editor source acceptance remains open; these sources are not represented as Aseprite files.
- Phaser loads all three art families. Counters occlude hawkers, foreground tables occlude diners, and customer reactions follow recorded outcomes.

The public recording changes from `web-demo-1` to `web-demo-2` to include bounded queue poses and actual received/departed counts. No customer IDs or private schedules are exported. Private episode archives and frozen simulation behavior are unchanged. The current app and regenerated fixture must be deployed together.

The renderer shows representative customers, not one sprite for every resolved person. At most three queue sprites, one receiver, one departure and one post-service diner appear per stall. A diner requires a prior recorded sale and never creates another sale. Pause, seek, scenario changes and reduced motion use the same presentation clock as hawkers.

## Validation

Thirteen new art tests cover all customer poses, directional silhouettes, clip cadence, atlas bounds/pivots, extrusion/padding, PNG decoding, deterministic exports, provenance and read-only verification. Three projection tests independently reconcile the public activity with rules episodes and cover zero-sale behavior, seeking and reduced motion.

All 80 Chromium browser cases passed, including 16 new customer/environment cases. Initial reference and minimum desktop captures were visually reviewed: customers remain grounded, counters and tables occlude the correct sprites, and the crowded layout retains readable controls. No visual correction was required. See [browser evidence](p3-browser-validation.md) for exact assertions, captures and limits.

All 358 unit tests, root and web TypeScript checks, read-only verification of all three art families, and public replay reproduction passed. The optimized production build passed. A production Chromium smoke loaded 96 hawker frames, 480 customer frames and all three environment layers, served all review pages, advanced the presentation clock and paused with no page errors.

P0 contract validation passed. P2-A passed 30 fixture cases with 88 expectations, 800 rules episode executions and 80 mixed episode executions. P2-B passed 24 persisted archives, 72 replay executions and 72 report reloads. All checks ran without network calls or held-out evaluation.

Guarded provenance refresh preserved frozen behavioral references. Source-tree identity: `348ece5f04508d57a9d2111874be3b4437565a6fd086190877b532f9d59da48d`. Static dataset identity remained `0e4e973c9e4c162354ab158b3127d1a7629d4f9f17b81233deecaaa6923341d7`.

## Remaining scope

Effects and UI asset families remain for the next P3 increment. This is not full G2 acceptance. Actual browser zoom, spoken screen reader review, native-editor source acceptance and cross-browser visual review remain open. Provider gates and paid campaign authorization are unchanged; this increment makes no live inference calls.

Subsequent work: effects and UI pictograms are implemented in the [parallel P3/P4 increment](parallel-p3-p4-validation.md). The evidence and source identity above describe the earlier customer/environment increment.
