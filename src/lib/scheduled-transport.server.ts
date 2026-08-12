import { datesInRange } from "@/lib/transport-export";

export const SCHEDULED_TRANSPORT_ROLES = ["admin", "manager", "logistics", "planning"];

export async function requireTransportAccess(supabase: any, userId: string) {
  const [rolesRes, profRes] = await Promise.all([
    supabase.from("user_roles").select("role").eq("user_id", userId),
    supabase.from("profiles").select("full_name, email, approval_status").eq("id", userId).maybeSingle(),
  ]);
  const roles: string[] = (rolesRes.data ?? []).map((r: { role: string }) => r.role);
  const approved = profRes.data?.approval_status === "approved";
  const allowed = approved && roles.some((role) => SCHEDULED_TRANSPORT_ROLES.includes(role));
  return {
    allowed,
    approved,
    roles,
    fullName: profRes.data?.full_name ?? "",
    email: profRes.data?.email ?? "",
  };
}

export async function fetchAllRows(db: any, table: string, order: { column: string; ascending: boolean }[]) {
  const rows: any[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    let query = db.from(table).select("*");
    for (const o of order) query = query.order(o.column, { ascending: o.ascending });
    const { data, error } = await query.range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < pageSize) break;
  }
  return rows;
}

export function buildScheduleRows(params: {
  employees: any[];
  dates: string[];
  batchId: string;
  userId: string;
  fullName: string;
  email: string;
  entry_time: string;
  departure_time: string;
  needs_snack: boolean;
  needs_transport: boolean;
  order_number: string | null;
  service_description: string | null;
  observation: string | null;
  missingBadgePrefix: string;
  missingIdPrefix: string;
}) {
  const rows: any[] = [];
  for (const employee of params.employees) {
    for (const date of params.dates) {
      rows.push({
        batch_id: params.batchId,
        requester_user_id: params.userId,
        requester_name: params.fullName,
        requester_email: params.email,
        employee_master_id: employee.id,
        employee_external_id: String(employee.employee_id ?? "").startsWith(params.missingIdPrefix)
          ? ""
          : employee.employee_id,
        employee_registration: String(employee.badge ?? "").startsWith(params.missingBadgePrefix) ? "" : employee.badge,
        employee_name: employee.full_name,
        employee_role: employee.job_title ?? "",
        employee_address: employee.address ?? null,
        employee_neighborhood: employee.neighborhood ?? null,
        employee_city: employee.city ?? null,
        employee_phone: employee.phone ?? null,
        employee_message_contact: employee.message_contact ?? null,
        employee_transport_line: employee.transport_line ?? null,
        transport_date: date,
        entry_time: params.entry_time,
        departure_time: params.departure_time,
        needs_snack: params.needs_snack,
        needs_transport: params.needs_transport,
        order_number: params.order_number,
        service_description: params.service_description,
        observation: params.observation,
        status: "scheduled",
      });
    }
  }
  return rows;
}

export function resolveDates(startIso: string, endIso: string, weekdays: number[]) {
  return datesInRange(startIso, endIso, weekdays);
}
