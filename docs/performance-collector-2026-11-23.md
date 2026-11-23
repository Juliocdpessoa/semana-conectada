# Session-independent performance collection

Access diagnostics already used independent HTTP, but Activities timings and realtime lifecycle samples still called a server function behind the global browser getSession middleware. A browser refresh/session stall could prevent those samples from being transmitted even before the actual authenticated collector ran.

New clients send the same bounded metadata to fixed POST `/api/public/nexo-performance`. The caller bearer is read only from the existing in-memory auth-event identity; no storage read, session lookup, auth refresh, queue, retry or forced sign-out is added. Logout clears that identity. Missing identity skips transmission. Existing sampling, per-operation cadence, lifecycle caps and three-second cancellation remain unchanged.

The fixed server route requires bearer shape, same-origin JSON and a capped 4 KiB body with a two-second read deadline. Bearer shape is not considered authentication: the upstream PostgREST request verifies the actual caller JWT before the existing `record_app_performance` function can execute. The backend uses only a public/anon configuration key and caller authorization, never a service role. The RPC is fixed in code; neither actor, worksite, URL nor RPC name can come from the body.

The unchanged database function derives actor/site from auth.uid(), checks password state, approval and worksite access, applies six/user/minute and 200/minute limits with a nonblocking lock, and keeps rolling retention. Anonymous execute remains revoked. Upstream requests have a 2.5-second limit; failure only drops the optional sample, not the user's work. Expired/invalid bearer rejection remains a rejection and does not trigger refresh. The legacy server-function collector remains available for already-open older clients.

The existing diagnostic HTTP parser is factored into an internal bounded parser so body limits/cancellation/origin behavior are tested once; diagnostic schema, optional verified identity and 8 KiB cap are unchanged. This helper is not a user-configurable proxy.

No business rows, RLS policies, sampling rate, database permissions, official calculations or backup settings change. A new 860-row SAP load was observed on 23/11 at 09:37 Brasília before this work; this agent did not reimport it. Real authenticated Petrobras collaboration is not established merely by collector tests, and generic realtime connection errors remain under investigation.

Validation: 256 Node regression tests, 60 Bun tests with locked production SDK 2.110.7, type checking and production build passed. Live database inspection confirmed the existing recorder's password, approval, worksite, actor/global rate guards and revoked anonymous execution. No synthetic production performance rows were inserted for validation. Publication and the new route's safe rejection must be verified separately before considering this batch live.
