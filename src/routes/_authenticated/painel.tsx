import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  AlertTriangle,
  Ban,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  Clock,
  Download,
  FileWarning,
  ListChecks,
  Percent,
  Search,
  Target,
  TrendingDown,
  Wrench,
  XCircle,
  Zap,
} from "lucide-react";
import { PageHeader, KpiCard, Panel, EmptyState, Field, Skeleton, StatusPill } from "@/components/ui-kit";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  Bar,
  Cell,

  BarChart,
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
function PainelPage() {
  const requestedView = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("view") : null;
  const initialView =
    requestedView === "nao-executadas" || requestedView === "nao-justificadas" ? requestedView : "geral";
  const [view, setView] = useState<"geral" | "nao-executadas" | "nao-justificadas">(initialView);

  function changeView(next: "geral" | "nao-executadas" | "nao-justificadas") {
    setView(next);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (next === "geral") url.searchParams.delete("view");
      else url.searchParams.set("view", next);
      window.history.replaceState({}, "", url);
    }
  }

  return (
    <>
      <div className="mx-auto w-full max-w-[1400px] overflow-x-hidden px-3 pt-4 sm:px-6 sm:pt-6">
        <div className="mb-3 flex w-full max-w-full overflow-x-auto rounded-md border border-border bg-card p-1 text-[12px] sm:inline-flex sm:w-auto">
          <PanelTabBtn active={view === "geral"} onClick={() => changeView("geral")}>
            Visão geral
          </PanelTabBtn>
          <PanelTabBtn active={view === "nao-executadas"} onClick={() => changeView("nao-executadas")}>
            Não execução
          </PanelTabBtn>
          <PanelTabBtn active={view === "nao-justificadas"} onClick={() => changeView("nao-justificadas")}>
            Não justificadas
          </PanelTabBtn>
        </div>
      </div>
      {view === "geral" ? (
        <OverviewPanel />
      ) : (
        <NonExecutionDashboard mode={view === "nao-justificadas" ? "unjustified" : "non-executed"} />
      )}
    </>
  );
}

function PanelTabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "min-w-max flex-1 rounded px-3 py-2 font-medium transition-colors sm:flex-none sm:py-1.5",
        active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}

type Row = {
  id: string;
  order_number: string | null;
  description: string;
  status: string;
  justification: string | null;
  observation: string | null;
  area: string | null;
  specialty: string | null;
  scheduled_date: string | null;
  is_immediate: boolean;
  reported_by_name: string | null;
  reported_at: string | null;
  planning_data: Record<string, unknown> | null;
};

