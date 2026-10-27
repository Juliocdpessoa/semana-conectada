import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { Panel } from "@/components/ui-kit";
import { RsAlertBadge } from "@/components/rs-alert-badge";
import { supabase } from "@/integrations/supabase/client";
import type { MonthlyRsWeek } from "@/lib/monthly-realization";
import {
  evolutionColor,
  evolutionCenters,
  evolutionPoints,
  evolutionWindow,
  type EvolutionWeek,
} from "@/lib/rs-weekly-evolution";

const percent = (value: number) =>
  `${value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
const date = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString("pt-BR");

export function RsWeeklyEvolution({
  weeks,
  local,
  userId,
  worksiteId,
  selectedIds,
}: {
  weeks: EvolutionWeek[];
  local: string;
  userId: string;
  worksiteId: string;
  selectedIds: string[];
}) {
  const [page, setPage] = useState(0);
  const [center, setCenter] = useState("");
  useEffect(() => setCenter(""), [userId, worksiteId]);
  const [visible, setVisible] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  const scope = weeks
    .map((week) => week.id)
    .sort()
    .join("|");
  useEffect(() => setPage(0), [scope, local]);
  useEffect(() => {
    if (!anchor.current) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setVisible(true);
        observer.disconnect();
      }
    });
    observer.observe(anchor.current);
    return () => observer.disconnect();
  }, []);
  const window = evolutionWindow(weeks, page);
  const ids = window.weeks.map((week) => week.id);
  const query = useQuery({
    queryKey: ["rs-weekly-evolution", userId, worksiteId, ids.join("|"), local],
    enabled: visible && ids.length > 0,
    staleTime: 300_000,
    refetchOnWindowFocus: false,
    retry: 1,
    queryFn: async ({ signal }) => {
      const { data, error } = await (supabase as any)
        .rpc("get_monthly_rs_weeks", {
          p_worksite_id: worksiteId,
          p_week_ids: ids,
          p_local: local || null,
        })
        .abortSignal(signal);
      if (error) throw error;
      if (
        !Array.isArray(data?.weeks) ||
        data.weeks.length !== ids.length ||
        new Set(data.weeks.map((item: MonthlyRsWeek) => item.week.id)).size !== ids.length ||
        data.weeks.some((item: MonthlyRsWeek) => !ids.includes(item.week.id))
      )
        throw new Error("Histórico semanal incompleto.");
      return data.weeks as MonthlyRsWeek[];
    },
  });
  const centers = evolutionCenters(query.data ?? []);
  const points = evolutionPoints(window.weeks, query.data ?? [], center);
  const measured = points.filter((point) => point.rs !== null);
  return (
    <div ref={anchor} className="mt-5">
      <Panel
        title="Evolução semanal do RS"
        description={`Ano e mês dos filtros · ${local || "IARI + ROTINA"} · ${center || "Todos os centros do RS"} · até 12 semanas por página`}
      >
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            Resultado de cada semana, preservando os fechamentos oficiais. Semanas em apuração podem
            mudar.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs">
              <span className="mb-1 block">Centro de trabalho</span>
              <select
                className="input-base h-8 min-w-[12rem]"
                value={center}
                onChange={(event) => setCenter(event.target.value)}
              >
                <option value="">Todos os centros do RS</option>
                {center && !centers.includes(center) && (
                  <option value={center}>{center} · sem base neste recorte</option>
                )}
                {centers.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="btn-outline h-8"
              disabled={window.page >= window.pages - 1}
              onClick={() => setPage(window.page + 1)}
              aria-label="Ver semanas anteriores"
            >
              <ChevronLeft className="h-4 w-4" />
              Anteriores
            </button>
            <button
              className="btn-outline h-8"
              disabled={window.page === 0}
              onClick={() => setPage(window.page - 1)}
              aria-label="Ver semanas mais recentes"
            >
              Recentes
              <ChevronRight className="h-4 w-4" />
            </button>
            <button
              className="btn-outline h-8"
              disabled={!visible || !ids.length || query.isFetching}
              onClick={() => void query.refetch()}
              aria-label="Atualizar evolução semanal"
            >
              <RefreshCw className={`h-4 w-4 ${query.isFetching ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>
        {!ids.length ? (
          <p className="text-sm text-muted-foreground">Nenhuma semana neste período.</p>
        ) : !visible || query.isPending ? (
          <p role="status" className="py-12 text-sm text-muted-foreground">
            Carregando evolução semanal…
          </p>
        ) : query.isError ? (
          <p role="alert" className="py-6 text-sm text-destructive">
            Não foi possível carregar a evolução. Use atualizar para tentar novamente.
          </p>
        ) : (
          <>
            {measured.length > 0 ? (
              <div className="overflow-x-auto">
                <div
                  className="h-[320px] min-w-[560px]"
                  style={{ minWidth: Math.max(560, points.length * 86) }}
                  role="img"
                  aria-label="Barras do RS por semana. Valores e situação disponíveis na tabela abaixo."
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      accessibilityLayer
                      data={points}
                      margin={{ top: 30, right: 42, bottom: 8, left: 4 }}
                    >
                      <CartesianGrid
                        vertical={false}
                        stroke="hsl(var(--border))"
                        strokeDasharray="3 3"
                      />
                      <XAxis
                        dataKey="axisLabel"
                        interval={0}
                        tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
                        tickLine={false}
                      />
                      <YAxis
                        domain={[
                          0,
                          Math.max(
                            110,
                            Math.ceil(Math.max(...measured.map((p) => p.rs!)) / 10) * 10,
                          ),
                        ]}
                        tickFormatter={(value) => `${value}%`}
                        tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <ReferenceLine
                        y={95}
                        stroke="hsl(var(--muted-foreground))"
                        strokeDasharray="3 3"
                      />
                      <ReferenceLine y={98} stroke="hsl(var(--foreground))" strokeDasharray="7 4" />
                      <Tooltip
                        cursor={{ fill: "hsl(var(--muted))", opacity: 0.5 }}
                        content={({ active, payload }) => {
                          const point = payload?.[0]?.payload as
                            (typeof points)[number] | undefined;
                          return active && point ? (
                            <div className="rounded-md border border-border bg-popover p-3 text-xs text-popover-foreground shadow-md">
                              <p className="font-semibold">{point.label}</p>
                              <p>
                                {date(point.start_date)} a {date(point.end_date)}
                              </p>
                              <p className="mt-2 text-base font-semibold">
                                {point.rs === null ? "Sem apuração" : percent(point.rs)}
                              </p>
                              <p>{point.frozen ? "Fechamento oficial" : "Em apuração"}</p>
                              <RsAlertBadge value={point.rs} />
                            </div>
                          ) : null;
                        }}
                      />
                      <Bar
                        dataKey="rs"
                        name="RS"
                        maxBarSize={58}
                        radius={[4, 4, 0, 0]}
                        isAnimationActive={false}
                      >
                        {points.map((point) => (
                          <Cell
                            key={point.id}
                            fill={evolutionColor(point.factor)}
                            fillOpacity={point.frozen ? 1 : 0.72}
                            stroke={
                              selectedIds.includes(point.id)
                                ? "hsl(var(--foreground))"
                                : evolutionColor(point.factor)
                            }
                            strokeWidth={selectedIds.includes(point.id) ? 2 : 1}
                            strokeDasharray={point.frozen ? undefined : "4 2"}
                          />
                        ))}
                        <LabelList
                          dataKey="rs"
                          position="top"
                          formatter={(value: unknown) =>
                            typeof value === "number" ? percent(value) : ""
                          }
                          fill="hsl(var(--foreground))"
                          fontSize={12}
                        />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            ) : (
              <p className="py-8 text-sm text-muted-foreground">
                Ainda não há RS válido para desenhar as barras deste período.
              </p>
            )}
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
              <span>Vermelho: &lt; 95%</span>
              <span>Âmbar: 95% a &lt; 98%</span>
              <span>Verde: 98% a 100%</span>
              <span>Azul: &gt; 100%</span>
              <span>Tracejada: em apuração · Contorno destacado: seleção acima</span>
              <span>Referências: 95% pontilhada / 98% tracejada</span>
            </div>
            <details className="mt-4 border-t border-border pt-3">
              <summary className="cursor-pointer text-xs font-medium">
                Valores e situação por semana
                {measured.length < points.length
                  ? ` · ${points.length - measured.length} sem apuração válida`
                  : ""}
              </summary>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <caption className="sr-only">
                    Resultado semanal SAP + RS, sem média dos percentuais
                  </caption>
                  <thead>
                    <tr className="border-b border-border">
                      <th className="p-2">Semana</th>
                      <th className="p-2">Período</th>
                      <th className="p-2">RS</th>
                      <th className="p-2">Situação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {points.map((point) => (
                      <tr key={point.id} className="border-b border-border">
                        <th className="p-2 font-medium">{point.label}</th>
                        <td className="p-2 whitespace-nowrap">
                          {date(point.start_date)} a {date(point.end_date)}
                        </td>
                        <td className="p-2">{point.rs === null ? "—" : percent(point.rs)}</td>
                        <td className="p-2">
                          {point.rs === null ? (
                            point.issues.join(" · ")
                          ) : (
                            <>
                              <span className="mr-2">
                                {point.frozen ? "Fechamento oficial" : "Em apuração"}
                              </span>
                              <RsAlertBadge value={point.rs} />
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </>
        )}
      </Panel>
    </div>
  );
}
