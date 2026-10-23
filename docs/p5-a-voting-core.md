# P5-A offline voting core

This increment starts P5 with a deterministic, in-process voting lifecycle. It does not enable the browser vote preview, deploy a shared service or authorize provider calls. P4's remaining manual accessibility and integrated G3 acceptance remain open; backend preparation can proceed independently.

## Scope and trust boundary

The core owns one exhibition vote window, opening after committed tick 30 and lasting 20 seconds of unpaused server time. It accepts one current selection per session, permits changes before the strict deadline, and preserves request idempotency. Resolution uses accepted selections only. No votes produce no event; ties use the existing `demand-1` keyed `vote_tie` draw over lexically ordered tied option IDs, separate from demand streams. Scheduling targets the next uncommitted game tick and never introduces a new event at closing.

This first core supports a clean exhibition with no preexisting chaos event. The future worker must enforce that precondition against its authoritative schedule and reject incompatible rounds before construction; this module does not inspect simulator state.

All timestamps and tick notifications must come from the eventual authoritative worker. Session identifiers are opaque internal inputs: accepting an identifier here does not authenticate a spectator. The transport must verify signed anonymous sessions and operator authority before calling this core. Anonymous sessions will provide exhibition deduplication, not proof of one human per vote.

The private resolution retains audit evidence. Public snapshots expose only the window lifecycle, counts and resolved effect, with no voter identities, request IDs, private seed or tie draw. A session-specific receipt is a separate private response. The snapshot is not a persistence format. Accepted request retries return the original receipt without reapplying an older selection; rejected submissions throw typed errors and are not stored as durable receipts. Request history is in memory and requires service-layer rate limits and lifecycle disposal. No crash recovery, database transaction or concurrent-worker guarantee is implied by this in-memory component.

## Remaining P5 work

- Implement private durable lifecycle/receipt records, atomic round commits, lease fencing and uniqueness constraints; persist before acknowledging or broadcasting.
- Add server authentication, signed anonymous sessions, submission rate limits and bounded request handling. Validate bodies before calling the core; never accept client-supplied server time or arbitrary effect parameters.
- Add Supabase migrations, least-privilege grants and RLS, with actual permitted-read/denied-write tests through public and Realtime paths.
- Integrate one resolved event uniformly into every policy environment at the same atomic boundary, preserving exact replay and benchmark isolation.
- Implement snapshot/cursor/Realtime recovery, sequence deduplication, gap handling and multi-viewer tests without extra inference.
- Connect truthful accepted/rejected/disconnected voting UI to server acknowledgements; retain the existing local-preview label until this is complete.
- Implement durable pause/restart/kill-switch handling and prove uncertain provider attempts never redispatch.

Provider activation remains separately gated. No Supabase credentials or deployment are required for this offline increment. No full P5 exit, live vote acceptance or G3 pass is claimed.

## Reproduction

Run `pnpm demo:voting` for a deterministic demonstration of changing a vote, retrying the older request, pausing/resuming, rejecting a deadline vote, and scheduling/expiring rain. It prints only public snapshots and makes no network calls. Run `pnpm exec vitest run tests/live-voting.test.ts tests/live-voting-adversarial.test.ts` for targeted checks.

## Validation

The deterministic CLI demonstration and root TypeScript check pass. All 23 targeted voting tests pass: 12 lifecycle cases and 11 independently authored adversarial cases. Independent review found no remaining blocker within this offline scope.

Checks cover strict deadline rejection, per-session request namespaces, changing a selection without double-counting, stale accepted retries, pause/resume and overflow handling, all non-exhibition manifest classifications, deterministic ties with independent SHA-256 vectors, private/public separation, effect durations, irreversible disablement, and closing boundaries. Review corrected skipped resolution boundaries and non-idempotent empty scheduling. An empty resolution at tick 119 now settles without attempting a forbidden closing event. Constructor validation uses the existing refined manifest schema's classification enum.

The core rejects progression past an elapsed unresolved vote. The eventual worker must call it within the same transaction before advancing/publishing the actual round; this is not itself a transaction or rollback implementation. No browser or renderer files changed, so this increment does not rerun or extend the previous frontend acceptance evidence.

All 416 unit tests across 30 test files pass. P0 contract checks pass. Guarded provenance refresh preserved the frozen behavioral references; source-tree identity is `e28f2e0f92f968f67bc9713414c72406f86780604d4af0101e9c4f5afec32fc8`. The complete `pnpm check` passes: P2-A executed 800 rules and 80 mixed episodes; P2-B verified 24 persisted archives, 72 replay executions and 72 report reloads. The static dataset hash remains `0e4e973c9e4c162354ab158b3127d1a7629d4f9f17b81233deecaaa6923341d7`. No held-out cases or provider calls were used.
