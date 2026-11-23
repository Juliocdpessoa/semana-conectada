# Reliability corrections — 23 November 2026

## Scope

Functional follow-up to `reliability-sweep-2026-11-23.md`. No account reset, operational task edits, business-calculation changes, mass refresh/save replay, generic service-role proxy, generated authentication edits or Lovable AI.

## Access

- New application-owned identity middleware uses the same caller/public-key client and `getClaims(token)` verification as the generated middleware. It rejects non-bearer/invalid token shapes and elevated configuration keys. Network-backed auth/claims calls have a five-second abort bound; request/handler cancellation propagates to caller-scoped reads. Generated client and middleware files remain unchanged.
- The password access-state RPC has a five-second bound. An RPC/network failure no longer asks the user to reset their password. A verified `required` state still demands password change, missing/denied states still fail closed. Existing password-reset handlers retain their authorization and audit behavior.

## Independent diagnostics

- New POST-only `/api/public/nexo-diagnostics` bypasses global server-function session attachment. It accepts only a strict diagnostic schema, JSON, a capped 8 KiB body, a two-second body deadline and same-origin browser requests. No data-reading or arbitrary RPC/URL forwarding endpoint is added.
- Identity is optional: an in-memory caller bearer, if available, is verified server-side with a 1.5-second auth network deadline. Actor IDs are never accepted from clients. Identity verification failure can still record an unassigned event. The existing DB recorder retains deduplication, six/client/ten-minute and global rate caps, retention and admin/worksite read policies.
- The client performs a cancellable HTTP call with six-second deadline. It does not call getSession, refresh, clear storage, or persist bearer tokens. The legacy server-function collector remains available for already-open older clients.
- Nullable metadata adds client occurrence time, build commit (or explicit `unavailable`), tab visibility and online status. Receipt time remains authoritative and separate. Client timestamps are accepted only within a bounded past/future window; metadata is untrusted and cannot authorize access. Older queued events are not relabeled with the current release.
- Vite embeds `git rev-parse HEAD` when available; builds without git explicitly remain unidentified rather than claiming a release. No credentials are read for build identity.

## Collaboration

- Weekly activity channel now requests all change kinds with the existing week filter; audit/history invalidation uses new or old row ID. The SDK/RLS limitations around DELETE filtering are not bypassed by a global unfiltered subscription.
- Both weekly and continuous lists use opt-in healthy reconciliation after 60 seconds plus jitter. This recovers missed events, including deletes that cannot be delivered through a filtered DELETE subscription. Background/offline reconciliation is skipped. It is not a claim that every deletion appears instantly.
- Continuous/Fiocruz channel is worksite-filtered. It refetches only active list/facet/count queries scoped to that worksite and user, debounced by two seconds. Imports-only mode does not subscribe. Cleanup ignores old callbacks, removes timers/listeners and disposes the channel. Draft/edit state and version-conflict rules remain unchanged.
- Healthy sockets do not perform the 10–15 second disconnected revision probes. Disconnected fallback keeps its existing backoff and no-overlap behavior. Periodic healthy reconciliation is one bounded catch-up per visible tab per minute, staggered, not per-task polling.

## Database rollout

Migration `20261123120000_diagnostic_context.sql` adds four nullable diagnostic columns and includes `continuous_activities` in the realtime publication. Existing approved-worksite SELECT RLS and restrictive password gate were inspected before rollout and are unchanged. Diagnostic SELECT remains admin/worksite/password scoped; possession of the table-level SELECT grant alone does not authorize rows. A preliminary test incorrectly assumed no authenticated table grant; it was corrected to compare the actual unchanged RLS policies. The successful transaction test rolled back before application.

The migration was applied and the four columns and realtime publication verified. No historical event is backfilled with invented occurrence/release data. No backup settings, data contents or business functions were changed.

## Validation and limits

Regression tests cover schema rejection, body caps/cancellation, no session lookup in diagnostic sending, hung auth aborts, no retries, forwarding of cancellation, fail-closed password checks, generated-file preservation, bounded visible reconciliation, and prompt recovery replacing a pending healthy-reconciliation timer. Locked production SDK 2.110.7 is used for SDK-facing tests. Type checking and production build are required before publication. No real users' passwords or tasks were used as fixtures.

Final local run: 250 Node tests and 55 locked-SDK Bun tests passed; type checking and production build passed. Public client build contains no service-role environment-variable reference. The preliminary migration test was rolled back; the applied migration was verified by schema and publication reads.

Authenticated two-user delivery from Petrobras remains an actual-use validation, not something proved by a local fake transport or broadcast probe. Secondary SAP/employee query tuning remains a measured follow-up; no speculative heavy indexing or load test was performed during normal use. Publication identity must be verified separately on both official hosts before calling this batch live.
