import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const updateSchema = z.object({
  activityId: z.string().uuid(),
  expectedVersion: z.number().int().min(1),
  status: z.enum(["Sem apontamento", "EXECUTADO", "NÃO EXECUTADO", "CANCELADA"]),
  justification: z.string().max(200).nullable(),
  observation: z.string().max(2000).nullable(),
  immediateActivityIds: z.array(z.string().uuid()).max(100).optional().default([]),
});

const REQUIRES_JUSTIFICATION = new Set(["NÃO EXECUTADO", "CANCELADA"]);
const CANCELLATION_JUSTIFICATIONS = new Set([
  "11 - MUDANÇA DE ESCOPO DA INTERVENÇÃO",
  "12 - SERVIÇO CANCELADO",
  "15 - PROGRAMAÇÃO INDEVIDA",
  "17 - TAREFA ELIMINADA EQUIVOCADAMENTE DO SAP",
  "22 - ATIVIDADE EXECUTADA ANTERIORMENTE",
  "29 - OUTROS TIPOS DE PENDENCIAS",
]);

export const updateActivity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => updateSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (REQUIRES_JUSTIFICATION.has(data.status) && !data.justification?.trim()) {
      return { ok: false as const, error: "Justificativa é obrigatória para este status." };
    }
    const normalizedJustification = REQUIRES_JUSTIFICATION.has(data.status) ? data.justification?.trim() || null : null;
    const requiresImmediateLink = data.status === "NÃO EXECUTADO" && normalizedJustification?.startsWith("08 -");

    const { data: currentActivity, error: currentError } = await supabase
      .from("activities")
      .select("id, week_id, is_immediate, planning_data, status, justification")
      .eq("id", data.activityId)
      .maybeSingle();
    if (currentError) return { ok: false as const, error: currentError.message };
    if (!currentActivity) return { ok: false as const, error: "Atividade não encontrada." };
    if (data.status === "CANCELADA") {
      const { data: roles, error: rolesError } = await supabase.from("user_roles").select("role").eq("user_id", userId);
      if (rolesError) return { ok: false as const, error: rolesError.message };
      const isPlanning = roles?.some((row) => row.role === "planning");
      const preservesExistingCancellation =
        currentActivity.status === "CANCELADA" && currentActivity.justification === normalizedJustification;
      if (!isPlanning && !preservesExistingCancellation) {
        return { ok: false as const, error: "Somente o perfil Planejamento pode cancelar atividades." };
      }
      if (!normalizedJustification || !CANCELLATION_JUSTIFICATIONS.has(normalizedJustification)) {
        return { ok: false as const, error: "Selecione uma justificativa de cancelamento válida." };
      }
    }
    if (requiresImmediateLink && currentActivity.is_immediate) {
      return { ok: false as const, error: "Uma atividade imediata não pode ser vinculada a ela mesma." };
    }

    const linkedIds = Array.from(new Set(data.immediateActivityIds));
    if (requiresImmediateLink && linkedIds.length === 0) {
      return { ok: false as const, error: "Selecione ao menos uma atividade imediata atendida." };
    }
    if (requiresImmediateLink) {
      const { data: validImmediates, error: immediateError } = await supabase
        .from("activities")
        .select("id")
        .eq("week_id", currentActivity.week_id)
        .eq("is_immediate", true)
        .in("id", linkedIds);
      if (immediateError) return { ok: false as const, error: immediateError.message };
      if ((validImmediates?.length ?? 0) !== linkedIds.length) {
        return { ok: false as const, error: "Uma ou mais imediatas selecionadas não pertencem à semana atual." };
      }
    }

    const nextPlanningData = { ...((currentActivity.planning_data ?? {}) as Record<string, unknown>) };
    if (requiresImmediateLink) nextPlanningData.__linked_immediate_ids = linkedIds;
    else delete nextPlanningData.__linked_immediate_ids;

    // Fetch profile for stamping name/email server-side
    const { data: prof } = await supabase.from("profiles").select("full_name, email").eq("id", userId).maybeSingle();
    const reportedAt = new Date().toISOString();
    // Optimistic concurrency: only update if version matches
    const { data: updated, error } = await supabase
      .from("activities")
      .update({
        status: data.status,
        justification: normalizedJustification,
        observation: data.observation,
        planning_data: nextPlanningData as never,
        reported_by_user_id: userId,
        reported_by_name: prof?.full_name ?? "",
        reported_by_email: prof?.email ?? "",
        reported_at: reportedAt,
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
    if (requiresImmediateLink) {
      const { error: immediateUpdateError } = await supabase
        .from("activities")
        .update({
          status: "EXECUTADO",
          justification: null,
          reported_by_user_id: userId,
          reported_by_name: prof?.full_name ?? "",
          reported_by_email: prof?.email ?? "",
          reported_at: reportedAt,
        })
        .eq("week_id", currentActivity.week_id)
        .eq("is_immediate", true)
        .in("id", linkedIds);
      if (immediateUpdateError) return { ok: false as const, error: immediateUpdateError.message };
    }
    return { ok: true as const, updated };
  });

const bulkSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
  status: z.enum(["Sem apontamento", "EXECUTADO", "NÃO EXECUTADO", "CANCELADA"]),
  justification: z.string().max(200).nullable(),
  observation: z.string().max(2000).nullable(),
  immediateActivityIds: z.array(z.string().uuid()).max(100).optional().default([]),
});

export const bulkUpdateActivities = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => bulkSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const normalizedJustification = REQUIRES_JUSTIFICATION.has(data.status) ? data.justification?.trim() || null : null;
    if (data.status === "CANCELADA") {
      const { data: roles, error: rolesError } = await supabase.from("user_roles").select("role").eq("user_id", userId);
      if (rolesError) return { ok: false as const, error: rolesError.message };
      if (!roles?.some((row) => row.role === "planning")) {
        return { ok: false as const, error: "Somente o perfil Planejamento pode cancelar atividades." };
      }
      if (!normalizedJustification || !CANCELLATION_JUSTIFICATIONS.has(normalizedJustification)) {
        return { ok: false as const, error: "Selecione uma justificativa de cancelamento válida." };
      }
    }
    if (REQUIRES_JUSTIFICATION.has(data.status) && !data.justification?.trim()) {
      return { ok: false as const, error: "Justificativa é obrigatória para este status." };
    }

    const requiresImmediateLink = data.status === "NÃO EXECUTADO" && normalizedJustification?.startsWith("08 -");
    const linkedIds = Array.from(new Set(data.immediateActivityIds));
    if (requiresImmediateLink && linkedIds.length === 0) {
      return { ok: false as const, error: "Selecione ao menos uma atividade imediata atendida." };
    }

    const { data: updatedCount, error } = await (supabase as any).rpc("bulk_update_activity_reports", {
      p_ids: Array.from(new Set(data.ids)),
      p_status: data.status,
      p_justification: normalizedJustification,
      p_observation: data.observation,
      p_linked_ids: requiresImmediateLink ? linkedIds : [],
    });
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const, count: Number(updatedCount ?? data.ids.length) };
  });

const activityPlanningFieldsSchema = z.object({
  rows: z
    .array(
      z.object({
        id: z.string().uuid(),
        pbs: z.string().max(120).nullable(),
        ptNumber: z.string().max(120).nullable(),
        releaseType: z.enum(["PT", "PTT", "ATRE", "OFICINAS"]).nullable(),
        scheduledDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullable(),
      }),
    )
    .min(1)
    .max(500),
});

export const bulkUpdateActivityPlanningFields = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => activityPlanningFieldsSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: roles, error: rolesError } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    if (rolesError) return { ok: false as const, error: rolesError.message };
    if (!roles?.some((row) => row.role === "planning")) {
      return { ok: false as const, error: "Apenas o perfil Planejamento pode editar estes campos." };
    }

    const payload = data.rows.map((row) => ({
      id: row.id,
      pbs: row.pbs,
      pt_number: row.ptNumber,
      release_type: row.releaseType,
      scheduled_date: row.scheduledDate,
    }));
    const { data: updatedCount, error } = await (supabase as any).rpc("bulk_update_activity_planning_fields", {
      p_rows: payload,
    });
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const, count: Number(updatedCount ?? 0) };
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

const roleSchema = z.enum(["admin", "manager", "planning", "leader", "measurement_control", "logistics", "viewer"]);
const approveSchema = z.object({
  targetUserId: z.string().uuid(),
  approvalStatus: z.enum(["approved", "blocked", "pending"]),
  roles: z.array(roleSchema).min(1, "Selecione pelo menos um perfil.").max(7).optional(),
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
    if (data.roles) {
      const uniqueRoles = [...new Set(data.roles)];
      const { error: deleteError } = await supabaseAdmin.from("user_roles").delete().eq("user_id", data.targetUserId);
      if (deleteError) return { ok: false as const, error: deleteError.message };
      const { error: rErr } = await supabaseAdmin
        .from("user_roles")
        .insert(uniqueRoles.map((role) => ({ user_id: data.targetUserId, role })));
      if (rErr) return { ok: false as const, error: rErr.message };
    }
    return { ok: true as const };
  });
