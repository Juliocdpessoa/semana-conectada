import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const updateSchema = z.object({
  activityId: z.string().uuid(),
  expectedVersion: z.number().int().min(1),
  status: z.enum(["Sem apontamento", "EXECUTADO", "NÃO EXECUTADO"]),
  justification: z.string().max(200).nullable(),
  observation: z.string().max(2000).nullable(),
  immediateActivityIds: z.array(z.string().uuid()).max(100).default([]),
});

const REQUIRES_JUSTIFICATION = new Set(["NÃO EXECUTADO"]);
const IMMEDIATE_JUSTIFICATION = "08 - ATENDIMENTO DE ORDEM IMEDIATA";

export const updateActivity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => updateSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (REQUIRES_JUSTIFICATION.has(data.status) && !data.justification?.trim()) {
      return { ok: false as const, error: "Justificativa é obrigatória para este status." };
    }
    if (
      data.status === "NÃO EXECUTADO" &&
      data.justification === IMMEDIATE_JUSTIFICATION &&
      data.immediateActivityIds.length === 0
    ) {
      return { ok: false as const, error: "Selecione ao menos uma atividade IMEDIATA relacionada." };
    }
    // Fetch profile for stamping name/email server-side
    const { data: prof } = await supabase.from("profiles").select("full_name, email").eq("id", userId).maybeSingle();
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
      .select("id, week_id, version, status, justification, observation, reported_by_name, reported_at")
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
    const { error: clearLinksError } = await supabase
      .from("activity_immediate_links")
      .delete()
      .eq("planned_activity_id", data.activityId);
    if (clearLinksError) {
      return {
        ok: false as const,
        error: `Apontamento salvo, mas não foi possível atualizar o vínculo: ${clearLinksError.message}`,
      };
    }
    const linkIds =
      data.status === "NÃO EXECUTADO" && data.justification === IMMEDIATE_JUSTIFICATION
        ? data.immediateActivityIds
        : [];
    if (linkIds.length > 0) {
      const { error: linkError } = await supabase.from("activity_immediate_links").insert(
        linkIds.map((immediateActivityId) => ({
          week_id: updated.week_id,
          planned_activity_id: data.activityId,
          immediate_activity_id: immediateActivityId,
          linked_by_user_id: userId,
        })),
      );
      if (linkError) {
        return {
          ok: false as const,
          error: `Apontamento salvo, mas o vínculo com a IMEDIATA falhou: ${linkError.message}`,
        };
      }
    }
    return { ok: true as const, updated };
  });

const bulkSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
  status: z.enum(["Sem apontamento", "EXECUTADO", "NÃO EXECUTADO"]),
  justification: z.string().max(200).nullable(),
  observation: z.string().max(2000).nullable(),
  immediateActivityIds: z.array(z.string().uuid()).max(100).default([]),
});

export const bulkUpdateActivities = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => bulkSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (REQUIRES_JUSTIFICATION.has(data.status) && !data.justification?.trim()) {
      return { ok: false as const, error: "Justificativa é obrigatória para este status." };
    }
    if (
      data.status === "NÃO EXECUTADO" &&
      data.justification === IMMEDIATE_JUSTIFICATION &&
      data.immediateActivityIds.length === 0
    ) {
      return { ok: false as const, error: "Selecione ao menos uma atividade IMEDIATA relacionada." };
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
      .select("id, week_id, is_immediate");
    if (error) return { ok: false as const, error: error.message };
    const { error: clearLinksError } = await supabase
      .from("activity_immediate_links")
      .delete()
      .in("planned_activity_id", data.ids);
    if (clearLinksError) {
      return {
        ok: false as const,
        error: `Atividades salvas, mas não foi possível atualizar os vínculos: ${clearLinksError.message}`,
      };
    }
    const linkIds =
      data.status === "NÃO EXECUTADO" && data.justification === IMMEDIATE_JUSTIFICATION
        ? data.immediateActivityIds
        : [];
    const programmedUpdated = updated?.filter((activity) => !activity.is_immediate) ?? [];
    if (linkIds.length > 0 && programmedUpdated.length) {
      const links = programmedUpdated.flatMap((activity) =>
        linkIds.map((immediateActivityId) => ({
          week_id: activity.week_id,
          planned_activity_id: activity.id,
          immediate_activity_id: immediateActivityId,
          linked_by_user_id: userId,
        })),
      );
      const { error: linkError } = await supabase.from("activity_immediate_links").insert(links);
      if (linkError) {
        return {
          ok: false as const,
          error: `Atividades salvas, mas o vínculo com a IMEDIATA falhou: ${linkError.message}`,
        };
      }
    }
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
  planning_data: z.record(z.string(), z.any()).default({}),
});

export const createImmediateActivity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => immediateSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    const canCreate = roles?.some((r) => r.role === "planning" || r.role === "admin");
    if (!canCreate)
      return { ok: false as const, error: "Somente planejamento/administrador pode cadastrar IMEDIATAS." };
    const sourceKey = `IMD-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
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
        planning_data: data.planning_data,
        is_immediate: true,
        created_by: userId,
        status: "Sem apontamento",
      })
      .select("id")
      .single();
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const, id: created.id };
  });

const bulkImmediateSchema = z.object({
  weekId: z.string().uuid(),
  items: z
    .array(immediateSchema.omit({ weekId: true }))
    .min(1)
    .max(1000),
});

export const bulkCreateImmediateActivities = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => bulkImmediateSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    const canCreate = roles?.some((r) => r.role === "planning" || r.role === "admin");
    if (!canCreate)
      return { ok: false as const, error: "Somente planejamento/administrador pode cadastrar IMEDIATAS." };
    const now = Date.now();
    const payload = data.items.map((it, idx) => ({
      week_id: data.weekId,
      source_key: `IMD-${now}-${idx}-${Math.floor(Math.random() * 10000)}`,
      order_number: it.order_number,
      note_number: it.note_number,
      description: it.description,
      area: it.area,
      specialty: it.specialty,
      scheduled_date: it.scheduled_date,
      planning_data: it.planning_data,
      is_immediate: true,
      created_by: userId,
      status: "Sem apontamento",
    }));
    const { data: created, error } = await supabase.from("activities").insert(payload).select("id");
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const, count: created?.length ?? 0 };
  });

const roleSchema = z.enum(["admin", "manager", "planning", "leader", "viewer"]);
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
