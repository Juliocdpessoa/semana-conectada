import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const updateSchema = z.object({
  activityId: z.string().uuid(),
  expectedVersion: z.number().int().min(1),
  status: z.enum([
    "Sem apontamento",
    "EXECUTADO",
    "NÃO EXECUTADO",
    "AGUARDANDO PRÉ-EMISSÃO DE PT",
    "PT EM ASSINATURA",
    "PT ENVIADA P/ CAMPO",
    "CANCELADA",
  ]),
  justification: z.string().max(200).nullable(),
  observation: z.string().max(2000).nullable(),
  immediateActivityIds: z.array(z.string().uuid()).max(100).optional().default([]),
});

const REQUIRES_JUSTIFICATION = new Set(["NÃO EXECUTADO", "CANCELADA"]);
const PLANNING_WORKFLOW_STATUSES = new Set(["AGUARDANDO PRÉ-EMISSÃO DE PT", "PT EM ASSINATURA", "PT ENVIADA P/ CAMPO"]);
const CANCELLATION_JUSTIFICATIONS = new Set([
  "11 - MUDANÇA DE ESCOPO DA INTERVENÇÃO",
  "12 - SERVIÇO CANCELADO",
  "15 - PROGRAMAÇÃO INDEVIDA",
  "17 - TAREFA ELIMINADA EQUIVOCADAMENTE DO SAP",
  "22 - ATIVIDADE EXECUTADA ANTERIORMENTE",
  "29 - OUTROS TIPOS DE PENDENCIAS",
]);
const JULIO_ADMIN_EMAIL = "julio.pessoa@normatel.com.br";

function isJulioPlanningAdmin(email: string | null | undefined) {
  return (
    String(email ?? "")
      .trim()
      .toLowerCase() === JULIO_ADMIN_EMAIL
  );
}

function canUseRestrictedPlanningWorkflow(roles: readonly string[], email: string | null | undefined) {
  return roles.includes("planning") || (roles.includes("admin") && isJulioPlanningAdmin(email));
}
async function canUsePlanningWorkflow(
  supabase: any,
  userId: string,
  roles: Array<{ role: string }> | null | undefined,
) {
  const roleNames = (roles ?? []).map((row) => row.role);
  if (!roleNames.includes("admin") && !roleNames.includes("planning")) return false;
  const { data: profile } = await supabase.from("profiles").select("email").eq("id", userId).maybeSingle();
  return canUseRestrictedPlanningWorkflow(roleNames, profile?.email);
}

export const updateActivity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => updateSchema.parse(data))
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
    if (PLANNING_WORKFLOW_STATUSES.has(data.status) && currentActivity.status !== data.status) {
      const { data: roles, error: rolesError } = await supabase.from("user_roles").select("role").eq("user_id", userId);
      if (rolesError) return { ok: false as const, error: rolesError.message };
      if (!(await canUsePlanningWorkflow(supabase, userId, roles))) {
        return {
          ok: false as const,
          error: "Somente o perfil Planejamento pode atribuir este status.",
        };
      }
    }
    if (data.status === "CANCELADA") {
      const { data: roles, error: rolesError } = await supabase.from("user_roles").select("role").eq("user_id", userId);
      if (rolesError) return { ok: false as const, error: rolesError.message };
      const isPlanning = await canUsePlanningWorkflow(supabase, userId, roles);
      const preservesExistingCancellation =
        currentActivity.status === "CANCELADA" && currentActivity.justification === normalizedJustification;
      if (!isPlanning && !preservesExistingCancellation) {
        return {
          ok: false as const,
          error: "Somente o perfil Planejamento pode cancelar atividades.",
        };
      }
      if (!normalizedJustification || !CANCELLATION_JUSTIFICATIONS.has(normalizedJustification)) {
        return { ok: false as const, error: "Selecione uma justificativa de cancelamento válida." };
      }
    }
    if (requiresImmediateLink && currentActivity.is_immediate) {
      return {
        ok: false as const,
        error: "Uma atividade imediata não pode ser vinculada a ela mesma.",
      };
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
        return {
          ok: false as const,
          error: "Uma ou mais imediatas selecionadas não pertencem à semana atual.",
        };
      }
    }

    // Use the same database transaction as bulk updates. This locks the
    // selected row, validates its version and updates linked immediates
    // atomically, so a partial save cannot be left behind.
    const { error } = await (supabase as any).rpc("bulk_update_activity_reports_v2", {
      p_rows: [{ id: data.activityId, expected_version: data.expectedVersion }],
      p_status: data.status,
      p_justification: normalizedJustification,
      p_observation: data.observation,
      p_linked_ids: requiresImmediateLink ? linkedIds : [],
    });
    if (error) {
      if (/alterad[ao]s? por outro usu[aá]rio|recarregue/i.test(error.message)) {
        const { data: current } = await supabase
          .from("activities")
          .select("id, version, status, justification, observation, reported_by_name")
          .eq("id", data.activityId)
          .maybeSingle();
        return { ok: false as const, conflict: true, current };
      }
      return { ok: false as const, error: error.message };
    }

    const { data: updated, error: updatedError } = await supabase
      .from("activities")
      .select("id, version, status, justification, observation, reported_by_name, reported_at")
      .eq("id", data.activityId)
      .maybeSingle();
    if (updatedError) return { ok: false as const, error: updatedError.message };
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
  rows: z
    .array(z.object({ id: z.string().uuid(), expectedVersion: z.number().int().min(1) }))
    .min(1)
    .max(500),
  status: z.enum([
    "Sem apontamento",
    "EXECUTADO",
    "NÃO EXECUTADO",
    "AGUARDANDO PRÉ-EMISSÃO DE PT",
    "PT EM ASSINATURA",
    "PT ENVIADA P/ CAMPO",
    "CANCELADA",
  ]),
  justification: z.string().max(200).nullable(),
  observation: z.string().max(2000).nullable(),
  immediateActivityIds: z.array(z.string().uuid()).max(100).optional().default([]),
});

