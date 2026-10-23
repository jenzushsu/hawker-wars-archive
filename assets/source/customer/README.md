# Original customer source

The editable artwork is [`packages/art/src/customer.ts`](../../../packages/art/src/customer.ts): ordered pixel rectangles, six customer palettes from the original Arena, individual silhouettes and authored animation poses. The variants have different hair, collars, stripes, glasses, bags and backpack details. No external imagery, sprite packs or paid generation calls were used.

Aseprite is unavailable in this environment. This is an explicitly disclosed editable TypeScript fallback, not native `.aseprite` source and not a claim that every production art gate is complete.

Run `pnpm exec tsx scripts/export-customer.ts` from the repository root. Outputs go to both `assets/atlases` and `apps/web/public/art`. Add `--check` for read-only verification: missing or stale outputs cause failure without creating, repairing or rewriting files. The PNG encoder is reused from the original hawker exporter, with fixed RGBA settings and no timestamp or external image dependencies. `customer-source.json` records source and atlas SHA-256 checksums.

All frames are 24×32, untrimmed and unrotated, with origin (0.5, 1). Atlas cells are 32×40: two pixels of edge extrusion plus two pixels of transparent outer padding on every side. Source borders are transparent. The atlas is 1024×600, below the 2048px texture limit.

Stable frame keys are `customer/<variant>/<clip>/<direction>/<zero-based-index>`. Variant order is terracotta, sage, saffron, slate, rose, cream. Direction order is down, left, right, up. Every clip has all four directions; side views mirror their geometry while retaining the same pivot. Back views show hair and clothing rather than faces.

| Clip | Frames | FPS | Loop |
| --- | ---: | ---: | --- |
| walk | 4 | 8 | yes |
| wait | 2 | 2 | yes |
| impatient | 2 | 4 | yes |
| receive | 4 | 8 | no |
| eat | 4 | 4 | yes |
| depart | 4 | 8 | no |

Walking alternates the arm swing and foot contact; waiting rests the hands; impatience checks a wristwatch; receiving reaches for a plate; eating lifts a spoon; departure begins with a small goodbye wave. Sprite clips do not move customers through the world or change simulation state. The renderer owns positioning and action selection.

Contact-sheet rows are the six clips in table order for each variant in order. Columns are four direction groups in direction order, each containing frames 0–3. Clips with two frames leave their last two cells empty. Open `/art/customer-review.html` in the local web app for palette and direction selectors, replay, pause and reduced-motion review.
