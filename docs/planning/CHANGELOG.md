# Hawker Wars planning changes — v1.3

22 October 2026 (Asia/Singapore). Source attachments v1.2 are preserved unchanged. Revised documents implement the review fixes; application work and provider verification remain unexecuted.

- Removed seed components from provider/public IDs and added a complete request-projection acceptance check (`observation-2`).
- Prohibited credential logging; defined trace sanitization and secret storage boundaries.
- Specified durable attempt states and conservative recovery without redispatch (`fallback-2`).
- Added atomic request/token/cost reservations, shared trial pools, expiry and no-overage rules.
- Defined canonical simulator hashing separately from operational records (`state-hash-1`).
- Split MECH-11 into two consistent supplier-delay timelines.
- Defined private recovery snapshots and a subscribe/buffer/snapshot/cursor handoff (`recovery-1`).
- Prioritized accessible DOM controls when desktop browser zoom crosses the nominal minimum viewport.
- Split P2 into offline engine, replay/evaluation foundation and live adapters with independent exits.
- Defined a small finite-horizon exact-oracle task family, exact tie handling and solver validation (`static-task-1`).
- Reduced initial stress evaluation to six paired seeds, staged three then three; clean target remains 30 subject to verified trial capacity (`trial-eval-1`).
- Consolidated G0-B into the canonical provider checklist and added quota, recovery and projection evidence requirements.

Request ceilings checked: stress 720 per live provider; clean 3,600; combined 4,320; three-provider total 12,960. Smoke/static requests are additional. Stress reduction: 80%.

Validation performed: local Markdown links resolve; phase references and version identifiers reviewed; request arithmetic and two-per-shock seed distribution checked; stale checklist duplication and contradictory MECH-11 text removed. These checks validate the documents only. No engine tests, external documentation verification, API calls, benchmark runs or deployment were performed.
