# Original effects source

Editable artwork lives in [`packages/art/src/effects.ts`](../../../packages/art/src/effects.ts). It uses ordered opaque pixel rectangles and the existing warm cream, wood, steel and stall palettes. The food, crate, bus and clock are original project drawings. No external imagery, sprite packs or paid generation calls were used.

Aseprite remains unavailable. Editable TypeScript is the explicitly disclosed native-editor fallback; no `.aseprite` source or complete production art-gate approval is claimed.

Export with `pnpm exec tsx scripts/export-effects.ts`. The exporter writes matching outputs to `assets/atlases` and `apps/web/public/art`. Add `--check` to verify every output without writing, creating or repairing files. It reuses the deterministic PNG encoder from `scripts/export-hawker.ts`; there are no image dependencies or timestamp chunks. `effects-source.json` records source and atlas SHA-256 checksums.

Frames are fixed 32×32, untrimmed and unrotated, with bottom-centre origin (0.5, 1). Each 40×40 atlas cell contains two pixels of edge extrusion and two pixels of transparent outer padding. Source borders stay transparent. The 25-frame atlas is 320×160.

Stable keys are `effects/<clip>/<zero-based-index>`. The browser-safe source exports `EFFECT_CLIPS`, `effectFrameName`, `effectFrameAt` and `effectRects`. The caller owns placement, visibility and elapsed visual time. These drawings never change game state or claim that an event occurred.

| Clip | Frames | FPS | Loop | Drawing |
| --- | ---: | ---: | --- | --- |
| steam | 4 | 6 | yes | Three curling rice-cooker wisps |
| service | 4 | 8 | no | Chicken-rice plate with handoff glints |
| shortage | 1 | 1 | yes | Persistent empty serving tray and folded red towel |
| delivery | 4 | 8 | no | Wooden supply crate, rice sack and greens |
| bus | 4 | 8 | no | Compact public bus and arrival arrow |
| rain | 4 | 8 | yes | Cloud, staggered drops and a puddle ripple |
| supplier-delay | 4 | 8 | yes | Supply crate and kitchen clock |

The shortage frame stays static at every elapsed time. One-shot clips clamp to their last pose; the renderer owns hiding them after their clip duration. All cues remain identifiable as static first frames when reduced motion applies.

Open `/art/effects-review.html` on the local web app for replay, pause and reduced-motion review. Contact-sheet rows follow the table above; columns show frames 0–3, with the persistent shortage occupying only its first cell.
