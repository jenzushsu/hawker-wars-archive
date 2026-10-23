# Original hawker-centre environment source

The editable source is `packages/art/src/environment.ts`. It records integer rectangle commands extracted from the original `Arena.tsx` architecture, counter-front occlusion, and foreground furniture/plant/trolley geometry. The extraction preserves the authored480×240 scene, stall positions, palette and layout. Original canvas-edge clipping is explicit. People are removed from the foreground layer and remain independently placed sprites.

This is project-original code-authored pixel art, with no external imagery or third-party game sprites. It is not an Aseprite/LibreSprite source file; that native-editor deliverable remains separate. The TypeScript drawing definitions are the editable original for this increment.

Run `pnpm exec tsx scripts/export-environment.ts` to export the three-frame Phaser PNG/JSON atlas, layer/layout manifest, provenance hashes, contact sheet and review page. Run the same command with `--check` for read-only byte verification. Check mode does not create output directories, repair missing artifacts or replace user content.

Each frame retains the full480×240 logical canvas, top-left pivot and scene position0,0. The atlas is488×744 with2px edge extrusion plus2px transparent padding around every frame. No trimming or rotation is allowed. Background is opaque; counters and foreground retain transparent occlusion areas.

Draw order: background, hawker sprites, counters, queue/seated customer sprites, foreground tables, steam effects. `ENVIRONMENT_LAYOUT` includes the original seated-customer anchors for sprite integration. The first three contact-sheet panels show individual layers over checkerboard; the fourth shows their composite without people. Runtime files and review artifacts are emitted identically to `assets/atlases/` and `apps/web/public/art/`.
