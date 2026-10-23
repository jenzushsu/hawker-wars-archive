# P0 G0-B status

P0 prepares the [canonical provider checklist](providers/checklist.md) and [evidence register](providers/README.md). G0-B remains incomplete for Jev, Zoom Decisions and Zoom Decisions Pro. Live dispatch stays disabled for all three. This does not block G0-A or offline P2 work.

Public SDK research confirms that `@typesafe-ai/sdk@0.7.0` exists, requires Node.js >=22, and provides `TypeSafeClient.systemOne()` with typed choices. The inspected published artifact matched the registry SHA-512 checksum. SDK default retries/timeouts conflict with the intended common policy and require explicit overrides. Account-specific exact model IDs, pricing, trial quota/expiry, semantic-equivalence tests and credentialed smoke evidence are still absent. The user-supplied official Zoom skill now documents the production endpoint, x-api-key scope, Standard/Pro model identifiers, alias normalization and response quirks. These documentation facts are pinned in the Zoom evidence files; account-specific access and smoke verification remain incomplete. See evidence files for precise sources and limitations.

A documentation-host proxy denial is recorded for `docs.typesafe.ai`; no API access conclusion is drawn from it. No network configuration or credentials were changed. No inference or account API calls were made and no trial requests were consumed.

## Handoff

1. Use the recorded official Zoom skill/reference as the Zoom contract source; complete independent catalog/account checks and obtain the remaining Jev documentation evidence.
2. Record exact pinned endpoint/model, runtime/auth/region/entitlement, pricing, remaining trial constraints and a conservative enforceable request bound.
3. Implement mock contract tests and attempt/quota recovery before enabling live requests.
4. When implementation scope includes credentialed verification, run one legal-decision smoke test using server-side configuration and record only safe metadata.
5. Enable an adapter only when every G0-B requirement passes; unavailable Pro remains disabled with no replacement.

## Latest account input — 22 October 2026

The user reports Standard and Pro access, required key scope enabled, 80 requests/second and USD billing. The current `ZOOM_AI_SERVICES_API_KEY` binding is ready/present; no value was inspected or authentication call made. [Account input](providers/zoom-account-input.json) records the user-confirmed absence of allowance/expiry and records approved shared Zoom-only caps of USD 0.25 per paired run and USD 5 per campaign; shared rate-limit scope and provider overage behavior remain unresolved. The official pricing page returned HTTP 403; a subsequent user screenshot supplies advertised rates: Standard USD 0.042/1M tokens and Pro USD 0.10/1M tokens. See [pricing evidence](providers/zoom-pricing.json) for illustrative estimates and unresolved billed-token bounds. Live dispatch remains disabled until the remaining G0-B requirements pass.

Budget approval is recorded in [zoom-budget-approval.json](providers/zoom-budget-approval.json). It includes smoke/static spend, excludes Jev, and does not by itself implement enforcement or enable any provider.

## Jev account update — 22 October 2026

`TYPESAFE_API_KEY` now exists in the process and runtime bindings; platform readiness is unknown and authentication has not been tested. The user reports freemium use. See [Jev account input](providers/jev-account-input.json) for the distinction between observed key presence and unverified quota/model/overage terms. No credential value was inspected, no live call was made, and no Jev paid spend was authorized. This does not block offline P2-A.

Jev rate-limit evidence now records 80 requests/second and 100,000 input tokens/second shared across all organization keys. The user estimates USD 0.042 per million input tokens; [pricing evidence](providers/jev-pricing.json) keeps that estimate separate from official pricing and the unverified output/free-tier terms. No Jev paid spend or live dispatch is enabled.

The user has confirmed the remaining Jev details are unknown. Information gathering is paused; no additional account input is needed to proceed with offline P2-A. G0-B remains incomplete for live Jev, with dispatch disabled and paid spend unauthorized.
