# Single four-policy campaign

The user requested one four-policy campaign after explicitly authorizing and
completing both Zoom smoke calls without verified request-charge bounds.
The selected private round is `d7f7da47-8b31-4465-8cf9-77773683da3f`, clean seed 7.
Voting and automatic round creation/repetition are disabled.

`HAWKER_CAMPAIGN_EXCEPTION_FILE` explicitly loads the reviewed single-round
approval. Without that environment variable, ordinary Zoom billing gates remain
closed. The manifest retains null verified Zoom charge bounds. The adapter and
ledger both reject dispatch for a different round, and each provider has at most
120 reserved attempts. Recoverable responses are reused; uncertain calls are
never resent.

Zoom uses a USD 0.001 operator allocation per request, not a verified maximum
charge. Both prior smokes receive retained USD 0.001 allocations as well. The
shared USD 0.25/run and USD 5/campaign accounting limits remain configured.
Reported token usage is priced at the published rates; if that estimate exceeds
an allocation, subsequent reservations use the higher exposure. This can stop
further calls but cannot guarantee a hard actual-charge cap without provider
billing bounds. Native usage, allowances and actual billed charges remain
separate. Jev keeps its verified USD 0.002753 reservation per request and
USD 0.34 campaign cap, including its prior smoke reservation.

The original ledger is amended in place with an audit entry. A separate one-use
Coolify bootstrap resource imports a SHA-256-pinned snapshot into the named
`muvfmjgpedffyk919kl40eid_provider-ledger` volume (the physical name
assigned by Coolify during provisioning) and sets private ownership for UID 1000. It refuses
any existing campaign directory. This provisioner is stopped and its snapshot
secret removed after successful import; it is never part of worker startup.
Retain the stopped bootstrap resource and its volume: deleting its storage would
remove the campaign ledger used by the worker.
The worker requires the existing external volume and never initializes storage.

After transfer, the local ledger is an archival copy and must not dispatch.
The Coolify volume is the sole authoritative writable ledger for the run. Any
future copy must preserve all records and use an explicit, reviewed handoff.

The hosted `multi_policy_worker` migration was applied and its protocol RPC
verified: service role allowed, anon denied. Advisors reported existing public
read-projection SECURITY DEFINER warnings and informational private-schema RLS
and vote-index notices; these are unchanged by this worker rollout. Public read
RPCs intentionally check published status and expose only allowlisted views.
See [Supabase function-advisor guidance](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable).

This Coolify installation rewrites external named-volume aliases. The worker
therefore binds the provisioned volume's existing host data directory explicitly,
with `create_host_path: false` in the source Compose file. Coolify renders this
as a short bind mount, so the existing-ledger startup check is the final guard
against missing storage. This host-specific mount must be reviewed if the
Docker data root or server changes. The worker still refuses missing ledgers;
it never creates a replacement budget history.

## Completed acceptance

The private seed-7 round completed on 2026-10-24 on Coolify at worker commit
`2afd3d78172c5246065afb832d924c602c352ad4`. It committed 120 decision turns
and one closing settlement, with all 121 event sequences present. Pause at tick 4,
a container restart while paused, and resume at tick 5 passed. The worker stays
idle after completion; no second round is scheduled.

| Policy | Final game profit | Utility | Served | Abandoned | Provider calls |
| --- | ---: | ---: | ---: | ---: | ---: |
| Rules | $311 | 29,790 | 116 | 2 | 0 |
| Zoom Pro | $261 | 22,955 | 101 | 11 | 103 |
| Zoom Standard | $226 | 18,390 | 98 | 14 | 96 |
| Jev | $106 | 700 | 46 | 66 | 105 |

These are single-seed exhibition results, not aggregate benchmark estimates.
Jev had one invalid-response fallback; Zoom had none. Jev, Zoom Standard and
Zoom Pro respectively had 15, 24 and 17 forced WAIT turns with no provider call.
The 304 new attempts plus the retained Jev smoke reconcile to 305 ledger records;
both Zoom smoke allowances are separate retained prior exposure.

Jev reserved $0.291818 including its prior smoke, below the $0.34 campaign cap.
Zoom allocated $0.199 for this run against its $0.25 run limit, and $0.201 including
both prior smokes against its $5 campaign limit. Reported campaign input usage
implies $0.00650979 for Standard and $0.01656920 for Pro at the published input
rates; these estimates are not invoices or verified maximum charges.

[Machine-readable evidence](evidence/four-policy-campaign-2026-10-24.json) contains
final database projections, ledger accounting, deployment identity and acceptance
checks. Both production and preview bootstrap snapshot entries were removed.
