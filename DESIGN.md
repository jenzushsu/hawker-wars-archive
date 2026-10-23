# Desktop arena direction

Source: docs/planning/hawker-wars-implementation-plan-v1.3.md sections4–9. This is implementation of that established direction, not a new brand proposal.

A warm, tiled Singapore hawker centre occupies the main surface. Three adjacent stalls use green, blue and amber identity accents plus readable names. Pixel geometry uses a480×240 Phaser canvas with integer scaling; DOM labels and controls remain sharp and accessible. Cream paper, charcoal ink, red venue lettering and stainless counters establish the setting. Barlow Condensed is self-hosted for compact signage; system sans is used for detailed text.

Cinematic starts with compact controls. Analytical mode reserves space for tabular metrics and compact inspection. A vote-preview rail reserves width rather than covering stalls. The inspector uses a native modal dialog with visible close, Escape and focus restoration. Reduced motion stops decorative animation. A nonmodal notice appears below supported size and never removes controls.

Palette: cream #f4ecd9, ink #272d29, muted #596259, venue red #9a352a, Jev #246848, Zoom #245e91, Pro #8b5b15. Rule results are labelled as mirrors at the point of reading; local preview voting is never represented as accepted by a server.

Art uses original editable pixel-rectangle sources in `packages/art/src/`, exported reproducibly to PNG/JSON atlases. Steam and committed-outcome cues use the effects atlas; DOM pictograms use a separate 16/24px atlas with adjacent text retained.

Hawker animation now uses original editable pixel rectangles in `packages/art/src/hawker.ts`, deterministic PNG/JSON atlases and six clips for each of three palettes. Phaser places sprite feet behind counters at logical y112. Customer animation uses six variants, six clips and four directions. Environment geometry is exported as background, counters and foreground layers; people remain separate sprites. See `docs/g1-art-validation.md` for source-workflow and accessibility limits.

Customer poses use committed queue samples and resolved service/departure counts from `web-demo-3`. Each stall shows at most three queued customers, one receiver, one departing customer and one decorative diner after a recorded sale. These are representative illustrations, not individual customer tracking. Seeking reconstructs poses without changing simulation outcomes. See `docs/p3-assets-validation.md`.

Effects use the same resettable presentation clock: steam only while cooking, service only for recorded sales, delivery only for typed delivery events, and scenario cues only while recorded effects are active. Settlement removes cues. Reduced motion hides steam and holds meaningful cues at frame zero. Replay loading validates the offline envelope and nested records before rendering, with distinct empty-recording and invalid-data recovery states.

Analysis uses Match, Decisions and Benchmarks tabs with visible selection and keyboard navigation. History is bounded to the replay boundary and scrolls within its panel; selected tabs, filters and scroll survive collapse. New tab-panel detail text uses a 16px minimum. The inspector distinguishes following the latest recorded tick from a pinned record. Clipboard feedback belongs to its specific record, and view-default recovery changes presentation preferences without changing the recording or selection.
