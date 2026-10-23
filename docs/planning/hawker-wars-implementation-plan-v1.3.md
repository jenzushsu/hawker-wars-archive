# Hawker Wars — Implementation Plan v1.3

**Revision date:** 22 October 2026 · **Platform:** desktop browser only · **Deliverable:** implementation plan; no application built or deployed.

**Status:** Revised planning baseline incorporating the document review and the user's reduced trial campaign. Supersedes the supplied v1.2 plan for future implementation. Documents only; no application, provider calls, benchmark results or deployment are produced by this revision.

**Readiness:** Simulation planning is resolved with the concrete `poc-1` mechanics, `utility-1` scorer and `rules-1` baseline below. These are user-authorized PoC defaults, not measured results or claims of optimal balance. Provider verification is an independent checklist (G0-B) and does not block offline engine/baseline implementation. No app is built by this revision; future implementation still requires a separate request.

### Review fixes and version policy

This revision fixes seed-bearing observations, credential logging language, uncertain-attempt recovery, quota/cost reservation, canonical hashing, private recovery snapshots, a contradictory supplier-delay fixture, zoom behavior and exact-oracle labeling. It also separates offline deliverables from provider-dependent work.

The economic/action rules remain `poc-1`, `demand-1`, `utility-1` and `rules-1`. Observation projection is now `observation-2`; canonical state hashing is `state-hash-1`; recovery snapshots are `recovery-1`; trial evaluation is `trial-eval-1`; attempt recovery and budget fallback are `fallback-2` (superseding `fallback-1`). Store these identifiers in each manifest. There are no implemented results to migrate; future results must not be mixed across observation/failure/evaluation versions without explicit labeling. Existing acceptance-fixture IDs remain stable except for the documented MECH-11 split.

### Merge review and resolutions

| Finding | Merged resolution |
|---|---|
| Earlier draft lacked the source stack | Restore Next.js/React/Tailwind, Phaser, strict TypeScript/Zod, Node worker, Supabase, Vercel, Railway, Vitest and Playwright |
| Shared arena could imply shared customers | Three independent policy environments receive identical exogenous arrivals/events; one server-owned round coordinates their presentation |
| Competitor name differed | Full name is **Zoom Decisions Pro**; **Zoom Pro** is the compact UI label; internal adapter ID stays `zoom-pro` |
| Source has illustrative balancing, not final rules | Preserve starting values and complete action/economy semantics in the `poc-1` contract below |
| Utility score is named but not defined | Define `utility-1`: profit minus abandonment, waiting and waste penalties; explicit ranking/tie rules below |
| Original dataset/sample targets were absent from the earlier draft | Retain 300–500 static candidate cases as a later research target; initial target is 30 clean seeds and 6 exploratory stress seeds, subject to trial quotas; larger campaigns deferred |
| Chaos overlay could cover the third stall | Keep contextual right-side behavior; reserve space while open so the third stall remains visible |
| Sprite size proposals differed | Standardize cooks to 32×32 logical pixels and customers to 24×32; use six customer variants including source minimum coverage |
| Initial draft allowed camera flourishes | Fixed camera for MVP; reduced-motion-friendly effects only; inspection zoom deferred |
| Source JSON/CSV exports versus added HF formats | Keep JSON and CSV reports; add JSONL/Parquet dataset exports |
| Source contains an implementation prompt | Retain a non-executing phase mapping and future handoff scope; this task changes documentation only |

## 1. Product outcome and scope

Hawker Wars is a public, live spectator experience in which **TypeSafe Jev**, **Zoom Decisions**, and **Zoom Decisions Pro (Zoom Pro)** operate three Singapore chicken rice stalls. Viewers first understand the competition through queues, cooking, service, stock pressure, and visible consequences. They can then inspect the decisions and supporting metrics without leaving the arena.

The **rules baseline remains a fourth evaluated policy**, with its results available in analysis and benchmark reports. It does not introduce a fourth visible stall. The baseline is an independent fourth benchmark policy, accessible through the benchmark HUD/table; it is not a fourth primary stall.

The primary audience is a desktop spectator watching a client demo or public run. The secondary audience is an evaluator inspecting decision quality, latency, reliability, and reproducibility. The same recorded events serve both audiences.

### Scope decisions

| Area | v1.3 decision |
|---|---|
| Desktop | 1920×1080 reference viewport; 1366×768 minimum supported viewport, measured in CSS pixels |
| Visual identity | Immersive, medium-complexity, 16-bit-inspired pixel art; Singapore hawker centre; exactly three visible chicken rice stalls |
| Default presentation | Cinematic mode, collapsed bottom HUD, closed decision inspector |
| Detailed presentation | Analytical mode with expanded HUD, comparable metrics, decision history, and rules-baseline results |
| Participation | Right-side contextual chaos voting during explicitly interactive runs |
| Evaluation | Retain static and sequential benchmark tracks, the three named competitors, and the rules baseline |
| Reproducibility | Versioned inputs, policies, engine, scorer, manifests, decisions, event logs, and Hugging Face-compatible data exports |
| Delivery | Public spectator live app plus replay and offline demo paths |
| Removed | Mobile layouts, portrait layouts, touch-first controls, gesture navigation, mobile device test matrices, mobile-specific assets, native mobile packaging, and mobile-specific performance work |

Also excluded: payments, actual restaurant orders or real hawker operations, additional dishes or player-owned stalls, Zoom Meeting SDK and Zoom Apps SDK integration, mobile/tablet-specific commitments, complex sprite rigging, and claims of numerical equivalence with an external published benchmark. All three stalls sell the same chicken rice under equivalent mechanics.

Below the supported desktop viewport, show a concise size notice and retain access to documentation/results. Do not create a second mobile gameplay experience. Browser zoom and assistive technology remain supported accessibility concerns.

### First-minute experience

1. Open a public run link and immediately see the arena, three named stalls, the current round, run classification, and live/replay status.
2. Watch customers arrive, queues change, and a validated decision produce a visible consequence.
3. Select a stall to inspect its latest committed decision; expand details only when wanted.
4. If voting opens, choose a clearly described chaos event and see its scheduled effect.
5. Switch to Analytical mode to compare outcomes, inspect history, and find benchmark evidence.

## 2. Preservation contract and change control

v1.3 retains the source architecture and desktop experience. This revision also fills previously unspecified simulation/scoring rules with explicitly versioned PoC defaults at the user’s request. It does not replace provider integrations, framework, transport, persistence or hosting.

| Inherited concern | Required treatment |
|---|---|
| Model/provider adapters | Preserve the planned TypeSafe Jev, Zoom Decisions, and Zoom Decisions Pro adapter boundaries; verify external endpoint/model IDs at G0-B |
| Rules policy | Use the ordered `rules-1` thresholds below; no adaptive tuning on held-out seeds |
| Simulation | Preserve state transitions, observation visibility, action space, economy, demand, inventory, round structure, and termination rules |
| Evaluation | Use the declared `trial-eval-1` static/sequential methodology and sample targets; use `utility-1` and the frozen seed cohorts below |
| Runtime and hosting | Reuse the earlier stack and deployment topology unless a measured requirement cannot be met |
| Data and replay | Preserve existing identifiers and formats; introduce additive, versioned fields or explicit migration adapters |
| UI | Replace mobile and dashboard-first composition with the desktop arena and progressive disclosure specified here |

### Gate G0 — two independent checks

**G0-A: offline contract conformance.** The mechanics, observations, demand, scoring, baseline, fallback and seed cohorts are specified below. At implementation kickoff, map them into typed configuration/schema specifications and accept the hand-calculated fixture expectations below. This design/configuration gate requires no API keys or hosted service and permits P2 to begin. P2 then executes the fixtures and accounting invariants in Vitest, pins runtime/dependency versions and freezes a deterministic reference checksum. The design decisions are settled; executable tests remain future work.

**G0-B: provider verification.** Use the separate checklist in “Provider contract and verification checklist.” Verify one provider at a time before enabling its live adapter. Missing entitlement or unavailable API access must not prevent G0-A, offline replay, art production, or rules-baseline tests. No live-model claim or paid dispatch is allowed for an unverified adapter.

Contract identifiers are `simulation=poc-1`, `demand=demand-1`, `scorer=utility-1`, `baseline=rules-1`, and `failure_policy=fallback-2`. Store these plus `observation-2`, `state-hash-1`, `recovery-1`, `static-task-1`, `trial-eval-1` and the canonical configuration hash in every manifest. Changes to these defaults require a new version and fresh results; UI and art changes must preserve frozen replay results. Provider-specific settings and prices remain G0-B verification items, never assumed simulation constants.

## 3. Architecture and runtime responsibilities

### Confirmed stack

| Concern | Retained technology / responsibility |
|---|---|
| Web application | Next.js, strict TypeScript, React, Tailwind; hosted on Vercel |
| Pixel arena | Phaser, isolated as a renderer consuming snapshots and committed events |
| Shared contracts | TypeScript + Zod; one canonical state/action/event schema |
| Simulation | Pure TypeScript transition engine with seeded PRNG; no UI, database or provider dependencies |
| Decision adapters | `@typesafe-ai/sdk` integration, Zoom Decisions HTTP adapters, local deterministic rules policy; exact external contracts verified independently at G0-B |
| Live coordinator | Long-lived Node worker on Railway; equivalent host only via documented architecture decision |
| Persistence / realtime | Supabase PostgreSQL + Realtime; durable event log and snapshots remain recovery authority |
| Workspace | pnpm monorepo |
| Tests | Vitest, integration mocks, Playwright desktop scenarios, database permission tests |
| Reporting | JSON/CSV reports, JSONL/Parquet dataset exports, charts from recorded results |

