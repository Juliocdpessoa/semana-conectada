import { createMiddleware } from "@tanstack/react-start";
import { requireSupabaseAuth as requireIdentity } from "@/integrations/supabase/auth-middleware";
import type { PasswordResetState } from "./password-reset";

// Keep generated authentication middleware unchanged. Enforce the password gate
// before any application handler can use the service-role client (which bypasses RLS).
export const requireSupabaseAuth = createMiddleware({ type: "function" })
  .middleware([requireIdentity])
  .server(async ({ next, context }) => {
    const { data, error } = await (context.supabase as any).rpc("password_reset_state");
    if (error || !(data as PasswordResetState | null)?.allowed)
      throw new Error("Sua senha precisa ser redefinida. Entre novamente e escolha uma nova senha.");
    return next();
  });
