import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const rowSchema = z.object({
  source_key: z.string().min(1).max(120),
  order_number: z.string().max(64).nullable().optional(),
  note_number: z.string().max(64).nullable().optional(),
  description: z.string().max(1000).default(""),
  area: z.string().max(160).nullable().optional(),
  specialty: z.string().max(160).nullable().optional(),
  scheduled_date: z.string().nullable().optional(),
  planning_data: z.record(z.string(), z.any()),
  source_row_number: z.number().int().nullable().optional(),
});

const importSchema = z.object({
  code: z.string().min(1).max(32),
  label: z.string().min(1).max(120),
  start_date: z.string(),
  end_date: z.string(),
  source_file_name: z.string().max(240).nullable().optional(),
  sheet_name: z.string().max(120).nullable().optional(),
  activate: z.boolean().default(true),
  rows: z.array(rowSchema).min(1).max(5000),
});

async function requirePlanning(supabase: any, userId: string) {
  const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  return roles?.some((r: any) => r.role === "planning" || r.role === "admin") ?? false;
}

export const importWeek = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => importSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (!(await requirePlanning(supabase, userId))) {
      return { ok: false as const, error: "Somente planejamento/administrador pode importar semanas." };
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Duplicate check
    const { data: existing } = await supabaseAdmin
      .from("weeks")
      .select("id, code")
      .eq("code", data.code)
      .maybeSingle();
    if (existing) {
      return { ok: false as const, error: `Já existe uma semana com o código ${data.code}.` };
    }

    if (data.activate) {
      await supabaseAdmin.from("weeks").update({ is_active: false }).eq("is_active", true);
    }

    const { data: week, error: wErr } = await supabaseAdmin
      .from("weeks")
      .insert({
        code: data.code,
        label: data.label,
        start_date: data.start_date,
        end_date: data.end_date,
        is_active: data.activate,
        source_file_name: data.source_file_name ?? null,
        sheet_name: data.sheet_name ?? null,
        imported_at: new Date().toISOString(),
        imported_by: userId,
      })
      .select("id")
      .single();
    if (wErr) return { ok: false as const, error: wErr.message };

    const payload = data.rows.map((r) => ({
      week_id: week.id,
      source_key: r.source_key,
      order_number: r.order_number ?? null,
      note_number: r.note_number ?? null,
      description: r.description ?? "",
      area: r.area ?? null,
      specialty: r.specialty ?? null,
      scheduled_date: r.scheduled_date ?? null,
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
      if (error) return { ok: false as const, error: `Erro ao inserir linha ${i}: ${error.message}` };
    }

    return { ok: true as const, weekId: week.id, count: payload.length };
  });

export const activateWeek = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ weekId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (!(await requirePlanning(supabase, userId))) {
      return { ok: false as const, error: "Sem permissão." };
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("weeks").update({ is_active: false }).eq("is_active", true);
    const { error } = await supabaseAdmin.from("weeks").update({ is_active: true }).eq("id", data.weekId);
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const };
  });
