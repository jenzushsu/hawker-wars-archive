# Original hawker source

The editable source is [`packages/art/src/hawker.ts`](../../../packages/art/src/hawker.ts): ordered opaque pixel rectangles, three original stall palettes, and individually authored pose controls. No external imagery, sprite packs, or paid generation calls were used. Its warm cream jacket, folded toque and apron match the existing Arena chef.

Aseprite is unavailable in this environment. This is a disclosed code-authored source fallback, not an `.aseprite` native source or a claim that the complete art pipeline gate has passed.

Export from repository root with `pnpm exec tsx scripts/export-hawker.ts`. This writes matching assets to `assets/atlases` and `apps/web/public/art`. The exporter uses a deterministic RGBA PNG encoder, without timestamps or external image dependencies. The source checksum and output checksum are in `hawker-source.json`.

All frames are32×32, untrimmed and unrotated, with origin(0.5,1). Each atlas cell has2px edge extrusion and2px transparent outer padding. Feet end at y30 in every pose, leaving a transparent lower border. Art pixels stay on the integer grid. Atlas keys are `hawker/<green|blue|amber>/<clip>/<zero-based-index>`.

| Clip | Frames | FPS | Loop |
| --- | ---: | ---: | --- |
| idle |4|4|yes|
| prepare |6|8|yes|
| serve |6|10|no|
| waiting |4|4|yes|
| shortage |4|6|no|
| celebrate |8|10|no|

`hawker-contact-sheet.png` rows are six clips in table order for green, then blue, then amber. Columns are frame indexes0..7. Open `/art/hawker-review.html` on the local web app to review timing, replay non-looping clips, and inspect the three palettes. The review respects the operating system reduced-motion preference.