```text
hawker-wars/
  apps/web/                 # Next.js + React HUD + Phaser bridge
  apps/worker/              # authoritative round runner, persistence, broadcast
  packages/simulation/     # state, reducer, economy, timers, RNG
  packages/decisions/       # shared provider contract; jev, zoom, zoom-pro, rules
  packages/benchmark/       # cases, oracle, runners, statistics, export
  packages/shared/          # Zod schemas, identifiers, UI event contracts
  packages/design-tokens/   # colours, typography, dimensions, animation names
  assets/source/            # editable licensed source art
  assets/atlases/           # generated PNGs, metadata and provenance manifests
  datasets/static/
  datasets/sequential/
  manifests/
  results/
  supabase/migrations/
  supabase/tests/
  tests/
  README.md
  .env.example
```

The following flow maps these retained components to their responsibilities; no infrastructure migration is introduced.

```text
Versioned scenario + seeds + rules
                |
        Authoritative run coordinator
                |
       Observation / decision boundary
                |
       Existing policy adapters ---------- Rules baseline runner
                |                                |
       Schema and legality validation             |
                |                                |
        Deterministic simulation + scorer <-------+
                |
      Committed event log + snapshots + results
                |
       Public projection / Supabase Realtime
                |
       Desktop arena + HUD + decision inspector

Spectator vote -> bounded voting service -> scheduled external event
                                      -> coordinator at a legal boundary

Recorded decisions + inputs -> replay -> same event projection and renderer
```

### Authority and state

- The server owns simulation state, accepted actions, score, vote deadlines, and event ordering. Rendering, camera movement, and spectator counts never influence simulation outcomes.
- The coordinator captures the eligible observations at the one-game-minute decision boundary specified below. It dispatches independent model calls concurrently, validates them independently, and commits the tick after all eligible results arrive or the bounded deadline expires. Arrival order must not create an undocumented advantage.
- Client state contains presentation preferences, selected stall/decision, expanded panels, local replay cursor, and a projection of committed run state. It cannot write inventory, score, customer allocation, or model actions.
- Use the one-minute simulation tick and decision cadence below. Animate between committed states using a separate presentation clock. Do not accelerate the model's simulated actions because its visual animation finishes sooner.
- Use Supabase PostgreSQL for the shared public service. Keep an in-memory/event-file adapter for local engine fixtures and offline replay, so early work runs without hosted services. This local mode does not replace the public persistence architecture. Never instantiate a simulation or paid provider request per viewer.

### Simulation contract — `poc-1`

These defaults prioritize explainable decisions, bounded state and visible trade-offs. They are fictional game rules, not claims about real food safety, restaurant economics or actual service capacity.

Each policy independently operates a **120-game-minute lunch service**, with actions at ticks **0 through 119** and closing settlement at **120**. One tick is one game minute. All stalls receive the same exogenous arrival/event schedule; each owns its own cash, stock, cooker, promotion and queue. All three sell the same chicken rice. There is no cross-stall diversion or private-state visibility.

| Parameter | Frozen PoC default |
|---|---|
| Initial cash / inventory | 20,000 cents; 12 ready and 30 raw portions per policy |
| Sale / ingredient unit value | 500 cents sale revenue; 200 cents ingredient acquisition value |
| Queue | FIFO by arrival tick then stable customer ID; capacity 30 |
| Service | Up to 3 queued customers per SERVE action; immediate at action commit |
| Cooking | One cooker; exactly 10 portions per batch; completes at start of tick `t+5` |
| Ready capacity / shelf life | 30 portions including reserved cooking output; 20 game minutes from completion |
| Raw capacity / storage | 60 portions including pending restock; no raw spoilage within this single-round PoC |
| Restock | Exactly 20 raw portions, 4,000 cents paid on order, delivery at start of `t+10`; at most one pending order |
| Promotion | 500 cents; active at ticks `t+1` through `t+10` inclusive; next promotion allowed at `t+20` |
| Initial ready expiry | Tick 20; initial raw is valued at 200 cents each |
| Default visual pacing | 5 wall-clock seconds per game minute (about 10 minutes/round); offline runs need not wait |
| Controller deadline | 4,000 ms from simultaneous dispatch; no retries within a tick; response after deadline is ignored |

Money, stock, timestamps and utility use integers. No rent, wages, tax, price changes, loans, cooking fees or salvage of prepared food in `poc-1`. No passive customer service: a controller must choose SERVE. Cooking and deliveries continue in the background while the next tick may select another action. Exactly one action is applied per active policy per tick; choosing WAIT still consumes the turn.

#### Legal actions and effects

| Action | Legal exactly when | Committed effect |
|---|---|---|
| SERVE | Queue nonempty and unexpired ready stock ≥1 | Serve `min(3, queue_length, ready_stock)` FIFO customers, consuming earliest-expiring ready portions first; add 500 cents per customer |
| COOK | Cooker idle, raw ≥10, ready + reserved cooking output +10 ≤30, and `t+5 <120` | Remove 10 raw immediately, reserve 10 ready-capacity slots, schedule completion at `t+5`; no partial batch |
| RESTOCK | No pending order, cash ≥4,000, raw + pending quantity +20 ≤60, and effective delivery tick <120 | Deduct 4,000 cents, reserve 20 raw-capacity slots and schedule delivery; no partial order |
| PROMOTE | Cash ≥500, queue ≤5, ready ≥10, no active/scheduled promotion, cooldown elapsed, and `t+10 <120` | Deduct 500 cents; schedule promotion arrivals for next 10 ticks and set next-eligible tick to `t+20` |
| WAIT | Always during ticks 0–119 | No direct mutation; background timers/demand still advance |

At a decision boundary, ready stock excludes expired portions, and reservations include all in-flight quantities. Deliveries/completions replace reservations with stock without exceeding capacity. Cooking cannot be cancelled or interrupted by serving. There is no auto-repeat action. If WAIT is the sole legal action, apply it without a provider call and record `forced_wait`, not a model decision or fallback.

#### Tick order and boundary semantics

For every tick 0–119:

1. Apply scheduled external events and their parameter changes.
2. Expire ready batches with `expires_at <= t` (count each portion as waste), then complete due deliveries and cooking; a newly cooked batch gets `expires_at=t+20`.
3. Add base/event/promotion arrivals in stable ID order. Admit until queue capacity; additional arrivals become immediate `queue_full` abandonments with zero wait.
4. Remove queued customers whose `arrival_tick + patience <= t`, recording `patience_expired`. New arrivals have patience ≥3 and cannot expire immediately. Customers at their exact deadline cannot be served this tick. Because admissions precede expiry, a queue-full arrival is rejected even if an old customer expires later in this same tick; test this deliberate ordering.
5. Form observations and legal-action sets for each independent policy.
6. Dispatch eligible controllers concurrently, with the same deadline; apply automatic WAIT when it is the only legal action.
7. Validate results and apply accepted or fallback actions. Credit service revenue now, not when a visual animation finishes.
8. Persist committed state, decision attribution, metrics and sequenced events atomically, then broadcast.

At **tick 120**, do not accept arrivals or decisions. Mark all remaining queued customers `closing_unserved` abandonments with wait `120-arrival_tick`. Dispose of all remaining ready stock as waste once, including batches reaching expiry at 120. Retain raw stock at ingredient value for settlement; do not add that valuation to spendable in-round cash. Normal action legality ensures no pending cook/order reaches 120; the delay-event guard below preserves that invariant. Record closing as a terminal event.

The worker starts the next tick no faster than the configured visual pacing and never overlaps decisions for two ticks of the same round. Model response speed affects measured latency, not available game time or service capacity. Offline benchmarks omit pacing but retain deadline/fallback semantics. UI pause affects presentation only; operator pause freezes at a committed tick boundary, preserving remaining game-time timers.

### Demand, observations and event defaults — `demand-1`

For reproducibility, generate action-independent potential arrivals before running policies. For seed `s`, random draws use SHA-256 over UTF-8 `hawker-wars|demand-1|s|stream|tick|index`, with decimal integers and fixed stream names; take the first four digest bytes as an unsigned big-endian integer `r`, and use `u=r/4294967296`. This provides keyed deterministic draws without action-dependent PRNG consumption. Store the resolved arrival/event schedule as well as seed and version; replays use the stored schedule.

- **Base demand:** ticks 0–29 and 90–119: 0 arrivals for `u<0.50`, 1 for `0.50<=u<0.90`, otherwise 2. Ticks 30–89: 1 for `u<0.50`, otherwise 2. Stream `base_count`, index 0. Expected base demand is 126 customers per episode; realized counts depend on seed.
- **Patience:** `3 + (r mod 8)` minutes, using stream `patience` with the potential customer's stable within-tick index. Values 3–10 are equally represented by the draw mapping.
- **Promotion:** stream `promo_count`, index 0, yields one extra potential arrival when `u<0.50`, otherwise zero; admit only when that policy's promotion is active. This changes local realized demand as an explicit endogenous action consequence, not an unfair exogenous schedule. Expected added demand per activation is 5 customers; no future draw is revealed to a controller.
- **Customer IDs/order:** order base arrivals, then bus-event arrivals, then promotion arrivals within a tick; assign a stable index across these potential slots before filtering. Private evaluator IDs include episode seed, tick, source and ordinal. Provider/public customer IDs are episode-local `customer-<tick>-<source>-<ordinal>` identifiers, independent of seed. Provider-visible run/round IDs are opaque random identifiers generated independently of evaluation seeds; do not encode seed or cohort metadata in them. Private-to-public ID mapping must remain stable for replay. Queues and serving are FIFO by this order. All policies use the same potential-arrival IDs and patience values.
- **Queue visualization:** draw a bounded visible queue plus an accurate overflow count; never drop authoritative customers for rendering performance.

Observation schema includes tick/remaining minutes, current cash, raw quantity, ready batches with quantity/expiry, cooker quantity/due tick, restock quantity/due tick, ordered queue IDs with arrival/deadline, active promotion/cooldown, currently active external effects, public demand phase/distribution, cumulative revenue/purchases/promotion spend, served/abandoned/waste/wait totals, the latest five own committed action summaries, and ordered legal actions. All are current or historical public-to-that-policy facts. Exclude future draws/schedules, evaluation seeds, other policies' state, oracle labels and private benchmark metadata. Use identical semantic fields for all adapters. The allowlisted `observation-2` projection also sanitizes action history, nested references, round IDs and SDK metadata; do not forward internal state wholesale. Test complete serialized requests for direct seed, future schedule, cohort and oracle leakage. Public seeds can still permit inference; this projection removes direct disclosure and is not a secrecy guarantee. Legal actions always serialize in `SERVE, COOK, RESTOCK, PROMOTE, WAIT` order after filtering.

