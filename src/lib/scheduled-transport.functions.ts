import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { requireTransportAccess, fetchAllRows, buildScheduleRows, resolveDates } from "./scheduled-transport.server";
import { MISSING_BADGE_PREFIX, MISSING_EMPLOYEE_ID_PREFIX } from "./overtime.functions";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida");
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Horário inválido");

export const listScheduledTransport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({}).parse(data))
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const info = await requireTransportAccess(supabase, userId);
    if (!info.allowed) return { ok: false as const, error: "Usuário sem permissão para o transporte programado." };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    try {
      const [rows, batches, employees] = await Promise.all([
        fetchAllRows(db, "scheduled_transport_requests", [
          { column: "transport_date", ascending: false },
          { column: "employee_name", ascending: true },
        ]),
        fetchAllRows(db, "scheduled_transport_batches", [{ column: "created_at", ascending: false }]),
        db
          .from("employees")
          .select("*")
          .eq("is_active", true)
          .order("full_name", { ascending: true })
          .then((res: any) => {
            if (res.error) throw new Error(res.error.message);
            return res.data ?? [];
          }),
      ]);
      return { ok: true as const, rows, batches, employees };
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : "Falha ao carregar dados." };
    }
  });

export const createScheduledTransport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        employee_ids: z.array(z.string().uuid()).min(1, "Selecione ao menos um colaborador").max(300),
        start_date: isoDate,
        end_date: isoDate,
        weekdays: z.array(z.number().int().min(0).max(6)).min(1, "Selecione ao menos um dia da semana"),
        entry_time: hhmm,
        departure_time: hhmm,
        needs_snack: z.boolean(),
        needs_transport: z.boolean(),
        order_number: z.string().trim().max(64).nullable().optional(),
        service_description: z.string().trim().max(1000).nullable().optional(),
        observation: z.string().trim().max(1000).nullable().optional(),
        skip_duplicates: z.boolean().optional(),
      })
      .refine((value) => value.start_date <= value.end_date, {
        message: "A data final deve ser igual ou posterior à data inicial.",
        path: ["end_date"],
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const info = await requireTransportAccess(supabase, userId);
    if (!info.allowed) return { ok: false as const, error: "Usuário sem permissão para o transporte programado." };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const uniqueIds = [...new Set(data.employee_ids)];
    const { data: employees, error: employeeError } = await db
      .from("employees")
      .select("*")
      .in("id", uniqueIds)
      .eq("is_active", true);
    if (employeeError) return { ok: false as const, error: "Não foi possível validar os colaboradores." };
    if (!employees || employees.length !== uniqueIds.length) {
      return { ok: false as const, error: "Um ou mais colaboradores não existem ou estão inativos." };
    }

    const dates = resolveDates(data.start_date, data.end_date, data.weekdays);
    if (dates.length === 0) return { ok: false as const, error: "Nenhuma data válida no período informado." };

    const { data: existing, error: existingError } = await db
      .from("scheduled_transport_requests")
      .select("employee_master_id, transport_date, entry_time, departure_time")
      .eq("status", "scheduled")
      .in("employee_master_id", uniqueIds)
      .gte("transport_date", data.start_date)
      .lte("transport_date", data.end_date);
    if (existingError) return { ok: false as const, error: existingError.message };
    const existingKeys = new Set(
      (existing ?? []).map(
        (row: any) =>
          `${row.employee_master_id}|${String(row.transport_date).slice(0, 10)}|${row.entry_time}|${row.departure_time}`,
      ),
    );

    const allRows = buildScheduleRows({
      employees,
      dates,
      batchId: crypto.randomUUID(),
      userId,
      fullName: info.fullName,
      email: info.email,
      entry_time: data.entry_time,
      departure_time: data.departure_time,
      needs_snack: data.needs_snack,
      needs_transport: data.needs_transport,
      order_number: data.order_number?.trim() || null,
      service_description: data.service_description?.trim() || null,
      observation: data.observation?.trim() || null,
      missingBadgePrefix: MISSING_BADGE_PREFIX,
      missingIdPrefix: MISSING_EMPLOYEE_ID_PREFIX,
    });

    const duplicates = allRows.filter((row) =>
      existingKeys.has(`${row.employee_master_id}|${row.transport_date}|${row.entry_time}|${row.departure_time}`),
    );
    if (duplicates.length > 0 && !data.skip_duplicates) {
      return {
        ok: false as const,
        duplicates: duplicates.length,
        total: allRows.length,
        error: `Já existem ${duplicates.length} programação(ões) idêntica(s) neste período.`,
      };
    }
    const rows = data.skip_duplicates
      ? allRows.filter(
          (row) =>
            !existingKeys.has(`${row.employee_master_id}|${row.transport_date}|${row.entry_time}|${row.departure_time}`),
        )
      : allRows;
    if (rows.length === 0) return { ok: false as const, error: "Todas as programações já existiam." };

    const batchId = rows[0].batch_id as string;
    const { error: batchError } = await db.from("scheduled_transport_batches").insert({
      id: batchId,
      start_date: data.start_date,
      end_date: data.end_date,
      weekdays: [...data.weekdays].sort((a, b) => a - b),
      entry_time: data.entry_time,
      departure_time: data.departure_time,
      needs_snack: data.needs_snack,
      needs_transport: data.needs_transport,
      order_number: data.order_number?.trim() || null,
      service_description: data.service_description?.trim() || null,
      observation: data.observation?.trim() || null,
      created_by_user_id: userId,
      created_by_name: info.fullName,
      created_by_email: info.email,
    });
    if (batchError) return { ok: false as const, error: batchError.message };

    const { error: insertError, data: inserted } = await db
      .from("scheduled_transport_requests")
      .insert(rows)
      .select("id");
    if (insertError) {
      await db.from("scheduled_transport_batches").delete().eq("id", batchId);
      return { ok: false as const, error: insertError.message };
    }
    return {
      ok: true as const,
      count: inserted?.length ?? 0,
      skipped: allRows.length - rows.length,
      batchId,
      days: dates.length,
    };
  });

