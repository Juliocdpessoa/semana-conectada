import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

async function archiveAccess(supabase: any, userId: string) {
  const [{ data: roles, error: rolesError }, { data: profile, error: profileError }] =
    await Promise.all([
      supabase.from("user_roles").select("role").eq("user_id", userId),
      supabase.from("profiles").select("worksite_id").eq("id", userId).maybeSingle(),
    ]);
  if (rolesError) throw new Error(rolesError.message);
  if (profileError) throw new Error(profileError.message);
  if (!(roles ?? []).some((row: { role: string }) => row.role === "admin")) {
    throw new Error("Somente administradores podem acessar os arquivos históricos.");
  }
  if (!profile?.worksite_id) throw new Error("Usuário sem obra vinculada.");
  return { worksiteId: String(profile.worksite_id) };
}

export const listOperationalArchives = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    try {
      const access = await archiveAccess(context.supabase, context.userId);
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data, error } = await (supabaseAdmin as any)
        .from("operational_archives")
        .select("id,cutoff_date,status,overtime_count,scale_change_count,prepared_at,finalized_at")
        .eq("worksite_id", access.worksiteId)
        .order("cutoff_date", { ascending: false });
      if (error) throw new Error(error.message);
      return { ok: true as const, archives: data ?? [] };
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : "Falha ao carregar arquivos." };
    }
  });

export const prepareOperationalArchive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => z.object({ cutoffDate: isoDate }).parse(data))
  .handler(async ({ data, context }) => {
    try {
      const access = await archiveAccess(context.supabase, context.userId);
      const { data: result, error } = await (context.supabase as any).rpc(
        "prepare_operational_archive",
        { _worksite_id: access.worksiteId, _cutoff_date: data.cutoffDate },
      );
      if (error) throw new Error(error.message);
      return { ok: true as const, archive: result?.[0] ?? null };
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : "Falha ao preparar arquivo." };
    }
  });

export const loadOperationalArchiveRows = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => z.object({ archiveId: uuid }).parse(data))
  .handler(async ({ data, context }) => {
    try {
      const access = await archiveAccess(context.supabase, context.userId);
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const db = supabaseAdmin as any;
      const { data: archive, error: archiveError } = await db
        .from("operational_archives")
        .select("id,cutoff_date,status,overtime_count,scale_change_count")
        .eq("id", data.archiveId)
        .eq("worksite_id", access.worksiteId)
        .maybeSingle();
      if (archiveError) throw new Error(archiveError.message);
      if (!archive) throw new Error("Arquivo histórico não encontrado.");
      const rows: any[] = [];
      for (let from = 0; ; from += 1000) {
        const { data: page, error } = await db
          .from("operational_archive_rows")
          .select("source_type,record_date,payload")
          .eq("archive_id", data.archiveId)
          .eq("worksite_id", access.worksiteId)
          .order("record_date", { ascending: true })
          .range(from, from + 999);
        if (error) throw new Error(error.message);
        rows.push(...(page ?? []));
        if (!page?.length || page.length < 1000) break;
      }
      const batchIds = Array.from(
        new Set(rows.map((row) => row.payload?.batch_id).filter(Boolean)),
      ) as string[];
      const [{ data: worksite, error: worksiteError }, batchesResult] = await Promise.all([
        db.from("worksites").select("id,code,name,is_active,created_at,updated_at").eq("id", access.worksiteId).maybeSingle(),
        batchIds.length
          ? db.from("scheduled_transport_batches").select("*").in("id", batchIds)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (worksiteError) throw new Error(worksiteError.message);
      if (batchesResult.error) throw new Error(batchesResult.error.message);
      const batchesById = new Map((batchesResult.data ?? []).map((batch: any) => [batch.id, batch]));
      const enrichedRows = rows.map((row) => {
        const batch = row.payload?.batch_id ? batchesById.get(row.payload.batch_id) : null;
        return {
          ...row,
          payload: {
            ...row.payload,
            worksite_code: worksite?.code ?? "",
            worksite_name: worksite?.name ?? "",
            worksite_active: worksite?.is_active ?? null,
            batch_start_date: batch?.start_date ?? null,
            batch_end_date: batch?.end_date ?? null,
            batch_weekdays: batch?.weekdays ?? null,
            batch_entry_time: batch?.entry_time ?? null,
            batch_departure_time: batch?.departure_time ?? null,
            batch_needs_snack: batch?.needs_snack ?? null,
            batch_needs_transport: batch?.needs_transport ?? null,
            batch_order_number: batch?.order_number ?? null,
            batch_service_description: batch?.service_description ?? null,
            batch_observation: batch?.observation ?? null,
            batch_created_by_user_id: batch?.created_by_user_id ?? null,
            batch_created_by_name: batch?.created_by_name ?? null,
            batch_created_by_email: batch?.created_by_email ?? null,
            batch_created_at: batch?.created_at ?? null,
            batch_updated_at: batch?.updated_at ?? null,
          },
        };
      });
      return { ok: true as const, archive, rows: enrichedRows };
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : "Falha ao montar o arquivo." };
    }
  });

export const finalizeOperationalArchive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => z.object({ archiveId: uuid }).parse(data))
  .handler(async ({ data, context }) => {
    try {
      await archiveAccess(context.supabase, context.userId);
      const { data: result, error } = await (context.supabase as any).rpc(
        "finalize_operational_archive",
        { _archive_id: data.archiveId },
      );
      if (error) throw new Error(error.message);
      return { ok: true as const, result: result?.[0] ?? null };
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : "Falha ao finalizar arquivo." };
    }
  });
