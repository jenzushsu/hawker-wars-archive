# P5-D durable operator controls

This increment adds pause, resume and irreversible stop for existing rules-only exhibition rounds. A machine-to-machine Next.js endpoint authenticates a dedicated operator credential; PostgreSQL serializes controls with worker commits. It does not enable voting, provider dispatch or a live browser viewer.

## Boundary and recovery

Pause preserves the last committed simulator boundary and prevents new leases or commits. Pause and stop revoke the current lease and advance its fence. If a tick wins the database lock first, that tick is committed before the control; if the control wins, the old worker cannot commit. Resume preserves the simulator state and the five-second pacing constraint. The CLI exits on a paused or stopped result; resume does not launch a process, so the operator must invoke or supervise the worker again.

Stop is terminal for that round. It releases the single active-round slot without fabricating a completed round or a closing score. Starting a fresh round requires a new UUID through the existing trusted worker creation command. Completed rounds cannot be controlled, and clean/stress/replay/benchmark rounds and generic persistence fixtures are ineligible for this endpoint.

Every mutation requires the current `expectedRevision` and a fresh UUID `requestId`. A successful change increments `control_revision` independently of tick/sequence. Accepted requests are retained in private durable receipts. An identical retry returns the original receipt without reapplying the action; reusing an ID with different arguments is rejected. A retry receipt can describe an older control state, so read current status afterward. The server supplies the audit actor; clients cannot claim a different identity.

Controls do not add synthetic tick events. Public snapshots and trusted status/recovery expose `control_state` and `control_revision`; tick event sequences still equal tick + 1. A future viewer must refresh snapshots to observe control-only changes. The current browser remains an offline replay. Private operator identities and receipts are excluded from public projections.

## Operator endpoint

Apply all three checked-in migrations before deploying the matching server and worker. Older strict clients must be upgraded with the added metadata fields. Configure only on the server:

- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` for the intended environment.
- `HAWKER_OPERATOR_TOKEN`: a dedicated secret generated from at least 32 cryptographically random bytes, encoded as unpadded base64url (43–128 characters accepted).
- `HAWKER_OPERATOR_ID`: an audit label of 1–128 ASCII letters, digits, underscores or hyphens.

The endpoint is `POST /api/admin/rounds/control`, with `Authorization: Bearer <operator token>` and `Content-Type: application/json`. Use trusted operator tooling over HTTPS. Do not place this credential in browser storage, a URL, public configuration, source control or logs. Missing configuration disables the endpoint. This is a single configured operator principal, not a multi-user login or role-management system. Rotate/revoke access by replacing/removing the token in server configuration.

Read the current boundary and revision first:

```json
{"action":"status","roundId":"11111111-1111-4111-8111-111111111111"}
```

Then submit a control using that revision:

```json
{"action":"pause","roundId":"11111111-1111-4111-8111-111111111111","requestId":"22222222-2222-4222-8222-222222222222","expectedRevision":0}
```

`resume` and `stop` use the same shape. A conflict requires reading status and choosing a new request ID for a new intent. If the outcome is unconfirmed, retry the **identical** request with its original ID; do not invent a new request. Then read status. The server never retries a mutation automatically.

Only POST is supported. Authentication precedes body parsing and store creation. Cookies grant no authority, browser Origin headers are rejected, and no CORS permission is supplied. JSON requests are limited to 1 KiB and two seconds of body reading; database requests retain the bounded client timeout. Responses are uncached and errors omit backend payloads and credentials. Deployment-level request limits remain part of hosted acceptance.

## Validation and remaining scope

TypeScript and all 469 unit tests across 34 files pass, including 14 independent operator gateway cases. Local PostgreSQL lifecycle/permission checks pass, including a real two-session pause versus stale-commit race. Actual PostgREST validation passes through the authenticated handler and strict client: pause/resume/stop, receipt retries, HTTP 409 conflicts, lost acknowledgements, forbidden public writes and private audit isolation.

The production Next.js build passes with the dynamic operator route. A local production-server smoke confirms the homepage returns 200, an unconfigured operator endpoint returns uncached 503, and GET returns 405. These are local checks, not hosted deployment acceptance. The complete `pnpm check` passes: P0 contracts, 800 rules and 80 mixed engine episodes, and 24 archives with 72 replays and 72 report reloads. Behavioral references and static dataset hash `0e4e973c9e4c162354ab158b3127d1a7629d4f9f17b81233deecaaa6923341d7` are unchanged. The refreshed source-tree identity is `96dd3fe5fc0c0320bb749563aff6408cbcd3c363382da58f061ad09afa286622`.

All database tests use disposable local infrastructure; no hosted migrations or provider calls are part of this increment.

Remaining P5 work includes signed anonymous sessions, durable votes/receipts and paused deadlines, uniform audience effects, live snapshot/cursor/Realtime reconnect, viewer integration, multi-viewer/load tests and hosted acceptance. Stop prevents future database commits; it cannot undo an external request already sent. Before provider dispatch is enabled, its durable reservation/uncertain-attempt guards remain mandatory. This increment does not claim a global provider kill switch or a completed P5 exit.
