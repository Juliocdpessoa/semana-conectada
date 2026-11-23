# Session loading incident, 23 November 2026

## Evidence and scope

Multiple users reported access failures, including Petrobras computers. The supplied screenshot is an access-loading communication timeout, not an invalid-password message. Recent received diagnostics include session timeouts around 8,000 ms, session server errors, and realtime transport errors. Receipt time is not necessarily occurrence time. No exact match to the screenshot support ID has been established. These observations do not establish a corporate-network root cause or a complete backend outage.

An external, anonymous check returned `/auth` HTTP 200 in 372 ms and the fixed access relay `/auth/v1/user` HTTP 401 in 505 ms (expected without a bearer). This checks routing only, not authenticated Petrobras access.

## Functional correction

- Installed browser access-gate transport now starts on the existing fixed same-origin relay. Its allowlist, public key, caller bearer, RLS, password/approval checks, response caps, no-store and one-upstream-attempt policy remain unchanged. No generic write route is introduced.
- Auth fetch gets a 12-second abort bound; caller cancellation is forwarded. Existing ambiguity protection prevents resending a rotating token after an uncertain result. No manual refresh/reconnect loop is added.
- Session and identity reads share only pending SDK promises, never cached access decisions. A route retry joins an outstanding read rather than starting another.
- Session-stage orchestration no longer retries the SDK's own refresh/backoff cycle. The pinned SDK can spend about 30 seconds on that bounded cycle; the route session budget is 35 seconds, within a 60-second complete-gate deadline. Other gate steps allow 15 seconds for the existing 10-second relay deadline plus transit. This corrects contradictory nested deadlines rather than assuming waiting alone repairs connectivity.
- Fixed gate routing does not set the operational-read fallback hint just because authentication succeeded. Healthy large data reads keep their existing route, avoiding unnecessarily routing all users' data through the relay.
- No saved tasks, account passwords, business permissions, RLS policies, or business calculations are changed. Generated Supabase client is untouched.

## Validation and limitations

Regression tests cover one pending SDK call under overlapping route retries, retry after route timeout, no cached grant after failure, no extra session-level refresh cycle, relay-first expired-session refresh without prior history using the locked SDK, aborting hung auth fetches, no rotating-token replay, and unchanged direct activity writes/healthy data reads. Production publication and a real authenticated Petrobras user check must be distinguished from local/synthetic tests; disappearance of all incident symptoms is not established by these tests alone.
