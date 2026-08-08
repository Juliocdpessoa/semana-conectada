import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export type OvertimeRow = {
  id: string;
  batch_id: string | null;
  request_number: number;
  requester_user_id: string;
  requester_name: string;
  requester_email: string;
  employee_name: string;
  employee_registration: string;
  employee_external_id: string | null;
  employee_role: string;
  activity_id: string | null;
  week_id: string | null;
  order_number: string | null;
  service_description: string;
  overtime_date: string;
  entry_time: string | null;
  departure_time: string;
  needs_snack: boolean;
  needs_transport: boolean;
  employee_address?: string | null;
  employee_neighborhood?: string | null;
  employee_city?: string | null;
  employee_phone?: string | null;
  employee_message_contact?: string | null;
  employee_transport_line?: string | null;
  justification: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  manager_comment: string | null;
  decided_by_name: string | null;
  decided_at: string | null;
  version: number;
  created_at: string;
};

export type EmployeeRow = {
  id: string;
  badge: string;
  employee_id: string;
  admission_date: string;
  full_name: string;
  job_title: string;
  address: string | null;
  neighborhood: string | null;
  city: string | null;
  phone: string | null;
  message_contact: string | null;
  transport_line: string | null;
  is_active: boolean;
};

export type DisplayOvertimeRow = OvertimeRow & {
  groupMembers?: OvertimeRow[];
};

export const WEEKLY_ACTIVITY_EXPORT_COLUMNS = [
  "Tipo de Nota",
  "Nota",
  "Confirmação",
  "Ordem",
  "Op",
  "Subop",
  "Data início",
  "Hora início",
  "Data fim",
  "Hora fim",
  "Gr pl",
  "Área op",
  "CenTrab",
  "TxtDesc.Oper.",
  "Localização",
  "Nº",
  "Dur n",
  "Trab",
  "Gerência",
  "Local",
  "Status",
  "Justificativa",
  "Observações",
] as const;

export function sanitizeEmployeeRow(employee: EmployeeRow): EmployeeRow {
  return {
    ...employee,
    badge: employee.badge.startsWith(MISSING_BADGE_PREFIX) ? "" : employee.badge,
    employee_id: employee.employee_id.startsWith(MISSING_EMPLOYEE_ID_PREFIX) ? "" : employee.employee_id,
  };
}

export function normalizeEmployeeDate(value: string) {
  const clean = value.trim();
  const isoMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(clean);
  const brMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[T\s].*)?$/.exec(clean);
  const year = isoMatch ? isoMatch[1] : brMatch?.[3];
  const month = (isoMatch ? isoMatch[2] : brMatch?.[2])?.padStart(2, "0");
  const day = (isoMatch ? isoMatch[3] : brMatch?.[1])?.padStart(2, "0");
  if (!year || !month || !day) return null;
  const iso = `${year}-${month}-${day}`;
  const date = new Date(`${iso}T00:00:00Z`);
  return date.getUTCFullYear() === Number(year) &&
    date.getUTCMonth() + 1 === Number(month) &&
    date.getUTCDate() === Number(day)
    ? iso
    : null;
}

