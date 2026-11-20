# Restricted-network list read audit — 20 November 2026

## Confirmed code defects and fixes

| Surface | Finding | Change |
| --- | --- | --- |
| Administration users | Four browser database queries ignored errors; profiles/roles/memberships list shapes were outside the narrow access relay. Failed reads became empty successful results. | Authenticated same-origin directory read; all subquery errors propagate; explicit loading/error/retry states; paginated stable reads; user/site cache keys. |
| Administration worksites | Independent effect silently replaced failed reads with an empty list. | Included in the successful directory response for global administration. No partial directory is published when a dependency fails. |
| History | Weeks, audit and activity detail reads ignored errors. Broad history/detail reads were outside the existing relay. | Fixed server reads, same caller/RLS/password gate, separate loading/error/retry states and user/site cache keys. |
| Overview | Active-week query discarded its error, incorrectly suggesting no active week. Task summary read shape was not an immediate-task query covered by the relay. | Same-origin fixed week/task reads, error before the empty-week branch and retry. |
| Non-execution/unjustified | Task detail lists used unsupported direct read shapes; failures were already thrown. | Fixed server reads and scoped query keys; visible week-load failure. Computation/status rules unchanged. |
| Overtime weekly activity export | Direct task export read was outside the read relay; failed reads could leave an apparent zero-row summary. | Same-origin fixed read, same two statuses and source ordering; export disabled and error/retry shown on failure. |
| Overtime activity lookup | Week and activity query keys lacked actor/site; free-text task lookup was outside the narrow relay. | Scoped keys, fixed server lookup, 20-result cap, 300 ms debounce and visible error/retry. |

## Scope and security

The six server read functions use `context.supabase`, which carries the caller's
JWT. No service-role client, database migrations, permission changes or writes
were introduced. Existing RLS remains in force. Profile approval/password access
are verified; directory reads also require admin role, local-admin membership or
global-admin identity derived from the caller's profile. Local directory output
is restricted to current-site memberships, including removal of other-site
membership details. Week task reads require the requested week in the actor's
current site and still use existing RLS.

Only fixed read shapes are exposed, not arbitrary table/SQL/RPC proxying. Pages
read at most 500 rows per ordered request, with total deadlines. Failure in any
required subquery is not returned as successful empty data. A failed response
never causes writes, deletions, permissions resets or automatic task updates.

## Other reviewed surfaces and limits

* Main shift-change/day-off lists already use authenticated server functions
  and explicit error states. Employee list reads are explicitly site-scoped and
  covered by the existing narrow read relay.
* Main overtime/employee list reads are site-scoped and covered by that relay;
  the checks above target their separate activity lookup/export dependencies.
* Fiocruz activity rows/facets/counts have narrow relay coverage and error states.
* Weekly RS, HH availability, their evidence/archive details and journey helpers
  still contain direct RPC/table reads (and direct writes). Several show explicit
  errors rather than silently empty lists. This patch does not claim complete
  Petrobras-network coverage of those flows or modify RS calculations/writes.
* This is a source/code review, not proof that Petrobras blocked a specific
  request on the affected computer. There is no device-level HAR or authenticated
  Petrobras-network reproduction for the new version yet.

## Follow-up: remaining RS/HH operations

The subsequent RS transport patch routes all direct database calls in the eleven
reviewed RS/HH/curve/evidence/archive/SAP-load-history components through the
same-origin server. The direct-read limitation above describes the first patch,
not the completed follow-up. Eighteen exact RPC names have per-operation strict
schemas; weeks and capacity journey have separate fixed table operations. Four
existing RPC mutations (availability save, close, reopen, extend deadline) and
journey writes retain caller JWT/RLS and the original DB authorization, version
checks, audit triggers and calculations. There is no service-role client,
arbitrary table/SQL/RPC API, or automatic retry of a mutation. Unknown outcomes
tell the user to refresh/check the saved state before another attempt.

Journey read errors now persist visibly with a retry action. Unknown people
equivalents are displayed as unavailable, not measured zero. The adapter is lazy,
forwards cancellation and performs one request even if the same result is
awaited twice. Metadata-only database inspection checked existing RPC signatures;
no closures, availability rows, journeys or real tasks were written for testing.

Final follow-up validation: 234 Node tests, 71 Bun tests, TypeScript and production
build passed. This improves HTTP access resilience; it does not identify the
Petrobras proxy/firewall/DNS policy or prove WebSocket availability on that network.

## Validation

TypeScript passed; production bundle passed; 231 Node tests and 64 Bun tests
passed, with the locked production SDK used for transport tests. New tests cover
approval/administration rules, local/global directory scoping, missing membership,
unintended profile-field exclusion, fixed read targets, error propagation,
pagination/deadlines and client cache/error-state wiring. No real task/account
was modified for testing. Deployment and on-device verification remain separate.
