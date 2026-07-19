import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const updateSchema = z.object({
  activityId: z.string().uuid(),
  expectedVersion: z.number().int().min(1),
  status: z.string().min(1).max(64),
  justification: z.string().max(200).nullable(),
  observation: z.string().max(2000).nullable(),
});

const REQUIRES_JUSTIFICATION = new Set(["NÃO EXECUTADO"]);

export const updateActivity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => updateSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (REQUIRES_JUSTIFICATION.has(data.status) && !data.justification?.trim()) {
      return { ok: false as const, error: "Justificativa é obrigatória para este status." };
    }
    // Fetch profile for stamping name/email server-side
    const { data: prof } = await supabase
      .from("profiles")
      .select("full_name, email")
      .eq("id", userId)
      .maybeSingle();
    // Optimistic concurrency: only update if version matches
    const { data: updated, error } = await supabase
      .from("activities")
      .update({
        status: data.status,
        justification: data.justification,
        observation: data.observation,
        reported_by_user_id: userId,
        reported_by_name: prof?.full_name ?? "",
        reported_by_email: prof?.email ?? "",
        reported_at: new Date().toISOString(),
      })
      .eq("id", data.activityId)
      .eq("version", data.expectedVersion)
      .select("id, version, status, justification, observation, reported_by_name, reported_at")
      .maybeSingle();
    if (error) return { ok: false as const, error: error.message };
    if (!updated) {
      // Conflict: fetch current
      const { data: current } = await supabase
        .from("activities")
        .select("id, version, status, justification, observation, reported_by_name")
        .eq("id", data.activityId)
        .maybeSingle();
      return { ok: false as const, conflict: true, current };
    }
    return { ok: true as const, updated };
  });

const bulkSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
  status: z.string().min(1).max(64),
  justification: z.string().max(200).nullable(),
  observation: z.string().max(2000).nullable(),
});

export const bulkUpdateActivities = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => bulkSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (REQUIRES_JUSTIFICATION.has(data.status) && !data.justification?.trim()) {
      return { ok: false as const, error: "Justificativa é obrigatória para este status." };
    }
    const { data: prof } = await supabase.from("profiles").select("full_name, email").eq("id", userId).maybeSingle();
    const { data: updated, error } = await supabase
      .from("activities")
      .update({
        status: data.status,
        justification: data.justification,
        observation: data.observation,
        reported_by_user_id: userId,
        reported_by_name: prof?.full_name ?? "",
        reported_by_email: prof?.email ?? "",
        reported_at: new Date().toISOString(),
      })
      .in("id", data.ids)
      .select("id");
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const, count: updated?.length ?? 0 };
  });

const immediateSchema = z.object({
  weekId: z.string().uuid(),
  order_number: z.string().min(1).max(64),
  note_number: z.string().max(64).nullable(),
  description: z.string().min(3).max(500),
  area: z.string().max(120).nullable(),
  specialty: z.string().max(120).nullable(),
  scheduled_date: z.string().nullable(),
});

export const createImmediateActivity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => immediateSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // authorization: planning or admin
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    const canCreate = roles?.some((r) => r.role === "planning" || r.role === "admin");
    if (!canCreate) return { ok: false as const, error: "Somente planejamento/administrador pode cadastrar IMEDIATAS." };
    const sourceKey = `IMD-${Date.now()}`;
    const { data: created, error } = await supabase
      .from("activities")
      .insert({
        week_id: data.weekId,
        source_key: sourceKey,
        order_number: data.order_number,
        note_number: data.note_number,
        description: data.description,
        area: data.area,
        specialty: data.specialty,
        scheduled_date: data.scheduled_date,
        is_immediate: true,
        created_by: userId,
        status: "Sem apontamento",
      })
      .select("id")
      .single();
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const, id: created.id };
  });

const roleSchema = z.enum(["admin", "planning", "leader", "viewer"]);
const approveSchema = z.object({
  targetUserId: z.string().uuid(),
  approvalStatus: z.enum(["approved", "blocked", "pending"]),
  role: roleSchema.optional(),
});

export const setUserApproval = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => approveSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: myRoles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    if (!myRoles?.some((r) => r.role === "admin")) {
      return { ok: false as const, error: "Apenas administradores podem alterar aprovação." };
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: pErr } = await supabaseAdmin
      .from("profiles")
      .update({
        approval_status: data.approvalStatus,
        approved_by: data.approvalStatus === "approved" ? userId : null,
        approved_at: data.approvalStatus === "approved" ? new Date().toISOString() : null,
      })
      .eq("id", data.targetUserId);
    if (pErr) return { ok: false as const, error: pErr.message };
    if (data.role) {
      // Replace role
      await supabaseAdmin.from("user_roles").delete().eq("user_id", data.targetUserId);
      const { error: rErr } = await supabaseAdmin
        .from("user_roles")
        .insert({ user_id: data.targetUserId, role: data.role });
      if (rErr) return { ok: false as const, error: rErr.message };
    }
    return { ok: true as const };
  });