export function formatDate(iso: string) {
  if (!iso) return "";
  const [year, month, day] = iso.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

export function formatOvertimeStatus(status: OvertimeRow["status"]) {
  return {
    pending: "Pendente",
    approved: "Aprovado",
    rejected: "Reprovado",
    cancelled: "Cancelado",
  }[status];
}

export function formatDateTime(iso: string) {
  const date = new Date(iso);
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function loadRoleAndProfile(supabase: any, userId: string) {
  const [rolesRes, profRes] = await Promise.all([
    supabase.from("user_roles").select("role").eq("user_id", userId),
    supabase.from("profiles").select("full_name, email, approval_status").eq("id", userId).maybeSingle(),
  ]);
  const roles = (rolesRes.data ?? []).map((r: { role: string }) => r.role);
  return {
    isAdmin: roles.includes("admin"),
    isManager: roles.includes("manager"),
    isLeader: roles.includes("leader"),
    isMeasurementControl: roles.includes("measurement_control"),
    isLogistics: roles.includes("logistics"),
    fullName: profRes.data?.full_name ?? "",
    email: profRes.data?.email ?? "",
    approvalStatus: profRes.data?.approval_status ?? "pending",
  };
}

export const listApprovedTransportRows = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({}).parse(data))
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const info = await loadRoleAndProfile(supabase, userId);
    if (info.approvalStatus !== "approved") return { ok: false as const, error: "Usuário não aprovado." };
    if (!(info.isAdmin || info.isManager || info.isLogistics)) {
      return { ok: false as const, error: "Usuário sem permissão para visualizar transportes." };
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const rows: any[] = [];
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await db
        .from("overtime_requests")
        .select("*")
        .neq("status", "cancelled")
        .order("overtime_date", { ascending: false })
        .order("employee_name", { ascending: true })
        .range(from, from + pageSize - 1);
      if (error) return { ok: false as const, error: error.message };
      if (!data?.length) break;
      rows.push(...data);
      if (data.length < pageSize) break;
    }
    return { ok: true as const, rows };
  });

const exportListSchema = z.object({});

export const listOvertimeForExport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => exportListSchema.parse(data))
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const info = await loadRoleAndProfile(supabase, userId);
    if (info.approvalStatus !== "approved") {
      return { ok: false as const, error: "Usuário não aprovado." };
    }
    if (!(info.isAdmin || info.isManager || info.isMeasurementControl || info.isLogistics)) {
      return { ok: false as const, error: "Usuário sem permissão para exportar horas extras." };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const rows: any[] = [];
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await db
        .from("overtime_requests")
        .select("*")
        .neq("status", "cancelled")
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, from + pageSize - 1);
      if (error) return { ok: false as const, error: error.message };
      if (!data?.length) break;
      rows.push(...data);
      if (data.length < pageSize) break;
    }
    const registrations = [
      ...new Set(rows.map((row) => String(row.employee_registration || "").trim()).filter(Boolean)),
    ];
    const employeeByBadge = new Map<string, any>();
    for (let from = 0; from < registrations.length; from += 500) {
      const { data: employees, error: employeeError } = await db
        .from("employees")
        .select("badge,address,neighborhood,city,phone,message_contact,transport_line")
        .in("badge", registrations.slice(from, from + 500));
      if (employeeError) return { ok: false as const, error: employeeError.message };
      for (const employee of employees ?? []) employeeByBadge.set(String(employee.badge).trim(), employee);
    }
    const enrichedRows = rows.map((row) => {
      const employee = employeeByBadge.get(String(row.employee_registration || "").trim());
      return {
        ...row,
        employee_address: employee?.address ?? null,
        employee_neighborhood: employee?.neighborhood ?? null,
        employee_city: employee?.city ?? null,
        employee_phone: employee?.phone ?? null,
        employee_message_contact: employee?.message_contact ?? null,
        employee_transport_line: employee?.transport_line ?? null,
      };
    });
    return { ok: true as const, rows: enrichedRows };
  });

function isValidDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

const createSchema = z
  .object({
    employee_ids: z.array(z.string().uuid()).min(1, "Selecione ao menos um colaborador").max(100),
    transport_employee_ids: z.array(z.string().uuid()).max(100).optional(),

    activity_id: z.string().uuid().nullable().optional(),
    week_id: z.string().uuid().nullable().optional(),
    order_number: z.string().trim().max(64).nullable().optional(),
    service_description: z.string().trim().min(3).max(1000),
    overtime_date: z.string().refine(isValidDate, "Data inválida"),
    entry_time: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Horário de entrada inválido")
      .nullable()
      .optional(),
    departure_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Horário inválido"),
    needs_snack: z.boolean(),
    justification: z.string().trim().min(3).max(1000),
  })
  .superRefine((data, ctx) => {
    if ((data.activity_id && !data.week_id) || (!data.activity_id && data.week_id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["activity_id"],
        message: "Atividade e semana devem ser informadas juntas.",
      });
    }
  });

