import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { SessionInfo } from "./route";

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
    queryFn: async () => (await supabase.from("activity_history").select("*").order("changed_at", { ascending: false }).limit(200)).data ?? [],
  });

  return (
    <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
      <h1 className="text-xl font-semibold">Histórico e auditoria</h1>

      <section className="mt-6 rounded-lg border border-border bg-card p-5">
        <h2 className="text-sm font-semibold">Semanas</h2>
        <div className="mt-2 overflow-hidden rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-xs text-muted-foreground">
              <tr><th className="px-2 py-2 text-left">Código</th><th className="px-2 py-2 text-left">Rótulo</th><th className="px-2 py-2 text-left">Início</th><th className="px-2 py-2 text-left">Fim</th><th className="px-2 py-2 text-left">Ativa</th></tr>
            </thead>
            <tbody>
              {(weeks.data ?? []).map((w) => (
                <tr key={w.id} className="border-t border-border/60">
                  <td className="px-2 py-2 font-mono text-xs">{w.code}</td>
                  <td className="px-2 py-2">{w.label}</td>
                  <td className="px-2 py-2 text-xs">{w.start_date}</td>
                  <td className="px-2 py-2 text-xs">{w.end_date}</td>
                  <td className="px-2 py-2 text-xs">{w.is_active ? "Sim" : "Não"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-6 rounded-lg border border-border bg-card p-5">
        <h2 className="text-sm font-semibold">Últimas alterações (auditoria)</h2>
        {history.data && history.data.length > 0 ? (
          <div className="mt-2 overflow-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-xs text-muted-foreground">
                <tr>
                  <th className="px-2 py-2 text-left">Quando</th>
                  <th className="px-2 py-2 text-left">Quem</th>
                  <th className="px-2 py-2 text-left">Origem</th>
                  <th className="px-2 py-2 text-left">Antes</th>
                  <th className="px-2 py-2 text-left">Depois</th>
                </tr>
              </thead>
              <tbody>
                {history.data.map((h) => (
                  <tr key={h.id} className="border-t border-border/60 align-top">
                    <td className="px-2 py-2 text-xs">{new Date(h.changed_at).toLocaleString("pt-BR")}</td>
                    <td className="px-2 py-2 text-xs">
                      <div>{h.changed_by_name}</div>
                      <div className="text-muted-foreground">{h.changed_by_email}</div>
                    </td>
                    <td className="px-2 py-2 text-xs">{h.change_source}</td>
                    <td className="px-2 py-2 text-xs"><pre className="whitespace-pre-wrap break-all">{JSON.stringify(h.previous_values, null, 0)}</pre></td>
                    <td className="px-2 py-2 text-xs"><pre className="whitespace-pre-wrap break-all">{JSON.stringify(h.new_values, null, 0)}</pre></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="mt-2 rounded-md border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
            Nenhuma alteração registrada ainda.
          </div>
        )}
      </section>
    </main>
  );
}
