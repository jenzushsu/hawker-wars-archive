# Adapter activation status

## Zoom smoke exception completed — 2026-10-24 UTC

The user explicitly instructed “skip 1. proceed 2.”, waiving verified maximum
charge evidence for the two requested smoke calls. See
[exception approval](zoom-smoke-exception-approval.json),
[Standard receipt](zoom-smoke-result.json) and [Pro receipt](zoom-pro-smoke-result.json).
Exactly one text-only opening-state request was sent to each model, with no
retries. Both returned legal COOK decisions and 1,482 input tokens. Standard
returned its canonical `zoom-decisions` identity; Pro returned
`zoom-decisions-pro`. Measured end-to-end latencies were 1,397 ms and 648 ms.

Intent was durably recorded before each POST in the retained local
`results/zoom-smoke-exception-2026-10-24` audit directory, and results were saved
before updating runtime receipts. Existing intents are never redispatched.
These exception attempts are outside the verified-cost ledger and must be
reconciled before future Zoom campaign dispatch. Their actual billed charges
remain unknown; native usage is not an invoice. Existing budget caps remain
unchanged, and no maximum request cost has been invented.

Successful credentialed smoke evidence is now recorded for all three providers.
The normal four-policy worker still requires Zoom billing bounds; the exception
does not authorize or enable a campaign. Earlier sections below are historical.


## Approved Jev campaign — 2026-10-24 UTC

The user approved the proposed USD 0.34 Jev campaign cap for one comparison,
including the prior smoke, and explicitly retained Zoom's USD 0.25/run and
USD 5/campaign limits. See [approval](jev-campaign-approval.json) and
[applied ledger amendment](jev-campaign-amendment.json). The existing local ledger
now retains its original attempt and USD 0.002753 reservation under the larger
Jev cap. Jev readiness checks pass; no new inference was made.

The explicit budget-amendment operation preserves attempts, run totals, pool
assignments, request bounds and dispatch timestamps, records an audit row, and
invalidates old worker handles. It never runs at startup. Stop workers before
amending and reopen with the new configuration identity afterward.

Both Zoom smoke commands still return `maximum-request-charge-unverified` with
zero network calls. The official API reference was fetched again; it specifies
input tokens and output question counts but no numeric maximum request charge.
The existing spending limits cannot yet be enforced against an unbounded charge.
This is partial activation: the four-policy comparison has not run.


## Multi-policy worker readiness — 2026-10-24 UTC

The four-policy worker is implemented and locally validated with mocks. A Jev
smoke receipt no longer makes live campaign mode ready: the existing approval
is smoke-only, and live mode requires explicit campaign scope. Zoom still lacks
verified request-charge bounds and bounded smoke receipts. No new provider
inference was made. See the [Coolify multi-policy runbook](../deployment/multi-policy-worker.md)
for deployment prerequisites and retained-ledger requirements. Earlier entries
below describe the evidence available at their recorded dates.


23 October 2026 (UTC).

The user requested activation of Jev, Zoom Standard and Zoom Pro. Runnable adapters, a persistent local reservation ledger and smoke commands are now implemented. **Jev's single approved inference smoke passed.** Its activation configuration has a valid receipt, but the retained single-test budget cannot fund another request. Zoom remains disabled pending maximum-charge evidence and its own smoke tests. This is partial P2-C implementation, not a live benchmark campaign or the complete phase exit.

## Successful Jev smoke — 07:40 UTC

The user approved the proposed separate **USD 0.003 single-test cap**. The [approval record](jev-smoke-approval.json) was saved before initializing the ledger or dispatching. The exact prepared request was checked against its payload hash.

One request to `jev-1.13.0` returned the legal action **COOK** in **439 ms**, with request ID `req_01a167b42948727db24105a76abd0efa`. The provider reported **1,969 input tokens and 49 output tokens**. There were no retries. The response, native usage and request ID were persisted and independently read back from the ledger. See the [smoke result](jev-smoke-result.json).

The full **USD 0.002753 reservation remains retained** against the USD 0.003 cap. Only USD 0.000247 remains, insufficient for another reservation; additional request capacity is zero. The published input-token rate implies USD 0.000082698 before free credits or taxes, but this is an estimate, not a confirmed invoice charge. No reservation was refunded from that estimate. Zoom's budget was untouched.

