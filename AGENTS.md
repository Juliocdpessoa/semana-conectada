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
- Sign-in/session/access-gate requests switch to the same-origin relay (`/api/public/nexo-access`, allowlist in `src/lib/access-transport-policy.ts`) only after a direct connection failure in that browser; widen the allowlist only with matching tests in `tests/access-transport.test.ts`. Why: some clients cannot reach the backend domain directly, and the generated client must not be edited.
- Operational relay reads also include explicitly worksite-scoped employee/overtime lists; these require the caller's bearer token and still use public-key/RLS access. Never add generic writes or service-role credentials. Successful relay use extends the six-hour route preference; bounded historical routing may select the relay for refresh before consuming a rotating token after an idle period. This does not extend the authenticated session or bypass access checks.
