# Provider research evidence — P0

**Latest status — 23 October, 07:40 UTC:** the user-approved Jev smoke passed on `jev-1.13.0`: legal action COOK in 439 ms, one request and zero retries. Its full USD 0.002753 reservation is retained under the separate USD 0.003 single-test cap, leaving no capacity for another request. No Jev evaluation campaign is authorized. Zoom remains disabled pending maximum-charge evidence and smoke verification. See [activation status and commands](activation.md). The research records below preserve earlier evidence and are not live configuration.

Checked 22 October 2026 (Asia/Singapore). These files record read-only research, not runnable provider configuration. `provider-research-1` is an evidence-document format; executable provider readiness is governed by the shared contracts and the [canonical checklist](checklist.md).

| Provider | Evidence | G0-B | Dispatch |
|---|---|---|---|
| TypeSafe Jev | [jev.json](jev.json): official published SDK 0.7.0 metadata, README and integrity-verified distribution inspected | Incomplete | Disabled |
| Zoom Decisions | [zoom.json](zoom.json): official Zoom skill/reference reviewed; endpoint/auth/Standard alias documented; account access unverified | Incomplete | Disabled |
| Zoom Decisions Pro | [zoom-pro.json](zoom-pro.json): official Zoom skill/reference reviewed; Pro identifier documented; account entitlement unverified | Incomplete | Disabled; no substitution |
| Rules baseline | Local `rules-1` comparator | Provider verification not required | No network dispatch |

The TypeSafe SDK defaults to **two retries** and a **10-second attempt timeout**; future adapters must set `retry.maxRetries=0`, enforce the shared four-second deadline and pass cancellation. Its default `jev-latest` alias is not a frozen version. These are published software facts, not proof the account can call that endpoint/model.

The SDK documentation destination `docs.typesafe.ai` returned a session-proxy HTTP CONNECT 403. Read-only npm and publisher GitHub source remained accessible. No network settings were changed and no API endpoint was contacted. Add the documentation domain through supported environment settings when official-page access is needed. The future API destination `api.typesafe.ai` comes from SDK source and remains untested.

Initial P0 research reported no secret/runtime-variable bindings. The latest observation now shows `ZOOM_AI_SERVICES_API_KEY` ready and present; its value was not inspected and authentication was not tested. Do not request a duplicate key.