Jev's `liveDispatchEnabled` configuration readiness can now be true because a validated smoke receipt exists; it does not mean spending capacity remains. The ledger still rejects new requests. A paid evaluation campaign or larger Jev allowance has not been approved. Freemium terms remain unknown.

## Prepared Jev smoke — historical plan before approval

Jev is now explicitly configured as **`jev-1.13.0`**, the documented stable version, rather than a moving alias. Its official pricing is USD 0.042 per million input tokens with free output tokens. The default per-request context is 64k; using 65,536 as a conservative ceiling gives `ceil(65536 × 0.042) = 2753` micro-USD, or **USD 0.002753**, before any free credit. The adapter sends no long-context opt-in header. See [billing-bound evidence](jev-request-bound.json).

The [concrete smoke plan](jev-smoke-plan.json) contains the exact public opening-state request, legal choices and payload hash. It permits one request, zero retries and a four-second deadline. A proposed separate **USD 0.003** run/campaign cap fits one full reservation and cannot fund a second. This proposal is not approved spending; `jevSpendApproval` remains null and no campaign ledger has been initialized. Existing Zoom approval does not cover Jev. A paid evaluation campaign is outside this proposal.

Newly reviewed TypeSafe SDK documentation identifies the request-ID header as `x-typesafe-request-id`. The adapter now reads and validates it, rejects conflicting or credential-reflecting metadata and persists it for recovery. Six new regressions cover that behavior and the one-request spending cap. TypeScript and all **60 provider tests** pass with mocked transport; no inference has been sent.

Zoom's newly accessible official reference again confirms that output units are question counts, while its numeric token ceiling is not specified. Its verified-charge gate remains closed.

## Latest validation — 07:25 UTC

The environment now reports the network policy as enforced and both credential bindings as ready. Rechecking authenticated Jev **GET `/v1/models` returned 200 OK**, listing `jev-latest` and `jev-preview`. This resolves the earlier 401. No credential value was printed or copied, and no inference call was made.

This verifies the Jev key for model-list access. It does not verify a pinned model's inference behavior, free allowance or overage policy. Zoom credential delivery is ready, but no credentialed inference smoke has passed. The maximum-charge and smoke gates remain in force. See [validation evidence](validation-2026-10-23.json).

## Earlier verification — 07:18 UTC

The saved network configuration has been applied. Both API hosts are reachable through the managed proxy; the earlier CONNECT 403 blocker below is resolved. Documentation on `developers.zoom.us` and `docs.typesafe.ai` is now accessible.

An authenticated **GET `/v1/models` to Jev returned 401 Unauthorized**. This was a read-only account check, not an inference call. Correct or rebind the existing `TYPESAFE_API_KEY` through environment settings, then retry that GET. Do not paste credentials into chat. Presence of the variable alone does not establish valid authentication.

Jev's official model documentation confirms USD 0.042 per million input tokens, free output tokens, default 64k per-request / 32k per-question context, stable alias `jev-latest` → `jev-1.13.0`, and preview alias → `jev-1.14.0`. Long context requires an explicit header that Hawker does not send. These public facts resolve the earlier undocumented price/model candidates, but do not establish this account's entitlement or free allowance/overage terms. No paid Jev budget has been approved.

Zoom's official API reference specifies input units as tokens and **output units as the number of submitted questions**. Do not sum those fields as total billed tokens. The reviewed reference still gives no numeric maximum input-token limit or complete maximum-charge bound. No credentialed inference smoke was attempted. The marketing pricing URL redirects to `zoom.us/syncStatus`, which remains blocked; the supplied screenshot prices remain the pricing evidence.

See [dated verification evidence](verification-2026-10-23.json) for source hashes and sanitized account-check results. There were zero inference calls. Remaining steps are correcting Jev authentication, confirming Jev's enforceable free allowance or a separately approved spend limit, and establishing Zoom's maximum charge before bounded smoke tests.

## Earlier activation attempt — historical evidence

