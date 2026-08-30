import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const GLOBAL_ADMIN_EMAIL = "julio.pessoa@normatel.com.br";

async function requireGlobalAdmin(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: profile, error } = await supabaseAdmin
    .from("profiles")
    .select("id,email,approval_status")
    .eq("id", userId)
    .maybeSingle();
  return {
    allowed:
      !error &&
      profile?.approval_status === "approved" &&
      profile.email?.trim().toLowerCase() === GLOBAL_ADMIN_EMAIL,
    db: supabaseAdmin as any,
  };
}

const createSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(20)
    .regex(/^[A-Za-z0-9_-]+$/, "Use somente letras, números, hífen ou sublinhado."),
  name: z.string().trim().min(3).max(160),
});

export const createWorksite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => createSchema.parse(data))
  .handler(async ({ data, context }) => {
    const access = await requireGlobalAdmin(context.userId);
    if (!access.allowed)
      return { ok: false as const, error: "Somente o administrador geral pode cadastrar obras." };
    const { data: created, error } = await access.db
      .from("worksites")
      .insert({ code: data.code.toUpperCase(), name: data.name, is_active: true })
      .select("id,code,name,is_active")
      .single();
    if (error?.code === "23505") return { ok: false as const, error: "Já existe uma obra com esse código." };
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const, worksite: created };
  });

export const selectGlobalWorksite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => z.object({ worksiteId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const access = await requireGlobalAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: membership } = access.allowed
      ? { data: { user_id: context.userId } }
      : await (supabaseAdmin as any)
          .from("worksite_memberships")
          .select("user_id")
          .eq("user_id", context.userId)
          .eq("worksite_id", data.worksiteId)
          .maybeSingle();
    if (!membership)
      return { ok: false as const, error: "Você não possui acesso a esta obra." };
    const { data: target, error: targetError } = await access.db
      .from("worksites")
      .select("id,code,name,is_active")
      .eq("id", data.worksiteId)
      .eq("is_active", true)
      .maybeSingle();
    if (targetError) return { ok: false as const, error: targetError.message };
    if (!target) return { ok: false as const, error: "Obra não encontrada ou inativa." };
    const { error } = await (supabaseAdmin as any)
      .from("profiles")
      .update({ worksite_id: target.id })
      .eq("id", context.userId);
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const, worksite: target };
  });

const membershipSchema = z.object({
  targetUserId: z.string().uuid(),
  worksiteId: z.string().uuid(),
  enabled: z.boolean(),
  isWorksiteAdmin: z.boolean().default(false),
});

export const setWorksiteMembership = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => membershipSchema.parse(data))
  .handler(async ({ data, context }) => {
    const access = await requireGlobalAdmin(context.userId);
    if (!access.allowed)
      return { ok: false as const, error: "Somente o administrador geral pode definir acesso entre obras." };
    if (data.targetUserId === context.userId && !data.enabled)
      return { ok: false as const, error: "O administrador geral não pode remover o próprio acesso." };
    if (data.enabled) {
      const { error } = await access.db.from("worksite_memberships").upsert({
        user_id: data.targetUserId,
        worksite_id: data.worksiteId,
        is_worksite_admin: data.isWorksiteAdmin,
        granted_by: context.userId,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id,worksite_id" });
      if (error) return { ok: false as const, error: error.message };
      if (data.isWorksiteAdmin) {
        const { error: roleError } = await access.db.from("user_roles")
          .upsert({ user_id: data.targetUserId, role: "admin" }, { onConflict: "user_id,role" });
        if (roleError) return { ok: false as const, error: roleError.message };
      } else {
        const { data: otherAdmin } = await access.db.from("worksite_memberships")
          .select("worksite_id").eq("user_id", data.targetUserId)
          .eq("is_worksite_admin", true).limit(1).maybeSingle();
        const { data: targetProfile } = await access.db.from("profiles").select("email")
          .eq("id", data.targetUserId).maybeSingle();
        if (!otherAdmin && targetProfile?.email?.toLowerCase() !== GLOBAL_ADMIN_EMAIL) {
          await access.db.from("user_roles").delete().eq("user_id", data.targetUserId).eq("role", "admin");
        }
      }
    } else {
      const { count } = await access.db.from("worksite_memberships")
        .select("*", { count: "exact", head: true }).eq("user_id", data.targetUserId);
      if ((count ?? 0) <= 1)
        return { ok: false as const, error: "O usuário precisa permanecer vinculado a pelo menos uma obra." };
      const { error } = await access.db.from("worksite_memberships").delete()
        .eq("user_id", data.targetUserId).eq("worksite_id", data.worksiteId);
      if (error) return { ok: false as const, error: error.message };
      const { data: otherAdmin } = await access.db.from("worksite_memberships")
        .select("worksite_id").eq("user_id", data.targetUserId)
        .eq("is_worksite_admin", true).limit(1).maybeSingle();
      const { data: targetProfile } = await access.db.from("profiles").select("email")
        .eq("id", data.targetUserId).maybeSingle();
      if (!otherAdmin && targetProfile?.email?.toLowerCase() !== GLOBAL_ADMIN_EMAIL) {
        await access.db.from("user_roles").delete().eq("user_id", data.targetUserId).eq("role", "admin");
      }
      const { data: profile } = await access.db.from("profiles").select("worksite_id")
        .eq("id", data.targetUserId).maybeSingle();
      if (profile?.worksite_id === data.worksiteId) {
        const { data: fallback } = await access.db.from("worksite_memberships")
          .select("worksite_id").eq("user_id", data.targetUserId).limit(1).maybeSingle();
        if (fallback) await access.db.from("profiles").update({ worksite_id: fallback.worksite_id })
          .eq("id", data.targetUserId);
      }
    }
    return { ok: true as const };
  });