**MVP chaos catalogue:** exactly three options; resolve a vote at the next uncommitted tick boundary. Apply the same event to every policy environment. One vote window per exhibition round opens after tick 30 commits and lasts 20 wall-clock seconds; stop its countdown during an operator pause. Never apply events at or after closing. No stacking of multiple chaos events in `poc-1`.

| Event | Exact effect |
|---|---|
| Bus arrival | Add 6 potential customers at the effective tick, after base arrivals; use standard patience |
| Rain | For 10 ticks starting at the effective tick, keep each base arrival only when its `rain_keep` draw is <0.50; do not alter promotion/bus arrivals or patience |
| Supplier delay | Add 5 minutes once to the currently pending order, if any; orders placed during the next 10 ticks take 15 instead of 10 minutes. Existing-order delay is clamped to tick 119; new-order legality requires effective due tick <120. No refund, duplicate delay or delivery loss |

`rain_keep` uses the base customer's stable slot index. Supplier-delay effects process before delivery completion, so an order due at the event tick may be delayed. Promotional viral-hype art can represent PROMOTE; storms are a visual rain variant, not a fourth mechanic. The controlled benchmark disables audience voting. The initial `trial-eval-1` suite targets **30 clean seeds** (no shock) and **6 exploratory stress seeds** (one event at tick 60, event type selected by seed modulo 3: 0 bus, 1 rain, 2 supplier delay). Every enabled policy runs the same selected seeds within a cohort; report unavailable adapters explicitly. Never pool cohorts into an unlabeled headline. Expansion to 30 stress seeds or approximately 100 seeds per cohort is deferred until additional capacity is allocated. Controllers see effects when activated, not the future event type or activation schedule.

Development seeds are 0–99. Held-out clean seeds are 1000–1029. Initial stress seeds are 1000–1005: two of each event. Stage stress seeds 1000–1002 first, then 1003–1005 only when reserved trial quota permits; freeze this sequence before results and never select continuation based on scores. Report incomplete campaigns and actual paired counts. Future expansion to 1000–1099 requires separately allocated capacity; report extensions separately if earlier seeds informed tuning. Hold seed lists in evaluator manifests, not controller observations. Static generator seeds are 2000–2099 for development and 3000–3099 for held-out candidates; deduplicate canonical states across splits and freeze the resulting dataset before testing. Publicly released seeds must not be reused as an unseen evaluation claim after tuning.

### Accounting, metrics and utility — `utility-1`

**Cash is liquidity; profit is change in asset value.** Initial wealth is 20,000 cash + 42 portions ×200 = **28,400 cents**. Initial stock is not free revenue. Ingredient purchases reduce cash on ordering; consumption does not charge cash a second time.

```text
P_cents = closing_cash + 200 * closing_raw_portions - 28400
        = sales_revenue - 200 * (42 + purchased_portions)
          - promotion_spend + 200 * closing_raw_portions

U_points = P_cents - 100 * A - 5 * T - 50 * W
```

`A` is every unserved customer resolved as patience-expired, queue-full or closing-unserved. `T` is the sum of game-minute wait across **all resolved customers**, including served and abandoned: resolution tick minus arrival tick (zero for immediate rejection). `W` is ready food discarded through expiry or closing. Count each customer/portion exactly once. Raw closing stock is retained and is not waste; prepared stock has zero terminal value. Cooking-in-progress, pending restock and unresolved customers must all be zero after settlement.

| Utility term | Weight | Intent |
|---|---|---|
| Profit | +1 point per cent | Keep financial outcome the main scale |
| Abandonment | −100 points per customer | Cost a lost customer an additional one-dollar-equivalent of utility |
| Waiting | −5 points per customer-minute | Penalize slow service without dominating ordinary margin |
| Prepared-food waste | −50 points per portion | Add a modest waste penalty beyond its already-incurred ingredient cost |

Utility is a game score, **not money**. The waste term intentionally penalizes both the financial cost (already in profit) and avoidable disposal. API cost, latency and fallback counts are separate diagnostics, not hidden economic penalties. No normalization by realized customer count: promotion cannot improve the headline by changing a denominator. Negative scores are allowed; do not clip to zero.

**Ranking:** default live race ranks by current marked-to-cost profit: `cash + 200*(raw + ready + cooking_quantity + pending_order_quantity) - 28400`. Unsold prepared stock loses all remaining value at closing; label live figures “provisional.” Equal profit shares rank; provider order is used only for stable visual placement. Final net-profit leaderboard ranks by `P_cents`; utility leaderboard ranks separately by `U_points`. Equal final primary values share rank with no hidden latency or provider-name tie-breaker. The UI must name the selected ranking metric; a “winner” is always attached to that metric. Utility may be displayed live as provisional using resolved-customer waits; terminal settlement is authoritative.

**Other metrics:** mean wait = `T / total_resolved_customers` (N/A when zero); also show served-only mean wait separately. Satisfaction per served customer = `max(0, 100 - 10*wait_minutes)`; abandoned customers score 0. Overall satisfaction is the mean over all resolved customers, N/A when none. Record stockout ticks when queue >0 and ready=0 at observation time. Report fill rate = served / arrivals, N/A when arrivals=0. These metrics are diagnostic and do not add undocumented utility terms.

**Worked arithmetic fixture (illustrative, not a measured run):** 60 served, 40 purchased portions, zero promotions, 12 closing raw, 10 ready portions wasted, 10 abandoned and 120 total customer-minutes of wait. Closing cash is 42,000 cents; `P=42,000+2,400−28,400=16,000` cents (S$160). `U=16,000−1,000−600−500=13,900` points. Portion conservation is `42+40=60+10+12`.

**Objective alignment:** all controllers are told to maximize final `U_points` using the same weights and rules; profit remains a separately reported outcome. Static exact-oracle reference sets include every action attaining the maximum expected remaining utility under this contract, with sunk costs common to all actions omitted. For tractable finite-horizon tasks, enumerate the specified future demand probabilities, never reveal hidden realized draws, and state the horizon/terminal valuation in the case. A short-horizon optimum is ground truth only for that declared task, not the full 120-minute episode. Full-episode approximate labels remain agreement labels. Do not use `rules-1` as an accuracy oracle.

**Static task contract — `static-task-1`:** begin with reachable states at ticks 117–119, using development generator seeds for development and separate held-out generator seeds for held-out tasks, generated by declared development behavior policies and deduplicated before held-out evaluation. Each task contains its initial simulator state, finite horizon through closing at 120, explicit demand/hidden-patience distributions, legal actions, scorer and terminal settlement version. Pending deliveries/cooking and active effects remain part of the task state. Enumerate all future stochastic branches and adaptive legal continuations for these small cases using exact rational probabilities (including the specified 32-bit draw mapping); compare expected utility exactly and retain every maximizing first action. Use independently hand-enumerated tiny cases to validate the solver. Reject cases exceeding a preregistered state/branch limit from the exact split and record counts; approximate cases remain a separate agreement split. Manifest the generator, selection quotas/categories, solver version, branch limit and terminal valuation before freezing either split; do not select cases by provider disagreement or outcome. Larger or alternative-horizon task families require a new task manifest.

### Deterministic baseline — `rules-1`

Use the first matching rule below after generating the current legal-action set. No randomness, lookahead access, cross-policy information or learned thresholds. Evaluate in this exact order each tick. `remaining=120-t`; `Q` is queue length; `R` is ready stock; `stock_pipeline=raw+cooking_quantity+pending_order_quantity`; urgent means the head customer's deadline minus `t` is ≤1. Each rule is skipped when its action is illegal.

| Priority | Condition | Action / rationale |
|---|---|---|
| 1 | Q>0, R>0 and head customer urgent | SERVE; prevent imminent abandonment |
| 2 | R≤5 and remaining≥6 | COOK; refill before a prolonged stockout |
| 3 | stock_pipeline≤10 and remaining≥25 | RESTOCK; cover delivery plus cooking lead time |
| 4 | Q>0 and R>0 | SERVE; normal FIFO service |
| 5 | R≤15 and remaining≥15 | COOK; build a controlled buffer |
| 6 | stock_pipeline≤20 and remaining≥35 | RESTOCK; replenish without late-round overbuying |
| 7 | Q≤2, R≥15 and remaining≥25 | PROMOTE; spend only with spare prepared stock and time |
| 8 | Otherwise | WAIT |

Legality additionally enforces cash, capacity, active cooker/order, promotion cooldown and completion deadlines. Equality thresholds are inclusive. Rule 1 precedes replenishment even when both are desirable; rule 2 precedes non-urgent service to make the heuristic reproducible. Prepared stock does not count in `stock_pipeline`; it has its own buffer thresholds. This is an explainable comparator, not an optimal solver. Do not tune it on held-out results without a new baseline version.

### Failure and fallback contract — `fallback-2`

Use the 4,000 ms deadline, one attempt per decision, and **zero automatic retries within that tick** for all enabled live/benchmark adapters. Invalid enum/shape, illegal action, network error, rate limit and timeout all invoke `rules-1` on the same captured observation/legal-action set; it always terminates with a legal action because WAIT is legal. Record raw outcome safely, attempted provider, applied action, baseline version, reason and latency separately. Never label fallback output as the provider’s own decision.

Retain fallback episodes in the primary deployment-policy results and report fallback counts/rates prominently; additionally show a no-fallback cohort with its sample count, without replacing the primary report or hiding selection bias. Attribute the episode as **provider + rules fallback** whenever fallback occurs. Provider evaluation latency includes time to failure/timeout, with fallback execution reported separately. Disabled/unverified adapters have no benchmark score; deterministic fixtures are not substituted under their names. A failed provider does not freeze other stalls beyond the common tick deadline.

