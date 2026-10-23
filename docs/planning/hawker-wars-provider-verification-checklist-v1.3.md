# Hawker Wars — Provider Verification Checklist v1.3

**Status:** Not executed. Canonical G0-B source for the v1.3 plan. Separate from offline simulation, scoring and rules-baseline conformance. No API calls or application implementation are authorized by this document.

### Provider contract and verification checklist — G0-B

Preserve `DecisionProvider.decide(input)` with `DecisionInput` containing `roundId`, `tick`, `observation`, and `legalActions`. Preserve result fields: `provider` (`jev`, `zoom`, `zoom-pro`, `rules`), `action`, optional `probabilities`/`confidence`, `latencyMs`, `status` (`success`, `fallback`, `error`), optional `modelVersion`, `requestId`, and `usage`. Add attempt/validation diagnostics through versioned fields; keep provider output and applied fallback separately attributable. Requests use `observation-2`; deadlines, recovery and quota handling use `fallback-2`.

| Display name | Internal policy ID | Source integration intent, not a verified external API contract |
|---|---|---|
| TypeSafe Jev | `jev` | `@typesafe-ai/sdk`; investigate documented `systemOne()` / typed-choice integration for the pinned version |
| Zoom Decisions | `zoom` | HTTP adapter; verify availability and exact identifier corresponding to source candidate `zoom-decisions` |
| Zoom Decisions Pro; short label Zoom Pro | `zoom-pro` | Same adapter family; verify source candidate `zoom-decisions-pro` and entitlement |
| Rules baseline | `rules` | Local deterministic policy with frozen thresholds and no network calls |

The SDK method and candidate model IDs above come from the supplied planning document; no credentialed API test was performed in this review. Prior to integration, confirm current official documentation for authentication, endpoints, request/response shape, rates and supported fields. Boot checks validate configuration; mock contract tests run without secrets; enabled real adapters require a credentialed smoke test. Missing access disables that provider or selects an explicitly labelled fixture mode. Never replace unavailable Pro with another model under the Pro name.

Show confidence/probabilities only when actually returned with documented semantics. Do not estimate them from latency or invent missing fields; do not compare incompatible confidence definitions as a common calibrated metric.

Keep this checklist **separate from simulation readiness**. It is not marked complete by this planning task. Record evidence per provider; never put secret values in the checklist.

- [ ] Official API/SDK documentation URL, access date, pinned SDK version and supported runtime recorded.
- [ ] Exact model/endpoint ID, region, authentication method and required entitlement verified.
- [ ] Request schema supports the canonical observation/legal-choice contract; semantic input equivalence checked.
- [ ] Response shape, model/request identifiers, and any probability/confidence semantics documented; unavailable fields remain absent.
- [ ] Real credentials are supplied through server-side secret configuration, never the browser or fixture files.
- [ ] Quotas/rate limits and the common 4-second, zero-retry policy (including disabled SDK/transport retries and no redispatch of uncertain attempts) are compatible with the intended run; any changed policy receives a new manifest/version for all compared policies.
- [ ] Current pricing/cost estimation verified; explicit currency budget per run and maximum request count configured. Document a conservative per-request bound with enforced input/output limits; reserve currency and quota atomically before dispatch across shared pools. Retain reservations for uncertain charges. Unknown price or usable trial capacity disables dispatch.
- [ ] Trial requests/tokens/credits, remaining capacity, expiry, shared quota pools and entitlements recorded with checked date; smoke/static capacity reserved separately. No automatic upgrades or paid overages.
- [ ] Durable attempt reservation/intent/response/commit recovery verified: uncertain attempts never redispatch, late responses cannot overwrite fallback, and possible charges stay reserved.
- [ ] Complete provider request projection excludes seed-bearing identifiers, future schedules and private evaluator metadata. Credentials stay in runtime secret configuration; logs redact headers and secret-bearing SDK errors.
- [ ] Mock contract tests cover valid, invalid, illegal, timeout, rate-limit and unavailable responses.
- [ ] Credentialed smoke test confirms a real legal decision and records safe request/model metadata; no real call is made by this document update.
- [ ] Unavailable model/entitlement disables that adapter; no silent substitution under its display name.

G0-B is complete for an adapter only when its evidence is recorded. It does not require changing `poc-1`, `utility-1` or `rules-1` to accommodate an undocumented provider feature.



## Trial evaluation manifest — `trial-eval-1`

Target 30 paired clean seeds (1000–1029), subject to verified trial capacity. Cap initial stress at six paired seeds (1000–1005), two per shock under seed-modulo-3 mapping, at tick 60. Stage 1000–1002 first; continue 1003–1005 only when reserved quota permits, without outcome-based selection. Report stress descriptively as exploratory and disclose incomplete or unavailable combinations. Expansion requires additional allocated capacity.

Maximum sequential requests per enabled live provider: clean 3,600 + stress 720 = 4,320; across all three: 12,960. Smoke/static calls are additional. These are ceilings, not granted trial allowances. Forced WAIT lowers actual requests. Trial quota and currency limits always take precedence; rules-baseline tests use no provider calls.

## Evidence register

| Provider | Verification status | Evidence record | Live dispatch |
|---|---|---|---|
| TypeSafe Jev | Not verified | Not yet collected | Disabled until G0-B passes |
| Zoom Decisions | Documentation reviewed; account/smoke unverified | [Pinned official skill evidence](../providers/zoom.json) | Disabled until G0-B passes |
| Zoom Decisions Pro | Documentation reviewed; entitlement/smoke unverified | [Pinned official skill evidence](../providers/zoom-pro.json) | Disabled until G0-B passes |
| Rules baseline | No provider verification required | Offline `rules-1` conformance tests belong to P2 | No paid dispatch |

For each live provider, record documentation links, checked date, SDK/runtime version, verified model ID, region, safe smoke-test request ID, response-schema findings, verified pricing source, per-run and campaign currency caps, request/token/credit limits, remaining trial capacity/expiry, shared quota-pool identity, conservative request-cost bound, SDK retry configuration, crash-recovery evidence, and verifier. Never record credential values. A completed checklist is evidence of integration access, not evidence of benchmark quality.

**Zoom documentation update — 22 October 2026:** The user-supplied [official Decisions skill](https://github.com/zoom/skills/blob/9a18f14b5cebd3aa022ef1565e1dbdc5d315b193/skills/decisions/SKILL.md) documents the production endpoint, `x-api-key` scope and Standard/Pro aliases. This is partial documentation evidence; it does not complete the checklist or authorize live dispatch. Native usage-unit preservation requires an explicit versioned adapter contract extension; Hawker retains its four-second, zero-retry policy.
