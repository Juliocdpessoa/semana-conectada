import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { CheckCircle2, XCircle, Clock, Zap, ListChecks, Percent } from "lucide-react";
import { PageHeader, KpiCard, Panel, EmptyState, Skeleton } from "@/components/ui-kit";
import { cn } from "@/lib/utils";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export const Route = createFileRoute("/_authenticated/painel")({
  component: PainelPage,
});

type Row = {
  id: string;
  order_number: string | null;
  description: string;
  status: string;
  justification: string | null;
  area: string | null;
  specialty: string | null;
  scheduled_date: string | null;
  is_immediate: boolean;
  reported_by_name: string | null;
  reported_at: string | null;
  planning_data: Record<string, unknown> | null;
};

type ImmediateLink = {
  planned_activity_id: string;
  immediate_activity_id: string;
};

function PainelPage() {
  const [selectedJustification, setSelectedJustification] = useState<string | null>(null);
  const activeWeek = useQuery({
    queryKey: ["active-week"],
    queryFn: async () => (await supabase.from("weeks").select("*").eq("is_active", true).maybeSingle()).data,
  });

  const activities = useQuery({
    queryKey: ["activities-painel", activeWeek.data?.id],
    enabled: !!activeWeek.data?.id,
    queryFn: async () => {
      const chunk = 1000;
      const all: Row[] = [];
      for (let from = 0; ; from += chunk) {
        const { data, error } = await supabase
          .from("activities")
          .select(
            "id,order_number,description,status,justification,area,specialty,scheduled_date,is_immediate,reported_by_name,reported_at,planning_data",
          )
          .eq("week_id", activeWeek.data!.id)
          .range(from, from + chunk - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        all.push(...(data as Row[]));
        if (data.length < chunk) break;
      }
      return all;
    },
  });

  const rows = activities.data ?? [];
  const immediateLinks = useQuery({
    queryKey: ["activity-immediate-links-painel", activeWeek.data?.id],
    enabled: !!activeWeek.data?.id,
    queryFn: async () => {
      const chunk = 1000;
      const all: ImmediateLink[] = [];
      for (let from = 0; ; from += chunk) {
        const { data, error } = await supabase
          .from("activity_immediate_links")
          .select("planned_activity_id,immediate_activity_id")
          .eq("week_id", activeWeek.data!.id)
          .range(from, from + chunk - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        all.push(...data);
        if (data.length < chunk) break;
      }
      return all;
    },
  });
  const links = immediateLinks.data ?? [];
  const immediateById = useMemo(
    () => new Map(rows.filter((row) => row.is_immediate).map((row) => [row.id, row])),
    [rows],
  );
  const immediateIdsByPlanned = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const link of links) {
      const current = map.get(link.planned_activity_id) ?? [];
      current.push(link.immediate_activity_id);
      map.set(link.planned_activity_id, current);
    }
    return map;
  }, [links]);

  const kpis = useMemo(() => {
    const planned = rows.filter((r) => !r.is_immediate);
    const immediate = rows.filter((r) => r.is_immediate);
    const total = planned.length;
    const executado = planned.filter((r) => r.status === "EXECUTADO").length;
    const naoExec = planned.filter((r) => r.status === "NÃO EXECUTADO").length;
    const semApont = planned.filter((r) => !r.status || r.status === "Sem apontamento").length;
    const imediatas = immediate.length;
    const imediatasExecutadas = immediate.filter((r) => r.status === "EXECUTADO").length;
    const impactadas = new Set(links.map((link) => link.planned_activity_id)).size;
    const apontadas = executado + naoExec;
    const aderencia = total > 0 ? Math.round((executado / total) * 100) : 0;
    const progresso = total > 0 ? Math.round((apontadas / total) * 100) : 0;
    return { total, executado, naoExec, semApont, imediatas, imediatasExecutadas, impactadas, aderencia, progresso };
  }, [rows, links]);

  const byArea = useMemo(() => groupCounts(rows, (r) => r.area || "—"), [rows]);
  const bySpecialty = useMemo(() => groupCounts(rows, (r) => r.specialty || "—"), [rows]);
  const byDay = useMemo(() => {
    const map = new Map<string, { total: number; exec: number; nao: number }>();
    for (const r of rows) {
      const k = r.scheduled_date || "—";
      const g = map.get(k) ?? { total: 0, exec: 0, nao: 0 };
      g.total++;
      if (r.status === "EXECUTADO") g.exec++;
      if (r.status === "NÃO EXECUTADO") g.nao++;
      map.set(k, g);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [rows]);
  const byJust = useMemo(() => {
    const only = rows.filter((r) => r.status === "NÃO EXECUTADO" && r.justification);
    return groupCounts(only, (r) => r.justification!).slice(0, 10);
  }, [rows]);
  const byResp = useMemo(() => {
    const only = rows.filter((r) => r.reported_by_name);
    return groupCounts(only, (r) => r.reported_by_name!).slice(0, 10);
  }, [rows]);
  if (activeWeek.isLoading || activities.isLoading || immediateLinks.isLoading) {
    return (
      <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
        <div className="mb-5 space-y-2">
          <Skeleton className="h-6 w-64" />
          <Skeleton className="h-4 w-96" />
        </div>
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-64" />
          ))}
        </div>
      </main>
    );
  }
  if (!activeWeek.data) {
    return (
      <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
        <PageHeader title="Painel gerencial" description="Indicadores da semana ativa." />
        <EmptyState title="Nenhuma semana ativa" description="Importe ou ative uma semana no menu Planejamento." />
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6">
      <PageHeader
        eyebrow="Painel gerencial"
        title={activeWeek.data.label}
        description={`${activeWeek.data.start_date} a ${activeWeek.data.end_date} · ${kpis.total} atividades`}
        actions={
          <div className="hidden items-center gap-4 sm:flex">
            <MiniStat label="Aderência" value={`${kpis.aderencia}%`} tone="success" />
            <MiniStat label="Progresso" value={`${kpis.progresso}%`} />
          </div>
        }
      />

      <section className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard label="Programadas" value={kpis.total} icon={<ListChecks className="h-3.5 w-3.5" />} />
        <KpiCard
          label="Executadas"
          value={kpis.executado}
          tone="success"
          icon={<CheckCircle2 className="h-3.5 w-3.5" />}
        />
        <KpiCard
          label="Não executadas"
          value={kpis.naoExec}
          tone="destructive"
          icon={<XCircle className="h-3.5 w-3.5" />}
        />
        <KpiCard label="Sem apontamento" value={kpis.semApont} icon={<Clock className="h-3.5 w-3.5" />} />
        <KpiCard
          label="IMEDIATAS executadas"
          value={`${kpis.imediatasExecutadas}/${kpis.imediatas}`}
          tone="warning"
          icon={<Zap className="h-3.5 w-3.5" />}
        />
        <KpiCard
          label="Impactadas por IMEDIATAS"
          value={kpis.impactadas}
          tone="primary"
          icon={<Percent className="h-3.5 w-3.5" />}
        />
      </section>

      <section className="mb-4">
        <ProgressCurve
          rows={rows}
          links={links}
          startDate={activeWeek.data.start_date}
          endDate={activeWeek.data.end_date}
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Panel title="Execução por dia" description="Barras empilhadas executado/não executado">
          <div className="space-y-3">
            {byDay.length === 0 ? (
              <Empty />
            ) : (
              byDay.map(([day, g]) => (
                <div key={day} className="min-w-0">
                  <div className="mb-1 flex justify-between text-[11px]">
                    <span className="font-medium text-foreground">{formatDate(day)}</span>
                    <span className="text-muted-foreground tabular">
                      {g.exec}/{g.total}
                    </span>
                  </div>
                  <StackedBar total={g.total} exec={g.exec} nao={g.nao} />
                </div>
              ))
            )}
          </div>
        </Panel>

        <Panel title="Por área (Gerência)">
          <BarList items={byArea} />
        </Panel>
        <Panel title="Por especialidade">
          <BarList items={bySpecialty} />
        </Panel>
        <Panel title="Top 10 justificativas" description="Clique no motivo para visualizar as tarefas pendentes">
          <PendingByJustification
            items={byJust}
            rows={rows}
            immediateById={immediateById}
            immediateIdsByPlanned={immediateIdsByPlanned}
            selected={selectedJustification}
            onSelect={(key) => setSelectedJustification((current) => (current === key ? null : key))}
          />
        </Panel>

        <Panel className="lg:col-span-2" title="Top 10 responsáveis por apontamento">
          <BarList items={byResp} color="success" />
        </Panel>
      </div>
    </main>
  );
}