export const bulkUpdateActivities = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => bulkSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const normalizedJustification = REQUIRES_JUSTIFICATION.has(data.status) ? data.justification?.trim() || null : null;
    if (PLANNING_WORKFLOW_STATUSES.has(data.status)) {
      const { data: roles, error: rolesError } = await supabase.from("user_roles").select("role").eq("user_id", userId);
      if (rolesError) return { ok: false as const, error: rolesError.message };
      if (!(await canUsePlanningWorkflow(supabase, userId, roles))) {
        return {
          ok: false as const,
          error: "Somente o perfil Planejamento pode atribuir este status.",
        };
      }
    }
    if (data.status === "CANCELADA") {
      const { data: roles, error: rolesError } = await supabase.from("user_roles").select("role").eq("user_id", userId);
      if (rolesError) return { ok: false as const, error: rolesError.message };
      if (!(await canUsePlanningWorkflow(supabase, userId, roles))) {
        return {
          ok: false as const,
          error: "Somente o perfil Planejamento pode cancelar atividades.",
        };
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

    const uniqueRows = Array.from(new Map(data.rows.map((row) => [row.id, row])).values());
    const { data: updatedCount, error } = await (supabase as any).rpc("bulk_update_activity_reports_v2", {
      p_rows: uniqueRows.map((row) => ({ id: row.id, expected_version: row.expectedVersion })),
      p_status: data.status,
      p_justification: normalizedJustification,
      p_observation: data.observation,
      p_linked_ids: requiresImmediateLink ? linkedIds : [],
    });
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const, count: Number(updatedCount ?? uniqueRows.length) };
  });