The per-round maximum is 120 attempted requests per enabled provider, fewer when WAIT is forced. Under `fallback-2`, persist a unique attempt record and reserve quota/cost before any outbound call. Persist transitions `reserved → dispatch_intent → response_recorded → committed`, with `uncertain`/`failed` terminal outcomes as applicable. Fence every transition; a uniqueness key `(run_id, tick, policy_id)` permits at most one dispatch intent. Only the process that durably created the intent may send once, after confirming its lease. Reserve before intent; a crash leaving only a reservation can safely release/re-reserve because sending without intent is prohibited. An intent without a durable valid response is uncertain after the original deadline or worker takeover: retain its potential charge and apply rules fallback without redispatch. A durable validated response is reusable only if it was received within the original persisted deadline. Requests finishing after takeover/deadline cannot replace a committed fallback. An uncertain attempt may have been billed even if no network request actually occurred; prefer conservative accounting over duplicate dispatch. Disable SDK/transport automatic retries. Cancellation is best-effort and is not evidence of no charge.

Persist UTC dispatch/deadline instants for recovery, use a monotonic clock for elapsed-time enforcement within a process, and record both. Stage dispatch intents for all eligible policies before their common dispatch boundary; record any dispatch skew. A restart does not reset the four-second deadline. Test each crash boundary and stale-worker response path.

**Trial quota and budget contract:** verify remaining trial requests, tokens/credits, expiry, model entitlements and any shared Jev/Zoom/Pro quota pools before enabling dispatch. Reserve capacity for smoke tests and static evaluation separately. Use atomic reservations across all workers, episodes and adapters sharing a quota. Require a documented conservative per-request cost/token bound with enforced input/output limits; reserve that bound and one request before dispatch, then reconcile verified usage. Retain the bound for uncertain charges until an authoritative usage record resolves them. Enforce per-episode and campaign currency caps plus tighter request/token/credit/expiry constraints; zero-price trials still require verified quota bounds. Missing price or usable quota evidence disables dispatch. No automatic upgrades or paid overages. Budget/quota exhaustion applies explicitly labeled rules fallback; quota-reduced episodes remain deployment-policy results with fallback counts, not pure-model scores. Real paid runs additionally require a verified per-run currency budget configured at G0-B; absent budget means paid runs cannot start. Exhausting that budget stops further dispatch and labels subsequent choices as budget-triggered rules fallback. Partial failures do not alter the simulation clock or deadline for another provider.

### Numerical and boundary acceptance fixtures

These are expected outcomes for future tests, not claims of an executed simulator. Unless a row overrides it, assume no active external effects, sufficient cash, idle cooker, no pending delivery, no promotion/cooldown, and a legal initialized state. Supply omitted arrival/history fields consistently when turning each row into a fixture.

| ID | Given / action | Required outcome |
|---|---|---|
| MECH-01 | Ready=2, Q=4, SERVE | Two FIFO customers served, +1,000 cents cash, ready=0, Q=2 |
| MECH-02 | Tick 10, raw=10, ready=5, COOK | Raw=0, reserved output=10; ready remains 5 through tick 14; +10 ready at tick 15 with expiry 35 |
| MECH-03 | Ready=21, raw=10 | COOK illegal because 31 would exceed ready capacity; ready=20 permits it |
| MECH-04 | Tick 10, raw=40, cash=4,000, RESTOCK | Cash=0, 20 reserved raw slots, delivery at tick 20 gives raw=60; second order illegal while pending |
| MECH-05 | Raw=41 or cash=3,999 | RESTOCK illegal; with raw=40 and cash=4,000 capacity/cash constraints pass |
| MECH-06 | Tick 10, ready=15, Q=0, PROMOTE | −500 cents; only potential promo arrivals at ticks 11–20 become eligible; no new promotion until tick 30 |
| MECH-07 | Tick 20, initial ready batch has not been served | Its 12 portions expire before action selection; W increases by 12, never consumed afterward |
| MECH-08 | Customer arrived tick 10 with patience 3 | Eligible for service through tick 12; abandons before actions at tick 13 with wait=3 |
| MECH-09 | Queue=30 before new arrival; an existing customer expires this tick | New arrival rejected with wait=0 before expiry frees a slot; both abandonments counted |
| MECH-10 | Tick 115 and idle cooker; tick 110 and ordinary supplier | COOK at 115 illegal (completion 120); RESTOCK at 110 illegal (delivery 120). At ticks 114 / 109 respectively, completion/delivery at 119 is legal |
| MECH-11A | Pending order due 118; supplier delay starts 115 | Due tick becomes 119, not 123; no second delay |
| MECH-11B | Separate scenario: supplier delay starts at 100, active through 109; attempt RESTOCK at 105 with other prerequisites satisfied | RESTOCK illegal because effective due tick is 120 |
| RULE-01 | Tick 10, Q=1, R=5, raw=10, head deadline=11 | SERVE by rule 1, even though cooking is legal |
| RULE-02 | Same as RULE-01, head deadline=15 | COOK by rule 2; exact R=5 threshold included |
| RULE-03 | Tick 10, Q=1, R=6, raw=10, head deadline=15 | RESTOCK by rule 3 before normal service; R=6 prevents rule 2 |
| RULE-04 | Tick 10, Q=0, R=15, raw=25 | COOK by rule 5 if legal; with R=16 instead, PROMOTE by rule 7 |
| RULE-05 | Tick 119, Q=0, R=0, raw=0 | WAIT; no late cook, restock or promotion |
| SCORE-01 | The worked 60-served fixture above | P=16,000 cents and U=13,900 points; no duplicate ingredient charge |
| SCORE-02 | No arrivals, no actions except WAIT | Initial ready expires; closing cash=20,000, raw=30, W=12; P=−2,400 cents, U=−3,000 points; mean wait/satisfaction N/A |
| SCORE-03 | Closing queue has one tick-118 arrival; all other totals zero for this customer | Closing-unserved increments A by 1 and T by 2; utility penalty for this customer is 110 points |
| SCORE-04 | Two policies have identical primary score but different latency | Shared rank; latency does not break the tie |
| FALL-01 | Illegal or late provider action with RULE-01 state | Apply SERVE from `rules-1`, record provider failure plus fallback, never success |

Universal inventory invariant after each action/settlement: `42 + purchased_portions = raw + ready + cooking_quantity + pending_order_quantity + served + wasted`. Universal cash invariant: `cash = 20000 + 500*served - 4000*restock_orders - 500*promotions`. Queue invariant: cumulative arrivals = served + abandoned + currently queued. Assert these throughout replay as well as at closing. Scenario effects change timing/arrivals only, never these conservation identities.

### Provider contract and verification checklist — G0-B

The canonical provider contract, checklist and evidence register live in [Provider verification checklist v1.3](hawker-wars-provider-verification-checklist-v1.3.md). Maintain that document as the single source of provider verification requirements; do not copy a second checklist here. Each adapter remains disabled until its G0-B evidence is complete. G0-B is independent of offline conformance and makes no benchmark-quality claim.


### Additive data contracts

| Record | Required contents |
|---|---|
| Run manifest | Run ID, run classification, source revision, engine/scorer/schema versions, scenario revision, seeds, policy identities/config hashes, timeout/retry policy, asset version, start/end status |
| Decision | Run/episode/turn/policy/decision IDs, observation hash, eligible action/schema version, request and completion timestamps, validated action, validity outcome, fallback reason, attempt count, latency, available usage/cost data |
| Committed event | Schema version, run ID, monotonic sequence, simulation time, event type, entity IDs, causal decision or chaos ID, public payload, resulting state hash where applicable |
| Public snapshot | Run ID, sequence boundary, projection version, sanitized public state, phase, effects and score projection; separate public projection hash, never secrets, private schedules or voter identities |
| Recovery snapshot | Private `recovery-1` state at an atomic tick/sequence boundary: full simulator state, schedule reference/hash, private ID mapping, attempt/deadline/reservation references, operator/vote lifecycle state and remaining paused vote duration, lease/fencing references and contract versions; operational envelope separate from simulator-state hash |
| Vote | Run/window IDs, eligible option IDs, start/close times, anonymous deduplication identity, selected option, receipt status; keep identifying data out of public exports |
| Vote resolution | Window ID, counts, tie/no-vote rule, winning option, effective simulation boundary, effect duration, resolved parameters |

Credentials belong only in server-side secret configuration and must never enter logs, exports, prompts, browser payloads or fixture files. Redact authentication headers and secret-bearing SDK errors before logging. Retain sanitized provider payloads only in access-controlled private traces with documented retention and sharing rights. The inspector receives a sanitized public decision record. A short supplied explanation may be shown if available and labeled as such; do not fabricate an explanation or expose hidden chain-of-thought.

### Canonical hashing and recovery — `state-hash-1` / `recovery-1`

Hash a versioned canonical simulator object with SHA-256 over UTF-8 JSON. Object keys are sorted lexicographically, no whitespace is emitted, optional absent fields are omitted consistently, and all numeric state is finite safe integer data (no floating point, negative zero or undefined). Restrict identifier/key alphabets to ASCII. Sort batches by expiry then stable batch ID, queues by arrival then stable customer order, pending schedules by tick/type/stable ID, and policy maps by policy ID. Schema validation rejects duplicate IDs and invalid ordering before hashing.

The simulator object includes tick/phase, initial/configuration and resolved-schedule hashes, all policy inventories/reservations/timers/queues, economic and customer counters, applied actions, and resolved game-time effects. It excludes wall-clock timestamps, latency, request IDs, quota/billing records, leases, operator identity, render state and unresolved audience votes. Hash operational records and public projections separately with explicit domains/versions. A resolved audience event enters the simulator hash only when scheduled as a game-time input. Exact replay uses the recorded schedule and applied actions, including fallbacks; it never calls a provider.