export const updateScheduledTransport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        scope: z.enum(["single", "future"]),
        entry_time: hhmm,
        departure_time: hhmm,
        needs_snack: z.boolean(),
        needs_transport: z.boolean(),
        order_number: z.string().trim().max(64).nullable().optional(),
        service_description: z.string().trim().max(1000).nullable().optional(),
        observation: z.string().trim().max(1000).nullable().optional(),
        version: z.number().int().min(1),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const info = await requireTransportAccess(supabase, userId);
    if (!info.allowed) return { ok: false as const, error: "Usuário sem permissão para o transporte programado." };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;

    const { data: current, error: currentError } = await db
      .from("scheduled_transport_requests")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (currentError) return { ok: false as const, error: currentError.message };
    if (!current) return { ok: false as const, error: "Programação não encontrada." };
    if (current.version !== data.version) {
      return { ok: false as const, error: "Este registro foi alterado por outro usuário. Recarregue a lista." };
    }

    const patch = {
      entry_time: data.entry_time,
      departure_time: data.departure_time,
      needs_snack: data.needs_snack,
      needs_transport: data.needs_transport,
      order_number: data.order_number?.trim() || null,
      service_description: data.service_description?.trim() || null,
      observation: data.observation?.trim() || null,
      updated_by_user_id: userId,
      updated_by_name: info.fullName,
    };

    let query = db.from("scheduled_transport_requests").update(patch).eq("status", "scheduled");
    if (data.scope === "future" && current.batch_id) {
      query = query
        .eq("batch_id", current.batch_id)
        .eq("employee_master_id", current.employee_master_id)
        .gte("transport_date", String(current.transport_date).slice(0, 10));
    } else {
      query = query.eq("id", data.id);
    }
    const { data: updated, error } = await query.select("id");
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const, count: updated?.length ?? 0 };
  });

export const cancelScheduledTransport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        ids: z.array(z.string().uuid()).max(5000).optional(),
        employee_master_id: z.string().uuid().optional(),
        start_date: isoDate.optional(),
        end_date: isoDate.optional(),
      })
      .refine((value) => (value.ids && value.ids.length > 0) || (value.start_date && value.end_date), {
        message: "Informe os registros ou o período a cancelar.",
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const info = await requireTransportAccess(supabase, userId);
    if (!info.allowed) return { ok: false as const, error: "Usuário sem permissão para o transporte programado." };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;

    let query = db
      .from("scheduled_transport_requests")
      .update({
        status: "cancelled",
        cancelled_by_user_id: userId,
        cancelled_by_name: info.fullName,
        cancelled_at: new Date().toISOString(),
        updated_by_user_id: userId,
        updated_by_name: info.fullName,
      })
      .eq("status", "scheduled");

    if (data.ids && data.ids.length > 0) {
      query = query.in("id", data.ids);
    } else {
      query = query.gte("transport_date", data.start_date!).lte("transport_date", data.end_date!);
      if (data.employee_master_id) query = query.eq("employee_master_id", data.employee_master_id);
    }
    const { data: cancelled, error } = await query.select("id");
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const, count: cancelled?.length ?? 0 };
  });