const activityPlanningFieldsSchema = z.object({
  rows: z
    .array(
      z.object({
        id: z.string().uuid(),
        expectedVersion: z.number().int().min(1),
        pbs: z.string().max(120).nullable(),
        ptNumber: z.string().max(120).nullable(),
        ptColor: z.enum(["red", "yellow", "white"]).nullable(),
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

const DATE_EDIT_TIMEZONE = "America/Sao_Paulo";
const DEFAULT_DATE_EDIT_CUTOFF = "15:00";

function currentMinutesInSaoPaulo() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: DATE_EDIT_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

function isPastDateEditCutoff(cutoffTime: string) {
  const [hour, minute] = cutoffTime.slice(0, 5).split(":").map(Number);
  return currentMinutesInSaoPaulo() >= hour * 60 + minute;
}

async function getDateEditAccess(supabase: any, userId: string) {
  const [{ data: profile }, { data: setting }] = await Promise.all([
    supabase.from("profiles").select("email").eq("id", userId).maybeSingle(),
    supabase.from("activity_edit_settings").select("date_edit_cutoff").eq("id", true).maybeSingle(),
  ]);
  const cutoffTime = String(setting?.date_edit_cutoff ?? DEFAULT_DATE_EDIT_CUTOFF).slice(0, 5);
  const email = String(profile?.email ?? "")
    .trim()
    .toLowerCase();
  return {
    cutoffTime,
    locked: isPastDateEditCutoff(cutoffTime),
    canConfigure: isJulioPlanningAdmin(email),
  };
}

export const getActivityDateEditSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const access = await getDateEditAccess(context.supabase, context.userId);
    return { ok: true as const, ...access, timezone: DATE_EDIT_TIMEZONE };
  });

const dateEditCutoffSchema = z.object({
  cutoffTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
});

export const updateActivityDateEditCutoff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => dateEditCutoffSchema.parse(data))
  .handler(async ({ data, context }) => {
    const access = await getDateEditAccess(context.supabase, context.userId);
    if (!access.canConfigure) {
      return {
        ok: false as const,
        error: `Somente o administrador ${JULIO_ADMIN_EMAIL} pode alterar o horário de corte.`,
      };
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await (supabaseAdmin as any).from("activity_edit_settings").upsert({
      id: true,
      date_edit_cutoff: `${data.cutoffTime}:00`,
      updated_by: context.userId,
      updated_at: new Date().toISOString(),
    });
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const, cutoffTime: data.cutoffTime };
  });

export const bulkUpdateActivityPlanningFields = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => activityPlanningFieldsSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: roles, error: rolesError } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    if (rolesError) return { ok: false as const, error: rolesError.message };
    if (!roles?.some((row) => row.role === "planning" || row.role === "admin")) {
      return {
        ok: false as const,
        error: "Apenas Planejamento ou Administrador pode editar estes campos.",
      };
    }

    const access = await getDateEditAccess(supabase, userId);
    if (access.locked) {
      const ids = data.rows.map((row) => row.id);
      const { data: currentRows, error: currentRowsError } = await supabase
        .from("activities")
        .select("id, scheduled_date")
        .in("id", ids);
      if (currentRowsError) return { ok: false as const, error: currentRowsError.message };
      const currentDates = new Map((currentRows ?? []).map((row) => [row.id, row.scheduled_date]));
      const changesDate = data.rows.some((row) => (currentDates.get(row.id) ?? null) !== row.scheduledDate);
      if (changesDate) {
        return {
          ok: false as const,
          error: `A alteração de datas está bloqueada após ${access.cutoffTime}. Procure o administrador julio.pessoa@normatel.com.br.`,
        };
      }
    }

    const payload = data.rows.map((row) => ({
      id: row.id,
      expected_version: row.expectedVersion,
      pbs: row.pbs,
      pt_number: row.ptNumber,
      pt_color: row.ptColor,
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
  .validator((data: unknown) => immediateSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    const canCreate = roles?.some((r) => r.role === "planning" || r.role === "admin");
    if (!canCreate)
      return {
        ok: false as const,
        error: "Somente planejamento/administrador pode cadastrar IMEDIATAS.",
      };
    const { data: week } = await (supabase as any)
      .from("weeks")
      .select("id,worksite_id")
      .eq("id", data.weekId)
      .maybeSingle();
    if (!week?.worksite_id) return { ok: false as const, error: "Semana não encontrada na obra ativa." };
    const sourceKey = `IMD-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    const { data: created, error } = await supabase
      .from("activities")
      .insert({
        worksite_id: week.worksite_id,
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
  .validator((data: unknown) => bulkImmediateSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    const canCreate = roles?.some((r) => r.role === "planning" || r.role === "admin");
    if (!canCreate)
      return {
        ok: false as const,
        error: "Somente planejamento/administrador pode cadastrar IMEDIATAS.",
      };
    const { data: week } = await (supabase as any)
      .from("weeks")
      .select("id,worksite_id")
      .eq("id", data.weekId)
      .maybeSingle();
    if (!week?.worksite_id) return { ok: false as const, error: "Semana não encontrada na obra ativa." };
    const now = Date.now();
    const payload = data.items.map((it, idx) => ({
      worksite_id: week.worksite_id,
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
  .validator((data: unknown) => approveSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: myRoles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    if (!myRoles?.some((r) => r.role === "admin")) {
      return { ok: false as const, error: "Apenas administradores podem alterar aprovação." };
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: actor }, { data: target, error: targetError }] = await Promise.all([
      supabaseAdmin.from("profiles").select("email, worksite_id, approval_status").eq("id", userId).maybeSingle(),
      supabaseAdmin.from("profiles").select("id, worksite_id").eq("id", data.targetUserId).maybeSingle(),
    ]);
    if (targetError) return { ok: false as const, error: targetError.message };
    if (!actor || actor.approval_status !== "approved" || !target) {
      return { ok: false as const, error: "Usuário ou administrador não encontrado." };
    }
    const isGlobalAdmin = actor.email?.toLowerCase() === "julio.pessoa@normatel.com.br";
    if (!isGlobalAdmin && actor.worksite_id !== target.worksite_id) {
      return { ok: false as const, error: "Você só pode aprovar usuários da sua obra." };
    }
    if (!isGlobalAdmin && data.roles?.includes("admin")) {
      return { ok: false as const, error: "Somente o administrador geral pode conceder o perfil administrador." };
    }
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