Freeze golden draw vectors (input bytes, digest, first-four-byte integer) and canonical serialization/state-hash fixtures in P2 before declaring a reference checksum. Recovery restores the private snapshot and subsequent durable records, validates contract/configuration/schedule hashes, and refuses unsupported versions. Schema migrations are explicit adapters with replay evidence; never guess missing fields. Regenerate public snapshots from recovered private state.

### Persistence, APIs and permissions

Retain these source tables: `rounds`, `stall_snapshots`, `decisions`, `game_events`, `vote_windows`, `audience_votes`, `round_results`, `benchmark_datasets`, `benchmark_cases`, `benchmark_runs`, `benchmark_predictions`, `benchmark_episode_results`, `benchmark_reports`. Record state checksums, configuration hashes, tick/sequence boundaries and safe diagnostics as described above. Separate public projections from private provider traces and voting identities.

Retain the source routes, now with explicit access intent:

| Route | Purpose and boundary |
|---|---|
| `GET /api/rounds/current` | Public current-round metadata; no start-on-read side effect |
| `GET /api/rounds/:id` | Public snapshot and provenance |
| `GET /api/rounds/:id/decisions` | Paginated sanitized decision history |
| `GET /api/rounds/:id/events` | Bounded sequence-cursor recovery stream |
| `POST /api/votes` | Signed-session, server-validated and rate-limited submission; no direct anonymous table writes |
| `GET /api/benchmarks` | Published benchmark summaries only |
| `GET /api/benchmarks/:id/export` | Versioned published results/data; bounded download |
| `POST /api/admin/rounds` | Authenticated, authorized operator start/control; explicit budget checks |
| `GET /api/health` | Minimal health state; no credentials or private configuration |

Keep a single active worker lease with a fencing token and idempotent commit keys. Use uniqueness for `(round_id, tick, policy_id)` decisions and `(round_id, sequence)` events. A transaction checks ownership and expected tick, writes results/events/snapshot, and advances the round exactly once. Broadcast only after commit; resending a committed event is safe because clients deduplicate by sequence. A stale worker must not commit after lease loss. Persist attempts, responses and reservations using the `fallback-2` state machine above. Durable on-time responses may be reused; uncertain attempts never trigger redispatch. Fencing ensures one committed tick, not exactly-once external billing.

Enable RLS and least-privilege grants on exposed tables. Anonymous access is restricted to intentionally public, sanitized data; deny direct anonymous writes to authoritative game and voting tables. Keep service credentials server-side, private traces outside public projections, and operator authorization server-checked. Test both allowed reads and denied writes through the actual public and Realtime paths. Supabase's documentation distinguishes table grants from row policies; both require review. [Supabase RLS documentation](https://supabase.com/docs/guides/database/postgres/row-level-security).

### Resilience and observability

Use the fixed deadline and `fallback-2` policy above. Every timeout, malformed output, illegal action, retry, and fallback is recorded separately from successful model behavior. Never credit a fallback as a model-authored action.

Use the versioned `rules-1` fallback and keep its attribution explicit. Do not silently add retries to improve one competitor's score. Retry latency and cost must remain visible.

The public transport must support snapshot-then-events, sequence deduplication, gap detection, and reconnect. Subscribe and buffer events first, then fetch a public snapshot at sequence S, fetch the bounded persisted cursor log after S through the current high-water mark, and merge buffered events by sequence. Resume from the last applied sequence; on overflow or an unrecoverable gap, repeat snapshot recovery. Test commits during every subscription/snapshot handoff boundary. Use Supabase Realtime for live delivery and the persisted sequence-cursor API for recovery; realtime delivery alone is not a replay log. A client detecting a gap requests a fresh snapshot rather than inventing intermediate outcomes. Backpressure may discard decorative effects, never committed decisions or scores.

Use structured logs keyed by run, episode, turn, policy, decision, sequence, and trace ID. Record adapter latency, validation outcome, simulation commit duration, broadcast lag, reconnects, missing assets, vote rejection reasons, and fallback counts. Do not log API keys or unrestricted raw prompts in public telemetry.

## 4. Desktop screen composition

The arena is the visual centre. It contains shared hawker-centre architecture, three adjacent stalls, distinguishable hawkers, customer paths, and foreground tables. All three stalls remain visible in the normal view. Typography and controls are accessible DOM elements layered around or over the pixel-art renderer.

### Layout dimensions

| Region | 1920×1080 reference | 1366×768 minimum |
|---|---|---|
| Top status bar | 56 px high | 48 px high |
| Bottom HUD collapsed | 64 px high | 56 px high |
| Bottom HUD expanded | 240 px high | 200 px high |
| Arena available with HUD collapsed | 1920×960 px | 1366×664 px |
| Arena available with HUD expanded | 1920×784 px | 1366×520 px |
| Contextual voting rail | 304 px wide when open | 272 px wide when open |
| Inspector expanded | Centred overlay, max 1100 px wide, 80% viewport height | 32 px outer margins, internally scrollable |

The voting rail reserves space while open; it must not cover the right-hand stall. Layout changes fit the full three-stall scene inside the remaining arena. HUD expansion reduces the scene region rather than covering essential stall information. At minimum size with both HUD and voting open, simplify decorative foreground detail and maintain visible stall signs, queues, and status markers. Review this exact worst-case combination at the composition gate.

Use a **480×240 logical scene** as the proposed v1.3 art canvas, with 16×16 tiles. Scale uniformly using nearest-neighbour filtering and integer scale steps that fit the available area; centre the canvas and fill unused space with non-interactive environmental framing. At the reference collapsed layout this permits 4× scaling; the minimum crowded layout permits 2×. Never stretch X and Y independently. This scene grid is a presentation specification for Phaser, independent of simulation coordinates.

World art uses the logical grid; DOM controls use CSS pixels and are not shrunk with the world. Honour device-pixel ratio without adding smoothing. Snap camera positions and final sprite placement to the scene grid.

### Arena visual hierarchy

1. Three hawkers, stall signs, queues, and the immediate service action.
2. Committed consequences: served customers, shortage states, stock deliveries, or active scenario effects.
3. Small in-world status cues, selected-stall outline, and short decision captions.
4. Background ambience and decorative activity.

Use warm hawker-centre lighting, tiled counters, stainless equipment, chicken display cabinets, rice cookers, trays, kopi cups, and Singapore-style communal seating. Represent the setting respectfully; avoid decorative stereotypes and unrelated pan-Asian props. Do not invent official logos or imply provider endorsement.

Retain source identity accents: Jev green, Zoom Decisions blue, and Zoom Pro amber; reserve red and status icons for semantic warnings independently of competitor colour. Each competitor needs an identifiable silhouette, sign label, icon, and accent colour. Colour alone is insufficient. Model identity must remain readable even when a stall is dimmed or a chaos effect is active. Long display names wrap in DOM labels; never bake essential names into textures.

### Information placement

- Top: title, run/round phase, LIVE / REPLAY / RECONNECTING, benchmark or interactive classification, mode switch, sound, help.
- Stall anchors: competitor name, authoritative provisional profit and separately labelled utility score, short state label, inspection affordance.
- Bottom HUD: round progress, summary comparison, latest important event, expand/collapse control.
- Right rail: eligible chaos choice only when a vote is active; otherwise a small next-window/status affordance.
- Inspector: selected decision and evidence; never an always-visible wall of raw JSON.

## 5. Viewing modes, HUD, and decision inspector

### Cinematic mode — default

Show the full arena, compact scores, short event captions, and collapsed HUD. Use restrained highlights to connect an accepted decision to its consequence. The MVP camera is fixed: no automatic pans, zooms or celebratory reframing. Optional inspection zoom is deferred beyond MVP.

### Analytical mode

Expand the HUD by default, retain the arena, reveal aligned metrics and an event timeline, and expose explicit decision timestamps, validation/fallback badges, and baseline comparison. Disable decorative camera movement. State the active metric, units, aggregation window, and whether results are live, partial, or final.

Switching modes changes only presentation. It preserves run ID, selected stall, selected decision, replay position, votes, and simulation state. Store the viewer's preference locally; allow restoring defaults. A view-mode control must not restart model calls.

### Collapsible bottom HUD

The collapsed HUD contains round/phase, concise three-way results, current significant event, and a labelled expand control. The expanded HUD has three tabs:

| Tab | Content |
|---|---|
| Match | Comparable metrics for the three stalls; scores, quantities, and failure badges use explicit units |
| Decisions | Time-ordered committed decisions, policy filters, validation status, and inspection links |
| Benchmarks | Static/sequential result summaries, rules baseline, run provenance, sample count, uncertainty, export/replay links |

Changing tabs does not affect the run. On collapse, restore focus to the expansion control when the focused child disappears. Preserve the chosen tab and scroll position. Collapse and expansion use a short 160–220 ms transition; reduced-motion mode changes state immediately.

### Expandable decision inspector

Selecting a stall, a decision marker, or a HUD row opens a compact inspector within the expanded HUD. It shows policy, turn, observed context summary, chosen action, validation result, latency, and linked consequence. An Expand button opens the larger overlay.

Expanded sections: **Observation**, **Action**, **Outcome**, and **Technical details**. Technical details hold sanitized structured data, schema/config versions, hashes, timestamps, and copy/download controls. An explicit “Not supplied” state replaces missing explanation or usage data.

Selecting a decision pins its ID. New live decisions do not replace the item being read; show a count and “Jump to latest” control. Prior/next navigation follows committed event order. A model's proposed action, accepted action, and fallback action must remain distinguishable. Outcomes not yet committed show “Pending outcome,” never predicted score changes presented as fact.

The overlay has a visible close button, Escape handling, contained focus, an accessible title, and focus restoration. The arena may continue behind it. Local replay pause is separate from pausing a live server run; spectators have no operator pause privilege.

## 6. Contextual chaos voting

Voting is part of interactive exhibition runs. Static and controlled sequential benchmark runs do not accept audience mutations. Their right rail states “Voting unavailable in benchmark mode.” Interactive results must not be mixed into the controlled leaderboard.

