import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { CheckCircle2, XCircle, Clock, Zap, TrendingUp, AlertTriangle } from "lucide-react";

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
      const pageSize = 1000;
      const all: Row[] = [];
      for (let from = 0; ; from += pageSize) {
        const { data, error } = await supabase
          .from("activities")
          .select("id,status,justification,area,specialty,scheduled_date,is_immediate,reported_by_name")
          .eq("week_id", activeWeek.data!.id)
          .range(from, from + pageSize - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        all.push(...(data as Row[]));
        if (data.length < pageSize) break;
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
    return <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6"><p className="text-sm text-muted-foreground">Carregando painel…</p></main>;
  }
  if (!activeWeek.data) {
    return <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6"><p className="text-sm text-muted-foreground">Nenhuma semana ativa.</p></main>;
  }

  return (
    <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold">Painel gerencial</h1>
          <p className="truncate text-xs text-muted-foreground">
            {activeWeek.data.label} · {activeWeek.data.start_date} a {activeWeek.data.end_date}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-2xl font-bold text-success leading-none">{kpis.aderencia}%</div>
          <div className="mt-1 text-[11px] text-muted-foreground">Aderência</div>
        </div>
      </header>

      <section className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi icon={<TrendingUp className="h-4 w-4" />} label="Programadas" value={kpis.total} />
        <Kpi icon={<CheckCircle2 className="h-4 w-4 text-success" />} label="Executadas" value={kpis.executado} />
        <Kpi icon={<XCircle className="h-4 w-4 text-destructive" />} label="Não executadas" value={kpis.naoExec} />
        <Kpi icon={<Clock className="h-4 w-4 text-muted-foreground" />} label="Sem apontamento" value={kpis.semApont} />
        <Kpi icon={<Zap className="h-4 w-4 text-warning" />} label="Imediatas" value={kpis.imediatas} />
        <Kpi icon={<AlertTriangle className="h-4 w-4" />} label="Progresso" value={`${kpis.progresso}%`} />
      </section>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card title="Por dia">
          <div className="space-y-2">
            {byDay.map(([day, g]) => (
              <div key={day}>
                <div className="mb-1 flex justify-between text-xs">
                  <span className="font-medium">{formatDate(day)}</span>
                  <span className="text-muted-foreground">{g.exec}/{g.total} executadas</span>
                </div>
                <StackedBar total={g.total} exec={g.exec} nao={g.nao} />
              </div>
            ))}
            {byDay.length === 0 && <Empty />}
          </div>
        </Card>

        <Card title="Por área (Gerência)">
          <BarList items={byArea} />
        </Card>

        <Card title="Por especialidade">
          <BarList items={bySpecialty} />
        </Card>

        <Card title="Top 10 justificativas (NÃO EXECUTADO)">
          <BarList items={byJust} color="destructive" />
        </Card>

        <Card title="Top 10 responsáveis por apontamento" className="lg:col-span-2">
          <BarList items={byResp} color="success" />
        </Card>
      </div>
    </main>
  );
}

function Kpi({ icon, label, value }: { icon: React.ReactNode; label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">{icon}{label}</div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
    </div>
  );
}

function Card({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-border bg-card p-4 ${className}`}>
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function BarList({ items, color = "primary" }: { items: [string, number][]; color?: "primary" | "success" | "destructive" }) {
  const max = Math.max(1, ...items.map(([, n]) => n));
  const bg = color === "success" ? "bg-success" : color === "destructive" ? "bg-destructive" : "bg-primary";
  if (items.length === 0) return <Empty />;
  return (
    <div className="space-y-1.5">
      {items.map(([k, n]) => (
        <div key={k} className="text-xs">
          <div className="flex justify-between gap-2">
            <span className="truncate" title={k}>{k}</span>
            <span className="tabular-nums text-muted-foreground">{n}</span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded bg-muted">
            <div className={`h-full ${bg}`} style={{ width: `${(n / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function StackedBar({ total, exec, nao }: { total: number; exec: number; nao: number }) {
  const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0);
  return (
    <div className="flex h-2.5 w-full overflow-hidden rounded bg-muted">
      <div className="h-full bg-success" style={{ width: `${pct(exec)}%` }} />
      <div className="h-full bg-destructive" style={{ width: `${pct(nao)}%` }} />
    </div>
  );
}

function Empty() {
  return <p className="text-xs text-muted-foreground">Sem dados.</p>;
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
