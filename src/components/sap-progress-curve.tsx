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
      title="Curva de avanço · SAP"
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
          <div className="mb-3 flex flex-wrap gap-5 text-sm">
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
          <div
            className="h-80 min-w-0 w-full"
            role="img"
            aria-label="Colunas de HH diário programado, apropriado SAP e restante; linhas de percentual acumulado"
          >
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={series} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis
                  yAxisId="hours"
                  domain={[0, "auto"]}
                  tick={{ fontSize: 11 }}
                  label={{ value: "HH", position: "insideTopLeft" }}
                />
                <YAxis
                  yAxisId="percent"
                  orientation="right"
                  domain={[0, 100]}
                  unit="%"
                  tick={{ fontSize: 11 }}
                />
                <Tooltip
                  formatter={(value: number, name: string) =>
                    `${number(value)}${name.includes("acumulado") ? "%" : " HH"}`
                  }
                  contentStyle={{
                    background: "var(--card)",
                    borderColor: "var(--border)",
                    color: "var(--foreground)",
                  }}
                />
                <Legend />
                <Bar
                  yAxisId="hours"
                  dataKey="dailyPlanned"
                  name="Programado (dia)"
                  fill="var(--muted-foreground)"
                  maxBarSize={22}
                />
                <Bar
                  yAxisId="hours"
                  dataKey="dailyEarned"
                  name="Apropriado SAP considerado (dia)"
                  fill="var(--primary)"
                  maxBarSize={22}
                />
                <Bar
                  yAxisId="hours"
                  dataKey="dailyRemaining"
                  name="Restante (dia)"
                  fill="#f59e0b"
                  maxBarSize={22}
                />
                <Line
                  yAxisId="percent"
                  type="linear"
                  dataKey="planned"
                  name="Planejado acumulado"
                  stroke="var(--muted-foreground)"
                  strokeDasharray="5 4"
                />
                <Line
                  yAxisId="percent"
                  type="linear"
                  dataKey="earned"
                  name="Apropriado SAP acumulado"
                  stroke="var(--primary)"
                  strokeWidth={2}
                />
              </ComposedChart>
            </ResponsiveContainer>
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