function OverviewPanel() {
  const [selectedJustification, setSelectedJustification] = useState<string | null>(null);
  const activeWeek = useQuery({
    queryKey: ["active-week"],
    queryFn: async () => (await supabase.from("weeks").select("*").eq("is_active", true).maybeSingle()).data,
  });

  const activities = useQuery({
    queryKey: ["panel-activities", activeWeek.data?.id],
    enabled: !!activeWeek.data?.id,
    queryFn: async () => {
      const chunk = 1000;
      const all: Row[] = [];
      for (let from = 0; ; from += chunk) {
        const { data, error } = await supabase
          .from("activities")
          .select(
            "id,order_number,note_number,description,area,specialty,scheduled_date,status,justification,observation,reported_by_name,reported_by_email,reported_at,is_immediate,planning_data",
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

  const kpis = useMemo(() => {
    const programmed = rows.filter((r) => !r.is_immediate);
    const immediates = rows.filter((r) => r.is_immediate);
    const total = programmed.length;
    const executado = programmed.filter((r) => r.status === "EXECUTADO").length;
    const naoExec = programmed.filter((r) => r.status === "NÃO EXECUTADO").length;
    const semApont = programmed.filter((r) => !r.status || r.status === "Sem apontamento").length;
    const imediatas = immediates.length;
    const imediatasExecutadas = immediates.filter((r) => r.status === "EXECUTADO").length;
    const impactadas = programmed.filter((r) => {
      const linked = r.planning_data?.__linked_immediate_ids;
      return Array.isArray(linked) && linked.length > 0;
    }).length;
    const apontadas = executado + naoExec;
    const aderencia = total > 0 ? Math.round((executado / total) * 100) : 0;
    const progresso = total > 0 ? Math.round((apontadas / total) * 100) : 0;
    return { total, executado, naoExec, semApont, imediatas, imediatasExecutadas, impactadas, aderencia, progresso };
  }, [rows]);

  const byArea = useMemo(
    () =>
      groupCounts(rows, (r) => {
        const management = r.planning_data?.["Gerência"];
        return management === null || management === undefined || management === ""
          ? r.area || "—"
          : String(management);
      }),
    [rows],
  );
  const bySpecialty = useMemo(() => groupCounts(rows, (r) => r.specialty || "—").slice(0, 10), [rows]);
  const byDay = useMemo(() => {
    const map = new Map<string, { total: number; exec: number; nao: number }>();
    for (const r of rows) {
      if (r.is_immediate) continue;
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
  if (activeWeek.isLoading || activities.isLoading) {
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
        <KpiCard label="Imediatas" value={kpis.imediatas} tone="warning" icon={<Zap className="h-3.5 w-3.5" />} />
        <KpiCard
          label="Aderência"
          value={`${kpis.aderencia}%`}
          tone="primary"
          icon={<Percent className="h-3.5 w-3.5" />}
        />
      </section>

      <section className="mb-4">
        <ProgressCurve rows={rows} startDate={activeWeek.data.start_date} endDate={activeWeek.data.end_date} />
      </section>

      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Panel
          title="Execução por dia"
          description="Somente tarefas programadas · barras empilhadas executado/não executado"
        >
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
  selected,
  onSelect,
}: {
  items: [string, number][];
  rows: Row[];
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
                {tasks.map((task) => (
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
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
                      <span>
                        <b>Data:</b> {formatDate(task.scheduled_date || "—")}
                      </span>
                      <span>
                        <b>Responsável:</b> {task.reported_by_name || "—"}
                      </span>
                    </div>
                  </div>
                ))}
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

/** HH da tarefa = valor direto da coluna TRAB (uma única vez por tarefa, sem multiplicar por nada). */
function hoursOf(pd: Record<string, unknown> | null): number {
  if (!pd) return 0;
  const src = pd as Record<string, unknown>;
  const raw = src["Trab"] ?? src["TRAB"] ?? src["trab"];
  if (raw === null || raw === undefined || raw === "") return 0;
  let n: number;
  if (typeof raw === "number") {
    n = raw;
  } else if (typeof raw === "string") {
    let s = raw.trim().replace(/\s*h(?:oras?)?$/i, "");
    if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
    n = Number(s);
  } else {
    n = NaN;
  }
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function ProgressCurve({ rows, startDate, endDate }: { rows: CurveRow[]; startDate: string; endDate: string }) {
  const [metric, setMetric] = useState<"count" | "hours">("count");

  const days = useMemo(() => daysBetween(startDate, endDate), [startDate, endDate]);
  const daySet = useMemo(() => new Set(days), [days]);
  const totalHours = useMemo(
    () => rows.filter((r) => !r.is_immediate).reduce((a, r) => a + hoursOf(r.planning_data), 0),
    [rows],
  );
  const hoursDisabled = totalHours <= 0;
  const effectiveMetric = hoursDisabled && metric === "hours" ? "count" : metric;

  const unitOf = (r: CurveRow) => (effectiveMetric === "hours" ? hoursOf(r.planning_data) : 1);

  const { data, totalPlanned, cutoffIso, indicators } = useMemo(() => {
    const dPlanned = new Map<string, number>();
    const dExec = new Map<string, number>();
    const dPlannedExec = new Map<string, number>();
    const dImmediateExec = new Map<string, number>();
    let total = 0;

    for (const r of rows) {
      // Em HH a curva considera apenas tarefas programadas (imediatas ficam fora)
      if (effectiveMetric === "hours" && r.is_immediate) continue;
      const unit = unitOf(r);
      if (unit <= 0) continue;

      const reportedIso = reportedIsoDay(r.reported_at);
      const reportedInWeek = reportedIso && daySet.has(reportedIso) ? reportedIso : null;

      if (r.is_immediate) {
        if (r.status === "EXECUTADO") {
          const immediateDay =
            reportedInWeek ?? (r.scheduled_date && daySet.has(r.scheduled_date) ? r.scheduled_date : null);
          if (immediateDay) dImmediateExec.set(immediateDay, (dImmediateExec.get(immediateDay) ?? 0) + unit);
        }
        continue;
      }

      // Planned day
      let plannedIso: string | null = r.scheduled_date && daySet.has(r.scheduled_date) ? r.scheduled_date : null;
      if (!plannedIso && r.is_immediate && reportedInWeek) plannedIso = reportedInWeek;

      if (plannedIso) {
        dPlanned.set(plannedIso, (dPlanned.get(plannedIso) ?? 0) + unit);
        total += unit;
      }

      // Executed day
      if (r.status === "EXECUTADO") {
        const execIso = reportedInWeek ?? (r.scheduled_date && daySet.has(r.scheduled_date) ? r.scheduled_date : null);
        if (execIso) {
          dExec.set(execIso, (dExec.get(execIso) ?? 0) + unit);
          if (plannedIso === execIso) {
            dPlannedExec.set(plannedIso, (dPlannedExec.get(plannedIso) ?? 0) + unit);
          } else if (plannedIso) {
            dPlannedExec.set(plannedIso, (dPlannedExec.get(plannedIso) ?? 0) + unit);
          }
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
    let cumE = 0;
    const series = days.map((day, idx) => {
      const planned = dPlanned.get(day) ?? 0;
      const exec = dExec.get(day) ?? 0;
      const plannedExec = dPlannedExec.get(day) ?? 0;
      const remaining = Math.max(planned - plannedExec, 0);
      const immediateExec = dImmediateExec.get(day) ?? 0;
      cumP += planned;
      cumE += exec;
      const pctP = total > 0 ? (cumP / total) * 100 : 0;
      const pctR = total > 0 ? (cumE / total) * 100 : 0;
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
        exec: round2(exec),
        remaining: round2(remaining),
        immediateExec: round2(immediateExec),
        pctPlanned: round2(pctP),
        pctReal: idx <= cutoffIdx ? round2(pctR) : null,
        _cumE: cumE,
      };
    });

    // Projection
    const realizedAtCut = series[cutoffIdx]?._cumE ?? 0;
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
    const impacted = rows.filter((r) => {
      if (r.is_immediate) return false;
      const linked = r.planning_data?.__linked_immediate_ids;
      return Array.isArray(linked) && linked.length > 0;
    }).length;
    const immediateExecuted = Array.from(dImmediateExec.values()).reduce((sum, value) => sum + value, 0);

    return {
      data: series,
      totalPlanned: total,
      cutoffIso: cutoff,
      indicators: {
        plannedPct: round2(cumPlannedCut),
        realPct: round2(realizedPctCut),
        deviation: round2(realizedPctCut - cumPlannedCut),
        remaining: round2(total - realizedAtCut),
        impacted,
        immediateExecuted: round2(immediateExecuted),
      },
    };
  }, [rows, days, daySet, effectiveMetric]);

  const cutoffLabel = data.find((d) => d.day === cutoffIso)?.label ?? "";
  const unitLabel = effectiveMetric === "hours" ? "h" : "";

  return (
    <Panel
      title="Curva de Avanço"
      description="Planejamento original congelado · imediatas exibidas separadamente sem alterar a curva planejada"
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
            <CurveStat label="Realizado" value={`${indicators.realPct.toFixed(1)}%`} tone="primary" />
            <CurveStat
              label="Desvio"
              value={`${indicators.deviation >= 0 ? "+" : ""}${indicators.deviation.toFixed(1)} pp`}
              tone={indicators.deviation >= 0 ? "success" : "destructive"}
            />
            <CurveStat
              label="Restante"
              value={`${indicators.remaining.toLocaleString("pt-BR")}${unitLabel ? ` ${unitLabel}` : ""}`}
            />
            <CurveStat
              label="Impactadas por imediatas"
              value={indicators.impacted.toLocaleString("pt-BR")}
              tone="destructive"
            />
            <CurveStat
              label="Imediatas executadas"
              value={`${indicators.immediateExecuted.toLocaleString("pt-BR")}${unitLabel ? ` ${unitLabel}` : ""}`}
              tone="warning"
            />
          </div>

          {hoursDisabled && metric === "hours" && (
            <p className="mb-2 text-[11px] text-muted-foreground">
              Modo "Horas planejadas" indisponível: nenhum registro possui HH válido na coluna TRAB.
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
                    domain={[0, 100]}
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
                  <Bar yAxisId="left" dataKey="planned" name="Planejado (dia)" fill="#9CA3AF" barSize={14} />
                  <Bar yAxisId="left" dataKey="exec" name="Executado (dia)" fill="#2563EB" barSize={14} />
                  <Bar yAxisId="left" dataKey="remaining" name="Restante (dia)" fill="#16A34A" barSize={14} />
                  <Bar
                    yAxisId="left"
                    dataKey="immediateExec"
                    name="Imediatas executadas (dia)"
                    fill="#F59E0B"
                    barSize={14}
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
                    name="Realizado acumulado %"
                    stroke="#2563EB"
                    strokeWidth={2.5}
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
  tone?: "default" | "success" | "destructive" | "primary" | "warning";
}) {
  const toneCls = {
    default: "text-foreground",
    success: "text-success",
    destructive: "text-destructive",
    primary: "text-primary",
    warning: "text-warning-foreground",
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

const PAGE_SIZE = 30;

type WeekRow = {
  id: string;
  code: string;
  label: string;
  start_date: string;
  end_date: string;
  is_active: boolean;
};

type ActivityRow = {
  id: string;
  order_number: string | null;
  note_number: string | null;
  description: string;
  area: string | null;
  specialty: string | null;
  scheduled_date: string | null;
  status: string;
  justification: string | null;
  observation: string | null;
  reported_by_name: string | null;
  reported_by_email: string | null;
  reported_at: string | null;
  is_immediate: boolean;
  planning_data: Record<string, unknown> | null;
};

type Filters = {
  search: string;
  date: string[];
  management: string[];
  specialty: string[];
  reason: string;
  responsible: string;
  origin: "all" | "programmed" | "immediate";
};

const EMPTY_FILTERS: Filters = {
  search: "",
  date: [],
  management: [],
  specialty: [],
  reason: "",
  responsible: "",
  origin: "all",
};


function NonExecutionDashboard({ mode }: { mode: "non-executed" | "unjustified" }) {
  const isUnjustifiedMode = mode === "unjustified";
  const weeks = useQuery({
    queryKey: ["non-execution-weeks"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("weeks")
        .select("id,code,label,start_date,end_date,is_active")
        .order("start_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as WeekRow[];
    },
  });
  const [selectedWeekId, setSelectedWeekId] = useState("");
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [specialtySearch, setSpecialtySearch] = useState("");
  const [page, setPage] = useState(1);
  const effectiveWeekId = selectedWeekId || weeks.data?.find((week) => week.is_active)?.id || weeks.data?.[0]?.id || "";
  const selectedWeek = weeks.data?.find((week) => week.id === effectiveWeekId);

  const activities = useQuery({
    queryKey: ["panel-activities", effectiveWeekId],
    enabled: !!effectiveWeekId,
    queryFn: async () => {
      const all: ActivityRow[] = [];
      const pageSize = 1000;
      for (let from = 0; ; from += pageSize) {
        const { data, error } = await supabase
          .from("activities")
          .select(
            "id,order_number,note_number,description,area,specialty,scheduled_date,status,justification,observation,reported_by_name,reported_by_email,reported_at,is_immediate,planning_data",
          )
          .eq("week_id", effectiveWeekId)
          .order("scheduled_date", { ascending: true })
          .range(from, from + pageSize - 1);
        if (error) throw error;
        const batch = (data ?? []) as ActivityRow[];
        all.push(...batch);
        if (batch.length < pageSize) break;
      }
      return all;
    },
  });

  const rows = activities.data ?? [];
  const nonExecuted = useMemo(
    () =>
      rows.filter((row) => {
        const status = normalizeStatusNe(row.status);
        return isUnjustifiedMode ? status !== "EXECUTADO" && status !== "NAO EXECUTADO" : status === "NAO EXECUTADO";
      }),
    [rows, isUnjustifiedMode],
  );

  const matchesFilters = (row: ActivityRow, omitted?: keyof Filters) => {
    const term = filters.search.trim().toLocaleLowerCase("pt-BR");
    if (omitted !== "date" && filters.date.length > 0 && !filters.date.includes(row.scheduled_date || "")) return false;
    if (omitted !== "management" && filters.management.length > 0 && !filters.management.includes(managementLabelNe(row)))
      return false;

    if (omitted !== "specialty" && filters.specialty.length > 0 && !filters.specialty.includes(row.specialty || "")) {
      return false;
    }
    if (omitted !== "reason" && filters.reason && reasonLabelNe(row) !== filters.reason) return false;
    if (omitted !== "responsible" && filters.responsible && responsibleLabelNe(row) !== filters.responsible) {
      return false;
    }
    if (omitted !== "origin") {
      if (filters.origin === "programmed" && row.is_immediate) return false;
      if (filters.origin === "immediate" && !row.is_immediate) return false;
    }
    if (omitted !== "search" && term) {
      const searchable = [
        row.order_number,
        row.note_number,
        row.description,
        managementLabelNe(row),
        row.specialty,
        reasonLabelNe(row),
        responsibleLabelNe(row),
        planValueNe(row.planning_data, "Op"),
        planValueNe(row.planning_data, "Subop"),
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("pt-BR");
      if (!searchable.includes(term)) return false;
    }
    return true;
  };

  const dateOptions = useMemo(
    () =>
      uniqueNe(
        nonExecuted
          .filter((row) => matchesFilters(row, "date"))
          .map((row) => row.scheduled_date)
          .filter((value): value is string => !!value),
      ).sort(),
    [nonExecuted, filters],
  );
  const managementOptions = useMemo(
    () =>
      uniqueNe(
        nonExecuted
          .filter((row) => matchesFilters(row, "management"))
          .map(managementLabelNe)
          .filter(Boolean) as string[],
      ).sort(localeSortNe),
    [nonExecuted, filters],
  );
  const specialtyOptions = useMemo(
    () =>
      uniqueNe(
        nonExecuted
          .filter((row) => matchesFilters(row, "specialty"))
          .map((row) => row.specialty)
          .filter((value): value is string => !!value),
      ).sort(localeSortNe),
    [nonExecuted, filters],
  );
  const visibleSpecialtyOptions = useMemo(() => {
    const term = specialtySearch
      .trim()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("pt-BR");
    if (!term) return specialtyOptions;
    return specialtyOptions.filter((value) =>
      value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase("pt-BR")
        .includes(term),
    );
  }, [specialtyOptions, specialtySearch]);

  const reasonOptions = useMemo(
    () => uniqueNe(nonExecuted.filter((row) => matchesFilters(row, "reason")).map(reasonLabelNe)).sort(localeSortNe),
    [nonExecuted, filters],
  );
  const responsibleOptions = useMemo(
    () =>
      uniqueNe(nonExecuted.filter((row) => matchesFilters(row, "responsible")).map(responsibleLabelNe)).sort(
        localeSortNe,
      ),
    [nonExecuted, filters],
  );

  const filtered = useMemo(() => nonExecuted.filter((row) => matchesFilters(row)), [nonExecuted, filters]);

  const denominator = useMemo(() => {
    return rows.filter((row) => {
      if (filters.date.length > 0 && !filters.date.includes(row.scheduled_date || "")) return false;
      if (filters.management.length > 0 && !filters.management.includes(managementLabelNe(row))) return false;
      if (filters.specialty.length > 0 && !filters.specialty.includes(row.specialty || "")) return false;
      if (filters.origin === "programmed" && row.is_immediate) return false;
      if (filters.origin === "immediate" && !row.is_immediate) return false;
      return true;
    });
  }, [rows, filters.date, filters.management, filters.specialty, filters.origin]);

  const kpis = useMemo(() => {
    const affectedOrders = new Set(filtered.map((row) => row.order_number).filter(Boolean)).size;
    const immediate = filtered.filter((row) => row.is_immediate).length;
    const percent = denominator.length ? Math.round((filtered.length / denominator.length) * 1000) / 10 : 0;
    const hours = sumHoursNe(filtered);
    const totalHours = sumHoursNe(denominator);
    const hoursPercent = totalHours > 0 ? Math.round((hours / totalHours) * 1000) / 10 : 0;
    return {
      nonExecuted: filtered.length,
      percent,
      affectedOrders,
      immediate,
      hours,
      totalHours,
      hoursPercent,
    };
  }, [denominator, filtered]);

  const reasonChart = useMemo(() => groupCountsNe(filtered, reasonLabelNe).slice(0, 10), [filtered]);
  const dailyChart = useMemo(() => {
    const base = nonExecuted.filter((row) => matchesFilters(row, "date"));
    const dates = uniqueNe(base.map((row) => row.scheduled_date).filter((value): value is string => !!value)).sort();
    return dates.map((date) => {
      const dayRows = base.filter((row) => row.scheduled_date === date);
      return {
        date: formatShortDateNe(date),
        iso: date,
        naoExecutadas: dayRows.length,
        horas: Math.round(sumHoursNe(dayRows) * 10) / 10,
        selected: filters.date.includes(date),
      };
    });
  }, [nonExecuted, filters]);
  const areaRanking = useMemo(
    () => groupCountsNe(nonExecuted.filter((row) => matchesFilters(row, "management")), managementLabelNe).slice(0, 8),
    [nonExecuted, filters],
  );
  const areaRankingTotal = useMemo(
    () => sumHoursNe(nonExecuted.filter((row) => matchesFilters(row, "management"))),
    [nonExecuted, filters],
  );
  const specialtyRanking = useMemo(
    () =>
      groupCountsNe(
        nonExecuted.filter((row) => matchesFilters(row, "specialty")),
        (row) => row.specialty || "Sem especialidade",
      ).slice(0, 8),
    [nonExecuted, filters],
  );
  const specialtyRankingTotal = useMemo(
    () => sumHoursNe(nonExecuted.filter((row) => matchesFilters(row, "specialty"))),
    [nonExecuted, filters],
  );


  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const paginated = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  function updateFilter<K extends keyof Filters>(key: K, value: Filters[K], resets: (keyof Filters)[] = []) {
    setFilters((current) => {
      const next = { ...current, [key]: value };
      resets.forEach((resetKey) => {
        (next as Record<string, unknown>)[resetKey] = resetKey === "specialty" ? [] : "";
      });
      return next;
    });
    setPage(1);
  }

  function toggleSpecialty(value: string) {
    setFilters((current) => ({
      ...current,
      specialty: current.specialty.includes(value)
        ? current.specialty.filter((item) => item !== value)
        : [...current.specialty, value],
      reason: "",
      responsible: "",
    }));
    setPage(1);
  }

  function toggleArrayFilter(key: "date" | "management" | "specialty", value: string, additive: boolean) {
    setFilters((current) => {
      const list = current[key];
      const has = list.includes(value);
      const next = additive
        ? has
          ? list.filter((item) => item !== value)
          : [...list, value]
        : has && list.length === 1
          ? []
          : [value];
      return { ...current, [key]: next };
    });
    setPage(1);
  }



  async function exportExcel() {
    if (filtered.length === 0) return;
    const XLSX = await import("xlsx");
    const values = filtered.map((row) => [
      row.order_number || "",
      row.note_number || "",
      planValueNe(row.planning_data, "Op") || "",
      planValueNe(row.planning_data, "Subop") || "",
      row.description,
      managementLabelNe(row),
      row.specialty || "",
      formatDateNe(row.scheduled_date),
      isUnjustifiedMode ? row.status || "Sem apontamento" : reasonLabelNe(row),
      row.observation || "",
      responsibleLabelNe(row),
      formatDateTimeNe(row.reported_at),
      row.is_immediate ? "Imediata" : "Programada",
    ]);
    const headers = [
      "Ordem",
      "Nota",
      "Operação",
      "Suboperação",
      "Atividade",
      "Gerência/Área",
      "Especialidade",
      "Data",
      isUnjustifiedMode ? "Situação atual" : "Motivo",
      "Observação",
      "Responsável",
      "Última atualização",
      "Origem",
    ];
    const sheet = XLSX.utils.aoa_to_sheet([headers, ...values]);
    sheet["!cols"] = [14, 14, 14, 14, 48, 28, 24, 12, 42, 48, 28, 20, 14].map((wch) => ({ wch }));
    sheet["!autofilter"] = { ref: `A1:M${values.length + 1}` };
    const workbook = XLSX.utils.book_new();
    const sheetName = isUnjustifiedMode ? "Não justificadas" : "Não executadas";
    const filePrefix = isUnjustifiedMode ? "nao-justificadas" : "nao-executadas";
    XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
    XLSX.writeFile(workbook, `${filePrefix}-${selectedWeek?.code || "semana"}.xlsx`);
  }

  if (weeks.isLoading) return <DashboardLoading />;

  return (
    <main className="mx-auto w-full max-w-[1500px] overflow-x-hidden px-3 py-4 sm:px-6 sm:py-6">
      <PageHeader
        eyebrow="Gestão de desvios"
        title={isUnjustifiedMode ? "Análise de Atividades Não Justificadas" : "Análise de Não Execução"}
        description={
          isUnjustifiedMode
            ? "Acompanhe as atividades que ainda não foram classificadas como EXECUTADO ou NÃO EXECUTADO."
            : "Identifique o que não foi executado, onde ocorreu e quais motivos concentram as perdas da semana."
        }
        actions={
          <button
            type="button"
            onClick={exportExcel}
            disabled={filtered.length === 0}
            className="btn-primary text-[12px] disabled:opacity-50"
          >
            <Download className="h-4 w-4" /> Exportar análise
          </button>
        }
      />

      <Panel padded={false} className="mb-4">
        <div className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          <Field label="Semana">
            <select
              value={effectiveWeekId}
              onChange={(event) => {
                setSelectedWeekId(event.target.value);
                setFilters(EMPTY_FILTERS);
                setPage(1);
              }}
              className="input-base text-[12px]"
            >
              {(weeks.data ?? []).map((week) => (
                <option key={week.id} value={week.id}>
                  {week.label}
                  {week.is_active ? " · Ativa" : ""}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Data">
            <select
              value={filters.date.length === 1 ? filters.date[0] : filters.date.length > 1 ? "__multi" : ""}
              onChange={(event) => updateFilter("date", event.target.value ? [event.target.value] : [])}
              className="input-base text-[12px]"
            >
              <option value="">Todos os dias</option>
              {filters.date.length > 1 && <option value="__multi">{filters.date.length} dias selecionados</option>}
              {dateOptions.map((date) => (
                <option key={date} value={date}>
                  {formatDateNe(date)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Gerência/Área">
            <select
              value={
                filters.management.length === 1 ? filters.management[0] : filters.management.length > 1 ? "__multi" : ""
              }
              onChange={(event) => updateFilter("management", event.target.value ? [event.target.value] : [])}
              className="input-base text-[12px]"
            >
              <option value="">Todas</option>
              {filters.management.length > 1 && (
                <option value="__multi">{filters.management.length} áreas selecionadas</option>
              )}

              {managementOptions.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Especialidades">
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="input-base flex w-full items-center justify-between gap-2 text-left text-[12px]"
                >
                  <span className="truncate">
                    {filters.specialty.length === 0
                      ? "Todas"
                      : filters.specialty.length === 1
                        ? filters.specialty[0]
                        : `${filters.specialty.length} selecionadas`}
                  </span>
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-[min(360px,calc(100vw-2rem))] p-2">
                <div className="mb-2 flex items-center justify-between border-b border-border pb-2">
                  <span className="text-[12px] font-semibold">Selecionar especialidades</span>
                  {filters.specialty.length > 0 && (
                    <button
                      type="button"
                      onClick={() => updateFilter("specialty", [])}
                      className="text-[11px] font-medium text-primary hover:underline"
                    >
                      Limpar
                    </button>
                  )}
                </div>
                <div className="relative mb-2">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="search"
                    value={specialtySearch}
                    onChange={(event) => setSpecialtySearch(event.target.value)}
                    placeholder="Buscar especialidade..."
                    className="input-base w-full pl-8 text-[12px]"
                    autoComplete="off"
                  />
                </div>
                <div className="max-h-64 overflow-y-auto">
                  {visibleSpecialtyOptions.length === 0 ? (
                    <div className="px-2 py-4 text-center text-[12px] text-muted-foreground">
                      Nenhuma especialidade encontrada.
                    </div>
                  ) : (
                    visibleSpecialtyOptions.map((value) => (
                      <label
                        key={value}
                        className="flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 hover:bg-muted"
                      >
                        <input
                          type="checkbox"
                          checked={filters.specialty.includes(value)}
                          onChange={() => toggleSpecialty(value)}
                          className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-primary"
                        />
                        <span className="min-w-0 text-[12px] leading-4">{value}</span>
                      </label>
                    ))
                  )}
                </div>
              </PopoverContent>
            </Popover>
          </Field>
          {!isUnjustifiedMode && (
            <Field label="Motivo">
              <select
                value={filters.reason}
                onChange={(event) => updateFilter("reason", event.target.value)}
                className="input-base text-[12px]"
              >
                <option value="">Todos</option>
                {reasonOptions.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Responsável">
            <select
              value={filters.responsible}
              onChange={(event) => updateFilter("responsible", event.target.value)}
              className="input-base text-[12px]"
            >
              <option value="">Todos</option>
              {responsibleOptions.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Origem">
            <select
              value={filters.origin}
              onChange={(event) => updateFilter("origin", event.target.value as Filters["origin"])}
              className="input-base text-[12px]"
            >
              <option value="all">Todas</option>
              <option value="programmed">Programadas</option>
              <option value="immediate">Imediatas</option>
            </select>
          </Field>
          <div className="sm:col-span-2 lg:col-span-4 xl:col-span-7">
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={filters.search}
                  onChange={(event) => updateFilter("search", event.target.value)}
                  placeholder="Buscar por ordem, nota, atividade, operação, motivo ou responsável…"
                  className="input-base w-full pl-8 text-[16px] sm:text-[12px]"
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  setFilters(EMPTY_FILTERS);
                  setPage(1);
                }}
                className="btn-secondary min-h-10 text-[12px]"
              >
                Limpar filtros
              </button>
            </div>
          </div>
        </div>
      </Panel>

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        <KpiCard
          label={isUnjustifiedMode ? "Não justificadas" : "Não executadas"}
          value={kpis.nonExecuted}
          tone={isUnjustifiedMode ? "warning" : "destructive"}
          icon={isUnjustifiedMode ? <FileWarning className="h-4 w-4" /> : <Ban className="h-4 w-4" />}
        />
        <KpiCard
          label={isUnjustifiedMode ? "HH não justificado" : "HH não executado"}
          value={formatHoursNe(kpis.hours)}
          hint={`de ${formatHoursNe(kpis.totalHours)} no recorte atual`}
          tone="destructive"
          icon={<Clock className="h-4 w-4" />}
        />
        <KpiCard
          label="Taxa de HH perdido"
          value={`${kpis.hoursPercent}%`}
          tone="warning"
          icon={<Percent className="h-4 w-4" />}
        />
        <KpiCard
          label={isUnjustifiedMode ? "Taxa sem definição" : "Taxa de não execução"}
          value={`${kpis.percent}%`}
          tone="warning"
          icon={<TrendingDown className="h-4 w-4" />}
        />
        <KpiCard label="Ordens afetadas" value={kpis.affectedOrders} icon={<Target className="h-4 w-4" />} />
        <KpiCard label="Imediatas" value={kpis.immediate} icon={<Zap className="h-4 w-4" />} />
      </div>


      {activities.isLoading ? (
        <DashboardLoading />
      ) : activities.isError ? (
        <Panel>
          <EmptyState
            icon={<AlertTriangle className="h-4 w-4" />}
            title="Não foi possível carregar as atividades"
            description={(activities.error as Error).message}
          />
        </Panel>
      ) : filtered.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<Wrench className="h-4 w-4" />}
            title={isUnjustifiedMode ? "Nenhuma atividade sem definição" : "Nenhuma atividade não executada"}
            description="Ajuste os filtros ou selecione outra semana."
          />
        </Panel>
      ) : (
        <>
          {!isUnjustifiedMode && (
            <div className="mb-4">
              <ReasonPanel
                rows={reasonChart}
                selectedReason={filters.reason}
                onSelect={(reason) => updateFilter("reason", filters.reason === reason ? "" : reason)}
              />
            </div>
          )}

          <div className="mb-4">
            <ChartPanel
              title="Evolução diária"
              description="Clique em um dia para filtrar. Segure Ctrl (ou ⌘) para selecionar vários dias."
            >
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={dailyChart} margin={{ left: 0, right: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fontFamily: "inherit" }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fontFamily: "inherit" }} />
                  <Tooltip
                    formatter={(value: number, name: string) =>
                      name === "HH" ? [`${value} h`, "HH"] : [value, name]
                    }
                  />
                  <Bar
                    dataKey="naoExecutadas"
                    name={isUnjustifiedMode ? "Não justificadas" : "Não executadas"}
                    fill="#C2413B"
                    radius={[4, 4, 0, 0]}
                    cursor="pointer"
                    onClick={(entry: unknown, _index: number, event?: { ctrlKey?: boolean; metaKey?: boolean }) => {
                      const iso = (entry as { iso?: string; payload?: { iso?: string } })?.iso
                        ?? (entry as { payload?: { iso?: string } })?.payload?.iso;
                      if (!iso) return;
                      toggleArrayFilter("date", iso, !!(event?.ctrlKey || event?.metaKey));
                    }}
                  >
                    {dailyChart.map((entry) => (
                      <Cell
                        key={entry.iso}
                        fill={entry.selected ? "#102B46" : "#C2413B"}
                        opacity={filters.date.length > 0 && !entry.selected ? 0.35 : 1}
                      />
                    ))}
                  </Bar>
                  <Bar dataKey="horas" name="HH" fill="#E0A458" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartPanel>
          </div>

          <div className="mb-4 grid gap-4 xl:grid-cols-2">
            <RankingPanel
              title="Áreas mais afetadas"
              rows={areaRanking}
              total={areaRankingTotal}
              selected={filters.management}
              onSelect={(name, additive) => toggleArrayFilter("management", name, additive)}
            />
            <RankingPanel
              title="Especialidades mais afetadas"
              rows={specialtyRanking}
              total={specialtyRankingTotal}
              selected={filters.specialty}
              onSelect={(name, additive) => toggleArrayFilter("specialty", name, additive)}
            />
          </div>


          <Panel
            title={isUnjustifiedMode ? "Atividades não justificadas" : "Atividades não executadas"}
            description={`${filtered.length} atividade(s) com os filtros atuais.`}
            padded={false}
          >
            <div className="grid gap-3 p-3 md:hidden">
              {paginated.map((row) => (
                <article key={row.id} className="rounded-lg border border-border bg-card p-3 text-[12px] shadow-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-semibold">
                      {row.order_number || "Sem ordem"} · {row.description}
                    </div>
                    <StatusPill status={row.status} />
                  </div>
                  <div className="mt-1 text-muted-foreground">
                    {formatDateNe(row.scheduled_date)} · {managementLabelNe(row)} ·{" "}
                    {row.specialty || "Sem especialidade"}
                  </div>
                  <div className="mt-2">
                    <b>{isUnjustifiedMode ? "Situação atual:" : "Motivo:"}</b>{" "}
                    {isUnjustifiedMode ? row.status || "Sem apontamento" : reasonLabelNe(row)}
                  </div>
                  {row.observation && (
                    <div className="mt-1">
                      <b>Observação:</b> {row.observation}
                    </div>
                  )}
                  <div className="mt-1 text-muted-foreground">Informado por {responsibleLabelNe(row)}</div>
                </article>
              ))}
            </div>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[1450px] text-[12px]">
                <thead className="border-b border-border bg-muted text-[10px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    {[
                      "Data",
                      "Ordem/Nota",
                      "Op/Subop",
                      "Atividade",
                      "Gerência/Área",
                      "Especialidade",
                      isUnjustifiedMode ? "Situação atual" : "Motivo",
                      "Observação",
                      "Responsável",
                      "Origem",
                    ].map((header) => (
                      <th key={header} className="px-3 py-2 text-left font-semibold">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {paginated.map((row) => (
                    <tr key={row.id} className="row-zebra align-top">
                      <td className="whitespace-nowrap px-3 py-2">{formatDateNe(row.scheduled_date)}</td>
                      <td className="px-3 py-2">
                        <div className="font-medium">{row.order_number || "—"}</div>
                        <div className="text-muted-foreground">Nota {row.note_number || "—"}</div>
                      </td>
                      <td className="px-3 py-2">
                        <div>{planValueNe(row.planning_data, "Op") || "—"}</div>
                        <div className="text-muted-foreground">{planValueNe(row.planning_data, "Subop") || "—"}</div>
                      </td>
                      <td className="max-w-[320px] px-3 py-2">{row.description}</td>
                      <td className="px-3 py-2">{managementLabelNe(row)}</td>
                      <td className="px-3 py-2">{row.specialty || "—"}</td>
                      <td className="max-w-[300px] px-3 py-2 font-medium text-destructive">
                        {isUnjustifiedMode ? row.status || "Sem apontamento" : reasonLabelNe(row)}
                      </td>
                      <td className="max-w-[300px] px-3 py-2 text-muted-foreground">{row.observation || "—"}</td>
                      <td className="px-3 py-2">
                        <div>{responsibleLabelNe(row)}</div>
                        <div className="text-[10px] text-muted-foreground">{formatDateTimeNe(row.reported_at)}</div>
                      </td>
                      <td className="px-3 py-2">{row.is_immediate ? "Imediata" : "Programada"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filtered.length > PAGE_SIZE && (
              <div className="flex flex-col gap-2 border-t border-border bg-muted/20 px-3 py-3 text-[12px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                <span>
                  Página {currentPage} de {pageCount} · {filtered.length} registro(s)
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setPage((value) => Math.max(1, value - 1))}
                    disabled={currentPage === 1}
                    className="btn-secondary min-h-9 px-3 text-[12px] disabled:opacity-50"
                  >
                    Anterior
                  </button>
                  <button
                    type="button"
                    onClick={() => setPage((value) => Math.min(pageCount, value + 1))}
                    disabled={currentPage === pageCount}
                    className="btn-secondary min-h-9 px-3 text-[12px] disabled:opacity-50"
                  >
                    Próxima
                  </button>
                </div>
              </div>
            )}
          </Panel>
        </>
      )}
    </main>
  );
}

function ReasonPanel({
  rows,
  selectedReason,
  onSelect,
}: {
  rows: { name: string; value: number; hours: number }[];
  selectedReason: string;
  onSelect: (reason: string) => void;
}) {
  const max = Math.max(1, ...rows.map((row) => row.hours));
  return (
    <Panel
      title="Principais motivos"
      description="Classificação por HH perdido. Clique em um motivo para filtrar as tarefas abaixo."
    >
      <div className="grid gap-2">
        {rows.map((row) => {
          const selected = selectedReason === row.name;
          return (
            <button
              key={row.name}
              type="button"
              onClick={() => onSelect(row.name)}
              aria-pressed={selected}
              className={`grid min-w-0 gap-2 rounded-md border px-3 py-2 text-left transition sm:grid-cols-[minmax(220px,340px)_1fr_72px_48px] sm:items-center ${
                selected ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:bg-muted/50"
              }`}
            >
              <span className="min-w-0 text-[12px] font-medium leading-4 text-foreground">{row.name}</span>
              <span className="h-2 overflow-hidden rounded-full bg-muted">
                <span
                  className="block h-full rounded-full bg-destructive"
                  style={{ width: `${Math.max(4, (row.hours / max) * 100)}%` }}
                />
              </span>
              <span className="text-right text-[12px] tabular-nums text-muted-foreground">
                {formatHoursNe(row.hours)}
              </span>
              <span className="text-right text-[12px] font-semibold tabular-nums text-foreground">{row.value}</span>

            </button>
          );
        })}
      </div>
    </Panel>
  );
}

function ChartPanel({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <Panel title={title} description={description}>
      <div className="h-[320px] w-full">{children}</div>
    </Panel>
  );
}

function RankingPanel({
  title,
  rows,
  total,
  selected,
  onSelect,
}: {
  title: string;
  rows: { name: string; value: number; hours: number }[];
  total: number;
  selected: string[];
  onSelect: (name: string, additive: boolean) => void;
}) {
  const maxHours = Math.max(1, ...rows.map((row) => row.hours));
  return (
    <Panel title={title} description="Classificação por HH perdido. Clique para filtrar. Segure Ctrl (ou ⌘) para somar seleções.">
      <div className="space-y-2">
        {rows.map((row, index) => {
          const percent = total ? Math.round((row.hours / total) * 100) : 0;
          const isSelected = selected.includes(row.name);
          return (
            <button
              key={row.name}
              type="button"
              aria-pressed={isSelected}
              onClick={(event) => onSelect(row.name, event.ctrlKey || event.metaKey)}
              className={cn(
                "block w-full rounded-md border px-2 py-1.5 text-left transition",
                isSelected ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-transparent hover:bg-muted/50",
              )}
            >
              <div className="mb-1 flex items-center gap-2 text-[12px]">
                <span className="w-5 text-muted-foreground">{index + 1}.</span>
                <span className="min-w-0 flex-1 truncate font-medium">{row.name}</span>
                <span className="font-semibold text-foreground">{formatHoursNe(row.hours)}</span>
                <span className="text-muted-foreground">{row.value}</span>
                <span className="w-10 text-right text-muted-foreground">{percent}%</span>
              </div>
              <div className="ml-7 h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-destructive" style={{ width: `${Math.max(4, (row.hours / maxHours) * 100)}%` }} />
              </div>
            </button>
          );
        })}
      </div>
    </Panel>
  );
}


function DashboardLoading() {
  return (
    <main className="mx-auto w-full max-w-[1500px] px-3 py-6 sm:px-6">
      <Skeleton className="mb-4 h-20" />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-24" />
        ))}
      </div>
    </main>
  );
}

function uniqueNe<T>(values: T[]) {
  return [...new Set(values)];
}
function localeSortNe(a: string, b: string) {
  return a.localeCompare(b, "pt-BR");
}
function planValueNe(data: Record<string, unknown> | null, key: string) {
  const value = data?.[key];
  return value === null || value === undefined ? "" : String(value).trim();
}
function managementLabelNe(row: ActivityRow) {
  return planValueNe(row.planning_data, "Gerência") || row.area || "Sem área";
}
function reasonLabelNe(row: ActivityRow) {
  return isMissingReasonNe(row.justification) ? "Sem justificativa" : row.justification!.trim();
}
function normalizeStatusNe(value: string | null) {
  return (value ?? "")
    .trim()
    .toLocaleUpperCase("pt-BR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}
function normalizeReasonNe(value: string | null) {
  return (value ?? "")
    .trim()
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}
function isMissingReasonNe(value: string | null) {
  const normalized = normalizeReasonNe(value);
  return (
    !normalized ||
    normalized === "-" ||
    normalized === "n/a" ||
    normalized === "pendente" ||
    normalized.startsWith("selecione") ||
    normalized.includes("sem justificativa") ||
    normalized.includes("nao justifica") ||
    normalized.includes("a justificar") ||
    normalized.includes("aguardando justific")
  );
}
function isUnjustifiedActivityNe(row: ActivityRow) {
  const reason = normalizeReasonNe(row.justification);
  const genericReasonWithoutDetails = ["outro", "outros"].includes(reason) && !row.observation?.trim();
  return isMissingReasonNe(row.justification) || genericReasonWithoutDetails || !row.reported_at;
}
function responsibleLabelNe(row: ActivityRow) {
  return row.reported_by_name?.trim() || row.reported_by_email?.trim() || "Sem responsável";
}
function sumHoursNe(rows: ActivityRow[]) {
  return rows.reduce((total, row) => total + hoursOf(row.planning_data), 0);
}
function formatHoursNe(value: number) {
  return `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(Math.round(value * 10) / 10)} h`;
}
function groupCountsNe(rows: ActivityRow[], label: (row: ActivityRow) => string) {
  const counts = new Map<string, { value: number; hours: number }>();
  rows.forEach((row) => {
    const key = label(row);
    const current = counts.get(key) ?? { value: 0, hours: 0 };
    counts.set(key, { value: current.value + 1, hours: current.hours + hoursOf(row.planning_data) });
  });
  return [...counts.entries()]
    .map(([name, agg]) => ({ name, value: agg.value, hours: agg.hours }))
    .sort((a, b) => b.hours - a.hours || localeSortNe(a.name, b.name));
}

function formatDateNe(value: string | null) {
  if (!value) return "—";
  const [year, month, day] = value.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}
function formatShortDateNe(value: string) {
  const [, month, day] = value.slice(0, 10).split("-");
  return `${day}/${month}`;
}
function formatDateTimeNe(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}
