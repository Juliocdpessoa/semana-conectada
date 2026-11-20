import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "./password-auth";
import {
  rsRequestSchema,
  journeyReadSchema,
  journeySaveSchema,
  RS_MUTATIONS,
} from "./rs-transport-policy";

async function requireApproved(db: any, userId: string) {
  const result = await db
    .from("profiles")
    .select("id")
    .eq("id", userId)
    .eq("approval_status", "approved")
    .maybeSingle()
    .abortSignal(AbortSignal.timeout(8000));
  if (result.error || !result.data) throw new Error("Não foi possível validar seu acesso.");
}
// Fixed, validated operations only. Caller JWT/RLS and database business gates
// remain authoritative. This is not a service-role or general SQL/write proxy.
export const executeRsOperation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => rsRequestSchema.parse(input))
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    await requireApproved(db, context.userId);
    const result = await db
      .rpc(data.operation, data.params)
      .abortSignal(AbortSignal.timeout(RS_MUTATIONS.has(data.operation) ? 30000 : 20000));
    return {
      data: result.data,
      error: result.error
        ? {
            message: String(result.error.message ?? "Não foi possível concluir a operação."),
            code: String(result.error.code ?? ""),
            status: result.status,
          }
        : null,
    };
  });
export const loadRsWeeks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ worksiteId: z.string().uuid() }).strict().parse(input))
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    await requireApproved(db, context.userId);
    const result = await db
      .from("weeks")
      .select("id,label,code,start_date,end_date,is_active,sap_closure_status")
      .eq("worksite_id", data.worksiteId)
      .order("start_date", { ascending: false })
      .order("id")
      .limit(600)
      .abortSignal(AbortSignal.timeout(15000));
    return {
      data: result.data,
      error: result.error ? { message: "Não foi possível carregar as semanas." } : null,
    };
  });
export const loadCapacityJourney = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => journeyReadSchema.parse(input))
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    await requireApproved(db, context.userId);
    const result = await db
      .from("weekly_capacity_journey")
      .select("*")
      .eq("week_id", data.weekId)
      .maybeSingle()
      .abortSignal(AbortSignal.timeout(15000));
    return {
      data: result.data,
      error: result.error ? { message: "Não foi possível carregar a jornada." } : null,
    };
  });
export const saveCapacityJourney = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => journeySaveSchema.parse(input))
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    await requireApproved(db, context.userId);
    // Exactly one attempt, preserving the original optimistic version and RLS.
    const query = data.version
      ? db
          .from("weekly_capacity_journey")
          .update({ days: data.days })
          .eq("week_id", data.weekId)
          .eq("version", data.version)
          .select()
          .maybeSingle()
      : db
          .from("weekly_capacity_journey")
          .insert({ week_id: data.weekId, days: data.days })
          .select()
          .single();
    const result = await query.abortSignal(AbortSignal.timeout(20000));
    return {
      data: result.data,
      error:
        result.error || !result.data
          ? {
              message:
                "Não foi possível confirmar o salvamento. Atualize a jornada antes de tentar novamente.",
            }
          : null,
    };
  });
