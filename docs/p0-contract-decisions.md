# P0 contract decisions

Baseline: [implementation plan v1.3](planning/hawker-wars-implementation-plan-v1.3.md). Recorded 22 October 2026 (Asia/Singapore).

P0 encodes configuration, schema boundaries, evaluation cohorts and acceptance expectations. P2-A implements transitions, action legality, demand draws, rules execution and observation projection. P2-B proves exact replay and oracle execution. A schema accepting a fixture does not establish that a transition produces its expected outcome.

## Boundary order and closing

The eight ordered phases are external effects; expiry/completions; arrivals/admission; patience expiry; observations; simultaneous dispatch; validation/application; atomic commit. Queue admission deliberately precedes old-customer abandonment. Expired stock/customer deadlines are unavailable at observation time. Actions occur at 0–119; settlement at 120 has no arrivals or decisions.

Cooking at t completes at t+5; new batches expire 20 minutes after completion. RESTOCK ordinarily delivers at t+10, or t+15 for orders placed during supplier delay. Each in-flight quantity reserves capacity. Exact due tick must be below 120. Existing-order delay clamps to 119 and occurs once. Promotions add eligible potential arrivals at t+1 through t+10 and allow another activation at t+20.

SERVE requires queue and ready stock; COOK requires idle cooker, raw ≥10, free ready capacity ≥10 and completion before 120; RESTOCK requires no pending order, cash ≥4000, raw capacity ≥20 and delivery before 120; PROMOTE requires cash ≥500, queue ≤5, ready ≥10, no active/scheduled promotion, elapsed cooldown and t+10<120. WAIT is always legal. Legal actions serialize in SERVE/COOK/RESTOCK/PROMOTE/WAIT order. A sole WAIT is `forced_wait` with no provider attempt.

## Invariants and fixtures

Normal episode state must preserve:

- `42 + purchased = raw + ready + cooking + pending + served + wasted`.
- `cash = 20000 + 500*served - 4000*restockOrders - 500*promotions`.
- `arrivals = served + abandoned + queued`.

Boundary fixtures may deliberately use synthetic local opening ledgers (e.g. cash 3999 cannot arise from the standard 500/4000 cash increments). They must be explicitly marked synthetic and must not masquerade as reachable standard episodes. Their local deltas and numerical expectations still need validation. Standard episode/scoring fixtures use normal initial wealth. Do not weaken production state invariants merely to accommodate synthetic fixtures.

Closing resolves all queued customers once, charges their waits, disposes of prepared stock once, retains raw at 200 cents per portion, and leaves no pending order/cooking. Profit is cash plus terminal raw valuation minus 28400. Utility subtracts 100 per abandonment, 5 per total resolved wait-minute and 50 per wasted portion. Diagnostic latency/API cost does not enter utility.

## Version and hash boundaries

`manifests/p0-contract.json` freezes JSON-compatible configuration plus a domain-separated SHA-256 identity under `p0-config-1`. The checked copy detects configuration drift; intentional contract changes require updating the appropriate version and explicitly regenerating this artifact. Arrays preserve semantic order and object keys sort lexically.

This hash is not a deterministic simulator reference checksum. The trial manifest leaves that checksum null until P2 produces replay evidence. `state-hash-1` excludes timestamps, provider request IDs, latency, billing, leases and rendering data. Operational snapshots retain those fields outside the simulator object. Strict observation schemas reject private fields; P2 must construct an allowlisted projection and test the full provider request, not merely validate an already-sanitized sample.

## Attempt recovery and provider gate

An attempt reserves request/token/currency capacity, then persists a unique dispatch intent before sending once. Recovery can reuse a durable on-time response. An uncertain intent must consume its possible charge and fall back without another send. A restarted/stale worker does not renew the four-second deadline. SDK retries must be disabled; Jev's published SDK defaults must not be assumed suitable.

All live providers remain disabled until G0-B proves identity, entitlement, schema, pricing, quota, runtime and a credentialed smoke decision. Public package documentation is evidence of an integration surface, not access readiness. Missing provider evidence does not block G0-A.

## Trial evaluation

Clean target is 30 paired seeds (1000–1029), with trial quota taking precedence. Stress is six paired seeds (1000–1005), staged 1000–1002 then 1003–1005, two of each event at tick 60 using seed modulo 3. Results are descriptive/exploratory. The campaign does not run merely because a manifest exists. Smoke/static work needs separately reserved capacity. No automatic paid overages or upgrades.

## P0 exit evidence

Run `pnpm check`. This validates schemas with positive/negative examples, frozen configuration, fixture coverage/arithmetic, split separation, shock balance and disabled provider defaults. The fixture inventory records expectations for later transition tests; it does not report those mechanics as executed. Provider documents record actual public evidence and remaining G0-B requirements. P0 offline readiness and live-provider readiness are reported independently.
