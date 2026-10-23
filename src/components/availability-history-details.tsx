import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { AvailabilityRow } from "@/lib/weekly-availability";
type Change = {
  center: string;
  date: string;
  action: "included" | "removed" | "updated";
  before: AvailabilityRow | null;
  after: AvailabilityRow | null;
};
type Changes = {
  comparisonAvailable: boolean;
  total: number;
  included: number;
  removed: number;
  updated: number;
  rows: Change[];
};
const labels = { included: "Incluído", removed: "Removido", updated: "Alterado" };
const number = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
function changedFields(row: Change) {
  if (row.action !== "updated")
    return row.action === "included" ? "Linha cadastrada" : "Linha excluída";
  const labels = {
    center: "Centro",
    date: "Data",
    hours: "HH disponível",
    local: "Local",
    specialty: "Especialidade",
    week: "Semana",
  };
  return (Object.keys(labels) as Array<keyof AvailabilityRow>)
    .filter((key) => row.before?.[key] !== row.after?.[key])
    .map((key) => labels[key])
    .join(", ");
}
function value(row: AvailabilityRow | null, key: keyof AvailabilityRow) {
  if (!row) return "—";
  return key === "hours" ? number(row.hours) + " HH" : row[key] || "—";
}
export function AvailabilityHistoryDetails({
  weekId,
  version,
  userId,
  worksiteId,
}: {
  weekId: string;
  version: number;
  userId: string;
  worksiteId: string;
}) {
  const [page, setPage] = useState(0);
  const query = useQuery({
    queryKey: ["weekly-rs-history-details", userId, worksiteId, weekId, version, page],
    staleTime: 60_000,
    queryFn: async ({ signal }) => {
      const { data, error } = await (supabase as any)
        .rpc("get_weekly_rs_availability_changes", {
          p_week_id: weekId,
          p_version: version,
          p_offset: page * 50,
          p_limit: 50,
        })
        .abortSignal(signal);
      if (error) throw error;
      return data as Changes;
    },
  });
  if (query.isPending) return <p role="status">Carregando alterações por centro…</p>;
  if (query.isError)
    return (
      <p role="alert" className="text-destructive">
        Não foi possível carregar os detalhes.{" "}
        <button className="underline" onClick={() => query.refetch()}>
          Tentar novamente
        </button>
      </p>
    );
  const data = query.data;
  if (!data.comparisonAvailable)
    return (
      <p>
        A versão anterior não está disponível para comparação. Não é possível reconstruir as
        alterações com segurança.
      </p>
    );
  return (
    <div className="space-y-3">
      <p className="font-medium">
        {version === 1 ? "Cadastro inicial" : `Versão ${version - 1} → ${version}`} ·{" "}
        {data.included} inclusões · {data.updated} alterações · {data.removed} remoções
      </p>
      <p className="text-muted-foreground">
        Comparação por centro e data. Troca de centro ou data aparece como remoção e inclusão. Os
        detalhes consideram a semana inteira, sem os filtros do editor.
      </p>
      {!data.total ? (
        <p>Nenhuma mudança nas linhas; este salvamento manteve os dados de disponibilidade.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr>
                  {[
                    "Centro",
                    "Data",
                    "Ação",
                    "O que mudou",
                    "HH anterior → novo",
                    "Local anterior → novo",
                    "Especialidade anterior → nova",
                    "Semana anterior → nova",
                  ].map((h) => (
                    <th key={h} className="p-2 text-left whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r, i) => (
                  <tr key={`${r.center}:${r.date}:${i}`} className="border-t border-border">
                    <td className="p-2 font-medium">{r.center}</td>
                    <td className="p-2 whitespace-nowrap">
                      {new Date(r.date + "T12:00:00").toLocaleDateString("pt-BR")}
                    </td>
                    <td className="p-2">{labels[r.action]}</td>
                    <td className="p-2">{changedFields(r)}</td>
                    {(["hours", "local", "specialty", "week"] as const).map((key) => (
                      <td className="p-2 whitespace-nowrap" key={key}>
                        {value(r.before, key)} → {value(r.after, key)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between gap-2">
            <button
              className="btn-ghost text-xs"
              disabled={page === 0 || query.isFetching}
              onClick={() => setPage((p) => p - 1)}
            >
              Anterior
            </button>
            <span>
              {data.total} linhas alteradas · página {page + 1}
            </span>
            <button
              className="btn-ghost text-xs"
              disabled={(page + 1) * 50 >= data.total || query.isFetching}
              onClick={() => setPage((p) => p + 1)}
            >
              Próxima
            </button>
          </div>
        </>
      )}
    </div>
  );
}
