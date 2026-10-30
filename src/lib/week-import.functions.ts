import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/lib/password-auth";
import { z } from "zod";
import { rsProgramImportError } from "@/lib/rs-program-base";

function normalizeReleaseType(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleUpperCase("pt-BR");
  if (
    normalized === "OFICINA" ||
    normalized === "OFICINAS" ||
    normalized.includes("SERVICO DE OFICINA")
  ) {
    return "OFICINAS";
  }
  return normalized || null;
}

const rowSchema = z.object({
  source_key: z.string().min(1).max(120),
  order_number: z.string().max(64).nullable().optional(),
  note_number: z.string().max(64).nullable().optional(),
  description: z.string().max(1000).default(""),
  area: z.string().max(160).nullable().optional(),
  specialty: z.string().max(160).nullable().optional(),
  scheduled_date: z.string().nullable().optional(),
  pbs: z.string().max(255).nullable().optional(),
  release_type: z.preprocess(
    normalizeReleaseType,
    z.enum(["PT", "PTT", "ATRE", "OFICINAS"]).nullable().optional(),
  ),
  planning_data: z.record(z.string(), z.any()),
  source_row_number: z.number().int().nullable().optional(),
});

const importSchema = z
  .object({
    code: z.string().min(1).max(32),
    label: z.string().min(1).max(120),
    start_date: z.string(),
    end_date: z.string(),
    source_file_name: z.string().max(240).nullable().optional(),
    sheet_name: z.string().max(120).nullable().optional(),
    rows: z.array(rowSchema).min(1).max(5000),
    rs_base_action: z.literal("update"),
    rs_program: z
      .array(
        z.object({
          confirmation: z.string().regex(/^\d{1,32}$/),
          order_number: z.string().regex(/^\d{1,32}$/),
          operation: z.string().regex(/^\d{1,32}$/),
          suboperation: z.string().max(32),
          center: z.string().min(1).max(160),
          work: z.number().finite().min(0).lt(1e9),
          source_row_number: z.number().int().min(2).max(100000),
          source_data: z.record(
            z.string(),
            z.union([z.string(), z.number().finite(), z.boolean(), z.null()]),
          ),
        }),
      )
      .min(1)
      .max(5000)
      .optional(),
  })
  .superRefine((data, context) => {
    const error = rsProgramImportError(data.rs_base_action, data.rs_program);
    if (error) context.addIssue({ code: "custom", path: ["rs_program"], message: error });
  });

async function loadPlanningContext(supabase: any, userId: string) {
  const [{ data: roles }, { data: profile }] = await Promise.all([
    supabase.from("user_roles").select("role").eq("user_id", userId),
    supabase
      .from("profiles")
      .select("worksite_id, email, approval_status")
      .eq("id", userId)
      .maybeSingle(),
  ]);
  return {
    allowed:
      profile?.approval_status === "approved" &&
      (roles?.some((r: any) => r.role === "planning" || r.role === "admin") ?? false),
    worksiteId: profile?.worksite_id as string | undefined,
  };
}

export const importWeek = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => importSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const access = await loadPlanningContext(supabase, userId);
    if (!access.allowed || !access.worksiteId) {
      return {
        ok: false as const,
        error: "Somente planejamento/administrador pode importar semanas.",
      };
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;

    // Duplicate check
    const { data: existing } = await db
      .from("weeks")
      .select("id, code")
      .eq("code", data.code)
      .eq("worksite_id", access.worksiteId)
      .maybeSingle();
    if (existing) {
      return { ok: false as const, error: `Já existe uma semana com o código ${data.code}.` };
    }

    // Keep historical weeks: daily screens load only their recent working window.
    // Official SAP + RS closures must never be deleted to make room for a new week.

    const { data: week, error: wErr } = await db
      .from("weeks")
      .insert({
        worksite_id: access.worksiteId,
        code: data.code,
        label: data.label,
        start_date: data.start_date,
        end_date: data.end_date,
        is_active: false,
        lifecycle_status: "preparation",
        source_file_name: data.source_file_name ?? null,
        sheet_name: data.sheet_name ?? null,
        imported_at: new Date().toISOString(),
        imported_by: userId,
      })
      .select("id")
      .single();
    if (wErr) return { ok: false as const, error: wErr.message };

    const payload = data.rows.map((r, index) => ({
      worksite_id: access.worksiteId,
      week_id: week.id,
      source_key: `${r.source_key}|IMPORT-${r.source_row_number ?? index + 2}`,
      order_number: r.order_number ?? null,
      note_number: r.note_number ?? null,
      description: r.description ?? "",
      area: r.area ?? null,
      specialty: r.specialty ?? null,
      scheduled_date: r.scheduled_date ?? null,
      pbs: r.pbs?.trim() || null,
      release_type: r.release_type ?? null,
      pt_color: r.release_type === "PTT" ? ("white" as const) : null,
      planning_data: r.planning_data,
      source_row_number: r.source_row_number ?? null,
      status: "Sem apontamento",
      is_immediate: false,
      created_by: userId,
    }));

    // Insert in chunks of 500
    for (let i = 0; i < payload.length; i += 500) {
      const chunk = payload.slice(i, i + 500);
      const { error } = await supabaseAdmin.from("activities").insert(chunk);
      if (error) {
        await db.from("weeks").delete().eq("id", week.id);
        return { ok: false as const, error: `Erro ao inserir linha ${i}: ${error.message}` };
      }
    }

    let officialError: string | undefined;
    if (data.rs_base_action === "update" && data.rs_program) {
      // Save through the authenticated, versioned RPC. If it fails, retain the imported
      // operational week and surface the missing basis explicitly; never ask users to reimport tasks.
      const { error } = await (supabase as any).rpc("save_weekly_rs_program_base", {
        p_week_id: week.id,
        p_rows: data.rs_program,
        p_source_file_name: data.source_file_name ?? "Importação semanal",
        p_sheet_name: "Programação SAP",
        p_expected_version: 0,
      });
      if (error) officialError = error.message;
    }
    return { ok: true as const, weekId: week.id, count: payload.length, officialError };
  });

