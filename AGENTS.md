<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Access transport
- Sign-in/session/access-gate requests use the same-origin relay (`/api/public/nexo-access`, allowlist in `src/lib/access-transport-policy.ts`) from the first request. Other allowlisted operational reads retain connection-failure routing. Widen the allowlist only with matching tests in `tests/access-transport.test.ts`. Why: initial/expired sessions must not consume rotating tokens through an unreachable backend domain, and the generated client must not be edited.
- Operational relay reads also include explicitly worksite-scoped employee/overtime lists; these require the caller's bearer token and still use public-key/RLS access. Never add generic writes or service-role credentials. Successful relay use extends the six-hour route preference; bounded historical routing may select the relay for refresh before consuming a rotating token after an idle period. This does not extend the authenticated session or bypass access checks.

## Reliability boundaries
- Application-owned identity/password middleware enforces bounded verification without editing generated auth files. A network failure is not proof of a required password reset; fail closed without clearing sessions or bypassing RLS.
- New access diagnostics use the fixed JSON-only HTTP collector, not server-function session attachment. Keep optional bearer verification server-side, strict schemas/body caps and existing DB rate limits. Never accept a client-supplied actor or arbitrary URL/RPC. Client occurrence/release/visibility are untrusted metadata, separate from server receipt time.
- Realtime subscriptions remain worksite/week filtered. Filtered DELETE delivery is not guaranteed; bounded visible-tab reconciliation handles missed events. Do not add unfiltered cross-worksite subscriptions or replay writes to recover reads.
- `nexo_read_worksite_scope()` is a caller-only, per-statement RLS optimization using the unchanged `can_access_worksite(auth.uid(), id)` predicate. Never add a caller-supplied user ID or cache its result between requests. Preserve role/password checks; run read-scope equivalence tests before modifying these read policies.
- Performance sampling uses only the existing in-memory caller token and the fixed authenticated `record_app_performance` RPC. Never read/refresh the browser session to send a metric, accept an actor/site from its payload, add service credentials, or retry optional telemetry writes.
