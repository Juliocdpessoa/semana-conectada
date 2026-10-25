import { Fragment, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Download, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { EmptyState, KpiCard, Panel } from "@/components/ui-kit";
import { RsAlertBadge } from "@/components/rs-alert-badge";
import { RsSpecialtyBars } from "@/components/weekly-rs-evidence";
import { availabilityKey } from "@/lib/weekly-availability";
import {
  consolidateMonthlyRs,
  rsWeekOverlapsMonth,
  type MonthlyRsRow,
  type MonthlyRsWeek,
} from "@/lib/monthly-realization";

type Week = MonthlyRsWeek["week"];
const n = (value: number) =>
  value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString("pt-BR");

export function MonthlyRealizationPanel({
  weeks,
  userId,
  worksiteId,
  year,
  month,
  onYear,
  onMonth,
  local,
  onLocal,
  hideNonRs,
  onHide,
  onOpenWeek,
}: {
  weeks: Week[];
  userId: string;
  worksiteId: string;
  year: string;
  month: string;
  onYear: (value: string) => void;
  onMonth: (value: string) => void;
  local: string;
  onLocal: (value: string) => void;
  hideNonRs: boolean;
  onHide: (value: boolean) => void;
  onOpenWeek: (id: string) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [applied, setApplied] = useState<string[]>([]);
  const [specialty, setSpecialty] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  useEffect(() => {
    setSelected([]);
    setApplied([]);
    setSpecialty(null);
  }, [year, month, userId, worksiteId]);
  const candidates = weeks.filter((week) => rsWeekOverlapsMonth(week, year, month));
  const years = [
    ...new Set(weeks.flatMap((week) => [week.start_date.slice(0, 4), week.end_date.slice(0, 4)])),
  ]
    .sort()
    .reverse();
  const ids = [...applied].sort();
  const dirty = [...selected].sort().join("|") !== ids.join("|");
  const data = useQuery({
    queryKey: ["monthly-rs", userId, worksiteId, ids, local],
    enabled: ids.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_monthly_rs_weeks", {
        p_worksite_id: worksiteId,
        p_week_ids: ids,
        p_local: local || null,
      });
      if (error) throw error;
      if (!data?.weeks || data.weeks.length !== ids.length)
        throw new Error("A resposta não contém todas as semanas selecionadas.");
      consolidateMonthlyRs(data.weeks);
      return data.weeks as MonthlyRsWeek[];
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const summary = useMemo(() => (data.data ? consolidateMonthlyRs(data.data) : null), [data.data]);
  function toggle(id: string) {
    setSelected((previous) =>
      previous.includes(id)
        ? previous.filter((value) => value !== id)
        : previous.length < 12
          ? [...previous, id]
          : previous,
    );
  }
  async function exportExcel() {
    if (!summary?.complete || !data.data || dirty) return;
    setExporting(true);
    try {
      const XLSX = await import("xlsx");
      const book = XLSX.utils.book_new();
      const state = summary.openWeeks ? "Em apuração" : "Semanas com versões oficiais";
      const context = {
        local: local || "IARI + ROTINA",
        situacao: state,
        gerado_em: new Date().toISOString(),
        semanas: data.data.map((item) => item.week.code).join(" | "),
        regra:
          "Soma dos HH considerados após os tetos semanais / soma dos HH disponíveis × 100. Semanas integrais. Não é média dos RS.",
      };
      XLSX.utils.book_append_sheet(
        book,
        XLSX.utils.json_to_sheet([{ ...context, ...summary.totals, ...summary.result }]),
        "Consolidado mensal",
      );
      XLSX.utils.book_append_sheet(
        book,
        XLSX.utils.json_to_sheet(
          data.data.map((item) => ({
            semana: item.week.code,
            inicio: item.week.start_date,
            fim: item.week.end_date,
            situacao: item.isFrozen ? "Fechada" : "Em apuração",
            versao_fechamento: item.closure?.version ?? null,
            id_fechamento: item.closure?.id ?? null,
            regra: item.closure?.rule_version ?? "Em apuração",
            base_programada: item.basis?.kind ?? "operational",
            versao_base: item.basis?.version ?? null,
            arquivo_base: item.basis?.source_file_name ?? null,
            arquivo_sap: item.source?.source_file_name ?? null,
            carga_sap: item.source?.imported_at ?? null,
            ...item.calculation.totals,
            ...item.calculation.result,
          })),
        ),
        "Semanas selecionadas",
      );
      const flat = (row: MonthlyRsRow) => ({ ...row, centers: row.centers.join(" | ") });
      XLSX.utils.book_append_sheet(
        book,
        XLSX.utils.json_to_sheet(summary.rows.map(flat)),
        "Especialidades",
      );
      XLSX.utils.book_append_sheet(
        book,
        XLSX.utils.json_to_sheet(summary.centerRows.map(flat)),
        "Centros",
      );
      XLSX.writeFile(book, `RS-mensal-${year || "selecao"}${month ? "-" + month : ""}.xlsx`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível exportar.");
    } finally {
      setExporting(false);
    }
  }
  const rows =
    summary?.rows.filter(
      (row) => (row.available > 0 || row.programmed > 0) && (!hideNonRs || row.includedInRs),
    ) ?? [];
  function cells(row: MonthlyRsRow) {
    return (
      <>
        <td className="px-3 py-2 text-right tabular">{n(row.available)}</td>
        <td className="px-3 py-2 text-right tabular">{n(row.programmed)}</td>
        <td className="px-3 py-2 text-right tabular">{n(row.completedForRs)}</td>
        <td className="px-3 py-2 text-right tabular">{n(row.immediate)}</td>
        <td className="px-3 py-2 text-right tabular">{n(row.considered)}</td>
        <td className="px-3 py-2 text-right">
          <RsAlertBadge value={row.rs} included={row.includedInRs} />
        </td>
      </>
    );
  }
  return (
    <div className="space-y-4">
      <div className="grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-[7rem_9rem_minmax(14rem,1fr)_auto_auto]">
        <label className="text-xs">
          <span className="mb-1 block">Ano</span>
          <select
            className="input-base h-9"
            value={year}
            onChange={(event) => onYear(event.target.value)}
          >
            <option value="">Todos os anos</option>
            {years.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs">
          <span className="mb-1 block">Mês de referência</span>
          <select
            className="input-base h-9"
            value={month}
            onChange={(event) => onMonth(event.target.value)}
          >
            <option value="">Selecionar semanas</option>
            {Array.from({ length: 12 }, (_, index) => (
              <option key={index} value={String(index + 1).padStart(2, "0")}>
                {new Date(2026, index, 1).toLocaleString("pt-BR", { month: "long" })}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs">
          <span className="mb-1 block">Local da realização</span>
          <select
            className="input-base h-9"
            value={local}
            onChange={(event) => onLocal(event.target.value)}
          >
            <option value="">IARI + ROTINA</option>
            <option value="IARI">IARI</option>
            <option value="ROTINA">ROTINA</option>
          </select>
        </label>
        <button
          className="btn-outline h-9"
          disabled={!applied.length || data.isFetching}
          onClick={() => void data.refetch()}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          {data.isFetching ? "Atualizando…" : "Atualizar"}
        </button>
        <label className="flex h-9 items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={hideNonRs}
            onChange={(event) => onHide(event.target.checked)}
          />
          Ocultar centros fora do RS
        </label>
      </div>
      <Panel
        title="Semanas do fechamento mensal"
        actions={
          <>
            <button
              className="btn-ghost text-xs"
              disabled={!candidates.length || candidates.length > 12}
              onClick={() => setSelected(candidates.map((week) => week.id))}
            >
              Selecionar visíveis
            </button>
            <button
              className="btn-ghost text-xs"
              onClick={() => {
                setSelected([]);
                setApplied([]);
              }}
            >
              Limpar
            </button>
          </>
        }
      >
        <p className="mb-3 text-xs text-muted-foreground">
          Selecione as semanas que compõem a medição. Elas entram integralmente, inclusive quando
          atravessam o mês. O mês acima apenas organiza a seleção; nenhum dia é rateado.
        </p>
        <div className="grid max-h-52 gap-2 overflow-y-auto sm:grid-cols-2 xl:grid-cols-3">
          {candidates.map((week) => (
            <label
              key={week.id}
              className="flex cursor-pointer items-start gap-2 rounded-md border border-border p-2 text-xs"
            >
              <input
                type="checkbox"
                className="mt-0.5"
                checked={selected.includes(week.id)}
                disabled={!selected.includes(week.id) && selected.length >= 12}
                onChange={() => toggle(week.id)}
              />
              <span>
                <strong>{week.code}</strong>
                <span className="mt-1 block text-muted-foreground">
                  {day(week.start_date)} a {day(week.end_date)}
                </span>
              </span>
            </label>
          ))}
        </div>
        {!candidates.length && (
          <p className="text-sm text-muted-foreground">Nenhuma semana neste recorte.</p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            className="btn-primary"
            disabled={!selected.length || data.isFetching}
            onClick={() => {
              setApplied([...selected]);
              setSpecialty(null);
            }}
          >
            Consolidar {selected.length || ""} semanas
          </button>
          <span className="text-xs text-muted-foreground">
            Até 12 semanas · não altera nem fecha as semanas individualmente.
          </span>
        </div>
      </Panel>
      {dirty && applied.length > 0 && (
        <p role="status" className="text-sm text-warning-foreground">
          Seleção alterada. Clique em Consolidar semanas para atualizar o resultado.
        </p>
      )}
      {!applied.length && (
        <EmptyState
          title="Selecione as semanas do mês"
          description="O resultado será calculado pelos HH acumulados, preservando os limites de cada semana."
        />
      )}
      {applied.length > 0 && data.isPending && <p role="status">Carregando consolidado…</p>}
      {data.isError && (
        <EmptyState
          title="Não foi possível consolidar todas as semanas"
          description={data.error.message}
          action={
            <button className="btn-ghost" onClick={() => void data.refetch()}>
              Tentar novamente
            </button>
          }
        />
      )}
      {summary && data.data && !dirty && !data.isError && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {data.data.length} semanas · {summary.closedWeeks} com fechamento oficial ·{" "}
              {summary.openWeeks} em apuração.{" "}
              {summary.openWeeks > 0
                ? "Consolidado provisório: cargas ou ajustes dessas semanas podem alterar o resultado."
                : "Utilizando as versões oficiais preservadas de cada semana."}
            </p>
            <button
              className="btn-outline text-xs"
              disabled={!summary.complete || exporting || data.isFetching}
              onClick={() => void exportExcel()}
            >
              <Download className="h-3.5 w-3.5" />
              {exporting ? "Exportando…" : "Exportar consolidado Excel"}
            </button>
          </div>
          {!summary.complete && (
            <div
              role="alert"
              className="rounded-md border border-warning/50 bg-warning/10 p-3 text-sm"
            >
              Consolidado incompleto: corrija as semanas indicadas abaixo. O RS mensal e o fator
              ficam indisponíveis; semanas sem informação não são consideradas zero.
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <KpiCard label="RS mensal" value={summary.result ? n(summary.result.rs) + "%" : "—"} />
            <KpiCard label="Fator mensal" value={summary.result ? n(summary.result.factor) : "—"} />
            <KpiCard label="HH disponível" value={n(summary.totals.available)} />
            <KpiCard
              label="HH considerado"
              value={summary.complete ? n(summary.totals.considered) : "—"}
              hint="Soma após os limites semanais"
            />
            <KpiCard
              label="Ocupação"
              value={summary.result ? n(summary.result.occupation * 100) + "%" : "—"}
              hint="Programado considerado / disponível"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            RS mensal = soma dos HH considerados de cada semana ÷ soma dos HH disponíveis × 100. O
            excesso de uma semana não compensa outra; não é média dos percentuais semanais.
          </p>
          {summary.complete && <RsSpecialtyBars rows={rows} hasSap={true} period="monthly" />}
          <Panel title="Realização mensal por especialidade e centro" padded={false}>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted text-left">
                  <tr>
                    {[
                      "Especialidade / centro",
                      "HH disponível",
                      "HH programado",
                      "TCpr (Limite)",
                      "Imediatas",
                      "HH considerado",
                      "RS mensal",
                    ].map((label) => (
                      <th key={label} className="whitespace-nowrap px-3 py-2">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const key = `${row.includedInRs}|${availabilityKey(row.specialty)}`;
                    const expanded = specialty === key;
                    return (
                      <Fragment key={key}>
                        <tr className="border-t border-border">
                          <td className="px-3 py-2">
                            <button
                              className="inline-flex items-center gap-2 font-semibold"
                              onClick={() => setSpecialty(expanded ? null : key)}
                              aria-expanded={expanded}
                            >
                              <ChevronDown
                                className={`h-3.5 w-3.5 ${expanded ? "rotate-180" : ""}`}
                              />
                              {row.specialty}
                            </button>
                          </td>
                          {cells(row)}
                        </tr>
                        {expanded &&
                          summary.centerRows
                            .filter(
                              (center) =>
                                center.includedInRs === row.includedInRs &&
                                availabilityKey(center.specialty) ===
                                  availabilityKey(row.specialty) &&
                                (center.available > 0 || center.programmed > 0),
                            )
                            .map((center) => (
                              <tr
                                key={center.center}
                                className="border-t border-border bg-muted/40"
                              >
                                <td className="py-2 pl-9 pr-3">{center.center}</td>
                                {cells(center)}
                              </tr>
                            ))}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
          <Panel title="Composição por semana" padded={false}>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted text-left">
                  <tr>
                    {[
                      "Semana",
                      "Fonte / situação",
                      "HH disponível",
                      "HH considerado",
                      "RS da semana",
                      "Conferência",
                    ].map((label) => (
                      <th key={label} className="whitespace-nowrap px-3 py-2">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.data.map((item) => (
                    <tr key={item.week.id} className="border-t border-border">
                      <td className="px-3 py-2">
                        <button
                          className="text-primary underline"
                          onClick={() => onOpenWeek(item.week.id)}
                        >
                          {item.week.code}
                        </button>
                        <p className="text-muted-foreground">
                          {day(item.week.start_date)} a {day(item.week.end_date)}
                        </p>
                      </td>
                      <td className="px-3 py-2">
                        {item.isFrozen ? `Fechamento v${item.closure?.version}` : "Em apuração"}
                        <p className="text-muted-foreground">
                          {item.basis?.kind === "official"
                            ? `Base oficial v${item.basis.version}`
                            : "Base operacional"}
                          {item.source
                            ? ` · SAP ${new Date(item.source.imported_at).toLocaleString("pt-BR")}`
                            : ""}
                        </p>
                      </td>
                      <td className="px-3 py-2 text-right tabular">
                        {n(item.calculation.totals.available ?? 0)}
                      </td>
                      <td className="px-3 py-2 text-right tabular">
                        {item.valid ? n(item.calculation.totals.considered ?? 0) : "—"}
                      </td>
                      <td className="px-3 py-2">
                        <RsAlertBadge
                          value={item.valid ? (item.calculation.result?.rs ?? null) : null}
                        />
                      </td>
                      <td className="px-3 py-2">
                        {item.valid ? "Dados disponíveis" : item.issues.join(" · ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}
