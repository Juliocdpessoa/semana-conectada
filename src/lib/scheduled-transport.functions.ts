import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { requireTransportAccess, fetchAllRows, buildScheduleRows, resolveDates } from "./scheduled-transport.server";
import { MISSING_BADGE_PREFIX, MISSING_EMPLOYEE_ID_PREFIX } from "./overtime.functions";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida");
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Horário inválido");

export const listScheduledTransport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ start_date: isoDate.optional(), end_date: isoDate.optional() }).parse(data),
  )
  .handler(async ({ context, data: input }) => {
    const { supabase, userId } = context;
    const info = await requireTransportAccess(supabase, userId);
    if (!info.allowed) return { ok: false as const, error: "Usuário sem permissão para o transporte programado." };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    try {
      const fallbackStart = new Date();
      fallbackStart.setDate(fallbackStart.getDate() - 90);
      const defaultStart = `${fallbackStart.getFullYear()}-${String(fallbackStart.getMonth() + 1).padStart(2, "0")}-${String(fallbackStart.getDate()).padStart(2, "0")}`;
      const rows: any[] = [];
      const pageSize = 1000;
      for (let from = 0; ; from += pageSize) {
        let rowsQuery = db
          .from("scheduled_transport_requests")
          .select("*")
          .gte("transport_date", input.start_date || defaultStart)
          .order("transport_date", { ascending: false })
          .order("employee_name", { ascending: true })
          .range(from, from + pageSize - 1);
        if (input.end_date) rowsQuery = rowsQuery.lte("transport_date", input.end_date);
        const { data, error } = await rowsQuery;
        if (error) throw error;
        if (!data?.length) break;
        rows.push(...data);
        if (data.length < pageSize) break;
      }

      const batchIds = Array.from(new Set(rows.map((row) => row.batch_id).filter(Boolean))) as string[];
      const batches: any[] = [];
      for (let from = 0; from < batchIds.length; from += 500) {
        const { data, error } = await db
          .from("scheduled_transport_batches")
          .select("*")
          .in("id", batchIds.slice(from, from + 500))
          .order("created_at", { ascending: false });
        if (error) throw error;
        batches.push(...(data ?? []));
      }
      return { ok: true as const, rows, batches };
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
        transport_employee_ids: z.array(z.string().uuid()).max(300).optional(),
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
      transportIds: data.transport_employee_ids,
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
            !existingKeys.has(
              `${row.employee_master_id}|${row.transport_date}|${row.entry_time}|${row.departure_time}`,
            ),
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
      needs_transport: data.transport_employee_ids ? data.transport_employee_ids.length > 0 : data.needs_transport,
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

    if (current.status !== "scheduled") {
      return { ok: false as const, error: "Somente programações ativas podem ser editadas." };
    }

    let targetsQuery = db.from("scheduled_transport_requests").select("id, version").eq("status", "scheduled");
    if (data.scope === "future" && current.batch_id) {
      targetsQuery = targetsQuery
        .eq("batch_id", current.batch_id)
        .eq("employee_master_id", current.employee_master_id)
        .gte("transport_date", String(current.transport_date).slice(0, 10));
    } else {
      targetsQuery = targetsQuery.eq("id", data.id);
    }
    const { data: targets, error: targetsError } = await targetsQuery;
    if (targetsError) return { ok: false as const, error: targetsError.message };
    if (!targets?.length) return { ok: false as const, error: "Nenhuma programação ativa foi encontrada." };

    let count = 0;
    let conflicts = 0;
    for (const target of targets) {
      const expectedVersion = target.id === data.id ? data.version : target.version;
      const { data: updated, error } = await db
        .from("scheduled_transport_requests")
        .update(patch)
        .eq("id", target.id)
        .eq("status", "scheduled")
        .eq("version", expectedVersion)
        .select("id")
        .maybeSingle();
      if (error) return { ok: false as const, error: error.message };
      if (updated) count += 1;
      else conflicts += 1;
    }
    if (count === 0) {
      return { ok: false as const, error: "Os registros foram alterados por outro usuário. Recarregue a lista." };
    }
    return { ok: true as const, count, conflicts };
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

export type EmployeeDayOffRow = {
  id: string;
  employee_master_id: string;
  employee_registration: string | null;
  employee_name: string;
  employee_role: string | null;
  day_off_date: string;
  observation: string | null;
  created_by_user_id: string;
  created_by_name: string;
  created_by_email: string;
  created_at: string;
  updated_by_user_id: string | null;
  updated_by_name: string | null;
  updated_at: string;
  version: number;
};

const dayOffSchema = z.object({
  employee_id: z.string().uuid(),
  day_off_date: isoDate,
  observation: z.string().max(1000).nullable(),
});

export const listEmployeeDaysOff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({}).parse(data))
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const info = await requireTransportAccess(supabase, userId);
    if (!info.allowed) return { ok: false as const, error: "Usuário sem permissão para visualizar folgas." };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    try {
      const rows = await fetchAllRows(db, "employee_days_off", [
        { column: "day_off_date", ascending: false },
        { column: "employee_name", ascending: true },
      ]);
      return { ok: true as const, rows: rows as EmployeeDayOffRow[] };
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : "Falha ao carregar folgas." };
    }
  });

