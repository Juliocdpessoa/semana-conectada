import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Panel } from "@/components/ui-kit";
import { sapProgressSeries, type SapEarnedProgress } from "@/lib/sap-progress-series";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const number = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 1 });

export function useSapProgress(weekId: string | undefined, userId: string, worksiteId: string) {
  return useQuery({
    enabled: !!weekId,
    queryKey: ["sap-earned-progress", userId, worksiteId, weekId],
    staleTime: 30_000,
    queryFn: async ({ signal }) => {
      const { data, error } = await (supabase as any)
        .rpc("get_activity_sap_progress", { p_week_id: weekId })
        .abortSignal(signal);
      if (error) throw error;
      return data as SapEarnedProgress;
    },
  });
}
export function SapProgressCurve({
  weekId,
  userId,
  worksiteId,
  startDate,
  endDate,
}: {
  weekId: string;
  userId: string;
  worksiteId: string;
  startDate: string;
  endDate: string;
}) {
  const query = useSapProgress(weekId, userId, worksiteId);
  const progress = query.data;
  const hasMeasuredProgress = !!progress?.hasSource && !progress.invalidHours;
  const series = sapProgressSeries(startDate, endDate, progress);
  return (
    <Panel
      title="Curva de Avanço"
      description="HH apropriado limitado ao programado por confirmação ÷ HH programado. Status operacional não interfere no avanço."
    >
      {query.isPending ? (
        <p className="text-sm text-muted-foreground">Carregando avanço SAP…</p>
      ) : query.isError ? (
        <p className="text-sm text-destructive">
          Não foi possível carregar o avanço SAP.{" "}
          <button className="underline" onClick={() => query.refetch()}>
            Tentar novamente
          </button>
        </p>
      ) : !progress || progress.planned <= 0 ? (
        <p className="text-sm text-muted-foreground">
          Sem HH programado válido para calcular o avanço.
        </p>
      ) : (
        <>
          {!progress.hasSource && (
            <p className="mb-3 text-sm text-muted-foreground">
              Sem carga SAP detalhada nesta semana. A curva planejada permanece visível; o avanço
              realizado fica indisponível até a importação.
            </p>
          )}
          {progress.invalidHours > 0 && (
            <p className="mb-3 text-sm text-amber-800 dark:text-amber-300">
              Há {progress.invalidHours} tarefas reais sem HH válido. Exibimos somente o
              planejamento com HH conhecido; o percentual realizado fica indisponível até a
              correção.
            </p>
          )}
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 [&>span]:rounded-md [&>span]:border [&>span]:border-border [&>span]:bg-muted/30 [&>span]:px-3 [&>span]:py-2 [&>span]:text-xs [&_strong]:mt-1 [&_strong]:block [&_strong]:text-sm">
            <span>
              HH programado: <strong>{number(progress.planned)}</strong>
            </span>
            <span>
              HH apropriado considerado:{" "}
              <strong>{hasMeasuredProgress ? number(progress.earned) : "—"}</strong>
            </span>
            <span>
              Conclusão SAP:{" "}
              <strong>
                {hasMeasuredProgress
                  ? number((progress.earned / progress.planned) * 100) + "%"
                  : "—"}
              </strong>
            </span>
          </div>
          <div className="w-full overflow-x-auto">
            <div
              className="h-[360px]"
              style={{ minWidth: Math.max(560, series.length * 70) }}
              role="img"
              aria-label="Colunas de HH diário programado, apropriado SAP e restante; linhas de percentual acumulado"
            >
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={series} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                  <YAxis
                    yAxisId="hours"
                    domain={[0, "auto"]}
                    tick={{ fontSize: 11 }}
                    stroke="var(--muted-foreground)"
                    label={{ value: "HH", position: "insideTopLeft" }}
                  />
                  <YAxis
                    yAxisId="percent"
                    orientation="right"
                    domain={[0, 100]}
                    unit="%"
                    tick={{ fontSize: 11 }}
                    stroke="var(--muted-foreground)"
                  />
                  <Tooltip
                    formatter={(value: number, name: string) =>
                      `${number(value)}${name.includes("%") ? "%" : " HH"}`
                    }
                    contentStyle={{
                      background: "var(--card)",
                      borderColor: "var(--border)",
                      color: "var(--foreground)",
                      fontSize: 12,
                      borderRadius: 8,
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar
                    yAxisId="hours"
                    dataKey="dailyPlanned"
                    name="Planejado (dia)"
                    fill="#9CA3AF"
                    barSize={14}
                  />
                  <Bar
                    yAxisId="hours"
                    dataKey="dailyEarned"
                    name="Realizado SAP (dia)"
                    fill="#2563EB"
                    barSize={14}
                  />
                  <Bar
                    yAxisId="hours"
                    dataKey="dailyRemaining"
                    name="Restante (dia)"
                    fill="#16A34A"
                    barSize={14}
                  />
                  <Line
                    yAxisId="percent"
                    type="monotone"
                    dataKey="planned"
                    name="Planejado acumulado %"
                    className="text-[#111827] dark:text-slate-100"
                    stroke="currentColor"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    yAxisId="percent"
                    type="monotone"
                    dataKey="earned"
                    name="Realizado acumulado %"
                    stroke="#2563EB"
                    strokeWidth={2.5}
                    dot={{ r: 3 }}
                    connectNulls={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Apropriações parciais geram avanço parcial nos dias programados cobertos pelo período
            real SAP. Sem data real, o HH não é distribuído. Imediatas e não programadas não
            aumentam a conclusão da programação; são acompanhadas na conferência SAP. Base: última
            carga da semana.
          </p>
        </>
      )}
    </Panel>
  );
}
