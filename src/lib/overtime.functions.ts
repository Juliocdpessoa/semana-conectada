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
  source_type: "manual" | "scale_change";
  source_scheduled_transport_id: string | null;
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

export type EmployeeImportRecord = {
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

export const EMPLOYEE_TEMPLATE_HEADERS = [
  "Chapa",
  "ID",
  "Data de Admissão",
  "Nome",
  "Função",
  "Endereço",
  "Bairro",
  "Cidade",
  "Telefone",
  "Contato (recado)",
  "Linha",
] as const;

export const REGULAR_OVERTIME_EXPORT_HEADERS = [
  "ID",
  "Matrícula",
  "Nome",
  "Função",
  "Data",
  "Horário de entrada",
  "Horário de saída",
  "Lanche",
  "Status",
  "Solicitante",
  "Ordem",
  "Serviço",
  "Justificativa",
] as const;

export const REGULAR_OVERTIME_EXPORT_WIDTHS = [14, 14, 32, 24, 12, 18, 18, 10, 14, 28, 16, 48, 48] as const;

export const LOGISTICS_EXPORT_HEADERS = [
  "Matrícula",
  "Nome",
  "Função",
  "Endereço",
  "Bairro",
  "Cidade",
  "Telefone",
  "Contato (recado)",
  "Data",
  "Horário de entrada",
  "Horário de saída",
] as const;

export const LOGISTICS_EXPORT_WIDTHS = [14, 32, 25, 38, 24, 20, 20, 22, 12, 18, 18] as const;

export const TRANSPORT_EXPORT_HEADERS = [
  "Data",
  "Chapa",
  "ID",
  "Nome",
  "Função",
  "Endereço completo",
  "Telefone",
  "Contato (recado)",
  "Linha",
  "Horário de entrada",
  "Horário de saída",
  "Ordem",
  "Serviço",
  "Solicitante",
  "Precisa de transporte",
  "Status",
] as const;

export const TRANSPORT_EXPORT_WIDTHS = [12, 14, 14, 32, 24, 50, 20, 24, 16, 18, 18, 16, 48, 28, 20, 16] as const;

export function mapRegularOvertimeExportRow(row: OvertimeRow) {
  return [
    row.employee_external_id || "",
    row.employee_registration || "",
    row.employee_name,
    row.employee_role,
    formatDate(row.overtime_date),
    row.entry_time || "",
    row.departure_time,
    row.needs_snack ? "Sim" : "Não",
    formatOvertimeStatus(row.status),
    row.requester_name || row.requester_email,
    row.order_number || "",
    row.service_description,
    row.justification,
  ];
}

export function mapLogisticsExportRow(row: OvertimeRow) {
  return [
    row.employee_registration || "",
    row.employee_name,
    row.employee_role,
    row.employee_address || "",
    row.employee_neighborhood || "",
    row.employee_city || "",
    row.employee_phone || "",
    row.employee_message_contact || "",
    formatDate(row.overtime_date),
    row.entry_time || "",
    row.departure_time,
  ];
}

export function mapTransportExportRow(row: OvertimeRow) {
  return [
    formatDate(row.overtime_date),
    row.employee_registration || "",
    row.employee_external_id || "",
    row.employee_name,
    row.employee_role,
    [row.employee_address, row.employee_neighborhood, row.employee_city].filter(Boolean).join(" - "),
    row.employee_phone || "",
    row.employee_message_contact || "",
    row.employee_transport_line || "",
    row.entry_time || "",
    row.departure_time,
    row.order_number || "",
    row.service_description,
    row.requester_name || row.requester_email,
    row.needs_transport ? "Sim" : "Não",
    formatOvertimeStatus(row.status),
  ];
}

export function formatPlanningDate(value: unknown) {
  if (value === null || value === undefined || value === "") return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return (
      String(value.getDate()).padStart(2, "0") +
      "/" +
      String(value.getMonth() + 1).padStart(2, "0") +
      "/" +
      value.getFullYear()
    );
  }
  const text = String(value).trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return iso[3] + "/" + iso[2] + "/" + iso[1];
  const br = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(text);
  if (br) {
    return String(Number(br[1])).padStart(2, "0") + "/" + String(Number(br[2])).padStart(2, "0") + "/" + br[3];
  }
  return text;
}

