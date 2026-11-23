# SAP/employee read performance follow-up

## Measured defect

The relevant ordered indexes already existed. Under an approved authenticated caller's existing RLS, SAP row reads and employee lists repeatedly evaluated authorized-worksite membership per returned row. A caller-scoped execution plan returned 750 SAP rows in 979.108 ms and 611 active employees in 539.875 ms. No row values or account credentials were exported as evidence.

## Narrow correction

Migration `20261123140000_read_scope_initplans.sql` adds a parameterless STABLE helper that enumerates worksite IDs using the *same* `can_access_worksite(auth.uid(), id)` predicate. It does not accept a user ID, return employee/task contents, cache a grant between requests, change roles or bypass the restrictive password gate. Its definer scope reads only the worksite catalog while applying the original authorization function; anonymous execute is revoked.

Three existing SELECT policies use an uncorrelated worksite-scope subquery. SAP's caller-only `can_view_activity_sap` and `can_access_sap` checks also become uncorrelated scalar subqueries. Employee role membership retains the exact original five-role list. No write policies, table grants, business calculations, row data, stored hours, indexes or application UI change.

## Validation before application

- Two independent migration rehearsals used transactions that were rolled back. Same caller and filters returned the same 750/611 rows, with measured database execution of 4.048 ms for SAP and 26.122 ms for employees.
- The scope helper was compared against the original direct worksite predicate for all 163 existing profiles across all three existing worksites (489 comparisons), including the existing mix of roles/statuses/memberships. No difference was found. Anonymous scope was empty and anonymous function execution denied.
- `tests/read-scope-equivalence.sql` keeps that read-only comparison reproducible; no test accounts, task writes or role grants are used. Static tests prevent user-supplied identity parameters, broad policy replacement, write-policy changes and role-list expansion.

These are individual execution-plan samples, not an SLA, benchmark under peak concurrency, total browser latency, or proof that all disconnections are resolved. The old/new plans do not establish that this overhead caused every login failure. Current statement statistics are cumulative and must not be confused with time-window-specific browser samples.

## Current diagnostics

The new independent collector has received at least one real diagnostic tagged with deployed release `9eefbc78989112938c3274f9ee2a218f1ce6706d`, including client occurrence time and visible/online metadata. Generic realtime transport failures still exist. Additional legacy/queued diagnostics arrive without release identity; they are not assigned to the current release. A frameless runtime event without release identity cannot establish a new code regression by itself.

This is a database-only optimization; after application it takes effect on subsequent reads without republishing frontend assets. Authenticated Petrobras end-to-end delivery remains to be verified in actual use. No automatic credential reset, manual SDK refresh loop, unfiltered subscription, load test or infrastructure upgrade is part of this change.

## Applied verification

The migration was applied in a transaction with a two-second lock-acquisition limit and a 15-second statement limit. Unrelated policies were checked for unexpected changes. Both tables have validated foreign keys to the worksite catalog, so replacing the per-row check with the catalog-derived authorized ID set does not drop orphan-worksite rows that the original predicate would have allowed.

Subsequent authenticated plans returned the same 750 SAP rows in 3.969 ms and 611 employee rows in 28.836 ms. These are verification samples, not a guarantee for other imports, users, database load or browser networks. All 252 Node regression tests passed. The frontend deployment remains unchanged; no extra publication was needed for this database change.