- `ZOOM_AI_SERVICES_API_KEY` and `TYPESAFE_API_KEY` are present. Values were not printed or copied. Current platform readiness is unknown; authentication remains untested.
- Unauthenticated HEAD requests to `api.zoom.us` and `api.typesafe.ai` both returned proxy CONNECT **403**. No inference POST reached either provider.
- A cloud configuration draft was saved with `api.zoom.us`, `api.typesafe.ai`, `developers.zoom.us`, `www.zoom.com` and `docs.typesafe.ai`. Existing package-manager presets and credential bindings were preserved. The draft must be applied through environment settings before connectivity can be rechecked; saving it did not change this running machine.
- Zoom's advertised total-token prices and existing USD 0.25 shared paired-run / USD 5 shared campaign caps remain recorded. The supplied official skill and reviewed official quickstart do not establish a maximum billed-token/request bound or guaranteed native-unit billing conversion. An input byte limit or four-second timeout is not a maximum charge. `maximumRequestCost` therefore remains null.
- Jev's exact account model, enforceable free quota/overage behavior and complete charging bound remain unknown. No paid Jev budget is authorized. Its separate `jevSpendApproval` stays null; it cannot spend from Zoom's pool. A free-only quota implementation requires verified free-tier terms and remains outstanding.

## Implemented behavior

`packages/providers/src/wire.ts` builds semantically identical canonical observations, objectives and public rules for all providers, with provider-specific typed choice wrappers. Jev's wire shape was checked against the integrity-verified published SDK 0.7.0. Zoom follows the [user-supplied official skill](https://github.com/zoom/skills/blob/main/skills/decisions/SKILL.md). Pro cannot silently return Standard. Sole WAIT is applied locally.

The adapter captures the observation before awaiting work, rejects unverified activation/billing, reserves before sending, writes a durable dispatch intent, and makes at most one POST with a shared four-second deadline covering the response body. It disallows redirects, bounds response size, aborts late work, validates legal actions and returns an attributed rules fallback on failure. Provider errors and credential reflections are excluded from results. Native usage is retained without treating unknown units as token counts or actual cost.

The SQLite ledger uses private file permissions, full synchronous transactions, unique `(run, tick, provider)` attempts and atomic shared budget counters. It preserves the full conservative reservation after success, error, uncertainty and restart; reserved totals are **not measured costs**. Known responses and native usage can be recovered without another request. Uncertain attempts are never resent. Missing, replaced or corrupt storage fails closed; the normal smoke path never creates or resets a ledger. Both Zoom models share a conservative limit of two dispatches per rolling second, allowing a simultaneous pair. This coordinates only this application, not other traffic in the organization.

These are local decision-attempt guarantees. Multi-host worker fencing, hosted simulation commits/recovery, complete live episode integration, provider billing reconciliation, Jev free-quota enforcement and a paid campaign are not implemented or claimed here. The offline engine and original manifests remain unchanged.

## Commands

```sh
pnpm providers:status
pnpm providers:init-ledger
pnpm providers:smoke zoom
pnpm providers:smoke zoom-pro
pnpm providers:smoke jev
```

`providers:status` prints non-secret readiness and exact blockers without network calls. `providers:init-ledger` refuses initialization until a provider has a verified request bound; when ready, it creates the one retained `results/live-provider-campaign` directory and refuses overwrite. Never delete or replace that directory to replenish a campaign budget.

Smoke commands use Node's supported `--use-env-proxy` switch and existing CA trust. They validate the configuration and network snapshot before making a request. Each provider's smoke uses a stable shared run ID and tick, so rerunning recovers the recorded result or refuses a duplicate uncertain attempt. A successful validated receipt records requested/returned model and request ID; this does not prove immutable model revision or provider region. Smoke is not part of `pnpm check` and is never triggered by installing packages or reading status.

The runtime manifest records the activation request separately from verified readiness. Do not fill missing cost/model/allowance evidence with estimates or change historical P0 manifests to claim G0-B success. After network configuration is applied, review official billing bounds, complete the missing provider terms, then run the bounded smoke commands. Account smoke, not an enabled-looking flag, establishes real access.

## Validation

The full unit suite passes **322 tests across 16 files**, including 54 new provider tests, with TypeScript checking. Tests cover semantic projection, legal/model validation, missing billing gates, sole WAIT, redirects, timeouts including stalled bodies, no retries, credential redaction, durable result recovery, retained uncertain charge, shared caps and concurrent SQLite reservations. The blocked Zoom smoke and ledger-init commands were executed and exited with status 2, reporting the unresolved prerequisites without creating a campaign ledger or making inference calls. This is verified fail-closed behavior, not a passed credentialed smoke.