export function formatReportedDate(value: unknown) {
  if (!value) return "";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "";
  const pad = (number: number) => String(number).padStart(2, "0");
  return (
    pad(date.getDate()) +
    "/" +
    pad(date.getMonth() + 1) +
    "/" +
    date.getFullYear() +
    " " +
    pad(date.getHours()) +
    ":" +
    pad(date.getMinutes())
  );
}

export function sanitizeEmployeeRow(employee: EmployeeRow): EmployeeRow {
  return {
    ...employee,
    badge: employee.badge.startsWith(MISSING_BADGE_PREFIX) ? "" : employee.badge,
    employee_id: employee.employee_id.startsWith(MISSING_EMPLOYEE_ID_PREFIX) ? "" : employee.employee_id,
  };
}

export function filterEmployees(employees: EmployeeRow[], search: string) {
  const term = search.trim().toLocaleLowerCase("pt-BR");
  if (!term) return employees;
  return employees.filter((employee) =>
    [
      employee.full_name,
      employee.badge,
      employee.employee_id,
      employee.job_title,
      employee.address ?? "",
      employee.neighborhood ?? "",
      employee.city ?? "",
      employee.phone ?? "",
      employee.message_contact ?? "",
      employee.transport_line ?? "",
    ].some((value) => value.toLocaleLowerCase("pt-BR").includes(term)),
  );
}

export function parseEmployeeImportText(raw: string) {
  const records: EmployeeImportRecord[] = [];
  const errors: string[] = [];
  raw.split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return;
    const columns = line.includes("\t") ? line.split("\t") : line.split(";");
    const values = columns.map((value) => value.trim());
    if (index === 0 && /chapa/i.test(values[0] ?? "")) return;
    if (values.length < EMPLOYEE_TEMPLATE_HEADERS.length) {
      errors.push(`Linha ${index + 1}: informe as ${EMPLOYEE_TEMPLATE_HEADERS.length} colunas.`);
      return;
    }
    const date = normalizeEmployeeDate(values[2]);
    if ((!values[0] && !values[1]) || !date || !values[3] || !values[4]) {
      errors.push(`Linha ${index + 1}: informe Chapa ou ID e verifique data, nome e função.`);
      return;
    }
    records.push({
      badge: values[0],
      employee_id: values[1],
      admission_date: date,
      full_name: values[3],
      job_title: values[4],
      address: values[5] || null,
      neighborhood: values[6] || null,
      city: values[7] || null,
      phone: values[8] || null,
      message_contact: values[9] || null,
      transport_line: values[10] || null,
    });
  });
  return { records, errors };
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
    supabase.from("profiles").select("full_name, email, approval_status, worksite_id").eq("id", userId).maybeSingle(),
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
    worksiteId: profRes.data?.worksite_id as string | undefined,
  };
}

export const listApprovedTransportRows = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => z.object({}).parse(data))
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const info = await loadRoleAndProfile(supabase, userId);
    if (info.approvalStatus !== "approved") return { ok: false as const, error: "Usuário não aprovado." };
    if (!(info.isAdmin || info.isManager || info.isLogistics)) {
      return { ok: false as const, error: "Usuário sem permissão para visualizar transportes." };
    }
    if (!info.worksiteId) return { ok: false as const, error: "Usuário sem obra vinculada." };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const rows: any[] = [];
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await db
        .from("overtime_requests")
        .select("*")
        .eq("worksite_id", info.worksiteId)
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

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const exportListSchema = z.object({
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
});

export const OVERTIME_EXPORT_COLUMNS =
  "id,batch_id,request_number,requester_user_id,requester_name,requester_email,employee_name,employee_registration,employee_external_id,employee_role,activity_id,week_id,order_number,service_description,overtime_date,entry_time,departure_time,needs_snack,needs_transport,justification,status,manager_comment,decided_by_name,decided_at,version,created_at,source_type,source_scheduled_transport_id";

