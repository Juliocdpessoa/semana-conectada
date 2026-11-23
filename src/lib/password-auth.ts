import { createMiddleware } from "@tanstack/react-start";
import { requireIdentity } from "./identity-auth";
import { assertPasswordGate } from './password-gate-policy';

// Keep generated authentication middleware unchanged. Enforce the password gate
// before any application handler can use the service-role client (which bypasses RLS).
export const requireSupabaseAuth = createMiddleware({ type: "function" })
  .middleware([requireIdentity])
  .server(async ({ next, context }) => {
    const { data, error } = await (context.supabase as any).rpc("password_reset_state").abortSignal(AbortSignal.timeout(5000));
    assertPasswordGate(data,error);
    return next();
  });