export const createOvertimeRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => createSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const info = await loadRoleAndProfile(supabase, userId);
    if (info.approvalStatus !== "approved") return { ok: false as const, error: "Usuário não aprovado." };
    if (!(info.isLeader || info.isAdmin || info.isMeasurementControl))
      return { ok: false as const, error: "Usuário sem permissão para solicitar hora extra." };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const uniqueEmployeeIds = [...new Set(data.employee_ids)];
    const { data: employees, error: employeeError } = await db
      .from("employees")
      .select("id, badge, employee_id, full_name, job_title")
      .in("id", uniqueEmployeeIds)
      .eq("is_active", true);
    if (employeeError) return { ok: false as const, error: "Não foi possível validar os colaboradores." };
    if (!employees || employees.length !== uniqueEmployeeIds.length) {
      return {
        ok: false as const,
        error: "Um ou mais colaboradores não existem ou estão inativos. Atualize a lista e tente novamente.",
      };
    }

    let activityId: string | null = null;
    let weekId: string | null = null;
    let orderNumber = data.order_number?.trim() || null;
    let serviceDescription = data.service_description.trim();
    if (data.activity_id && data.week_id) {
      const { data: activity, error: activityError } = await db
        .from("activities")
        .select("id, week_id, order_number, description, weeks!inner(is_active)")
        .eq("id", data.activity_id)
        .eq("week_id", data.week_id)
        .eq("weeks.is_active", true)
        .maybeSingle();
      if (activityError) return { ok: false as const, error: "Não foi possível validar a atividade." };
      if (!activity) return { ok: false as const, error: "A atividade não pertence à semana ativa." };
      activityId = activity.id;
      weekId = activity.week_id;
      orderNumber = activity.order_number;
      serviceDescription = activity.description;
    }

    const batchId = crypto.randomUUID();
    const transportSet = new Set(data.transport_employee_ids ?? []);
    const rows = employees.map((employee: any) => ({
      needs_transport: transportSet.has(employee.id),
      batch_id: batchId,
      requester_user_id: userId,
      requester_name: info.fullName,
      requester_email: info.email,
      employee_master_id: employee.id,
      employee_external_id: employee.employee_id.startsWith(MISSING_EMPLOYEE_ID_PREFIX) ? "" : employee.employee_id,
      employee_name: employee.full_name,
      employee_registration: employee.badge.startsWith(MISSING_BADGE_PREFIX) ? "" : employee.badge,
      employee_role: employee.job_title,
      activity_id: activityId,
      week_id: weekId,
      order_number: orderNumber,
      service_description: serviceDescription,
      overtime_date: data.overtime_date,
      entry_time: data.entry_time || null,
      departure_time: data.departure_time,
      needs_snack: data.needs_snack,
      justification: data.justification,
      status: "pending",
    }));
    const { data: created, error } = await db.from("overtime_requests").insert(rows).select("id, request_number");
    if (error) return { ok: false as const, error: error.message };
    return {
      ok: true as const,
      count: created?.length ?? 0,
      numbers: (created ?? []).map((item: any) => item.request_number),
    };
  });

export const MISSING_BADGE_PREFIX = "__missing_badge__:";
export const MISSING_EMPLOYEE_ID_PREFIX = "__missing_employee_id__:";