export const listOvertimeForExport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => exportListSchema.parse(data))
  .handler(async ({ context, data: input }) => {
    const { supabase, userId } = context;
    const info = await loadRoleAndProfile(supabase, userId);
    if (info.approvalStatus !== "approved") {
      return { ok: false as const, error: "Usuário não aprovado." };
    }
    if (!(info.isAdmin || info.isManager || info.isMeasurementControl || info.isLogistics)) {
      return { ok: false as const, error: "Usuário sem permissão para exportar horas extras." };
    }
    if (!info.worksiteId) return { ok: false as const, error: "Usuário sem obra vinculada." };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const rows: any[] = [];
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      let query = db
        .from("overtime_requests")
        .select(OVERTIME_EXPORT_COLUMNS)
        .eq("worksite_id", info.worksiteId)
        .neq("status", "cancelled")
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, from + pageSize - 1);
      if (input.dateFrom) query = query.gte("overtime_date", input.dateFrom);
      if (input.dateTo) query = query.lte("overtime_date", input.dateTo);
      const { data, error } = await query;
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
        .eq("worksite_id", info.worksiteId)
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
  .validator((data: unknown) => createSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const info = await loadRoleAndProfile(supabase, userId);
    if (info.approvalStatus !== "approved") return { ok: false as const, error: "Usuário não aprovado." };
    if (!(info.isLeader || info.isAdmin || info.isMeasurementControl))
      return { ok: false as const, error: "Usuário sem permissão para solicitar hora extra." };
    if (!info.worksiteId) return { ok: false as const, error: "Usuário sem obra vinculada." };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const uniqueEmployeeIds = [...new Set(data.employee_ids)];
    const { data: employees, error: employeeError } = await db
      .from("employees")
      .select("id, badge, employee_id, full_name, job_title")
      .eq("worksite_id", info.worksiteId)
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
        .eq("worksite_id", info.worksiteId)
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

    if (data.entry_time) {
      const { data: automaticDuplicates, error: duplicateError } = await db
        .from("overtime_requests")
        .select("employee_master_id")
        .in("employee_master_id", uniqueEmployeeIds)
        .eq("worksite_id", info.worksiteId)
        .eq("overtime_date", data.overtime_date)
        .eq("entry_time", data.entry_time)
        .eq("departure_time", data.departure_time)
        .eq("source_type", "scale_change")
        .neq("status", "cancelled");
      if (duplicateError)
        return {
          ok: false as const,
          error: "Não foi possível verificar solicitações automáticas.",
        };
      if (automaticDuplicates?.length) {
        return {
          ok: false as const,
          error:
            automaticDuplicates.length === 1
              ? "Este colaborador já possui uma hora extra automática gerada pela Mudança de Escala."
              : `${automaticDuplicates.length} colaboradores já possuem hora extra automática gerada pela Mudança de Escala.`,
        };
      }
    }

    const batchId = crypto.randomUUID();
    const transportSet = new Set(data.transport_employee_ids ?? []);
    const rows = employees.map((employee: any) => ({
      worksite_id: info.worksiteId,
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
  .validator((data: unknown) => z.object({ employees: z.array(employeeSchema).min(1).max(2000) }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const info = await loadRoleAndProfile(supabase, userId);
    if (info.approvalStatus !== "approved" || !(info.isAdmin || info.isManager || info.isLogistics)) {
      return {
        ok: false as const,
        error: "Somente gerente, logística ou administrador pode atualizar colaboradores.",
      };
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
    if (!info.worksiteId) return { ok: false as const, error: "Usuário sem obra vinculada." };
    const rows = data.employees.map((employee) => ({
      worksite_id: info.worksiteId,
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
    const { data: saved, error } = await db
      .from("employees")
      .upsert(rows, { onConflict: "worksite_id,badge" })
      .select("id");
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const, count: saved?.length ?? 0 };
  });

export const updateEmployee = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) =>
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
      return {
        ok: false as const,
        error: "Somente gerente, logística ou administrador pode editar colaboradores.",
      };
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    if (!info.worksiteId) return { ok: false as const, error: "Usuário sem obra vinculada." };
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
      .eq("worksite_id", info.worksiteId)
      .select("id")
      .maybeSingle();
    if (error) return { ok: false as const, error: error.message };
    if (!updated) return { ok: false as const, error: "Colaborador não encontrado." };
    return { ok: true as const };
  });

export const setEmployeeActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => z.object({ id: z.string().uuid(), active: z.boolean() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const info = await loadRoleAndProfile(supabase, userId);
    if (info.approvalStatus !== "approved" || !(info.isAdmin || info.isManager || info.isLogistics)) {
      return {
        ok: false as const,
        error: "Somente gerente, logística ou administrador pode alterar colaboradores.",
      };
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    if (!info.worksiteId) return { ok: false as const, error: "Usuário sem obra vinculada." };
    const { data: updated, error } = await db
      .from("employees")
      .update({
        is_active: data.active,
        updated_by_user_id: userId,
        updated_by_name: info.fullName,
      })
      .eq("id", data.id)
      .eq("worksite_id", info.worksiteId)
      .select("id")
      .maybeSingle();
    if (error) return { ok: false as const, error: error.message };
    if (!updated) return { ok: false as const, error: "Colaborador não encontrado." };
    return { ok: true as const };
  });

export const deleteEmployee = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const info = await loadRoleAndProfile(supabase, userId);
    if (info.approvalStatus !== "approved" || !(info.isAdmin || info.isManager || info.isLogistics)) {
      return {
        ok: false as const,
        error: "Somente gerente, logística ou administrador pode excluir colaboradores.",
      };
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    if (!info.worksiteId) return { ok: false as const, error: "Usuário sem obra vinculada." };
    const { data: deleted, error } = await db
      .from("employees")
      .delete()
      .eq("id", data.id)
      .eq("worksite_id", info.worksiteId)
      .select("id")
      .maybeSingle();
    if (error) {
      if (error.code === "23503") {
        return {
          ok: false as const,
          error:
            "Este colaborador possui registros vinculados e não pode ser excluído. Use Inativar para preservar o histórico.",
        };
      }
      return { ok: false as const, error: error.message };
    }
    if (!deleted) return { ok: false as const, error: "Colaborador não encontrado." };
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
  .validator((data: unknown) => decideSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const info = await loadRoleAndProfile(supabase, userId);
    if (info.approvalStatus !== "approved" || !(info.isAdmin || info.isManager)) {
      return {
        ok: false as const,
        error: "Somente gerente ou administrador aprovado pode decidir.",
      };
    }
    if (data.decision === "rejected" && !data.comment?.trim()) {
      return { ok: false as const, error: "Comentário é obrigatório para reprovação." };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    if (!info.worksiteId) return { ok: false as const, error: "Usuário sem obra vinculada." };
    const { data: target, error: targetError } = await db
      .from("overtime_requests")
      .select("id, batch_id, status, version")
      .eq("id", data.id)
      .eq("worksite_id", info.worksiteId)
      .maybeSingle();
    if (targetError) return { ok: false as const, error: targetError.message };
    if (!target || target.status !== "pending" || target.version !== data.expectedVersion) {
      return { ok: false as const, conflict: true, current: target };
    }

    let batchQuery = db.from("overtime_requests").select("id, status, version").eq("worksite_id", info.worksiteId);
    batchQuery = target.batch_id ? batchQuery.eq("batch_id", target.batch_id) : batchQuery.eq("id", target.id);
    const { data: batchRows, error: batchError } = await batchQuery;
    if (batchError) return { ok: false as const, error: batchError.message };
    if (
      !batchRows?.length ||
      batchRows.some(
        (row: { status: string; version: number }) => row.status !== "pending" || row.version !== data.expectedVersion,
      )
    ) {
      return { ok: false as const, conflict: true, current: target };
    }

    const batchIds = batchRows.map((row: { id: string }) => row.id);
    const { data: updated, error } = await db
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
      .in("id", batchIds)
      .eq("worksite_id", info.worksiteId)
      .eq("status", "pending")
      .eq("version", data.expectedVersion)
      .select("id, status, version");
    if (error) return { ok: false as const, error: error.message };
    if ((updated?.length ?? 0) !== batchIds.length) {
      return { ok: false as const, conflict: true, current: target };
    }
    return { ok: true as const, updated, count: updated.length };
  });

const cancelSchema = z.object({ id: z.string().uuid(), expectedVersion: z.number().int().min(1) });

export const cancelOvertimeRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => cancelSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const info = await loadRoleAndProfile(supabase, userId);
    if (info.approvalStatus !== "approved" || !(info.isLeader || info.isAdmin)) {
      return { ok: false as const, error: "Usuário sem permissão para cancelar." };
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    if (!info.worksiteId) return { ok: false as const, error: "Usuário sem obra vinculada." };
    const { data: updated, error } = await db
      .from("overtime_requests")
      .update({ status: "cancelled", version: data.expectedVersion + 1 })
      .eq("id", data.id)
      .eq("worksite_id", info.worksiteId)
      .eq("requester_user_id", userId)
      .eq("source_type", "manual")
      .eq("status", "pending")
      .eq("version", data.expectedVersion)
      .select("id")
      .maybeSingle();
    if (error) return { ok: false as const, error: error.message };
    if (!updated) {
      return {
        ok: false as const,
        error: "Solicitações geradas pela Mudança de Escala devem ser canceladas no módulo de Mudança de Escala.",
      };
    }
    return { ok: true as const };
  });

const updateOvertimeSchema = z.object({
  id: z.string().uuid(),
  expectedVersion: z.number().int().min(1),
  overtime_date: z.string().refine(isValidDate, "Data inválida"),
  entry_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
  departure_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Horário inválido"),
  needs_snack: z.boolean(),
  needs_transport: z.boolean(),
  order_number: z.string().trim().max(64).nullable(),
  service_description: z.string().trim().min(3).max(1000),
  justification: z.string().trim().min(3).max(1000),
});

async function loadEditableOvertimeRequest(db: any, info: Awaited<ReturnType<typeof loadRoleAndProfile>>, userId: string, id: string) {
  if (!info.worksiteId) return { error: "Usuário sem obra vinculada." } as const;
  const { data: request, error } = await db
    .from("overtime_requests")
    .select("id,requester_user_id,status,source_type,version")
    .eq("id", id)
    .eq("worksite_id", info.worksiteId)
    .maybeSingle();
  if (error) return { error: error.message } as const;
  if (!request) return { error: "Solicitação não encontrada." } as const;
  if (request.source_type !== "manual") {
    return { error: "Solicitações da Mudança de Escala devem ser alteradas naquele módulo." } as const;
  }
  const elevated = info.isLogistics || info.isAdmin;
  const canRequest = info.isLeader || info.isAdmin || info.isMeasurementControl;
  const ownPending = canRequest && request.requester_user_id === userId && request.status === "pending";
  if (!elevated && !ownPending) {
    return { error: "Você só pode alterar solicitações próprias que ainda estejam pendentes." } as const;
  }
  return { request } as const;
}

export const updateOvertimeRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => updateOvertimeSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const info = await loadRoleAndProfile(supabase, userId);
    if (info.approvalStatus !== "approved") return { ok: false as const, error: "Usuário não aprovado." };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const access = await loadEditableOvertimeRequest(db, info, userId, data.id);
    if ("error" in access) return { ok: false as const, error: access.error };
    if (access.request.version !== data.expectedVersion) {
      return { ok: false as const, conflict: true, error: "A solicitação foi alterada por outro usuário. Atualize a tela." };
    }
    const { data: updated, error } = await db
      .from("overtime_requests")
      .update({
        overtime_date: data.overtime_date,
        entry_time: data.entry_time,
        departure_time: data.departure_time,
        needs_snack: data.needs_snack,
        needs_transport: data.needs_transport,
        order_number: data.order_number || null,
        service_description: data.service_description,
        justification: data.justification,
        version: data.expectedVersion + 1,
      })
      .eq("id", data.id)
      .eq("worksite_id", info.worksiteId)
      .eq("version", data.expectedVersion)
      .select("id,version")
      .maybeSingle();
    if (error) return { ok: false as const, error: error.message };
    if (!updated) return { ok: false as const, conflict: true, error: "A solicitação foi alterada por outro usuário. Atualize a tela." };
    return { ok: true as const, updated };
  });

export const deleteOvertimeRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => cancelSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const info = await loadRoleAndProfile(supabase, userId);
    if (info.approvalStatus !== "approved") return { ok: false as const, error: "Usuário não aprovado." };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const access = await loadEditableOvertimeRequest(db, info, userId, data.id);
    if ("error" in access) return { ok: false as const, error: access.error };
    const { data: deleted, error } = await db
      .from("overtime_requests")
      .delete()
      .eq("id", data.id)
      .eq("worksite_id", info.worksiteId)
      .eq("version", data.expectedVersion)
      .select("id")
      .maybeSingle();
    if (error) return { ok: false as const, error: error.message };
    if (!deleted) return { ok: false as const, conflict: true, error: "A solicitação foi alterada por outro usuário. Atualize a tela." };
    return { ok: true as const };
  });

