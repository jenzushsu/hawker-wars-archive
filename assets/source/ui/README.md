# Original UI pictograms

Editable source: [`packages/art/src/ui.ts`](../../../packages/art/src/ui.ts). Nine original code-authored pixel drawings: inventory, queue, time, latency, warning, validation, vote, sound and expand. No external icon set, font glyphs, generated imagery or third-party artwork is used. This repository owns the source artwork. There is no native Aseprite source; editable rectangle geometry is the source of truth.

Both 16px and 24px variants use integer geometry, solid warm hawker-centre palette colours and a transparent border. The 24px variant snaps authored vector rectangle edges to the larger pixel grid; PNGs are never smoothly resized. The 288×64 atlas has eighteen untrimmed, unrotated frames named `ui/{name}/{16|24}`, 2px edge extrusion and at least 2px transparent cell padding. The source module exports frame coordinates shared by the decorative DOM consumer.

Run `pnpm exec tsx scripts/export-ui.ts` to regenerate the PNG, Phaser-compatible JSON atlas, icon manifest, contact sheet, review page and provenance/hashes in `assets/atlases/` and `apps/web/public/art/`. Run the same command with `--check` for strictly read-only verification. Review `/art/ui-review.html` at 2× integer display scale; the contact sheet orders names above left to right, 16px then 24px.

`Pictogram` renders `aria-hidden="true"` decorative pixels beside a visible text label. Keep the adjacent text and a meaningful button name; colour and icon silhouettes must not carry the only status explanation.
