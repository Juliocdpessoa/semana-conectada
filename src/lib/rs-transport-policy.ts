import { z } from "zod";
const uuid = z.string().uuid(),
  version = z.number().int().nonnegative();
const local = z.enum(["IARI", "ROTINA"]).nullable().optional();
const week = { p_week_id: uuid };
const page = {
  p_offset: z.number().int().min(0).max(10000000),
  p_limit: z.number().int().min(1).max(500),
};
const pending = {
  p_local: local,
  ...page,
  p_justification: z.string().max(2000).nullable(),
  p_only_missing_justification: z.boolean(),
  p_include_monitoring: z.boolean(),
  p_query: z.string().max(500),
};
const center = {
  p_sources: z
    .array(z.object({ week_id: uuid, closure_id: uuid.nullable() }).strict())
    .min(1)
    .max(600),
  p_center: z.string().min(1).max(200),
  p_local: local,
  ...page,
};
export const RS_RPC_SCHEMAS = {
  get_monthly_rs_weeks: z
    .object({ p_worksite_id: uuid, p_week_ids: z.array(uuid).min(1).max(600), p_local: local })
    .strict(),
  get_weekly_realization: z.object(week).strict(),
  get_weekly_rs_report: z
    .object({ ...week, p_local: local, p_version: version.nullable().optional() })
    .strict(),
  list_weekly_rs_availability_history: z
    .object({
      ...week,
      p_before_version: version.nullable(),
      p_limit: z.number().int().min(1).max(50),
    })
    .strict(),
  list_weekly_rs_closures: z.object(week).strict(),
  get_weekly_rs_closure_items: z
    .object({
      p_closure_id: uuid,
      p_kind: z.enum([
        "activity",
        "sap",
        "sap_import",
        "availability",
        "activity_history",
        "availability_history",
        "program_basis",
        "program_basis_history",
      ]),
      ...page,
    })
    .strict(),
  get_weekly_rs_pending: z.object({ ...week, ...pending }).strict(),
  get_weekly_rs_closure_pending: z.object({ p_closure_id: uuid, ...pending }).strict(),
  get_rs_center_pending_tasks: z.object(center).strict(),
  get_rs_center_immediate_tasks: z.object(center).strict(),
  get_activity_sap_progress: z.object(week).strict(),
  get_weekly_rs_availability_changes: z.object({ ...week, p_version: version, ...page }).strict(),
  list_weekly_sap_loads: z.object({ ...week, ...page }).strict(),
  get_weekly_sap_load_rows: z.object({ p_import_id: uuid, ...page }).strict(),
  save_weekly_rs_availability: z
    .object({
      ...week,
      p_expected_version: version,
      p_source_file_name: z.string().max(500).nullable(),
      p_rows: z
        .array(
          z
            .object({
              center: z.string().max(200),
              date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
              hours: z.number().finite().nonnegative(),
              week: z.string().max(200),
              local: z.string().max(200),
              specialty: z.string().max(200),
            })
            .strict(),
        )
        .max(10000),
    })
    .strict(),
  close_sap_week: z.object({ ...week, p_reason: z.string().min(3).max(2000) }).strict(),
  reopen_sap_week: z.object({ ...week, p_reason: z.string().min(3).max(2000) }).strict(),
  extend_sap_week_deadline: z
    .object({
      ...week,
      p_reason: z.string().min(3).max(2000),
      p_deadline: z.string().datetime({ offset: true }),
    })
    .strict(),
};
export const RS_MUTATIONS = new Set([
  "save_weekly_rs_availability",
  "close_sap_week",
  "reopen_sap_week",
  "extend_sap_week_deadline",
]);
export function parseRsRpc(operation: string, params: unknown) {
  if (!Object.hasOwn(RS_RPC_SCHEMAS, operation)) throw new Error("Operação de RS não permitida.");
  return RS_RPC_SCHEMAS[operation as keyof typeof RS_RPC_SCHEMAS].parse(params);
}
export const rsRequestSchema = z
  .object({ operation: z.string().max(80), params: z.unknown() })
  .strict()
  .transform((data) => ({
    operation: data.operation,
    params: parseRsRpc(data.operation, data.params),
  }));
export const journeyReadSchema = z.object({ weekId: uuid }).strict();
export const journeySaveSchema = journeyReadSchema
  .extend({
    version,
    days: z
      .record(z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.number().finite().min(0).max(24))
      .refine((value) => Object.keys(value).length <= 31),
  })
  .strict();