### Window lifecycle

`closed → open → locked → resolved → scheduled → active → expired`

The server supplies eligible options, deadline, target scope, effect duration, and effective simulation boundary. Display at most three options, each with a plain-language consequence. Use only the three `demand-1` events: bus arrival, rain, and supplier delay. Viral hype is promotion artwork, not a fourth chaos mechanic. New mechanics require a separately versioned simulator change.

Frozen PoC exhibition defaults: one 20-second vote window per eligible round, opening after tick 30 commits, one choice per anonymous session per window, changes allowed until the server deadline, and one resolved event applied at the next legal tick boundary after the vote closes. These are explicit exhibition defaults, separate from controlled benchmark configuration. No votes means no added event. A tie orders tied option IDs lexically and selects index `floor(u * tied_count)` from a separate keyed draw using stream `vote_tie`, the round seed, tick equal to the integer window index (0 for the single MVP window), and index 0; store the selected ID and draw in the resolution log. This draw does not consume demand randomness. Disable incompatible options while an existing effect is active; no undocumented stacking.

Use common event conditions across competitors where the original scenario permits. The MVP applies each winning external event uniformly to all three policy environments. Stall-targeted chaos is out of scope. Do not let a spectator submit arbitrary simulator parameters or model prompts.

### Interaction and failure behavior

- Show selected, submitting, accepted, rejected, closed, and disconnected states. A local click is not an accepted vote until acknowledged.
- Use server time for closure. Reject late or duplicate submissions idempotently; do not silently queue a disconnected vote for a future window.
- Show accepted counts and a countdown; do not move keyboard focus or reorder options as totals change.
- Announce the winner, the scheduled application boundary, and the eventual active effect separately.
- Apply rate limits and signed anonymous session identity. Document that anonymous deduplication is suitable for an exhibition, not proof of one human/one vote.
- Reconnecting viewers receive the current authoritative window and their receipt state. Operator disablement closes voting cleanly without changing already committed events.

## 7. Desktop keyboard, mouse, and accessibility

Every action available by mouse must be reachable by keyboard. Provide DOM equivalents for interactive canvas entities and a text summary of arena state. Essential information must not require hover, audio, colour recognition, or reading moving sprites.

| Input | Behavior |
|---|---|
| Tab / Shift+Tab | Navigate controls in visible reading order |
| Enter / Space | Activate the focused control; Space retains native behavior |
| 1 / 2 / 3 | Select the corresponding stall when shortcuts are enabled and focus is outside text fields |
| H | Toggle HUD |
| I | Open selected decision inspector |
| V | Focus active voting panel, or announce that no vote is open |
| C / A | Select Cinematic / Analytical viewing mode |
| Escape | Close the topmost dismissible panel and restore focus |
| ? | Open keyboard help |

Single-character shortcuts must be disableable or remappable and inactive in editable fields. Visible controls remain the primary means of operation. Do not intercept browser shortcuts, page zoom, or normal scrolling. No drag-only, double-click-only, or right-click-only actions.

Use visible focus rings, accessible names, proper expanded/selected states, and stable focus during updates. Provide adequate text and control contrast, with text and shape redundant to status colour. Use a legible non-pixel font for detailed values, prose, and tables; reserve pixel typography for short display headings. Default detail text is at least 16 CSS px.

Respect reduced motion: stop decorative loops, remove camera movement and flashes, and replace large transitions with immediate changes. Avoid rapid flashing entirely. Sound starts muted, has independent mute/volume controls, and has equivalent visual event cues. Use polite, throttled live announcements for round changes and important failures, not every customer or score tick.

At 200% browser zoom, the arena may occupy less space while the HUD/inspector reflows and scrolls. The minimum-size notice is nonmodal and informational: it must not replace the DOM controls, results, inspector, or voting access, even when CSS dimensions fall below 1366×768. Prioritize readable DOM controls over the nominal art scale; this accessibility reflow is part of the desktop experience. Test the full default/HUD/inspector/vote combinations at zoomed sizes before full asset production. Test keyboard-only use, zoom, reduced motion, and representative screen-reader flows on desktop.

## 8. Sprite atlas, animation, and visual asset specification

### Asset inventory

| Family | Source grid / frame box | Minimum deliverable |
|---|---|---|
| Environment | 16×16 tiles; 480×240 scene composition | Floor/wall/counter tiles, background, foreground tables, occlusion masks |
| Stall structures | 128×96 logical px modular footprint | Three distinguishable variants sharing equivalent operational readability |
| Hawkers | 32×32 px frame box; bottom-centre pivot | Three distinct characters; idle, preparation, serving, waiting, shortage reaction, celebration |
| Customers | 24×32 px frame box; bottom-centre pivot | Six visual variants; directional walk, wait, impatience, receive, eat, depart |
| Food and equipment | 16×16 or 32×32 | Rice portions, chicken plates, trays, rice cooker, stock crates, order indicators |
| Effects | 16×16, 32×32, or 64×64 | Steam, service confirmation, shortage, delivery, supported chaos effects |
| UI pictograms | 16×16 and 24×24 | Inventory, queue, time, latency, warning, validation, vote, sound, expand |

Stall art may extend beyond the operational footprint only into documented decoration margins. Keep customer route lanes and interactive anchors consistent across variants. Changing a skin must not alter simulation geometry.

### Animation clips

| Clip | Frames / cadence | Loop and event semantics |
|---|---|---|
| Hawker idle | 4 frames at 4 fps | Decorative loop |
| Prepare | 6 frames at 8 fps | Loop while authoritative state indicates preparation |
| Serve | 6 frames at 10 fps | One-shot triggered by committed service event |
| Waiting | 4 frames at 4 fps | Loop; communicates awaiting decision or work, with explicit text status |
| Shortage reaction | 4 frames at 6 fps | One-shot, then persistent shortage icon |
| Celebrate | 8 frames at 10 fps | One-shot after committed round result; never before scoring |
| Customer walk | 4 frames/direction at 8 fps | Four directions; mirroring only when art permits |
| Customer wait | 2 frames at 2 fps | Decorative loop |
| Receive order | 4 frames at 8 fps | One-shot linked to committed service |
| Eat | 4 frames at 4 fps | Decorative post-service loop; no second sale or scoring effect |
| Impatient | 2 frames at 4 fps | Reflect authoritative patience state, no flashing |
| Cashier transaction | 4 frames at 8 fps | Presentation-only cue for committed sale |
| Steam | 4 frames at 6 fps | Decorative; disabled in reduced motion |
| Event highlight | 4–6 frames, 400–700 ms total | Non-flashing one-shot; exact effect determined by event |

Animation is a projection of state, not the source of truth. Frame callbacks may play audio or particles but must never award points, consume stock, or serve customers. Seeking a replay reconstructs the correct pose from event time instead of replaying every prior effect. Late events snap to the current valid state with an optional short cue; do not build an ever-growing animation backlog.

### Atlas contract

- Export transparent PNG atlases and machine-readable frame/clip metadata. Retain editable source files.
- Split environment, characters, and effects/UI into separately cacheable families. Initial maximum atlas dimension is 2048×2048; split by family if packing exceeds it.
- Use nearest-neighbour sampling, no texture smoothing, no atlas frame rotation, and no trim on animated character frames. Preserve fixed pivots and source sizes.
- Include 2 px padding/extrusion around packed frame regions to prevent edge bleed. Validate boundaries and alpha edges at all supported scales.
- Stable frame naming: `family/entity/skin/clip/direction/frame-number`. Never address animation frames by incidental packing position.
- Metadata includes asset version, image hash, frame rectangle, source size, pivot, duration, clip loop flag, and optional presentation-only event markers.
- Fix a shared palette and lighting direction at G1. Use consistent pixel clusters, outlines, perspective, and material shading; no isolated high-resolution painted asset inside the pixel world.
- Asset manifest links each file to source, author, licence/provenance, review state, and replacement history. No unlicensed third-party game sprites.

## 9. Asset production pipeline and review gates

Create an art brief and reference board from the approved direction. Produce a full three-stall composition test and one complete animated hawker before scaling production. Retain the source tooling direction: Figma for desktop interaction specifications and tokens; Aseprite or LibreSprite for editable sprite sheets; deterministic PNG/JSON atlas export consumed by Phaser. Pin exporter/settings at G1. Tiled remains deferred until map complexity justifies it; no advanced rigging engine is required.

If generative imagery is used during later production, use it for exploration or source material, followed by deliberate pixel-grid cleanup, consistent silhouettes, palette correction, and frame-by-frame animation review. Generated sheets are not accepted merely because they look plausible as a thumbnail.

Pipeline: **brief → composition/key frame → source sprites → animation cleanup → atlas export → automated validation → in-scene review → versioned release**.

| Gate | Evidence | Pass condition |
|---|---|---|
| G0-A / G0-B: conformance / providers | Offline default-contract fixtures / separate per-provider evidence | Engine/baseline can proceed offline; only verified adapters enable real paid calls |
| G1: composition and art direction | Desktop compositions at both sizes, including expanded HUD + active voting; one animated hawker | Three stalls identifiable; essential information readable; pixel scale and panel geometry workable |
| G2: production asset quality | Contact sheets, animation strips, provenance manifest, atlas validation report | No missing frames, drifted pivots, texture bleed, inconsistent lighting, or unresolved rights |
| G3: integrated interaction | Future build captures and interaction walkthrough in both modes | HUD, inspector, voting, keyboard access, and live state behave as specified |
| G4: benchmark integrity | Reference replay, static/sequential reports, export validation | UI cannot alter results; baseline retained; metrics and fallbacks honestly attributed |
| G5: release readiness | Desktop compatibility, load/reconnect tests, public-access rehearsal, fallback demo | Release acceptance suite passes and runbook is usable by another operator |