function MiniStat({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "success" }) {
  return (
    <div className="text-right">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div
        className={cn(
          "text-xl font-semibold leading-none tabular",
          tone === "success" ? "text-success" : "text-foreground",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function BarList({
  items,
  color = "primary",
  onSelect,
}: {
  items: [string, number][];
  color?: "primary" | "success" | "destructive";
  onSelect?: (key: string) => void;
}) {
  const max = Math.max(1, ...items.map(([, n]) => n));
  const bg = color === "success" ? "bg-success" : color === "destructive" ? "bg-destructive" : "bg-primary";
  if (items.length === 0) return <Empty />;
  return (
    <div className="space-y-2">
      {items.map(([k, n]) => (
        <button
          key={k}
          type="button"
          onClick={() => onSelect?.(k)}
          disabled={!onSelect}
          className={cn(
            "block w-full min-w-0 text-left text-[12px]",
            onSelect && "rounded-md p-1.5 transition-colors hover:bg-muted",
          )}
        >
          <div className="flex min-w-0 justify-between gap-2">
            <span className="min-w-0 flex-1 truncate text-foreground" title={k}>
              {k}
            </span>
            <span className="shrink-0 tabular text-muted-foreground">{n.toLocaleString("pt-BR")}</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
            <div className={cn("h-full rounded-full", bg)} style={{ width: `${(n / max) * 100}%` }} />
          </div>
        </button>
      ))}
    </div>
  );
}

function PendingByJustification({
  items,
  rows,
  immediateById,
  immediateIdsByPlanned,
  selected,
  onSelect,
}: {
  items: [string, number][];
  rows: Row[];
  immediateById: Map<string, Row>;
  immediateIdsByPlanned: Map<string, string[]>;
  selected: string | null;
  onSelect: (key: string) => void;
}) {
  const max = Math.max(1, ...items.map(([, count]) => count));
  if (items.length === 0) return <Empty />;
  return (
    <div className="space-y-2">
      {items.map(([reason, count]) => {
        const open = selected === reason;
        const tasks = open ? rows.filter((row) => row.status === "NÃO EXECUTADO" && row.justification === reason) : [];
        return (
          <div
            key={reason}
            className={cn("overflow-hidden rounded-md border", open ? "border-destructive/40" : "border-transparent")}
          >
            <button
              type="button"
              onClick={() => onSelect(reason)}
              aria-expanded={open}
              className="block w-full p-2 text-left text-[12px] transition-colors hover:bg-muted active:bg-muted"
            >
              <div className="flex min-w-0 items-start justify-between gap-2">
                <span className="min-w-0 flex-1 text-foreground">{reason}</span>
                <span className="shrink-0 rounded-full bg-destructive/10 px-2 py-0.5 font-semibold tabular text-destructive">
                  {count.toLocaleString("pt-BR")}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-destructive" style={{ width: `${(count / max) * 100}%` }} />
              </div>
              <div className="mt-1 text-[10px] font-medium text-muted-foreground">
                {open ? "Toque para recolher" : "Toque para ver as tarefas"}
              </div>
            </button>

            {open && (
              <div className="max-h-[55vh] space-y-2 overflow-y-auto border-t border-border bg-muted/30 p-2">
                <div className="text-[11px] font-semibold text-foreground">
                  {tasks.length.toLocaleString("pt-BR")} tarefa(s) encontrada(s)
                </div>
                {tasks.map((task) => {
                  const linkedImmediateActivities = (immediateIdsByPlanned.get(task.id) ?? [])
                    .map((id) => immediateById.get(id))
                    .filter((item): item is Row => !!item);
                  return (
                    <div key={task.id} className="rounded-md border border-border bg-card p-3 text-[11px] shadow-sm">
                      <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-foreground">
                        <span>
                          <b>Ordem:</b> {task.order_number || "—"}
                        </span>
                        <span>
                          <b>Op:</b> {planValue(task.planning_data, "Op")}
                        </span>
                        <span>
                          <b>Subop:</b> {planValue(task.planning_data, "Subop")}
                        </span>
                      </div>
                      <div className="mt-2 text-[12px] leading-snug text-foreground">{task.description}</div>
                      <div className="mt-2 rounded bg-muted/60 px-2 py-1.5 text-[11px] leading-snug text-foreground">
                        <b>Observação:</b> {task.observation?.trim() || "—"}
                      </div>
                      {linkedImmediateActivities.length > 0 && (
                        <div className="mt-2 rounded border border-warning/30 bg-warning/10 px-2 py-1.5 text-[11px]">
                          <b className="text-foreground">IMEDIATA(s) relacionada(s):</b>
                          <ul className="mt-1 space-y-1 text-foreground">
                            {linkedImmediateActivities.map((immediate) => (
                              <li key={immediate.id}>
                                <span className="font-semibold">{immediate.order_number || "Sem ordem"}</span>
                                {" · "}
                                {immediate.description}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
                        <span>
                          <b>Data:</b> {formatDate(task.scheduled_date || "—")}
                        </span>
                        <span>
                          <b>Responsável:</b> {task.reported_by_name || "—"}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function planValue(data: Record<string, unknown> | null, key: string) {
  const value = data?.[key];
  return value === null || value === undefined || value === "" ? "—" : String(value);
}

function StackedBar({ total, exec, nao }: { total: number; exec: number; nao: number }) {
  const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0);
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
      <div className="h-full bg-success" style={{ width: `${pct(exec)}%` }} />
      <div className="h-full bg-destructive" style={{ width: `${pct(nao)}%` }} />
    </div>
  );
}

function Empty() {
  return <p className="text-[12px] text-muted-foreground">Sem dados.</p>;
}

function groupCounts<T>(rows: T[], key: (r: T) => string): [string, number][] {
  const map = new Map<string, number>();
  for (const r of rows) {
    const k = key(r);
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
}

function formatDate(d: string) {
  if (!d || d === "—") return "—";
  const [y, m, day] = d.split("-");
  if (!y || !m || !day) return d;
  return `${day}/${m}/${y}`;
}

/* ---------------- Curva de Avanço (S-Curve) ---------------- */

type CurveRow = {
  id: string;
  status: string;
  scheduled_date: string | null;
  reported_at: string | null;
  is_immediate: boolean;
  planning_data: Record<string, unknown> | null;
};

const WEEKDAY_PT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function isoDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseIsoDay(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

function daysBetween(startIso: string, endIso: string): string[] {
  const start = parseIsoDay(startIso);
  const end = parseIsoDay(endIso);
  const out: string[] = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    out.push(isoDay(d));
  }
  return out;
}

function reportedIsoDay(reportedAt: string | null): string | null {
  if (!reportedAt) return null;
  const d = new Date(reportedAt);
  if (isNaN(d.getTime())) return null;
  return isoDay(d);
}

function hoursOf(pd: Record<string, unknown> | null): number {
  if (!pd) return 0;
  const raw = (pd as Record<string, unknown>)["Dur n"] ?? (pd as Record<string, unknown>)["Trab"];
  const normalized =
    typeof raw === "string"
      ? raw
          .trim()
          .replace(/\s*h(?:oras?)?$/i, "")
          .replace(/\./g, "")
          .replace(",", ".")
      : raw;
  const n = typeof normalized === "number" ? normalized : typeof normalized === "string" ? Number(normalized) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function ProgressCurve({
  rows,
  links,
  startDate,
  endDate,
}: {
  rows: CurveRow[];
  links: ImmediateLink[];
  startDate: string;
  endDate: string;
}) {
  const [metric, setMetric] = useState<"count" | "hours">("count");

  const days = useMemo(() => daysBetween(startDate, endDate), [startDate, endDate]);
  const daySet = useMemo(() => new Set(days), [days]);
  const totalHours = useMemo(
    () => rows.filter((row) => !row.is_immediate).reduce((a, r) => a + hoursOf(r.planning_data), 0),
    [rows],
  );
  const hoursDisabled = totalHours <= 0;
  const effectiveMetric = hoursDisabled && metric === "hours" ? "count" : metric;

  const unitOf = (r: CurveRow) => (effectiveMetric === "hours" ? hoursOf(r.planning_data) : 1);

  const { data, totalPlanned, cutoffIso, indicators } = useMemo(() => {
    const dPlanned = new Map<string, number>();
    const dProgrammedExec = new Map<string, number>();
    const dImmediateExec = new Map<string, number>();
    const dImpacted = new Map<string, number>();
    const impactedIds = new Set(links.map((link) => link.planned_activity_id));
    let total = 0;

    for (const r of rows) {
      const unit = unitOf(r);
      if (unit <= 0) continue;

      const reportedIso = reportedIsoDay(r.reported_at);
      const reportedInWeek = reportedIso && daySet.has(reportedIso) ? reportedIso : null;

      if (r.is_immediate) {
        if (r.status === "EXECUTADO") {
          const execIso =
            reportedInWeek ?? (r.scheduled_date && daySet.has(r.scheduled_date) ? r.scheduled_date : null);
          if (execIso) dImmediateExec.set(execIso, (dImmediateExec.get(execIso) ?? 0) + unit);
        }
        continue;
      }

      // A linha de base considera somente a programação congelada.
      const plannedIso: string | null = r.scheduled_date && daySet.has(r.scheduled_date) ? r.scheduled_date : null;
      if (plannedIso) {
        dPlanned.set(plannedIso, (dPlanned.get(plannedIso) ?? 0) + unit);
        total += unit;
        if (impactedIds.has(r.id)) {
          dImpacted.set(plannedIso, (dImpacted.get(plannedIso) ?? 0) + unit);
        }
      }

      // Execução da programação original.
      if (r.status === "EXECUTADO") {
        const execIso = reportedInWeek ?? (r.scheduled_date && daySet.has(r.scheduled_date) ? r.scheduled_date : null);
        if (execIso) {
          dProgrammedExec.set(execIso, (dProgrammedExec.get(execIso) ?? 0) + unit);
        }
      }
    }

    // Cutoff
    const todayIso = isoDay(new Date());
    let cutoff: string;
    if (todayIso < days[0]) cutoff = days[0];
    else if (todayIso > days[days.length - 1]) cutoff = days[days.length - 1];
    else cutoff = todayIso;
    const cutoffIdx = days.indexOf(cutoff);

    // Series
    let cumP = 0;
    let cumProgrammed = 0;
    let cumImmediate = 0;
    const series = days.map((day, idx) => {
      const planned = dPlanned.get(day) ?? 0;
      const programmedExec = dProgrammedExec.get(day) ?? 0;
      const immediateExec = dImmediateExec.get(day) ?? 0;
      const impacted = dImpacted.get(day) ?? 0;
      cumP += planned;
      cumProgrammed += programmedExec;
      cumImmediate += immediateExec;
      const pctP = total > 0 ? (cumP / total) * 100 : 0;
      const pctR = total > 0 ? (cumProgrammed / total) * 100 : 0;
      const pctTotal = total > 0 ? ((cumProgrammed + cumImmediate) / total) * 100 : 0;
      const label = (() => {
        const d = parseIsoDay(day);
        const dd = String(d.getDate()).padStart(2, "0");
        const mm = String(d.getMonth() + 1).padStart(2, "0");
        return `${dd}/${mm} ${WEEKDAY_PT[d.getDay()]}`;
      })();
      return {
        day,
        label,
        planned: round2(planned),
        programmedExec: round2(programmedExec),
        immediateExec: round2(immediateExec),
        impacted: round2(impacted),
        pctPlanned: round2(pctP),
        pctReal: idx <= cutoffIdx ? round2(pctR) : null,
        pctTotal: idx <= cutoffIdx ? round2(pctTotal) : null,
        _cumE: cumProgrammed,
        _cumImmediate: cumImmediate,
      };
    });

    // Projection
    const realizedAtCut = series[cutoffIdx]?._cumE ?? 0;
    const immediateAtCut = series[cutoffIdx]?._cumImmediate ?? 0;
    const daysElapsed = cutoffIdx + 1;
    if (realizedAtCut > 0 && total > 0 && daysElapsed > 0) {
      const rate = realizedAtCut / daysElapsed; // units per day
      let projected = realizedAtCut;
      for (let i = cutoffIdx; i < series.length; i++) {
        const s = series[i];
        if (i === cutoffIdx) {
          (s as Record<string, unknown>).pctProj = round2((realizedAtCut / total) * 100);
        } else {
          projected = Math.min(projected + rate, total);
          (s as Record<string, unknown>).pctProj = round2(Math.min(100, Math.max(0, (projected / total) * 100)));
        }
      }
    }

    const cumPlannedCut = series[cutoffIdx]?.pctPlanned ?? 0;
    const realizedPctCut = total > 0 ? (realizedAtCut / total) * 100 : 0;
    const totalProductionPctCut = total > 0 ? ((realizedAtCut + immediateAtCut) / total) * 100 : 0;

    return {
      data: series,
      totalPlanned: total,
      cutoffIso: cutoff,
      indicators: {
        plannedPct: round2(cumPlannedCut),
        realPct: round2(realizedPctCut),
        totalProductionPct: round2(totalProductionPctCut),
        deviation: round2(realizedPctCut - cumPlannedCut),
        remaining: round2(total - realizedAtCut),
        impacted: impactedIds.size,
      },
    };
  }, [rows, links, days, daySet, effectiveMetric]);

  const cutoffLabel = data.find((d) => d.day === cutoffIso)?.label ?? "";
  const unitLabel = effectiveMetric === "hours" ? "h" : "";

  return (
    <Panel
      title="Curva de Avanço"
      description="Progresso semanal estilo Primavera P6 · barras diárias e curva acumulada"
      actions={
        <div className="flex items-center gap-1 rounded-md border border-border bg-muted/40 p-0.5 text-[11px]">
          <button
            type="button"
            onClick={() => setMetric("count")}
            className={cn(
              "rounded px-2 py-1 font-medium transition",
              effectiveMetric === "count"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Atividades
          </button>
          <button
            type="button"
            disabled={hoursDisabled}
            onClick={() => setMetric("hours")}
            title={hoursDisabled ? "Sem horas planejadas suficientes nos dados desta semana" : undefined}
            className={cn(
              "rounded px-2 py-1 font-medium transition",
              effectiveMetric === "hours"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
              hoursDisabled && "cursor-not-allowed opacity-50",
            )}
          >
            Horas planejadas
          </button>
        </div>
      }
    >
      {totalPlanned <= 0 ? (
        <div className="py-8 text-center text-xs text-muted-foreground">
          Sem dados suficientes para calcular a curva de avanço nesta semana.
        </div>
      ) : (
        <>
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <CurveStat label="Planejado até corte" value={`${indicators.plannedPct.toFixed(1)}%`} />
            <CurveStat label="Programado executado" value={`${indicators.realPct.toFixed(1)}%`} tone="primary" />
            <CurveStat
              label="Produção total c/ IMEDIATAS"
              value={`${indicators.totalProductionPct.toFixed(1)}%`}
              tone="success"
            />
            <CurveStat
              label="Desvio"
              value={`${indicators.deviation >= 0 ? "+" : ""}${indicators.deviation.toFixed(1)} pp`}
              tone={indicators.deviation >= 0 ? "success" : "destructive"}
            />
            <CurveStat
              label="Programadas impactadas"
              value={indicators.impacted.toLocaleString("pt-BR")}
              tone="destructive"
            />
            <CurveStat
              label="Restante"
              value={`${indicators.remaining.toLocaleString("pt-BR")}${unitLabel ? ` ${unitLabel}` : ""}`}
            />
          </div>

          {hoursDisabled && metric === "hours" && (
            <p className="mb-2 text-[11px] text-muted-foreground">
              Modo "Horas planejadas" indisponível: nenhum registro possui horas válidas (Dur n/Trab).
            </p>
          )}

          <div className="w-full overflow-x-auto">
            <div style={{ minWidth: Math.max(560, data.length * 70) }} className="h-[360px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
                  <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                  <YAxis yAxisId="left" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    domain={[0, "auto"]}
                    tickFormatter={(v) => `${v}%`}
                    tick={{ fontSize: 11 }}
                    stroke="hsl(var(--muted-foreground))"
                  />
                  <Tooltip
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid hsl(var(--border))" }}
                    formatter={(value: number | string, name: string) => {
                      if (name.includes("%")) return [`${Number(value).toFixed(1)}%`, name];
                      return [`${Number(value).toLocaleString("pt-BR")}${unitLabel ? ` ${unitLabel}` : ""}`, name];
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar yAxisId="left" dataKey="planned" name="Planejado (dia)" fill="#9CA3AF" barSize={12} />
                  <Bar
                    yAxisId="left"
                    dataKey="programmedExec"
                    name="Programado executado (dia)"
                    fill="#2563EB"
                    barSize={12}
                  />
                  <Bar
                    yAxisId="left"
                    dataKey="immediateExec"
                    name="IMEDIATAS executadas (dia)"
                    fill="#F59E0B"
                    barSize={12}
                  />
                  <Bar
                    yAxisId="left"
                    dataKey="impacted"
                    name="Programadas impactadas (dia)"
                    fill="#DC2626"
                    barSize={12}
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="pctPlanned"
                    name="Planejado acumulado %"
                    stroke="#111827"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="pctReal"
                    name="Programado executado acumulado %"
                    stroke="#2563EB"
                    strokeWidth={2.5}
                    dot={{ r: 3 }}
                    connectNulls={false}
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="pctTotal"
                    name="Produção total com IMEDIATAS %"
                    stroke="#16A34A"
                    strokeWidth={2.5}
                    strokeDasharray="3 2"
                    dot={{ r: 3 }}
                    connectNulls={false}
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="pctProj"
                    name="Projeção %"
                    stroke="#DC2626"
                    strokeWidth={2}
                    strokeDasharray="5 4"
                    dot={false}
                    connectNulls
                  />
                  {cutoffLabel && (
                    <ReferenceLine
                      yAxisId="right"
                      x={cutoffLabel}
                      stroke="#2563EB"
                      strokeDasharray="4 3"
                      label={{ value: "Data de corte", position: "top", fill: "#2563EB", fontSize: 11 }}
                    />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}
    </Panel>
  );
}

function CurveStat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "success" | "destructive" | "primary";
}) {
  const toneCls = {
    default: "text-foreground",
    success: "text-success",
    destructive: "text-destructive",
    primary: "text-primary",
  }[tone];
  return (
    <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn("mt-0.5 text-lg font-semibold leading-none tabular", toneCls)}>{value}</div>
    </div>
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