The [official Zoom Decisions skill](https://github.com/zoom/skills/blob/9a18f14b5cebd3aa022ef1565e1dbdc5d315b193/skills/decisions/SKILL.md), supplied by the user and read with its contract/scenario references, documents `POST https://api.zoom.us/v2/aiservices/decisions/decide`, `x-api-key` from `ZOOM_AI_SERVICES_API_KEY`, and scope `aiservices:write:decide:admin`. Standard requests use `zoom-decisions-standard` (response may normalize to `zoom-decisions`); Pro uses `zoom-decisions-pro`. This is documentation evidence, not our credentialed test. Source revision and SHA-256 digests are recorded in both evidence files.

Hawker uses one named `choice` question over legal actions; at least two are required, so sole WAIT stays local. No separate confidence is expected. Native `usage` units are not automatically tokens or cost and need an explicit adapter contract extension. The general skill suggests transient retries; Hawker's existing `fallback-2` four-second/zero-retry policy takes precedence.

The user now confirms Standard/Pro access and required key scope, with a reported rate limit of 80 requests/second. These are user-reported facts pending account smoke validation. Remaining Zoom requirements are pricing/usage units, shared rate-limit scope, overage behavior, enforcement of approved shared USD caps, mock adapter/recovery tests and a credentialed smoke test. `verifiedModelId` remains null until our account-specific test. Do not substitute another model under the Pro name.

Trial campaign ceilings are 30 clean + six stress episodes, at most 4,320 requests per enabled provider; verified remaining quotas override those ceilings. Smoke and static calls require their own reserved capacity. No inference calls, account API calls, provider installs, paid dispatch or smoke tests were performed during this research.

## Account input update — 22 October 2026

[Recorded user data](zoom-account-input.json) preserves all supplied non-secret fields and provenance. The user subsequently clarified that no allowance or expiry applies, confirmed by Zoom. This user-reported clarification does not establish zero pricing or authorize unlimited spend; the user has now approved shared Zoom-only caps recorded below. The supplied [pricing page](https://www.zoom.com/en/products/ai-services/decisions-api/#pricing) returned HTTP 403 from this environment; the user then supplied its pricing screenshot. [Pricing evidence](zoom-pricing.json) records Standard USD 0.042 / 1M tokens and Pro USD 0.10 / 1M tokens, with billing based on total tokens. Native API usage-unit mapping and maximum billed-token bounds still need verification. Documentation access requires `www.zoom.com`; the actual API route remains untested. Live dispatch remains disabled and no trial requests were made.

## Screenshot pricing and illustrative campaign estimate

At an **assumed 5,000 billed tokens per request**, 36 episodes × 120 requests = 4,320 requests per Zoom model. Standard would be USD 0.9072 and Pro USD 2.16, totaling USD 3.0672. A paired episode would be USD 0.0852 for both models. These are illustrative estimates, not measured usage or enforceable bounds. They exclude Jev, smoke/static work and any unshown fees/taxes.

**Approved Zoom-only caps:** USD 0.25 per paired episode and USD 5.00 for the entire Zoom campaign, including smoke/static work. [Budget approval](zoom-budget-approval.json) records the user's confirmation. Both models share these caps; each does not receive its own allowance. Jev is excluded. Spending must be reserved across both models and stop at either cap, with no automatic increase or reset.

Approval is persisted and local SQLite reservation enforcement is now implemented and tested; see [activation status](activation.md). The P0 trial manifest remains dispatch-disabled with its all-policy budget unset; it must not apply this Zoom-only allowance to Jev. The new runtime shares the approved limits across both Zoom models. Larger requests could exhaust either cap earlier. API network access, verified maximum charges and credentialed smoke evidence still precede live dispatch.

## Jev freemium update — 22 October 2026

The user reports freemium use and has added `TYPESAFE_API_KEY`. The variable is present and the runtime binding exists, with platform readiness reported as unknown; no value was inspected or authentication request made. [Jev account input](jev-account-input.json) records the plan tier and remaining free allowance/reset/rate-limit/model/overage evidence. No duplicate credential is needed. Freemium is not assumed unlimited or automatically free after quota exhaustion. No Jev paid spend or upgrade is authorized; the Zoom budget is separate. Live Jev dispatch remains disabled pending the remaining G0-B checks.

## Jev pricing estimate and organization rate limits

The user estimates USD 0.042 per million **input** tokens. The account screenshot documents **80 requests/second** and **100,000 input tokens/second**, shared by every key in the organization, including simultaneous requests. These are throughput limits, not the free-tier allowance. Future throttling must account for both limits and other organization traffic; at 5,000 input tokens/request the token limit alone allows at most 20 requests/second before other traffic.

[Pricing evidence](jev-pricing.json) records an illustrative input-only campaign cost: 4,320 requests × 5,000 input tokens × USD 0.042/1M = **USD 0.9072** (USD 0.0252 per episode). This excludes output/other billing units, smoke/static work and fees, and does not apply unknown freemium credits. The price remains a user estimate, not a verified full-cost bound or spending authorization. Official billing/free-tier terms, model identity, adapter tests and smoke evidence remain outstanding. No paid Jev budget has been approved; live dispatch remains disabled.

## Jev unknown details accepted

The user confirmed the remaining details are unknown. Preserve the missing model/billing/free-tier terms explicitly and defer their verification until live integration; no repeated account-information request is needed for offline development. Live Jev calls remain disabled and no paid spend is authorized. G0-A stays complete and P2-A can proceed independently.