export const activateWeek = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => z.object({ weekId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const access = await loadPlanningContext(supabase, userId);
    if (!access.allowed || !access.worksiteId) {
      return { ok: false as const, error: "Sem permissão." };
    }
    const { error } = await (supabase as any).rpc("activate_operational_week", {
      p_week_id: data.weekId,
    });
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const };
  });

const sapClosureActionSchema = z.discriminatedUnion("action", [
  z.object({
    weekId: z.string().uuid(),
    action: z.literal("close"),
    reason: z.string().trim().min(3).max(500),
  }),
  z.object({
    weekId: z.string().uuid(),
    action: z.literal("reopen"),
    reason: z.string().trim().min(3).max(500),
  }),
  z.object({
    weekId: z.string().uuid(),
    action: z.literal("extend"),
    deadline: z.string().datetime(),
    reason: z.string().trim().min(3).max(500),
  }),
]);

export const manageSapClosure = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => sapClosureActionSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const access = await loadPlanningContext(supabase, userId);
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    const isAdmin = roles?.some((role: any) => role.role === "admin") ?? false;
    if (!access.allowed || !access.worksiteId || !isAdmin) {
      return {
        ok: false as const,
        error: "Somente o administrador da obra pode controlar o fechamento SAP.",
      };
    }
    const functionName =
      data.action === "close"
        ? "close_sap_week"
        : data.action === "reopen"
          ? "reopen_sap_week"
          : "extend_sap_week_deadline";
    const parameters =
      data.action === "extend"
        ? { p_week_id: data.weekId, p_deadline: data.deadline, p_reason: data.reason }
        : { p_week_id: data.weekId, p_reason: data.reason };
    const { error } = await (supabase as any).rpc(functionName, parameters);
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const };
  });

export const deleteWeek = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => z.object({ weekId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const access = await loadPlanningContext(supabase, userId);
    if (!access.allowed || !access.worksiteId) {
      return { ok: false as const, error: "Sem permissão." };
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { data: week, error: weekError } = await db
      .from("weeks")
      .select("id, is_active, lifecycle_status")
      .eq("id", data.weekId)
      .eq("worksite_id", access.worksiteId)
      .maybeSingle();
    if (weekError) return { ok: false as const, error: weekError.message };
    if (!week) return { ok: false as const, error: "Semana não encontrada." };
    if (week.is_active || week.lifecycle_status === "operational")
      return { ok: false as const, error: "A semana operacional não pode ser excluída." };

    const { count: closures, error: closureError } = await db
      .from("weekly_rs_closures")
      .select("id", { count: "exact", head: true })
      .eq("week_id", data.weekId);
    if (closureError) return { ok: false as const, error: closureError.message };
    if (closures)
      return {
        ok: false as const,
        error:
          "Esta semana possui fechamento SAP + RS preservado e não pode ser excluída. Consulte o histórico em Gestão Operacional → Realização Semanal.",
      };
    const { count: sapLoads, error: sapError } = await db
      .from("sap_confirmation_imports")
      .select("id", { count: "exact", head: true })
      .eq("week_id", data.weekId);
    if (sapError) return { ok: false as const, error: sapError.message };
    if (sapLoads)
      return {
        ok: false as const,
        error:
          "Esta semana possui cargas SAP preservadas. Não é necessário excluí-la para importar novas semanas.",
      };

    const { count: programBases, error: programError } = await db
      .from("weekly_rs_program_bases")
      .select("week_id", { count: "exact", head: true })
      .eq("week_id", data.weekId);
    if (programError) return { ok: false as const, error: programError.message };
    if (programBases)
      return {
        ok: false as const,
        error:
          "Esta semana possui base oficial RS e histórico preservados. Não é necessário excluir semanas para importar novas programações. Consulte Gestão Operacional → Realização Semanal.",
      };

    const { error } = await db.from("weeks").delete().eq("id", data.weekId);
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const };
  });
