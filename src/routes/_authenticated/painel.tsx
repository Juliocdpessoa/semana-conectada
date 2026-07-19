import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { CheckCircle2, XCircle, Clock, Zap, ListChecks, Percent } from "lucide-react";
import { PageHeader, KpiCard, Panel, EmptyState, Skeleton } from "@/components/ui-kit";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/painel")({
  component: PainelPage,
});

type Row = {
  id: string;
  status: string;
  justification: string | null;
  area: string | null;
  specialty: string | null;
  scheduled_date: string | null;
  is_immediate: boolean;
  reported_by_name: string | null;
};

function PainelPage() {
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
          .select("id,status,justification,area,specialty,scheduled_date,is_immediate,reported_by_name")
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
    const total = rows.length;
    const executado = rows.filter((r) => r.status === "EXECUTADO").length;
    const naoExec = rows.filter((r) => r.status === "NÃO EXECUTADO").length;
    const semApont = rows.filter((r) => !r.status || r.status === "Sem apontamento").length;
    const imediatas = rows.filter((r) => r.is_immediate).length;
    const apontadas = executado + naoExec;
    const aderencia = total > 0 ? Math.round((executado / total) * 100) : 0;
    const progresso = total > 0 ? Math.round((apontadas / total) * 100) : 0;
    return { total, executado, naoExec, semApont, imediatas, aderencia, progresso };
  }, [rows]);

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

  if (activeWeek.isLoading || activities.isLoading) {
    return (
      <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
        <div className="mb-5 space-y-2"><Skeleton className="h-6 w-64" /><Skeleton className="h-4 w-96" /></div>
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-64" />)}
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
    <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
      <PageHeader
        eyebrow="Painel gerencial"
        title={activeWeek.data.label}
        description={`${activeWeek.data.start_date} a ${activeWeek.data.end_date} · ${kpis.total} atividades`}
        actions={
          <div className="flex items-center gap-4">
            <MiniStat label="Aderência" value={`${kpis.aderencia}%`} tone="success" />
            <MiniStat label="Progresso" value={`${kpis.progresso}%`} />
          </div>
        }
      />

      <section className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard label="Programadas" value={kpis.total} icon={<ListChecks className="h-3.5 w-3.5" />} />
        <KpiCard label="Executadas" value={kpis.executado} tone="success" icon={<CheckCircle2 className="h-3.5 w-3.5" />} />
        <KpiCard label="Não executadas" value={kpis.naoExec} tone="destructive" icon={<XCircle className="h-3.5 w-3.5" />} />
        <KpiCard label="Sem apontamento" value={kpis.semApont} icon={<Clock className="h-3.5 w-3.5" />} />
        <KpiCard label="Imediatas" value={kpis.imediatas} tone="warning" icon={<Zap className="h-3.5 w-3.5" />} />
        <KpiCard label="Aderência" value={`${kpis.aderencia}%`} tone="primary" icon={<Percent className="h-3.5 w-3.5" />} />
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Execução por dia" description="Barras empilhadas executado/não executado">
          <div className="space-y-3">
            {byDay.length === 0 ? <Empty /> : byDay.map(([day, g]) => (
              <div key={day}>
                <div className="mb-1 flex justify-between text-[11px]">
                  <span className="font-medium text-foreground">{formatDate(day)}</span>
                  <span className="text-muted-foreground tabular">{g.exec}/{g.total}</span>
                </div>
                <StackedBar total={g.total} exec={g.exec} nao={g.nao} />
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Por área (Gerência)"><BarList items={byArea} /></Panel>
        <Panel title="Por especialidade"><BarList items={bySpecialty} /></Panel>
        <Panel title="Top 10 justificativas" description="Motivos de NÃO EXECUTADO"><BarList items={byJust} color="destructive" /></Panel>

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
      <div className={cn("text-xl font-semibold leading-none tabular", tone === "success" ? "text-success" : "text-foreground")}>
        {value}
      </div>
    </div>
  );
}

function BarList({ items, color = "primary" }: { items: [string, number][]; color?: "primary" | "success" | "destructive" }) {
  const max = Math.max(1, ...items.map(([, n]) => n));
  const bg = color === "success" ? "bg-success" : color === "destructive" ? "bg-destructive" : "bg-primary";
  if (items.length === 0) return <Empty />;
  return (
    <div className="space-y-2">
      {items.map(([k, n]) => (
        <div key={k} className="text-[12px]">
          <div className="flex justify-between gap-2">
            <span className="truncate text-foreground" title={k}>{k}</span>
            <span className="tabular text-muted-foreground">{n.toLocaleString("pt-BR")}</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
            <div className={cn("h-full rounded-full", bg)} style={{ width: `${(n / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
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
