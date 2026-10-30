import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "./password-auth";
import { requireSupabaseAuth as requireIdentity } from "@/integrations/supabase/auth-middleware";
import { canResetPassword, newPasswordSchema, TEMPORARY_PASSWORD, type PasswordResetState } from "./password-reset";

export const resetUserPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => z.object({ targetUserId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const ids = [context.userId, data.targetUserId];
    const [profiles, roles, memberships] = await Promise.all([
      db.from("profiles").select("id,email,full_name,approval_status,worksite_id").in("id", ids),
      db.from("user_roles").select("user_id,role").in("user_id", ids),
      db.from("worksite_memberships").select("user_id,worksite_id,is_worksite_admin").in("user_id", ids),
    ]);
    if (profiles.error || roles.error || memberships.error) return { ok: false as const, error: "Não foi possível validar as permissões. Tente novamente." };
    const user = (id: string) => {
      const p = profiles.data?.find((row: any) => row.id === id);
      return p && { ...p, roles: roles.data.filter((r: any) => r.user_id === id).map((r: any) => r.role),
        memberships: memberships.data.filter((m: any) => m.user_id === id) };
    };
    const actor = user(context.userId), target = user(data.targetUserId);
    if (!actor || !target || !canResetPassword(actor, target, actor.worksite_id))
      return { ok: false as const, error: "Sem permissão para resetar a senha deste usuário. O usuário deve estar aprovado e pertencer à sua obra." };
    const current = await supabaseAdmin.auth.admin.getUserById(target.id);
    if (current.error || !current.data.user) return { ok: false as const, error: "Não foi possível localizar o acesso deste usuário." };
    const previous = current.data.user.app_metadata?.nexo_password_reset;
    if (previous?.requested_at && Date.now() - Date.parse(previous.requested_at) < 60_000)
      return { ok: false as const, error: "Um reset acabou de ser solicitado. Aguarde um minuto antes de repetir." };
    const requestedAt = new Date();
    const { error } = await supabaseAdmin.auth.admin.updateUserById(target.id, {
      password: TEMPORARY_PASSWORD,
      app_metadata: { ...current.data.user.app_metadata, nexo_password_reset: {
        id: crypto.randomUUID(), required: true, requested_at: requestedAt.toISOString(),
        expires_at: new Date(requestedAt.getTime() + 24 * 60 * 60_000).toISOString(),
        requested_by: actor.id, requested_by_name: actor.full_name || actor.email,
      } },
    });
    // Never log credentials or store them in audit records.
    if (error) return { ok: false as const, error: "Não foi possível resetar a senha. Verifique a política de senhas do serviço e tente novamente." };
    return { ok: true as const };
  });

export const completeRequiredPasswordChange = createServerFn({ method: "POST" })
  .middleware([requireIdentity])
  .validator((data: unknown) => z.object({ password: newPasswordSchema, resetId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { data: state, error: stateError } = await (context.supabase as any).rpc("password_reset_state");
    const s = state as PasswordResetState | null;
    if (stateError || !s?.required || !s.can_change || s.reset_id !== data.resetId)
      return { ok: false as const, error: "Entre novamente com a senha temporária. Se ela expirou, solicite um novo reset ao administrador." };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const current = await supabaseAdmin.auth.admin.getUserById(context.userId);
    const reset = current.data.user?.app_metadata?.nexo_password_reset;
    if (current.error || !reset?.required || reset.id !== data.resetId)
      return { ok: false as const, error: "O reset foi atualizado. Entre novamente antes de continuar." };
    const { error } = await supabaseAdmin.auth.admin.updateUserById(context.userId, {
      password: data.password,
      app_metadata: { ...current.data.user!.app_metadata, nexo_password_reset: {
        ...reset, required: false, completed_at: new Date().toISOString(),
      } },
    });
    if (error) return { ok: false as const, error: "Não foi possível salvar a nova senha. Tente outra senha ou solicite um novo reset." };
    return { ok: true as const };
  });