const employeeSchema = z
  .object({
    badge: z.string().trim().max(50),
    employee_id: z.string().trim().max(50),
    admission_date: z.string().refine(isValidDate, "Data de admissão inválida"),
    full_name: z.string().trim().min(2).max(150),
    job_title: z.string().trim().min(1).max(120),
    address: z.string().trim().max(300).nullable().optional(),
    neighborhood: z.string().trim().max(150).nullable().optional(),
    city: z.string().trim().max(150).nullable().optional(),
    phone: z.string().trim().max(50).nullable().optional(),
    message_contact: z.string().trim().max(100).nullable().optional(),
    transport_line: z.string().trim().max(100).nullable().optional(),
  })
  .refine((employee) => Boolean(employee.badge || employee.employee_id), {
    message: "Informe a Chapa ou o ID do colaborador",
  });

export const upsertEmployees = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ employees: z.array(employeeSchema).min(1).max(2000) }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const info = await loadRoleAndProfile(supabase, userId);
    if (info.approvalStatus !== "approved" || !(info.isAdmin || info.isManager || info.isLogistics)) {
      return { ok: false as const, error: "Somente gerente, logística ou administrador pode atualizar colaboradores." };
    }
    const badges = data.employees.map((employee) => employee.badge.toLocaleLowerCase("pt-BR")).filter(Boolean);
    const externalIds = data.employees
      .map((employee) => employee.employee_id.toLocaleLowerCase("pt-BR"))
      .filter(Boolean);
    if (new Set(badges).size !== badges.length)
      return { ok: false as const, error: "Há chapas repetidas no arquivo informado." };
    if (new Set(externalIds).size !== externalIds.length)
      return { ok: false as const, error: "Há IDs repetidos no arquivo informado." };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const rows = data.employees.map((employee) => ({
      badge: employee.badge || `${MISSING_BADGE_PREFIX}${employee.employee_id}`,
      employee_id: employee.employee_id || `${MISSING_EMPLOYEE_ID_PREFIX}${employee.badge}`,
      admission_date: employee.admission_date,
      full_name: employee.full_name,
      job_title: employee.job_title,
      address: employee.address || null,
      neighborhood: employee.neighborhood || null,
      city: employee.city || null,
      phone: employee.phone || null,
      message_contact: employee.message_contact || null,
      transport_line: employee.transport_line || null,
      is_active: true,
      updated_by_user_id: userId,
      updated_by_name: info.fullName,
    }));
    const { data: saved, error } = await db.from("employees").upsert(rows, { onConflict: "badge" }).select("id");
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const, count: saved?.length ?? 0 };
  });

export const updateEmployee = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        badge: z.string().trim().max(50),
        employee_id: z.string().trim().max(50),
        admission_date: z.string().refine(isValidDate, "Data de admissão inválida"),
        full_name: z.string().trim().min(2).max(150),
        job_title: z.string().trim().min(1).max(120),
        address: z.string().trim().max(300).nullable().optional(),
        neighborhood: z.string().trim().max(150).nullable().optional(),
        city: z.string().trim().max(150).nullable().optional(),
        phone: z.string().trim().max(50).nullable().optional(),
        message_contact: z.string().trim().max(100).nullable().optional(),
        transport_line: z.string().trim().max(100).nullable().optional(),
      })
      .refine((employee) => Boolean(employee.badge || employee.employee_id), {
        message: "Informe a Chapa ou o ID do colaborador",
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const info = await loadRoleAndProfile(supabase, userId);
    if (info.approvalStatus !== "approved" || !(info.isAdmin || info.isManager || info.isLogistics)) {
      return { ok: false as const, error: "Somente gerente, logística ou administrador pode editar colaboradores." };
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { data: updated, error } = await db
      .from("employees")
      .update({
        badge: data.badge || `${MISSING_BADGE_PREFIX}${data.employee_id}`,
        employee_id: data.employee_id || `${MISSING_EMPLOYEE_ID_PREFIX}${data.badge}`,
        admission_date: data.admission_date,
        full_name: data.full_name,
        job_title: data.job_title,
        address: data.address || null,
        neighborhood: data.neighborhood || null,
        city: data.city || null,
        phone: data.phone || null,
        message_contact: data.message_contact || null,
        transport_line: data.transport_line || null,
        updated_by_user_id: userId,
        updated_by_name: info.fullName,
      })
      .eq("id", data.id)
      .select("id")
      .maybeSingle();
    if (error) return { ok: false as const, error: error.message };
    if (!updated) return { ok: false as const, error: "Colaborador não encontrado." };
    return { ok: true as const };
  });

export const setEmployeeActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ id: z.string().uuid(), active: z.boolean() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const info = await loadRoleAndProfile(supabase, userId);
    if (info.approvalStatus !== "approved" || !(info.isAdmin || info.isManager || info.isLogistics)) {
      return { ok: false as const, error: "Somente gerente, logística ou administrador pode alterar colaboradores." };
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { data: updated, error } = await db
      .from("employees")
      .update({ is_active: data.active, updated_by_user_id: userId, updated_by_name: info.fullName })
      .eq("id", data.id)
      .select("id")
      .maybeSingle();
    if (error) return { ok: false as const, error: error.message };
    if (!updated) return { ok: false as const, error: "Colaborador não encontrado." };
    return { ok: true as const };
  });

