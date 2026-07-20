import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { SessionInfo } from "./route";
import { PageHeader, Panel, EmptyState } from "@/components/ui-kit";
import { History } from "lucide-react";

export const Route = createFileRoute("/_authenticated/historico")({
  beforeLoad: ({ context }) => {
    const s = (context as { session: SessionInfo }).session;
    if (s.role !== "planning" && s.role !== "admin") throw redirect({ to: "/atividades" });
  },
  component: HistoricoPage,
});

function HistoricoPage() {
  const weeks = useQuery({
    queryKey: ["all-weeks"],
    queryFn: async () => (await supabase.from("weeks").select("*").order("start_date", { ascending: false })).data ?? [],
  });
  const history = useQuery({
    queryKey: ["history"],
    queryFn: async () => {
      const { data: rows } = await supabase
        .from("activity_history")
        .select("*")
        .order("changed_at", { ascending: false })
        .limit(200);
      const list = rows ?? [];
      const ids = Array.from(new Set(list.map((r: any) => r.activity_id).filter(Boolean)));
      let map: Record<string, any> = {};
      if (ids.length > 0) {
        const { data: acts } = await supabase
          .from("activities")
          .select("id, order_number, planning_data")
          .in("id", ids);
        map = Object.fromEntries((acts ?? []).map((a: any) => [a.id, a]));
      }
      return list.map((h: any) => {
        const a = map[h.activity_id] ?? {};
        const pd = (a.planning_data ?? {}) as Record<string, any>;
        return {
          ...h,
          order_number: a.order_number ?? null,
          operacao: pd["Operação"] ?? pd["Operacao"] ?? pd["OPERAÇÃO"] ?? null,
          sub_operacao: pd["Sub operação"] ?? pd["Sub Operação"] ?? pd["Subop"] ?? pd["SUB OPERAÇÃO"] ?? pd["Sub operacao"] ?? null,
        };
      });
    },
  });

  return (
    <main className="mx-auto w-full max-w-[1400px] min-w-0 px-4 py-6 sm:px-6">
      <PageHeader eyebrow="Histórico" title="Semanas e auditoria" description="Registro de semanas importadas e últimas alterações de apontamento." />

      <div className="grid min-w-0 gap-4">
        <Panel title="Semanas" description={`${weeks.data?.length ?? 0} registros`} padded={false}>
          {weeks.data && weeks.data.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="border-b border-border bg-muted text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">Código</th>
                    <th className="px-3 py-2 text-left font-semibold">Rótulo</th>
                    <th className="px-3 py-2 text-left font-semibold">Início</th>
                    <th className="px-3 py-2 text-left font-semibold">Fim</th>
                    <th className="px-3 py-2 text-left font-semibold">Ativa</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {weeks.data.map((w) => (
                    <tr key={w.id} className="row-zebra">
                      <td className="px-3 py-2 font-mono text-[11px]">{w.code}</td>
                      <td className="px-3 py-2">{w.label}</td>
                      <td className="px-3 py-2 text-[11px] tabular">{w.start_date}</td>
                      <td className="px-3 py-2 text-[11px] tabular">{w.end_date}</td>
                      <td className="px-3 py-2 text-[11px]">{w.is_active ? "Sim" : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-4"><EmptyState title="Nenhuma semana registrada" /></div>
          )}
        </Panel>

        <Panel title="Últimas alterações" description="200 registros mais recentes" padded={false}>
          {history.data && history.data.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead className="border-b border-border bg-muted text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">Quando</th>
                    <th className="px-3 py-2 text-left font-semibold">Ordem</th>
                    <th className="px-3 py-2 text-left font-semibold">Op</th>
                    <th className="px-3 py-2 text-left font-semibold">Subop</th>
                    <th className="px-3 py-2 text-left font-semibold">Quem</th>
                    <th className="px-3 py-2 text-left font-semibold">Origem</th>
                    <th className="px-3 py-2 text-left font-semibold">Antes</th>
                    <th className="px-3 py-2 text-left font-semibold">Depois</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {history.data.map((h: any) => (
                    <tr key={h.id} className="row-zebra align-top">
                      <td className="px-3 py-2 tabular text-[11px]">{new Date(h.changed_at).toLocaleString("pt-BR")}</td>
                      <td className="px-3 py-2 font-mono text-[11px]">{h.order_number ?? "—"}</td>
                      <td className="px-3 py-2 text-[11px]">{h.operacao ?? "—"}</td>
                      <td className="px-3 py-2 text-[11px]">{h.sub_operacao ?? "—"}</td>
                      <td className="px-3 py-2 text-[11px]">
                        <div className="font-medium text-foreground">{h.changed_by_name}</div>
                        <div className="text-muted-foreground">{h.changed_by_email}</div>
                      </td>
                      <td className="px-3 py-2 text-[11px]">
                        <span className="status-pill border-border bg-muted text-muted-foreground">{h.change_source}</span>
                      </td>
                      <td className="px-3 py-2 text-[11px]">
                        <pre className="max-w-[14rem] sm:max-w-[24rem] whitespace-pre-wrap break-all font-mono text-[10px] text-muted-foreground">{JSON.stringify(h.previous_values, null, 0)}</pre>
                      </td>
                      <td className="px-3 py-2 text-[11px]">
                        <pre className="max-w-[14rem] sm:max-w-[24rem] whitespace-pre-wrap break-all font-mono text-[10px] text-foreground">{JSON.stringify(h.new_values, null, 0)}</pre>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-4"><EmptyState icon={<History className="h-4 w-4" />} title="Nenhuma alteração registrada" description="Assim que apontamentos forem feitos, o histórico aparecerá aqui." /></div>
          )}
        </Panel>
      </div>
    </main>
  );
}
