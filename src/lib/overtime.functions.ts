import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

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
    fullName: profRes.data?.full_name ?? "",
    email: profRes.data?.email ?? "",
    approvalStatus: profRes.data?.approval_status ?? "pending",
  };
}

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
    employee_name: z.string().trim().min(2).max(150),
    employee_registration: z.string().trim().min(1).max(50),
    employee_role: z.string().trim().min(1).max(120),
    activity_id: z.string().uuid().nullable().optional(),
    week_id: z.string().uuid().nullable().optional(),
    order_number: z.string().trim().max(64).nullable().optional(),
    service_description: z.string().trim().min(3).max(1000),
    overtime_date: z.string().refine(isValidDate, "Data inválida"),
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
    if (!(info.isLeader || info.isAdmin)) {
      return { ok: false as const, error: "Somente líder ou administrador pode solicitar hora extra." };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;

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

    const { data: created, error } = await db
      .from("overtime_requests")
      .insert({
        requester_user_id: userId,
        requester_name: info.fullName,
        requester_email: info.email,
        employee_name: data.employee_name,
        employee_registration: data.employee_registration,
        employee_role: data.employee_role,
        activity_id: activityId,
        week_id: weekId,
        order_number: orderNumber,
        service_description: serviceDescription,
        overtime_date: data.overtime_date,
        departure_time: data.departure_time,
        needs_snack: data.needs_snack,
        justification: data.justification,
        status: "pending",
      })
      .select("id, request_number")
      .single();
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const, id: created.id, number: created.request_number };
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
      .eq("id", data.id)
      .eq("version", data.expectedVersion)
      .eq("status", "pending")
      .select("id, status, version")
      .maybeSingle();
    if (error) return { ok: false as const, error: error.message };
    if (!updated) {
      const { data: current } = await db
        .from("overtime_requests")
        .select("id, status, version, decided_by_name, decided_at")
        .eq("id", data.id)
        .maybeSingle();
      return { ok: false as const, conflict: true, current };
    }
    return { ok: true as const, updated };
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
