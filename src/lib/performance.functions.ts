import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "./password-auth";

export const recordPerformanceSample = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) =>
    z
      .object({
        operation: z.enum(["activities_list", "activities_filter"]),
        durationMs: z.number().int().min(0).max(120000),
        success: z.boolean(),
      })
      .strict()
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { data: accepted, error } = await (context.supabase as any)
      .rpc("record_app_performance", {
        p_operation: data.operation,
        p_duration_ms: data.durationMs,
        p_success: data.success,
      })
      .abortSignal(AbortSignal.timeout(2500));
    return { accepted: !error && accepted === true };
  });

export const getPerformanceDashboard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) =>
    z
      .object({ hours: z.union([z.literal(1), z.literal(6), z.literal(24)]) })
      .strict()
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    // Caller-bound client: the database enforces admin, worksite and password gates.
    const { data: result, error } = await (context.supabase as any).rpc(
      "get_app_performance_dashboard",
      { p_hours: data.hours },
    );
    if (error)
      throw new Error(
        "Não foi possível consultar o monitoramento. Verifique seu acesso e tente novamente.",
      );
    return result as PerformanceDashboard;
  });

export type PerformanceDashboard = {
  checkedAt: string;
  since: string;
  hours: number;
  globalScope: boolean;
  diagnostics: { total: number; browsers: number; realtime: number };
  hourly: { hour: string; errors: number }[];
  groups: { stage: string; category: string; realtime_reason: string | null; total: number }[];
  metrics: {
    operation: string;
    samples: number;
    failures: number;
    median_ms: number | null;
    p95_ms: number | null;
  }[];
  recent: {
    id: string;
    received_at: string;
    stage: string;
    category: string;
    route: string;
    realtime_reason: string | null;
    build: string;
  }[];
  database: {
    lockWaits: number;
    slowRequests: number;
    activeSlots: number;
    totalSlots: number;
  } | null;
};
