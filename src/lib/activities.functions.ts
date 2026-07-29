import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const updateSchema = z.object({
  activityId: z.string().uuid(),
  expectedVersion: z.number().int().min(1),
  status: z.enum(["Sem apontamento", "EXECUTADO", "NÃO EXECUTADO"]),
  justification: z.string().max(200).nullable(),
  observation: z.string().max(2000).nullable(),
  immediateActivityIds: z.array(z.string().uuid()).max(100).optional().default([]),
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
    const requiresImmediateLink = data.status === "NÃO EXECUTADO" && data.justification?.startsWith("08 -");

    const { data: currentActivity, error: currentError } = await supabase
      .from("activities")
      .select("id, week_id, is_immediate, planning_data")
      .eq("id", data.activityId)
      .maybeSingle();
    if (currentError) return { ok: false as const, error: currentError.message };
    if (!currentActivity) return { ok: false as const, error: "Atividade não encontrada." };
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
        justification: data.justification,
        observation: data.observation,
        planning_data: nextPlanningData,
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
  status: z.enum(["Sem apontamento", "EXECUTADO", "NÃO EXECUTADO"]),
  justification: z.string().max(200).nullable(),
  observation: z.string().max(2000).nullable(),
  immediateActivityIds: z.array(z.string().uuid()).max(100).optional().default([]),
});

export const bulkUpdateActivities = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => bulkSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (REQUIRES_JUSTIFICATION.has(data.status) && !data.justification?.trim()) {
      return { ok: false as const, error: "Justificativa é obrigatória para este status." };
    }

    const requiresImmediateLink = data.status === "NÃO EXECUTADO" && data.justification?.startsWith("08 -");
    const linkedIds = Array.from(new Set(data.immediateActivityIds));
    if (requiresImmediateLink && linkedIds.length === 0) {
      return { ok: false as const, error: "Selecione ao menos uma atividade imediata atendida." };
    }

    const { data: selectedActivities, error: selectedError } = await supabase
      .from("activities")
      .select("id, week_id, is_immediate, planning_data")
      .in("id", data.ids);
    if (selectedError) return { ok: false as const, error: selectedError.message };
    if ((selectedActivities?.length ?? 0) !== data.ids.length) {
      return { ok: false as const, error: "Uma ou mais atividades selecionadas não foram encontradas." };
    }
    const selectedWeeks = new Set((selectedActivities ?? []).map((activity) => activity.week_id));
    if (selectedWeeks.size !== 1) {
      return { ok: false as const, error: "As atividades do lote devem pertencer à mesma semana." };
    }
    if (requiresImmediateLink && selectedActivities?.some((activity) => activity.is_immediate)) {
      return { ok: false as const, error: "Selecione somente atividades programadas para vincular às imediatas." };
    }
    if (requiresImmediateLink) {
      const weekId = selectedActivities![0].week_id;
      const { data: validImmediates, error: immediateError } = await supabase
        .from("activities")
        .select("id")
        .eq("week_id", weekId)
        .eq("is_immediate", true)
        .in("id", linkedIds);
      if (immediateError) return { ok: false as const, error: immediateError.message };
      if ((validImmediates?.length ?? 0) !== linkedIds.length) {
        return { ok: false as const, error: "Uma ou mais imediatas selecionadas não pertencem à semana atual." };
      }
    }

    const { data: prof } = await supabase.from("profiles").select("full_name, email").eq("id", userId).maybeSingle();
    const reportedAt = new Date().toISOString();
    const reportFields = {
      status: data.status,
      justification: data.justification,
      observation: data.observation,
      reported_by_user_id: userId,
      reported_by_name: prof?.full_name ?? "",
      reported_by_email: prof?.email ?? "",
      reported_at: reportedAt,
    };

    const results = await Promise.all(
      (selectedActivities ?? []).map(async (activity) => {
        const nextPlanningData = { ...((activity.planning_data ?? {}) as Record<string, unknown>) };
        if (requiresImmediateLink) nextPlanningData.__linked_immediate_ids = linkedIds;
        else delete nextPlanningData.__linked_immediate_ids;
        const { error } = await supabase
          .from("activities")
          .update({ ...reportFields, planning_data: nextPlanningData })
          .eq("id", activity.id);
        return error;
      }),
    );
    const updateError = results.find(Boolean);
    if (updateError) return { ok: false as const, error: updateError.message };

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
        .eq("week_id", selectedActivities![0].week_id)
        .eq("is_immediate", true)
        .in("id", linkedIds);
      if (immediateUpdateError) return { ok: false as const, error: immediateUpdateError.message };
    }
    return { ok: true as const, count: selectedActivities?.length ?? 0 };
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

const roleSchema = z.enum(["admin", "manager", "planning", "leader", "measurement_control", "viewer"]);
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
