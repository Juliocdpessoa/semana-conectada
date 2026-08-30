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
    if (!access.allowed)
      return { ok: false as const, error: "Somente o administrador geral pode trocar de obra." };
    const { data: target, error: targetError } = await access.db
      .from("worksites")
      .select("id,code,name,is_active")
      .eq("id", data.worksiteId)
      .eq("is_active", true)
      .maybeSingle();
    if (targetError) return { ok: false as const, error: targetError.message };
    if (!target) return { ok: false as const, error: "Obra não encontrada ou inativa." };
    const { error } = await access.db
      .from("profiles")
      .update({ worksite_id: target.id })
      .eq("id", context.userId);
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const, worksite: target };
  });