Each gate has a named owner in the implementation backlog: technical lead for G0/G4, design/art lead for G1/G2, frontend/accessibility lead for G3, and release owner for G5. Review evidence is captured in one batched pass, defects fixed together, then confirmed; further review is driven by unresolved defects rather than indefinite polishing.

## 10. Benchmarks, fairness, and reproducibility

### Preserve two evaluation tracks

**Static:** target 300–500 candidate canonical states for the research release; start the MVP with a smaller validated fixture set. Store observation, legal actions, scenario category, dataset version, solver parameters and reference-action set. Use exact search/dynamic programming for tractable finite-horizon oracle cases and accept all tie-equivalent reference actions. Approximate-policy labels measure agreement, not ground-truth accuracy. Separate development and held-out cases; disagreement-only cases are a secondary stress-test split, never the general-accuracy headline. Evaluate independent frozen observations/tasks against these preregistered criteria. Every policy receives the same allowed information and action contract. Static scores describe decision performance on those tasks; they are not presented as full-episode business results.

**Sequential:** target 30 paired clean seeds plus six exploratory stress seeds under `trial-eval-1`, subject to verified trial capacity. Defer larger stress/research campaigns until additional capacity is allocated. Report actual counts and partial completion; do not claim a completed 30-seed report if trial limits prevent it. Evaluate complete episodes in which earlier decisions affect later state. Preserve initial conditions, endogenous transitions, exogenous event generation, observation policy, and termination rules. Report trajectory outcomes and failure accumulation in addition to aggregate score.

Run TypeSafe Jev, Zoom Decisions, Zoom Decisions Pro, and the rules baseline in both tracks. Report unavailable provider/track combinations explicitly rather than filling them with another adapter. Primary sequential outcomes are net profit and the preregistered utility score; secondary metrics are served, abandoned, mean wait, waste, satisfaction, stockouts, p50/p95 latency, invalid responses, fallbacks, request counts and cost/usage where available. Use the frozen `utility-1` formula and settlement accounting above; report measured results only after execution, separately for clean/stress cohorts.

The research question is whether static structured-choice accuracy/agreement correlates with sequential operational outcomes. Report the tracks separately; any cross-track association analysis must state its unit of analysis and uncertainty. Four policy-level averages alone do not justify a broad correlation claim.

### Comparison rules

- Freeze the evaluation manifest before execution: scenarios, seeds, model/config versions, prompts, budgets, timeouts, retry policy, scoring, and aggregation.
- Separate provider identity from display labels. Do not infer what “Zoom Decisions” or “Zoom Pro” resolves to from its name.
- Preserve independent matched policy environments: identical initial resources, demand streams and shock schedules; separate cash, inventory and queues. No shared-market customer competition or access to other policies’ private state.
- Visualize the environments as three parallel stalls in one shared spectator scene and label “Same base conditions, independent stalls.” The rules baseline runs in an equivalent fourth environment for evaluation.
- Use matched scenario/seed conditions for comparison, but do not assume identical seeds guarantee comparable shocks after divergent action paths. Preserve or verify named random streams/event schedules for exogenous demand, supplier events, and other shocks.
- Keep evaluation random streams separate from decorative sprite variation and audience voting. Spectator count, frame rate, and replay speed have no effect on measured state.
- Publish failures, missing results, timeouts, invalid actions, fallback rates, latency distributions, sample counts, and available cost/usage alongside primary scores. Do not silently discard failed trials.
- Use `utility-1` and its shared-rank tie rule. Display net profit, utility and static scores separately with units and definitions; do not blend them into an undocumented winner score.
- Aggregate clean sequential uncertainty by paired episode/seed, not by treating correlated turns as independent samples. Preregister primary comparisons, paired mean differences and a seed-cluster bootstrap (10,000 resamples, analysis RNG seed 424242, 95% percentile intervals) for each primary metric. Report multiplicity and missing/non-completing runs explicitly, including bounds/sensitivity when missingness prevents a complete paired estimate. Report stress outcomes descriptively by seed/event; two episodes per event do not establish robust rankings. Record this statistical specification in the evaluation manifest before provider results are seen.

### External benchmark boundary

The supplied source distinguishes Hawker Wars from Zoom AI's `contested-fast-decisions` benchmark. Preserve that boundary: no published external leaderboard result is a Hawker Wars game score, no direct numerical equivalence claim is permitted, and any future external-dataset use requires separate methodology and licence verification. The merged plan does not assert current external dataset contents or scores.

### Reproducibility package

Provide versioned scenario inputs, static tasks, episode manifests, observations or their reconstructible references, raw/public-safe decisions, validated actions, external event schedule, state/event logs, score outputs, and configuration hashes. Include dependency locks, source revision, runtime/container details, deterministic rules policy, and evaluator entry points.