const decideSchema = z.object({
  id: z.string().uuid(),
  expectedVersion: z.number().int().min(1),
  decision: z.enum(["approved", "rejected"]),
  comment: z.string().trim().max(2000).nullable().optional(),
});

export const decideOvertimeRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => decideSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const info = await loadRoleAndProfile(supabase, userId);
    if (info.approvalStatus !== "approved" || !(info.isAdmin || info.isManager)) {
      return { ok: false as const, error: "Somente gerente ou administrador aprovado pode decidir." };
    }
    if (data.decision === "rejected" && !data.comment?.trim()) {
      return { ok: false as const, error: "Comentário é obrigatório para reprovação." };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { data: target, error: targetError } = await db
      .from("overtime_requests")
      .select("id, batch_id, status, version")
      .eq("id", data.id)
      .eq("version", data.expectedVersion)
      .maybeSingle();
    if (targetError) return { ok: false as const, error: targetError.message };
    if (!target || target.status !== "pending") {
      const { data: current } = await db
        .from("overtime_requests")
        .select("id, status, version, decided_by_name, decided_at")
        .eq("id", data.id)
        .maybeSingle();
      return { ok: false as const, conflict: true, current };
    }

    let updateQuery = db
      .from("overtime_requests")
      .update({
        status: data.decision,
        manager_comment: data.comment?.trim() || null,
        decided_by_user_id: userId,
        decided_by_name: info.fullName,
        decided_by_email: info.email,
        decided_at: new Date().toISOString(),
        version: data.expectedVersion + 1,
      })
      .eq("status", "pending");
    updateQuery = target.batch_id ? updateQuery.eq("batch_id", target.batch_id) : updateQuery.eq("id", target.id);
    const { data: updated, error } = await updateQuery.select("id, status, version");
    if (error) return { ok: false as const, error: error.message };
    if (!updated?.length) return { ok: false as const, conflict: true, current: target };
    return { ok: true as const, updated, count: updated.length };
  });

const cancelSchema = z.object({ id: z.string().uuid(), expectedVersion: z.number().int().min(1) });

export const cancelOvertimeRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => cancelSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const info = await loadRoleAndProfile(supabase, userId);
    if (info.approvalStatus !== "approved" || !(info.isLeader || info.isAdmin)) {
      return { ok: false as const, error: "Usuário sem permissão para cancelar." };
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { data: updated, error } = await db
      .from("overtime_requests")
      .update({ status: "cancelled", version: data.expectedVersion + 1 })
      .eq("id", data.id)
      .eq("requester_user_id", userId)
      .eq("status", "pending")
      .eq("version", data.expectedVersion)
      .select("id")
      .maybeSingle();
    if (error) return { ok: false as const, error: error.message };
    if (!updated) return { ok: false as const, error: "Solicitação não pode mais ser cancelada." };
    return { ok: true as const };
  });
