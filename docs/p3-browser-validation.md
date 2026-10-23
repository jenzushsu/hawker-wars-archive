# P3 customer and environment browser validation

Scope: the offline customer-sprite and environment-layer integration, using the public `web-demo-2` recording. These checks do not establish live provider behavior, individual customer tracking, a shared audience service or completion of every P3/art gate.

## Reproduction and assertions

Run with the development server at `http://localhost:3000`:

```sh
PLAYWRIGHT_BASE_URL=http://localhost:3000 pnpm exec playwright test e2e/arena.spec.ts e2e/hawker.spec.ts e2e/customers.spec.ts
```

`e2e/customers.spec.ts` adds four cases per configured viewport:

- Fetch and decode the actual customer/environment PNGs and JSON atlases, verify PNG header dimensions against atlas metadata, check 480 customer frames at 24×32 and three environment frames at 480×240, and assert every frame stays within a texture no larger than 2048 pixels per side. The live client must report all environment layers ready.
- Seek recorded states across all four scenarios and compare projected queue poses, slots, role directions and representative receive/depart/eat presence against public fixture evidence. Exact received/departed counts are independently checked against cumulative served/abandoned deltas. Queue samples stay bounded to the first three customers.
- Advance the presentation clock within a committed tick, check arrival/departure movement and clip frames, pause without drift, seek away/back to reconstruct the same poses, and reset the scenario without carrying customer effects.
- Enable reduced motion and retain recorded customer activity while keeping decorative frames and offsets at zero. Recorded playback continues to advance.

The suite rejects external HTTP requests and local write requests and records uncaught browser errors. The existing 64 cases retain playback, terminal settlement, accessible DOM controls, modal semantics, keyboard operation, local vote isolation, hawker animation and responsive composition coverage.

## Evidence

The full Chromium batch passed **80/80 cases** in 2.0 minutes on 2026-10-23: 64 existing cases plus all 16 customer/environment cases. No external/write HTTP requests or uncaught browser errors occurred. The new spec also passed a standalone strict TypeScript check with ES2022, DOM and Bundler module resolution. The HTML report is `results/p1-playwright-report/`; persistent AX snapshots remain under `results/g1-accessibility/`.

The initial capture batch wrote `results/p3-ui-review/{reference,minimum}/customers/tick-{0,37,40,76,77,120}.png`. These show committed receive, walk, wait, impatient, departure and post-service dining states from the clean recording. They are representative samples mirrored across stalls, not a visual count of every resolved customer. Canvas-area captures include any real DOM labels overlaying that area. The existing composition batch refreshed `results/p1-ui-review/{project}/{default,crowded,dialog}.png`. Desktop crowded captures retain three stalls and the baseline; both equivalent reflow projects pass without horizontal overflow.

The checked-in recording begins after a real first-tick sale. Browser checks use that recording without fabricating an earlier state. The separate projection unit tests cover the zero-sale case and reject meals/service/departure effects without committed evidence.

## Limits

Chromium automation covers 1920×1080 and 1366×768 desktop viewports plus 960×540 and 683×384 CSS viewports with device scale factor 2. The latter are equivalent reflow checks; they are not actual browser zoom. Actual zoom and spoken screen reader review remain open for the tooling reasons recorded in [G1 accessibility evidence](g1-accessibility.md).

Presentation metadata makes the exercised roles and frames inspectable; atlas fetch/decode and canvas composition checks establish that the live renderer also runs. These checks do not replace visual acceptance of every source frame, cross-browser review or pixel-art provenance/export validation.

Validation date: 2026-10-23. No provider calls or new system packages are required.