Retain JSON and CSV report exports from the source. Export dataset records as JSONL and/or Parquet with stable field types and explicit dataset splits/configurations. These are supported loading formats in Hugging Face Datasets; pin the dataset revision when reproducing published runs. [Hugging Face dataset loading documentation](https://huggingface.co/docs/datasets/loading).

Include a dataset card documenting intended use, task definitions, generation process, schema, splits, limitations, licences, evaluation method, and known failure modes. [Hugging Face dataset cards](https://huggingface.co/docs/hub/datasets-cards).

Required reproducibility levels:

1. **Exact simulator replay:** original inputs plus recorded validated actions and external events reproduce committed states and scores without provider access.
2. **Deterministic baseline rerun:** the frozen rules baseline reproduces decisions and results for the same manifest.
3. **Live model rerun:** the same configuration can be executed again, but provider nondeterminism and model revisions may change outputs. Report this limitation; do not promise bitwise-identical LLM responses.

Interactive chaos runs retain the resolved vote schedule for exact replay, but are labelled exhibition data. Raw anonymous voter identifiers are not part of the public dataset. Publishing decisions or provider outputs must respect their applicable sharing rights; do not include credentials or private user data.

## 11. Public spectator app and demo operations

Deploy the public website on Vercel, the long-lived simulation worker on Railway, and persistence/realtime on Supabase as specified in the source. Keep paid inference out of browser sessions and web request lifecycles. Hugging Face-compatible datasets and reports do not require migrating the live app to Spaces.

The public app supports anonymous viewing, a shareable run URL, late joining, current status, completed results, replay, and benchmark provenance. Spectators cannot initiate paid model runs or access operator controls. Public payloads contain no provider credentials or privileged settings.

Required user-facing states: loading assets, waiting for run, live, awaiting model decision, degraded provider, reconnecting, offline, replay, complete, operator-paused, cancelled, and unavailable run. Provide protected operator pause/resume and a kill switch for new inference; spectators cannot invoke them. Persist pause state and resume at a well-defined tick boundary. Distinguish a stalled stream from a paused simulation. A provider failure must not blank the arena or fabricate successful decisions.

Provide an offline deterministic demo using recorded events and a clearly marked mock adapter for development. Mock and replay runs carry persistent labels and are excluded from live-model benchmark claims. A prerecorded replay may be offered after a live failure, but switching is explicit, never disguised as live output.

The implementation runbook must contain exact, tested project commands for local start, mock run, static benchmark, sequential benchmark, replay, export, and public deployment. Define these scripts when establishing the repository and verify them before the implementation handoff; no runnable app commands are claimed by this planning document. Include example configuration with non-secret values, credential requirements, and one-command local startup as a delivery requirement. Use ngrok/localtunnel only if the inherited integration needs inbound callbacks; do not add tunnels to a read-only local replay unnecessarily.

### Proposed v1.3 performance budgets

These are acceptance targets, not measurements or inherited guarantees. Measure on a documented desktop laptop with integrated graphics, 8 GB RAM, and a fixed network profile; record actual hardware/browser versions in the test evidence.

| Measure | Initial target |
|---|---|
| Arena rendering | 60 fps target; p95 frame time ≤33 ms during maximum supported scene activity |
| Local control response | p95 ≤100 ms, excluding network-dependent acknowledgement |
| Commit-to-screen delay | p95 ≤500 ms on the defined normal network profile; measure model inference separately |
| Initial usable spectator view | ≤5 seconds at 10 Mbps / 100 ms RTT, excluding a documented cold host start |
| Initial compressed assets | ≤5 MB; lazy-load optional art and audio |
| Decoded atlas memory | ≤64 MB initial target, including runtime copies where measured |
| PoC load | 100 concurrent spectators and 20 vote submissions/second without lost committed events |
| Reconnect recovery | Current state within 5 seconds after connectivity is restored under the normal profile |

When budgets are exceeded, reduce decorative effects, cap drawn background customers with an accurate overflow count, and defer nonessential asset loading. Never reduce authoritative simulation demand or hide failures to improve render metrics.

## 12. Phased implementation backlog

No application implementation is part of this planning deliverable. The following phases define subsequent work, dependencies, and exit evidence. Estimates should be set after G0, based on actual reuse and asset staffing.

| Phase | Tasks and deliverables | Dependencies | Acceptance / exit gate |
|---|---|---|---|
| P0 — Contract conformance and provider checklist | Encode the specified PoC contracts/seeds into schemas/manifests; prepare numerical fixtures; independently collect G0-B provider evidence | This merged plan | G0-A conformance; unresolved provider checks block only live adapters, not offline engine work |
| P1 — Desktop composition | Both viewport compositions; Cinematic/Analytical states; expanded HUD/inspector/voting layouts; keyboard map; one animated hawker; art tokens | G0-A for scene/event contracts | G1; worst-case panel combination remains readable with all stalls visible |
| P2-A — Offline engine and baseline | Establish pnpm workspace, pinned runtime/locks, TypeScript/Zod engine, observation projection, rules policy, adapter interfaces and failure mocks | G0-A | Numerical fixtures, inventory/cash/queue invariants, golden demand/hash tests and deterministic development-seed runs pass |
| P2-B — Replay and evaluation foundation | File-backed manifests/events/private and public snapshots; replay; JSON/CSV exports; tiny exact-oracle tasks | P2-A | Every boundary/final score reproduces without providers; exports recompute; independent oracle fixtures pass |
| P2-C — Live adapters | Verify Jev/Zoom/Pro individually; implement deadline, durable attempt state, quota/cost reservations and recovery | P2-A; G0-B per enabled adapter | Mock failure/crash/budget tests pass; enabled adapters return legal real smoke decisions; unavailable adapters disabled |
| P3 — Arena and asset pipeline | Render three stalls; customer/status mapping; atlas build/validation; animation state mapping; asset fallback | P1 + P2-B | G2; no visual event changes simulation; no missing/bleeding frames |
| P4 — Spectator controls | HUD tabs/collapse; inspector expansion/history; modes/preferences; keyboard/focus/reduced motion; no-run/error states | P3 | G3; complete mouse and keyboard journeys at both desktop sizes |
| P5 — Shared live service and voting | Supabase migrations, RLS/grants, worker lease/fencing, committed broadcasts, reconnect; voting windows/receipts/rate limits; uniform effects; admin pause/recovery/kill switch | P2-B + P4; P2-C for enabled live inference | Two+ viewers share one round without extra inference; restart and permission tests pass; voting boundary/idempotency tests pass; benchmark mutation rejected |
| P6 — Trial evaluation and exports | Freeze methodology/splits; target 30 clean and 6 exploratory stress paired seeds across enabled policies plus rules; JSON/CSV and JSONL/Parquet; dataset card | P2-B for offline methodology; P2-C for live campaign; P4 only for UI presentation | G4 scoped to declared trial manifest; clean uncertainty and descriptive stress results labeled; incomplete/unavailable combinations explicit; outputs reproduce; all failures retained |
| P7 — Public release rehearsal | Existing-host deployment, anonymous access, permissions, load/performance, browser coverage, runbook, offline fallback rehearsal | P3–P6 | G5; public spectator journey and operator recovery demonstrated |

### Source milestone mapping and future handoff

Preserve the original delivery intent: M0 maps to P0 plus P1 composition; M1 to P2-A/P2-B engine/rules/replay; M2 to P2-C provider integrations; M3 to P1/P3/P4 visuals; M4 to P5 live service/voting; M5 to P6 evaluation; M6 to P7 release and the later research expansion. The first implementation increment, when separately requested, is **P0 then P2-A and P2-B (source M0/M1)**: offline engine, rules, mock failure handling, replay and exports, with Vitest evidence and a local CLI demonstration. Live adapters, frontend, database, voting and deployment have their own later exits. This is a future handoff scope, not an instruction executed by this review.

After the trial report, expand stress evaluation to 30 seeds and later approximately 100 paired seeds per cohort and 300–500 validated static candidate cases only after additional capacity is allocated; report exact versus approximate labels separately. Publish Hugging Face artifacts only after release/licence review. Research expansion does not delay an otherwise valid clearly labelled desktop MVP.

Art production can proceed after G1 while offline runtime work proceeds after G0-A; provider evidence proceeds independently at G0-B. Art and offline replay merge at P3; live adapters join the service later. This dependency structure does not require additional agents or changes to staffing.

## 13. Acceptance test catalogue

| ID | Test | Required result |
|---|---|---|
| SRC-01 | Freeze a reference episode after engine implementation; compare it before/after presentation changes | Same validated actions, state hashes, economic totals, score and termination |
| SRC-02 | Audit mobile backlog and UI routes | No mobile-specific implementation tasks, gestures, or layouts remain |
| UI-01 | Open default view at 1920×1080 and 1366×768 | Three stalls, labels, status, and HUD controls visible without page-level horizontal scrolling |
| UI-02 | Expand HUD and open vote rail together at minimum viewport | All stalls remain visible; controls readable and operable; no essential overlap |
| UI-03 | Switch modes repeatedly during an active decision | No model redispatch, score change, vote loss, selected-decision loss, or run reset |
| UI-04 | Inspect an older decision while new decisions arrive | Pinned record stays stable; latest-count affordance updates |
| UI-05 | Display pending, invalid, timeout, fallback, and missing-usage decisions | Honest distinct states; no invented explanation, cost, or accepted action |
| A11Y-01 | Complete select stall → inspect → vote → change mode using keyboard only | Visible focus, logical order, no trap, focus restored after close |
| A11Y-02 | Use 200% zoom, reduced motion, and screen reader | Controls remain reachable; text summaries available; no decorative motion required |
| A11Y-03 | Disable character shortcuts; focus a text field | Typing and browser shortcuts work normally |
| ART-01 | Validate atlas metadata and all referenced clips | No absent frames, invalid rectangles, pivot drift, or unintended trimming |
| ART-02 | Inspect all scale steps and supported device-pixel ratios | Crisp art; no edge bleed, stretched proportions, or unreadable DOM labels |
| SIM-01 | Vary frame rate, spectator count, UI mode, and decorative seed | Identical authoritative result for the same simulation inputs/actions |
| SIM-02 | Replay recorded actions without network/provider access | Same per-boundary state hashes and final score |
| NET-01 | Duplicate, reorder, and drop streamed messages | Duplicates ignored; gaps detected; snapshot recovery restores authoritative state |
| NET-02 | Disconnect/reconnect during a vote and decision | Correct current state/receipt restored; no duplicated vote or committed action |
| FAIL-01 | Inject timeout, malformed output, unavailable provider, and illegal action | `fallback-2` applied and recorded; other stalls/UI remain usable |
| VOTE-01 | Submit just before/after the authoritative deadline | Only server-eligible votes accepted; UI explains closure |
| VOTE-02 | Send duplicates, change selection, create tie, submit no votes | Versioned deterministic rules applied once and logged |
| VOTE-03 | Vote during controlled static/sequential run | Server rejects mutation; benchmark state remains unchanged |
| VOTE-04 | Replay an interactive chaos run | Recorded effects apply at the original boundaries and reproduce outcomes |
| BENCH-01 | Execute static and sequential tracks for the four policies | Correct policy identities, baseline results, counts, failures, and separate track summaries |
| BENCH-02 | Recompute scores from exported decisions/events | Exact versioned scorer outputs; no renderer dependencies |
| BENCH-03 | Exact-oracle ties and approximate reference labels | All equivalent oracle actions accepted; approximate cases report agreement only |
| BENCH-04 | Check declared trial manifest, seed count, split leakage and matched conditions | Clean target 30; stress cap 6 with two of each shock if complete; actual paired counts and incomplete status explicit; held-out separation; identical exogenous schedules |
| SIM-03 | Action legality, stock conservation, cents accounting and tick boundaries | No negative illegal stock, duplicate service, undefined terminal accounting or frame-dependent outcomes |
| NET-03 | Kill/restart worker and allow an old lease holder to attempt commit | One authoritative tick commit; stale worker rejected; persisted state recovered |
| SEC-01 | Anonymous and unauthorized authenticated writes/read attempts | Authoritative writes, private traces and admin operations denied; sanitized public reads allowed |
| COST-01 | Add spectators and exhaust provider/campaign quota or budget | No per-viewer calls; reservations prevent overspend across shared pools; quota exhaustion applies labeled fallback; no upgrade/overage |
| OBS-01 | Inspect complete requests including nested history and metadata | No direct seed, future schedule, private ID or oracle leakage; stable opaque/provider IDs |
| LOG-01 | Inject secret-bearing headers and SDK errors | Credentials redacted from every trace/export/public record |
| REC-01 | Crash at reservation, intent, send, response and commit boundaries | At most one dispatch intent/send per tick/policy; uncertain charge retained; no recovery redispatch; late responses rejected |
| HASH-01 | Reorder object insertion and vary timestamps/latency | Canonical simulator hashes agree; state mutation changes hash; operational hashes are separate |
| SNAP-01 | Restart from private snapshot; commit during subscribe/snapshot handoff | Full deterministic recovery; no lost/duplicate public updates; private fields never exposed |
| DATA-01 | Load JSONL/Parquet in a fresh pinned environment | Expected schema, counts, splits, hashes, and non-secret contents |
| DATA-02 | Rerun frozen rules baseline | Identical decisions and results |
| PUB-01 | Open public link in a signed-out desktop browser | Anonymous viewing and late join work; no operator privileges or secrets |
| PUB-02 | Simulate load at the proposed PoC target | Performance budgets measured; no lost committed events or vote corruption |
| DEMO-01 | Interrupt live provider/network during rehearsal | Clear degraded state and explicit labelled replay fallback; no fake live continuity |

Test desktop Chrome, Edge, Firefox, and Safari versions selected and recorded at implementation time. Cover Windows and macOS for keyboard/focus behavior and at least one integrated-graphics machine for the performance profile. No mobile browser matrix is required.

## 14. Definition of done and handoff

The full subsequent implementation is complete when G0–G5 pass for the declared release scope, the desktop-only backlog replaces mobile work, all three named competitors and the rules baseline are retained, static and sequential evidence is reproducible, and the public spectator journey works in both viewing modes with accessible controls.

Required handoff artifacts: reconciled architecture/contract inventory; approved desktop compositions; asset sources/atlases/provenance; versioned manifests and schemas; deterministic demo/replay fixtures; benchmark runner and reports; Hugging Face-compatible export and dataset card; public app/run links; performance/accessibility evidence; operational runbook; and a documented rollback to the last known-good release and compatible data version once one exists.

**Trial campaign ceiling:** clean 30 × 120 = 3,600 requests per live provider; stress 6 × 120 = 720; total 4,320 per live provider or 12,960 for all three. Stress request ceiling is reduced 80% from 30 seeds. These exclude smoke/static requests and are ceilings, not verified trial allowances; forced WAIT lowers actual counts. The rules baseline uses no provider calls. The clean target can itself exceed a trial and cannot bypass quota checks.

**Remaining work:** implement and verify the specified contracts under G0-A; independently complete G0-B for each live provider. Action mechanics, utility weights, baseline thresholds, observation/demand rules and fallback behavior are now resolved PoC defaults. They are not yet implemented or empirically balanced. No app, generated assets, benchmark execution or deployment was produced by this planning update.
