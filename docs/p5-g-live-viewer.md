# P5-G shared live viewer and acknowledged voting

This increment connects a dedicated browser view to published shared rounds. The existing offline arena remains the replay fallback. Live spectators read committed scores, bounded tick history, operator state and audience results; browser reads never create a round, run a worker or dispatch a provider.

## Surface direction

This is an extension of the established cream-paper, charcoal-ink and red venue-signage design, using self-hosted Barlow Condensed headings and system text. The live surface is for watching a shared round and submitting an acknowledged choice. It uses a score ledger and voting rail, preserving the incumbent controls, focus treatment and readable DOM text. No new visual identity is introduced.

The first viewport must establish the round identity, connection state and last committed boundary, show the actual policy metrics and make voting eligibility clear. Connection failure, operator pause, stopped round and normal completion are distinct states. Loading/unavailable states offer a useful route back to the offline demo. At desktop sizes the score/history and voting sections sit together; at narrow and zoomed sizes they reflow without hiding controls. Changes should not announce every score tick to screen readers.

The current public projection contains scores and totals, not customer positions, inventory details or a complete live arena frame. The live view must not animate invented customers or present three mirrored stalls as live model results. Adding authoritative live arena projection remains separate work.

Source review of the live routes, `LiveRound.tsx`, its CSS module and the global stylesheet confirms reuse of the incumbent paper/ink/red palette, Barlow Condensed headings, system body text, blue focus outlines, bordered controls and tabular numeric results. The Operate layout preserves a desktop voting rail; below 900px its reading order is metrics, voting, then ledger, with an early voting jump link and a scrollable results table. This is surface-specific composition, not a new design-system rule. `PRODUCT.md`, `DESIGN.md` and `.impeccable/design.json` remain unchanged; the existing product document's P1-only scope is preexisting documentation drift. This source review does not substitute for the final rendered responsive review.

## Public data and reconnect

Migration 006 adds a public read-only view RPC. It briefly takes a shared lock on the same private round record used by commits and controls, then returns a consistent sanitized snapshot, event page, vote window, result and server time. Only published rounds are visible. No private recovery, seed, session identity, provider credential or tie draw is included.

The server endpoint reads this RPC with server-only configuration. The browser uses bounded sequential polling and persisted event cursors. It validates response identity and contiguous event sequences, rejects malformed or regressing data, and recovers from a missing page using the authoritative snapshot. A control change can appear at the same tick with a higher control revision. A failed connection retains the last good display but marks it stale and disables vote submission; reconnect does not replay local mutations.

This transport is polling, not a claim of hosted Supabase Realtime delivery. Realtime subscription handoff and hosted load testing remain separate acceptance work. The persisted cursor path can serve as the recovery path for a later push transport.

## Voting acknowledgement

An eligible spectator explicitly joins voting to obtain the signed anonymous cookie. Current receipt lookup restores the accepted choice for an existing session. Selecting an option alone is not acceptance; submission remains pending until the server acknowledges its durable receipt. Changed selections receive new request IDs only when the user submits them.

If a response is lost, the interface retains the original request ID and choice, explains that acceptance is unconfirmed, and permits an explicit retry of that identical request. It never silently sends disconnected votes later. Paused, closed, stopped, disconnected and expired-session states explain why submission is unavailable. The result distinguishes a resolved winner from an effect whose application has committed. Anonymous sessions remain exhibition deduplication rather than one-human/one-vote proof.

## Running and deployment

Apply all six migrations and deploy matching API, worker and browser versions. The live read endpoint needs the existing server-only Supabase configuration. Voting additionally needs the signing key and exact HTTPS origin documented in P5-E. The worker remains a separately supervised process; Vercel serves short requests only.

Use `/live` to enter a round UUID, or share `/live/ROUND_UUID` directly. Create and publish a rules round with the trusted CLI; add `--voting` only when audience voting is intended. Private/unpublished rounds remain unavailable to spectators. The offline demo remains at `/`.

## Validation and remaining work

Local validation on 2026-10-23:

- Root and web TypeScript checks and the Next production build passed. The unconfigured production API returns a sanitized 503; malformed round IDs return 400 and public responses disable caching.
- `pnpm check` passed: all 570 unit tests in 43 files (including 38 new view contract/gateway/reconciliation tests), P0 contracts, 800 rules and 80 mixed episodes, 24 disk archives, 72 replay executions and 72 report reloads. The static dataset hash stayed unchanged. Provenance-only refresh preserved behavioral references; source hash is `cab33d7fc25f8647be48109e81533e2c9d7fe7e0c3fd4068df9e920639f9e977`.
- All six migrations and the SQL lifecycle/concurrency suite passed in disposable PostgreSQL. The real PostgREST/worker view test passed: two concurrent readers each recovered 121 events exactly once, a delayed reader caught up in pages of 100 and 21, and control-only updates created no tick events. Hidden-round and role-permission checks passed; reads created no extra decisions.
- Browser checks passed: 32 behavior cases across four viewports, plus the final keyboard/reflow capture test. Ten existing offline controls/resilience cases also passed. Separate output directories resolved an initial concurrent test-artifact collision; no application change was needed for it.
- Desktop, 683px zoom-equivalent and 390px mobile captures were inspected. Independent finish review scored its sole responsive voting-hierarchy fix resolved, with disposition **ship** at that reviewed scope. Browser checks confirmed the voting jump focuses its heading and the final table column is reachable by horizontal scrolling. The design detector could not run because its launcher is unavailable; no detector pass is claimed.

Browser fixtures cover interaction and uncertainty handling, not actual HTTPS Secure-cookie acceptance. Actual local HTTP tests cover the server/database boundary; hosted TLS, cookies and Supabase behavior still require staging acceptance. All implementation checks use local infrastructure and synthetic test credentials; no hosted deployment or provider requests are part of this increment.

Remaining acceptance includes hosted Vercel/Supabase configuration and permissions, Realtime, supervised-worker operation, public-load testing, additional browser/assistive-technology coverage, and the live arena/multi-policy projection. No full P5 or release-readiness exit is claimed.
