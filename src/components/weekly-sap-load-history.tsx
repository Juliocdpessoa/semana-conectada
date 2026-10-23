import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

type Load = {
  id: string;
  source_file_name: string;
  imported_at: string;
  imported_by_name: string;
  row_count: number;
};
export function WeeklySapLoadHistory({
  weekId,
  userId,
  worksiteId,
}: {
  weekId: string;
  userId: string;
  worksiteId: string;
}) {
  const [open, setOpen] = useState(false),
    [page, setPage] = useState(0),
    [busy, setBusy] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["weekly-sap-loads", userId, worksiteId, weekId, page],
    enabled: open,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("list_weekly_sap_loads", {
        p_week_id: weekId,
        p_offset: page * 10,
        p_limit: 10,
      });
      if (error) throw error;
      return data as { total: number; rows: Load[] };
    },
  });
  async function download(load: Load) {
    if (busy) return;
    setBusy(load.id);
    try {
      const rows: Record<string, unknown>[] = [];
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await (supabase as any).rpc("get_weekly_sap_load_rows", {
          p_import_id: load.id,
          p_offset: offset,
          p_limit: 500,
        });
        if (error) throw error;
        rows.push(...data.rows);
        if (rows.length >= data.total) break;
      }
      const XLSX = await import("xlsx");
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet([load]), "Carga");
      XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(rows), "Dados SAP");
      XLSX.writeFile(book, `SAP-${load.id}.xlsx`);
    } catch (e: any) {
      toast.error(e.message ?? "Não foi possível baixar a carga.");
    } finally {
      setBusy(null);
    }
  }
  return (
    <details
      className="mt-3 border-t border-border pt-3"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="cursor-pointer text-xs font-medium">
        Histórico de cargas SAP da semana
      </summary>
      <p className="my-2 text-xs text-muted-foreground">
        As cargas estruturadas ficam preservadas. Somente a última alimenta a apuração atual. O
        download reconstrói os dados importados, não o arquivo Excel original. Cargas removidas
        antes desta mudança não podem ser recuperadas aqui.
      </p>
      {query.isError ? (
        <p role="alert" className="text-xs text-destructive">
          Falha ao consultar cargas.{" "}
          <button className="underline" onClick={() => query.refetch()}>
            Tentar novamente
          </button>
        </p>
      ) : query.isPending ? (
        <p className="text-xs">Carregando…</p>
      ) : (
        <>
          {!query.data.rows.length && <p className="text-xs">Nenhuma carga preservada.</p>}
          <ul className="divide-y divide-border">
            {query.data.rows.map((load) => (
              <li
                key={load.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs"
              >
                <span>
                  {new Date(load.imported_at).toLocaleString("pt-BR")} | {load.imported_by_name} |{" "}
                  {load.source_file_name} | {load.row_count} linhas
                </span>
                <button
                  className="btn-outline text-xs"
                  disabled={!!busy}
                  onClick={() => download(load)}
                >
                  {busy === load.id ? "Preparando…" : "Baixar carga"}
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex items-center gap-3 text-xs">
            <button className="btn-ghost" disabled={!page} onClick={() => setPage(page - 1)}>
              Anterior
            </button>
            <span>
              Página {page + 1} · {query.data.total} cargas
            </span>
            <button
              className="btn-ghost"
              disabled={(page + 1) * 10 >= query.data.total}
              onClick={() => setPage(page + 1)}
            >
              Próxima
            </button>
          </div>
        </>
      )}
    </details>
  );
}
