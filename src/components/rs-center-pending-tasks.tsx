import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  pendingOperationalLabel,
  pendingJustification,
  pendingHours,
  pendingPageHours,
  type RsPendingSource,
} from "@/lib/rs-center-pending";
type Row = {
  id: string;
  week_id: string;
  week_code: string;
  order_number: string;
  operation: string | null;
  suboperation: string | null;
  description: string;
  scheduled_date: string | null;
  planned_hh: number | string | null;
  status: string;
  justification: string | null;
  observation: string | null;
  justification_by: string | null;
  justification_at: string | null;
};
type Result = {
  total: number;
  rows: Row[];
  missingSapWeeks: string[];
  unknownPeriod: number;
  totalPlannedHh: number | string | null;
  missingPlannedHh: number;
};
const hours = (value: unknown) => {
  const parsed = pendingHours(value);
  return parsed === null
    ? "—"
    : parsed.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const date = (value: string | null) => (value ? value.split("-").reverse().join("/") : "Sem data");
export function RsCenterPendingTasks({
  center,
  sources,
  local,
  userId,
  worksiteId,
  revision,
  onClose,
}: {
  center: string;
  sources: RsPendingSource[];
  local: string;
  userId: string;
  worksiteId: string;
  revision: string;
  onClose: () => void;
}) {
  const [page, setPage] = useState(0);
  const query = useQuery({
    queryKey: [
      "rs-center-pending-tasks",
      userId,
      worksiteId,
      sources,
      center,
      local,
      revision,
      page,
    ],
    queryFn: async ({ signal }) => {
      const { data, error } = await (supabase as any)
        .rpc("get_rs_center_pending_tasks", {
          p_sources: sources,
          p_center: center,
          p_local: local || null,
          p_offset: page * 50,
          p_limit: 50,
        })
        .abortSignal(signal);
      if (error) throw error;
      return data as Result;
    },
    staleTime: 30_000,
  });
  const allMissing = !!query.data && query.data.missingSapWeeks.length === sources.length;
  return (
    <section aria-label={`Tarefas sem apropriação SAP de ${center}`} className="space-y-3 text-xs">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-foreground">
            {center} · Programação sem apropriação SAP
          </h3>
          <p className="mt-1 text-muted-foreground">
            Somente tarefas sem apropriação na carga SAP do recorte. Justificativas e observações
            vêm dos encarregados, não do SAP. HH programado corresponde à tarefa/dia da programação
            operacional; não é o HH da base oficial semanal do RS.
          </p>
        </div>
        <button type="button" onClick={onClose} className="btn-ghost text-xs">
          Fechar detalhes
        </button>
      </div>
      {query.isPending ? (
        <p role="status">Carregando tarefas…</p>
      ) : query.isError ? (
        <p role="alert" className="text-destructive">
          Não foi possível carregar as tarefas.{" "}
          <button type="button" className="underline" onClick={() => void query.refetch()}>
            Tentar novamente
          </button>
        </p>
      ) : (
        <>
          {!!query.data.missingSapWeeks.length && (
            <p role="status" className="text-warning-foreground">
              Sem carga SAP em: {query.data.missingSapWeeks.join(", ")}. Não é possível identificar
              as pendências dessas semanas.
            </p>
          )}
          {query.data.unknownPeriod > 0 && (
            <p className="text-muted-foreground">
              Registros antigos com período SAP indefinido ficaram fora desta lista.
            </p>
          )}
          {query.data.missingPlannedHh > 0 && (
            <p role="status" className="text-warning-foreground">
              {query.data.missingPlannedHh} tarefa(s) sem HH válido. O total fica indisponível para
              não apresentar uma soma incompleta.
            </p>
          )}
          {!allMissing && (
            <p aria-live="polite" className="text-muted-foreground">
              {query.data.total} tarefa(s) sem apropriação · {local || "IARI + ROTINA"}
            </p>
          )}
          {!query.data.rows.length ? (
            !allMissing && (
              <p className="py-3 text-muted-foreground">
                Nenhuma tarefa sem apropriação SAP neste centro e recorte.
              </p>
            )
          ) : (
            <div className="max-h-[440px] overflow-auto rounded-md border border-border bg-card">
              <table className="w-full min-w-[940px] text-left text-xs">
                <thead className="sticky top-0 bg-muted">
                  <tr>
                    {[
                      "Semana / Data",
                      "Ordem / Operação",
                      "Atividade",
                      "HH programado",
                      "Status operacional",
                      "Justificativa do encarregado",
                    ].map((v) => (
                      <th key={v} className="p-2 font-semibold">
                        {v}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {query.data.rows.map((row) => (
                    <tr
                      key={`${row.week_id}:${row.id}`}
                      className="rs-hover-row row-zebra border-t border-border/50 align-top"
                    >
                      <td className="p-2">
                        <div>{row.week_code}</div>
                        <div className="mt-1 text-muted-foreground">{date(row.scheduled_date)}</div>
                      </td>
                      <td className="p-2 font-mono">
                        <div>{row.order_number || "—"}</div>
                        <div className="mt-1 text-muted-foreground">
                          {row.operation || "—"}
                          {row.suboperation ? ` / ${row.suboperation}` : ""}
                        </div>
                      </td>
                      <td className="min-w-48 p-2">{row.description}</td>
                      <td className="p-2 text-right tabular-nums">{hours(row.planned_hh)}</td>
                      <td className="min-w-36 p-2">{pendingOperationalLabel(row.status)}</td>
                      <td className="min-w-64 p-2">
                        <p className="whitespace-pre-wrap">
                          {pendingJustification(row.justification)}
                        </p>
                        {row.justification_by && (
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            {row.justification_by}
                            {row.justification_at
                              ? ` · ${new Date(row.justification_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`
                              : ""}
                          </p>
                        )}
                        {row.observation?.trim() && (
                          <p className="mt-2 whitespace-pre-wrap text-muted-foreground">
                            Observação: {row.observation}
                          </p>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-border bg-muted font-semibold">
                  {query.data.total > 50 && (
                    <tr className="rs-hover-row">
                      <th scope="row" colSpan={3} className="p-2">
                        Subtotal desta página · HH
                      </th>
                      <td className="p-2 text-right tabular-nums">
                        {hours(pendingPageHours(query.data.rows))}
                      </td>
                      <td colSpan={2} className="p-2 font-normal text-muted-foreground">
                        Somente as tarefas exibidas
                      </td>
                    </tr>
                  )}
                  <tr className="rs-hover-row">
                    <th scope="row" colSpan={3} className="p-2">
                      Total das tarefas sem apropriação · HH
                    </th>
                    <td className="p-2 text-right tabular-nums">
                      {hours(query.data.totalPlannedHh)}
                    </td>
                    <td colSpan={2} className="p-2 font-normal text-muted-foreground">
                      {query.data.total} tarefa(s) · todas as páginas
                      {query.data.missingSapWeeks.length
                        ? " · recorte parcial: há semanas sem SAP"
                        : ""}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          {query.data.total > 50 && (
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                className="btn-ghost text-xs"
                disabled={page === 0 || query.isFetching}
                onClick={() => setPage((p) => p - 1)}
              >
                Anterior
              </button>
              <span>
                Página {page + 1} de {Math.ceil(query.data.total / 50)}
              </span>
              <button
                type="button"
                className="btn-ghost text-xs"
                disabled={(page + 1) * 50 >= query.data.total || query.isFetching}
                onClick={() => setPage((p) => p + 1)}
              >
                Próxima
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