export const createEmployeeDayOff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => dayOffSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const info = await requireTransportAccess(supabase, userId);
    if (!info.allowed) return { ok: false as const, error: "Usuário sem permissão para registrar folgas." };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { data: employee, error: employeeError } = await db
      .from("employees")
      .select("id,badge,full_name,job_title,is_active")
      .eq("id", data.employee_id)
      .maybeSingle();
    if (employeeError) return { ok: false as const, error: employeeError.message };
    if (!employee?.is_active) return { ok: false as const, error: "Colaborador não encontrado ou inativo." };
    const { data: created, error } = await db
      .from("employee_days_off")
      .insert({
        employee_master_id: employee.id,
        employee_registration: employee.badge,
        employee_name: employee.full_name,
        employee_role: employee.job_title,
        day_off_date: data.day_off_date,
        observation: data.observation?.trim() || null,
        created_by_user_id: userId,
        created_by_name: info.fullName,
        created_by_email: info.email,
      })
      .select("*")
      .single();
    if (error?.code === "23505") {
      return { ok: false as const, error: "Este colaborador já possui uma folga registrada nessa data." };
    }
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const, row: created as EmployeeDayOffRow };
  });

export const updateEmployeeDayOff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    dayOffSchema.extend({ id: z.string().uuid(), version: z.number().int().min(1) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const info = await requireTransportAccess(supabase, userId);
    if (!info.allowed) return { ok: false as const, error: "Usuário sem permissão para editar folgas." };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { data: employee, error: employeeError } = await db
      .from("employees")
      .select("id,badge,full_name,job_title,is_active")
      .eq("id", data.employee_id)
      .maybeSingle();
    if (employeeError) return { ok: false as const, error: employeeError.message };
    if (!employee?.is_active) return { ok: false as const, error: "Colaborador não encontrado ou inativo." };
    const { data: updated, error } = await db
      .from("employee_days_off")
      .update({
        employee_master_id: employee.id,
        employee_registration: employee.badge,
        employee_name: employee.full_name,
        employee_role: employee.job_title,
        day_off_date: data.day_off_date,
        observation: data.observation?.trim() || null,
        updated_by_user_id: userId,
        updated_by_name: info.fullName,
        updated_at: new Date().toISOString(),
        version: data.version + 1,
      })
      .eq("id", data.id)
      .eq("version", data.version)
      .select("*")
      .maybeSingle();
    if (error?.code === "23505") {
      return { ok: false as const, error: "Este colaborador já possui uma folga registrada nessa data." };
    }
    if (error) return { ok: false as const, error: error.message };
    if (!updated) return { ok: false as const, error: "A folga foi alterada por outro usuário. Recarregue a lista." };
    return { ok: true as const, row: updated as EmployeeDayOffRow };
  });

export const deleteEmployeeDayOff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ id: z.string().uuid(), version: z.number().int().min(1) }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const info = await requireTransportAccess(supabase, userId);
    if (!info.allowed) return { ok: false as const, error: "Usuário sem permissão para excluir folgas." };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: deleted, error } = await (supabaseAdmin as any)
      .from("employee_days_off")
      .delete()
      .eq("id", data.id)
      .eq("version", data.version)
      .select("id")
      .maybeSingle();
    if (error) return { ok: false as const, error: error.message };
    if (!deleted) return { ok: false as const, error: "A folga foi alterada por outro usuário. Recarregue a lista." };
    return { ok: true as const };
  });
