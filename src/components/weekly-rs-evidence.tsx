import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { KpiCard, Panel } from "@/components/ui-kit";

export type PendingSummary = {
  programmed: number;
  confirmed: number | null;
  pending: number | null;
  executed: number | null;
  withJustification: number | null;
  withoutJustification: number | null;
  plannedHh: number | null;
  unknownPeriod: number;
  monitoringTasks: number;
};
export type RsReason = { justification: string | null; tasks: number; planned_hh: number };
type PendingActivity = {
  id: string;
  order_number: string;
  operation: string | null;
  suboperation: string | null;
  confirmation: string;
  description: string;
  scheduled_date: string;
  local: string;
  center: string;
  specialty: string;
  included_in_rs: boolean;
  planned_hh: number | null;
  status: string;
  justification: string | null;
  observation: string | null;
  sap_state: string;
  justification_by: string | null;
  justification_at: string | null;
};
const n = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
const count = (v: number | null) => (v === null ? "—" : n(v));
const day = (v: string) => new Date(v + "T12:00:00").toLocaleDateString("pt-BR");

export function WeeklyRsEvidence({
  weekId,
  userId,
  worksiteId,
  local,
  summary,
  reasons,
  hasSap,
  closureId,
}: {
  weekId: string;
  userId: string;
  worksiteId: string;
  local: string;
  summary: PendingSummary;
  reasons: RsReason[];
  hasSap: boolean;
  closureId?: string;
}) {
  const [reason, setReason] = useState("");
  const [showAllReasons, setShowAllReasons] = useState(false);
  const [includeMonitoring, setIncludeMonitoring] = useState(false);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(0);
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(query);
      setPage(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);
  const pending = useQuery({
    queryKey: [
      "weekly-rs-pending",
      userId,
      worksiteId,
      weekId,
      local,
      reason,
      includeMonitoring,
      debounced,
      page,
      closureId,
    ],
    enabled: hasSap,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc(
        closureId ? "get_weekly_rs_closure_pending" : "get_weekly_rs_pending",
        {
          ...(closureId ? { p_closure_id: closureId } : { p_week_id: weekId }),
          p_local: local || null,
          p_offset: page * 50,
          p_limit: 50,
          p_justification: reason.startsWith("value:") ? reason.slice(6) : null,
          p_only_missing_justification: reason === "missing",
          p_include_monitoring: includeMonitoring,
          p_query: debounced,
        },
      );
      if (error) throw error;
      return data as { total: number; rows: PendingActivity[] };
    },
    staleTime: 30_000,
    refetchInterval: 5 * 60_000,
  });
  function chooseReason(value: string) {
    setReason(value);
    setPage(0);
  }
  const maxReason = Math.max(1, ...reasons.map((r) => r.tasks));
  return (
    <div className="space-y-4">
      <Panel title="Conferência da programação · sem apropriação SAP">
        <p className="mb-3 text-xs text-muted-foreground">
          Contagem por tarefa/dia elegível ao RS no local selecionado. Uma confirmação apropriada
          somente em parte da semana não confirma os demais dias. Justificativas e observações vêm
          do apontamento operacional do NEXO, não do SAP.
          {closureId && " Nesta versão, são os registros preservados no momento do fechamento."}
        </p>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="Programadas sem apropriação"
            value={count(summary.pending)}
            hint={
              summary.confirmed === null
                ? "Aguardando carga SAP"
                : n(summary.confirmed) + " tarefas/dias com evidência de apropriação"
            }
          />
          <KpiCard
            label="Executadas sem apropriação"
            value={count(summary.executed)}
            hint="Status EXECUTADO no NEXO · conferir SAP"
            tone="warning"
          />
          <KpiCard
            label="Pendências com justificativa"
            value={count(summary.withJustification)}
            hint={
              summary.withoutJustification === null
                ? "Aguardando carga SAP"
                : n(summary.withoutJustification) + " sem justificativa registrada"
            }
          />
          <KpiCard
            label="HH programado das pendências"
            value={summary.plannedHh === null ? "—" : n(summary.plannedHh) + " HH"}
            hint="Soma das linhas pendentes; não é saldo de HH SAP"
          />
        </div>
        {summary.unknownPeriod > 0 && (
          <p className="mt-3 text-xs text-warning-foreground">
            Há {summary.unknownPeriod} tarefas com HH SAP, mas sem período identificável. Não foram
            tratadas como confirmadas por dia nem como pendentes; confira a carga.
          </p>
        )}
      </Panel>
      <p className="text-xs text-muted-foreground">
        Sem apropriação não significa necessariamente pendência de execução: canceladas e não
        executadas permanecem identificadas pelo status e motivo. O destaque EXECUTADO sem
        apropriação prioriza a conferência.
      </p>
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(260px,1fr)_minmax(0,2fr)]">
        <Panel title="Justificativas das tarefas sem apropriação">
          <p className="mb-3 text-xs text-muted-foreground">
            Clique em um motivo para filtrar a lista ao lado. Este filtro afeta apenas a lista, não
            o cálculo do RS.
          </p>
          {!hasSap ? (
            <p className="text-sm text-muted-foreground">
              Importe uma carga SAP para identificar as pendências.
            </p>
          ) : reasons.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma pendência no recorte.</p>
          ) : (
            <div className="space-y-2">
              {(showAllReasons ? reasons : reasons.slice(0, 8)).map((r) => {
                const key = r.justification === null ? "missing" : "value:" + r.justification;
                return (
                  <button
                    key={key}
                    className={
                      "w-full rounded-md border p-2 text-left transition-colors " +
                      (reason === key ? "border-primary bg-accent" : "border-border hover:bg-muted")
                    }
                    onClick={() => chooseReason(reason === key ? "" : key)}
                    aria-pressed={reason === key}
                  >
                    <span className="flex justify-between gap-3 text-xs">
                      <span>{r.justification ?? "Sem justificativa registrada"}</span>
                      <strong>{n(r.tasks)}</strong>
                    </span>
                    <span className="mt-2 block h-1.5 overflow-hidden rounded bg-muted">
                      <span
                        className="block h-full bg-primary"
                        style={{ width: (r.tasks / maxReason) * 100 + "%" }}
                      />
                    </span>
                    <span className="mt-1 block text-[11px] text-muted-foreground">
                      {n(r.planned_hh)} HH programado
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          {reasons.length > 8 && (
            <button
              className="btn-ghost mt-3 text-xs"
              onClick={() => setShowAllReasons((value) => !value)}
            >
              {showAllReasons
                ? "Mostrar os 8 motivos mais frequentes"
                : "Mostrar todos os " + reasons.length + " motivos"}
            </button>
          )}
        </Panel>
        <Panel title="Atividades da programação sem apropriação">
          <div className="mb-3 grid gap-2 sm:grid-cols-2">
            <label className="text-xs">
              Buscar ordem, operação, confirmação ou atividade
              <input
                value={query}
                maxLength={200}
                onChange={(e) => setQuery(e.target.value)}
                className="input-base mt-1"
                placeholder="Buscar na lista…"
              />
            </label>
            <label className="text-xs">
              Justificativa
              <select
                value={reason}
                onChange={(e) => chooseReason(e.target.value)}
                className="input-base mt-1"
              >
                <option value="">Todas as justificativas</option>
                <option value="missing">Sem justificativa registrada</option>
                {reasons
                  .filter((r) => r.justification !== null)
                  .map((r) => (
                    <option key={r.justification} value={"value:" + r.justification}>
                      {r.justification}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <label className="mb-3 flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={includeMonitoring}
              onChange={(e) => {
                setIncludeMonitoring(e.target.checked);
                setPage(0);
              }}
            />
            Incluir grupos fora do RS somente para acompanhamento na lista
          </label>
          {!hasSap ? (
            <p className="text-sm text-muted-foreground">
              Sem carga SAP: não é possível afirmar quais tarefas ainda não foram apropriadas.
            </p>
          ) : pending.isLoading ? (
            <p role="status" className="text-sm">
              Carregando atividades…
            </p>
          ) : pending.isError ? (
            <p role="alert" className="text-sm text-destructive">
              Não foi possível consultar as atividades.{" "}
              <button className="underline" onClick={() => void pending.refetch()}>
                Tentar novamente
              </button>
            </p>
          ) : !pending.data?.rows.length ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma atividade corresponde aos filtros da lista.
            </p>
          ) : (
            <div className="max-h-[580px] overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted">
                  <tr>
                    {[
                      "Ordem / operação",
                      "Data / local",
                      "Atividade / especialidade",
                      "HH programado",
                      "Status NEXO",
                      "Justificativa / observação",
                      "Registro da justificativa",
                    ].map((h) => (
                      <th key={h} className="whitespace-nowrap p-2 text-left">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pending.data.rows.map((r) => (
                    <tr key={r.id} className="row-zebra align-top">
                      <td className="whitespace-nowrap p-2">
                        <strong>{r.order_number}</strong>
                        <p>
                          {r.operation ?? "—"}
                          {r.suboperation ? " / " + r.suboperation : ""}
                        </p>
                        <p className="text-muted-foreground">
                          Conf. {r.confirmation || "não informada"}
                        </p>
                      </td>
                      <td className="whitespace-nowrap p-2">
                        {day(r.scheduled_date)}
                        <p className="text-muted-foreground">{r.local}</p>
                      </td>
                      <td className="min-w-56 p-2">
                        {r.description}
                        <p className="mt-1 text-muted-foreground">
                          {r.center} · {r.specialty}
                        </p>
                        {!r.included_in_rs && (
                          <span className="text-warning-foreground">
                            Acompanhamento · fora do RS
                          </span>
                        )}
                        {r.sap_state === "sem_confirmacao" && (
                          <p className="text-warning-foreground">Sem confirmação na programação</p>
                        )}
                      </td>
                      <td className="p-2 text-right">
                        {r.planned_hh === null ? "—" : n(r.planned_hh)}
                      </td>
                      <td className="min-w-32 p-2">{r.status}</td>
                      <td className="min-w-64 p-2">
                        <p>{r.justification ?? "Sem justificativa registrada"}</p>
                        {r.observation && (
                          <p className="mt-1 whitespace-pre-wrap text-muted-foreground">
                            {r.observation}
                          </p>
                        )}
                      </td>
                      <td className="min-w-36 p-2">
                        {r.justification ? (
                          <>
                            {r.justification_by ?? "Autor não identificado no histórico"}
                            {r.justification_at && (
                              <p className="text-muted-foreground">
                                {new Date(r.justification_at).toLocaleString("pt-BR")}
                              </p>
                            )}
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {hasSap && (
            <div className="mt-3 flex items-center justify-between gap-2 text-xs">
              <button
                className="btn-ghost"
                disabled={page === 0 || pending.isFetching}
                onClick={() => setPage((p) => p - 1)}
              >
                Anterior
              </button>
              <span>
                {pending.data ? n(pending.data.total) + " atividades · página " + (page + 1) : "—"}
                {includeMonitoring ? " · inclui acompanhamento" : " · somente elegíveis ao RS"}
              </span>
              <button
                className="btn-ghost"
                disabled={
                  !pending.data || (page + 1) * 50 >= pending.data.total || pending.isFetching
                }
                onClick={() => setPage((p) => p + 1)}
              >
                Próxima
              </button>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

export function RsSpecialtyBars({
  rows,
  hasSap,
  period = "weekly",
}: {
  rows: Array<{
    specialty: string;
    available: number;
    considered: number;
    rs: number | null;
    includedInRs: boolean;
  }>;
  hasSap: boolean;
  period?: "weekly" | "monthly" | "selection";
}) {
  const included = rows.filter((r) => r.includedInRs);
  return (
    <Panel
      title={
        period === "monthly"
          ? "Realização mensal por especialidade"
          : "Realização por especialidade"
      }
    >
      <p className="mb-3 text-xs text-muted-foreground">
        HH considerado em relação à disponibilidade{" "}
        {period !== "weekly" ? "acumulada das semanas selecionadas" : "semanal do recorte"}. Linha
        pontilhada: referência de 95%. Alpinismo, INSPPINT, TECNIEND, TECNINSC, HIDROJAT e HIDROJATO
        não participam.
      </p>
      {!hasSap ? (
        <p className="text-sm text-muted-foreground">Aguardando carga SAP.</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {included.map((r) => (
            <div key={r.specialty}>
              <div className="mb-1 flex justify-between gap-2 text-xs">
                <span className="font-medium">{r.specialty}</span>
                <strong>{r.rs === null ? "Sem disponibilidade" : n(r.rs) + "%"}</strong>
              </div>
              <div
                className="relative h-3 overflow-hidden rounded bg-muted"
                role="img"
                aria-label={
                  r.specialty + ": " + (r.rs === null ? "sem disponibilidade" : n(r.rs) + "%")
                }
              >
                <div
                  className={"h-full " + ((r.rs ?? 0) < 95 ? "bg-amber-500" : "bg-primary")}
                  style={{ width: Math.max(0, Math.min(100, r.rs ?? 0)) + "%" }}
                />
                <span
                  className="absolute inset-y-0 border-l border-dashed border-foreground/70"
                  style={{ left: "95%" }}
                />
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {n(r.considered)} / {n(r.available)} HH
              </p>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
