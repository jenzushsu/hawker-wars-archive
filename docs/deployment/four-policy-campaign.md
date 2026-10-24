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

Coolify normalizes underscore aliases when rewriting volume mounts. The worker
uses the hyphenated `campaign-ledger` alias and an explicit external physical
volume name to attach the provisioned ledger rather than create an empty volume.
