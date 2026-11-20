import { createFileRoute } from "@tanstack/react-router";
import { relayAccessRequest } from "@/lib/access-relay";

// Restricted same-origin path for the sign-in/access gate only. The allowlist,
// fixed upstream and header rules live in src/lib/access-relay.ts.
async function handle({ request }: { request: Request }) {
  return relayAccessRequest(request, {
    upstreamUrl: process.env["SUPABASE_URL"],
    publishableKey: process.env["SUPABASE_PUBLISHABLE_KEY"],
  });
}

export const Route = createFileRoute("/api/public/nexo-access/$")({
  server: { handlers: { GET: handle, POST: handle } },
});
