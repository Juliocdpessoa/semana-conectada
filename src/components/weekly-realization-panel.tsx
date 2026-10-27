import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, RefreshCw } from "lucide-react";
import { RsAlertBadge } from "@/components/rs-alert-badge";
import { AvailabilityHistoryDetails } from "@/components/availability-history-details";
import { WeeklyRsArchive, type RsClosure } from "@/components/weekly-rs-archive";
import { RsWeekSelector } from "@/components/rs-week-selector";
import { RsCenterPendingTasks } from "@/components/rs-center-pending-tasks";
import { RsWeeklyEvolution } from "@/components/rs-weekly-evolution";
import {
  consolidateMonthlyRs,
  rsWeekOverlapsMonth,
  type MonthlyRsWeek,
} from "@/lib/monthly-realization";
import type { RsProgramBasis } from "@/lib/rs-program-base";
import { supabase } from "@/integrations/supabase/client";
import { calculateWeeklyRealization, parseServiceHours } from "@/lib/weekly-realization";
import { hasRsDisplayLoad } from "@/lib/rs-center-display";
import {
  calculateSpecialtyRealization,
  calculateCenterRealization,
  availabilityKey,
  validateAvailability,
  type CenterHours,
} from "@/lib/weekly-availability";
import {
  WeeklyAvailabilityEditor,
  type AvailabilityDocument,
} from "@/components/weekly-availability-editor";
import { EmptyState, KpiCard, PageHeader, Panel } from "@/components/ui-kit";
import {
  RsSpecialtyBars,
  type PendingSummary,
  type RsReason,
} from "@/components/weekly-rs-evidence";

type Week = {
  id: string;
  label: string;
  code: string;
  start_date: string;
  end_date: string;
  is_active: boolean;
  sap_closure_status?: string;
};
type RsData = {
  consolidated?: {
    weeks: MonthlyRsWeek[];
    complete: boolean;
    calculation: NonNullable<RsData["frozenCalculation"]>;
  };
  programBasis?: RsProgramBasis;
  isFrozen?: boolean;
  frozenCalculation?: ReturnType<typeof calculateSpecialtyRealization> & {
    centerRows: ReturnType<typeof calculateCenterRealization>;
  };
  closure?: RsClosure | null;
  legacyClosedWithoutSnapshot?: boolean;
  deadlinePassed?: boolean;
  programmed: number;
  programmedTasks: number;
  emptyProgrammedRows: number;
  invalidPlannedHours: number;
  completed: number | null;
  immediate: number | null;
  unprogrammed: number;
  unclassified: number;
  missingDates: number;
  outsidePeriod: number;
  source: {
    source_file_name: string;
    imported_at: string;
    imported_by_name: string | null;
    row_count: number;
  } | null;
  centers: CenterHours[];
  availability: AvailabilityDocument | null;
  previousAvailability: (AvailabilityDocument & { week_code: string }) | null;
  pendingSummary: PendingSummary;
  reasons: RsReason[];
  unresolvedLocal: number;
};
const number = (value: number) =>
  value.toLocaleString("pt-BR", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
const hours = (value: number | null) => (value === null ? "—" : `${number(value)} HH`);
const date = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString("pt-BR");
const example = { programmed: "4708", completed: "4500", immediate: "0", available: "4708" };
const bands = [
  { label: "Abaixo de 95%", factor: -0.02, display: "−0,02 (−2%)" },
  { label: "De 95% até menos de 98%", factor: -0.01, display: "−0,01 (−1%)" },
  { label: "De 98% até 100% (inclusive)", factor: 0, display: "0,00 (0%)" },
  { label: "Acima de 100%", factor: 0.01, display: "+0,01 (+1%)" },
];

export function WeeklyRealizationPanel({
  tabs,
  userId,
  worksiteId,
  worksiteCode,
  mode = "indicator",
  isAdmin = false,
}: {
  tabs: ReactNode;
  userId: string;
  worksiteId: string;
  worksiteCode: string;
  mode?: "indicator" | "availability";
  isAdmin?: boolean;
}) {
  const [selectedWeeks, setSelectedWeeks] = useState<string[] | null>(null);
  const [selected, setSelected] = useState(() =>
    typeof window !== "undefined"
      ? (new URLSearchParams(window.location.search).get("week") ?? "")
      : "",
  );
  const weeks = useQuery({
    queryKey: ["weekly-rs-weeks", userId, worksiteId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("weeks")
        .select("id,label,code,start_date,end_date,is_active,sap_closure_status")
        .eq("worksite_id", worksiteId)
        .order("start_date", { ascending: false })
        .limit(600);
      if (error) throw error;
      return (data ?? []) as Week[];
    },
    staleTime: 60_000,
  });
  const [year, setYear] = useState("");
  const yearStorageKey = `nexo:weekly-rs:year:${userId}:${worksiteId}`;
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(yearStorageKey) ?? "";
      setYear(/^\d{4}$/.test(saved) ? saved : "");
    } catch {
      setYear("");
    }
    setMonth("");
    setSelectedWeeks(null);
  }, [yearStorageKey]);
  const [month, setMonth] = useState("");
  function changeYear(e: { target: { value: string } }) {
    setYear(e.target.value);
    try {
      if (e.target.value) window.localStorage.setItem(yearStorageKey, e.target.value);
      else window.localStorage.removeItem(yearStorageKey);
    } catch {
      // The filter still works when browser storage is unavailable.
    }
    setMonth("");
    setSelected("");
    setSelectedWeeks(null);
  }
  const [hideNonRs, setHideNonRs] = useState(true);
  const [local, setLocal] = useState(() => {
    const value =
      typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("local");
    return value === "IARI" || value === "ROTINA" ? value : "";
  });
  const availableYears = [...new Set(weeks.data?.map((w) => w.start_date.slice(0, 4)) ?? [])];
  const visibleWeeks =
    weeks.data?.filter((w) =>
      mode === "indicator"
        ? rsWeekOverlapsMonth(w, year, month)
        : (!year || w.start_date.startsWith(year)) &&
          (!month || w.start_date.slice(5, 7) === month),
    ) ?? [];
  const week =
    visibleWeeks.find((w) => w.id === selected) ??
    visibleWeeks.find((w) => w.is_active) ??
    visibleWeeks[0];
  const activeWeeks =
    mode === "indicator" && selectedWeeks !== null
      ? visibleWeeks.filter((w) => selectedWeeks.includes(w.id))
      : week
        ? [week]
        : [];
  const evolutionPanel =
    mode === "indicator" && !weeks.isError ? (
      <RsWeeklyEvolution
        weeks={visibleWeeks}
        local={local}
        userId={userId}
        worksiteId={worksiteId}
        selectedIds={activeWeeks.map((item) => item.id)}
      />
    ) : null;
  return (
    <main className="mx-auto max-w-none px-4 py-6 sm:px-6">
      <PageHeader
        eyebrow="Gestão Operacional"
        title={
          mode === "availability" ? "Disponibilidade semanal de HH" : "Realização Semanal (RS)"
        }
        description={
          mode === "availability"
            ? "Mantenha a base da semana e consulte quem alterou cada versão."
            : "Semana atual em apuração e histórico oficial dos fechamentos SAP + RS."
        }
      />
      {tabs}
      <div
        className={
          mode === "indicator"
            ? "grid items-end gap-3 2xl:grid-cols-[7rem_8rem_minmax(14rem,1.5fr)_minmax(12rem,1fr)_minmax(18rem,1.2fr)_auto_9rem]"
            : ""
        }
      >
        <div
          className={`grid grid-cols-2 items-end gap-3 sm:grid-cols-[8rem_10rem_minmax(0,1fr)] ${mode === "indicator" ? "2xl:contents" : "mb-4"}`}
        >
          <label className="text-xs">
            <span className="mb-1 block h-4 leading-4">Ano</span>
            <select className="input-base h-9" value={year} onChange={changeYear}>
              <option value="">Todos os anos</option>
              {availableYears.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            <span className="mb-1 block h-4 leading-4">Mês</span>
            <select
              className="input-base h-9"
              value={month}
              onChange={(e) => {
                setMonth(e.target.value);
                setSelected("");
                setSelectedWeeks(null);
              }}
            >
              <option value="">Todos os meses</option>
              {Array.from({ length: 12 }, (_, i) => (
                <option key={i} value={String(i + 1).padStart(2, "0")}>
                  {new Date(2026, i, 1).toLocaleString("pt-BR", { month: "long" })}
                </option>
              ))}
            </select>
          </label>
          <div className="col-span-2 min-w-0 sm:col-span-1">
            <label htmlFor="rs-week" className="mb-1 block h-4 truncate text-xs leading-4">
              Semana · {worksiteCode}
            </label>
            {mode === "indicator" ? (
              <RsWeekSelector
                weeks={visibleWeeks}
                selected={activeWeeks.map((w) => w.id)}
                loading={weeks.isLoading}
                onChange={(ids) => {
                  setSelectedWeeks(ids);
                  setSelected(ids[0] ?? "");
                  const url = new URL(window.location.href);
                  if (ids.length === 1) url.searchParams.set("week", ids[0]);
                  else url.searchParams.delete("week");
                  window.history.replaceState({}, "", url);
                }}
              />
            ) : (
              <select
                id="rs-week"
                value={week?.id ?? ""}
                onChange={(e) => {
                  setSelected(e.target.value);
                  const url = new URL(window.location.href);
                  url.searchParams.set("week", e.target.value);
                  window.history.replaceState({}, "", url);
                }}
                className="input-base h-9"
              >
                {!week && (
                  <option value="">{weeks.isLoading ? "Carregando…" : "Nenhuma semana"}</option>
                )}
                {visibleWeeks.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.label} · {date(w.start_date)} a {date(w.end_date)}
                    {w.is_active ? " · Operacional" : ""}
                  </option>
                ))}
              </select>
            )}
          </div>
          {mode === "indicator" && (
            <label className="col-span-2 min-w-0 text-xs sm:col-span-3 xl:col-span-1">
              <span
                className="mb-1 block h-4 truncate leading-4"
                title="Local da realização semanal"
              >
                Local da realização semanal
              </span>
              <select
                className="input-base h-9"
                value={local}
                onChange={(e) => {
                  const next = e.target.value;
                  setLocal(next);
                  const url = new URL(window.location.href);
                  if (next) url.searchParams.set("local", next);
                  else url.searchParams.delete("local");
                  window.history.replaceState({}, "", url);
                }}
              >
                <option value="">IARI + ROTINA · todos os locais</option>
                <option value="IARI">IARI</option>
                <option value="ROTINA">ROTINA</option>
              </select>
            </label>
          )}
          {mode === "indicator" && (
            <label className="flex h-9 cursor-pointer items-center gap-2 text-xs 2xl:col-start-7 2xl:row-start-1">
              <input
                type="checkbox"
                checked={hideNonRs}
                onChange={(event) => setHideNonRs(event.target.checked)}
              />
              Ocultar centros fora do RS
            </label>
          )}
        </div>
        {weeks.isError ? (
          <EmptyState
            title="Não foi possível carregar as semanas"
            action={
              <button className="btn-ghost" onClick={() => void weeks.refetch()}>
                Tentar novamente
              </button>
            }
          />
        ) : mode === "indicator" && activeWeeks.length > 1 ? (
          <SelectedWeeksResults
            afterResults={evolutionPanel}
            weeks={activeWeeks}
            userId={userId}
            worksiteId={worksiteId}
            worksiteCode={worksiteCode}
            local={local}
            hideNonRs={hideNonRs}
          />
        ) : activeWeeks[0] ? (
          <WeeklyResults
            afterResults={evolutionPanel}
            key={activeWeeks[0].id}
            week={activeWeeks[0]}
            userId={userId}
            worksiteId={worksiteId}
            worksiteCode={worksiteCode}
            mode={mode}
            isAdmin={isAdmin}
            local={local}
            hideNonRs={hideNonRs}
          />
        ) : (
          !weeks.isLoading && (
            <EmptyState
              title={
                visibleWeeks.length
                  ? "Selecione uma ou mais semanas"
                  : "Nenhuma semana disponível nesta obra"
              }
            />
          )
        )}
      </div>
    </main>
  );
}

function SelectedWeeksResults({
  afterResults,
  weeks,
  userId,
  worksiteId,
  worksiteCode,
  local,
  hideNonRs,
}: {
  afterResults?: ReactNode;
  weeks: Week[];
  userId: string;
  worksiteId: string;
  worksiteCode: string;
  local: string;
  hideNonRs: boolean;
}) {
  const signature = weeks
    .map((week) => week.id)
    .sort()
    .join("|");
  const [settled, setSettled] = useState(signature);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(signature), 300);
    return () => clearTimeout(timer);
  }, [signature]);
  const query = useQuery({
    queryKey: ["selected-weeks-rs", userId, worksiteId, settled, local],
    enabled: settled === signature,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_monthly_rs_weeks", {
        p_worksite_id: worksiteId,
        p_week_ids: settled.split("|"),
        p_local: local || null,
      });
      if (error) throw error;
      if (!data?.weeks || data.weeks.length !== weeks.length)
        throw new Error("Não foi possível obter todas as semanas selecionadas.");
      const sources = data.weeks as MonthlyRsWeek[];
      const combined = consolidateMonthlyRs(sources);
      const decorate = (row: (typeof combined.rows)[number]) => ({
        ...row,
        actual: row.completed + row.immediate,
      });
      const calculation = {
        ...combined,
        rows: combined.rows.map(decorate),
        centerRows: combined.centerRows.map((row) => ({
          ...decorate(row),
          center: row.center ?? "",
        })),
        unmapped: [],
        invalid: [],
        monitoring: combined.rows.filter((row) => !row.includedInRs).map(decorate),
      };
      return { sources, complete: combined.complete, calculation };
    },
  });
  if (settled !== signature || query.isPending)
    return (
      <p role="status" className="2xl:col-span-7">
        Atualizando semanas selecionadas…
      </p>
    );
  if (query.isError || !query.data)
    return (
      <div className="2xl:col-span-7">
        <EmptyState
          title="Não foi possível calcular as semanas selecionadas"
          description={query.error?.message}
          action={
            <button className="btn-ghost" onClick={() => void query.refetch()}>
              Tentar novamente
            </button>
          }
        />
      </div>
    );
  const { sources, complete, calculation } = query.data;
  const data: RsData = {
    consolidated: { weeks: sources, complete, calculation },
    availability: null,
    previousAvailability: null,
    source: null,
    centers: [],
    programmed: calculation.totals.programmed,
    programmedTasks: 0,
    emptyProgrammedRows: 0,
    invalidPlannedHours: 0,
    completed: null,
    immediate: null,
    unprogrammed: 0,
    unclassified: 0,
    missingDates: 0,
    outsidePeriod: 0,
    unresolvedLocal: 0,
    reasons: [],
    pendingSummary: {
      programmed: 0,
      confirmed: null,
      pending: null,
      executed: null,
      withJustification: null,
      withoutJustification: null,
      plannedHh: null,
      unknownPeriod: 0,
      monitoringTasks: 0,
    },
  };
  return (
    <div className="contents">
      <div className="flex min-w-0 items-end gap-3 2xl:contents">
        <div className="flex h-9 min-w-0 flex-1 items-center truncate text-xs text-muted-foreground">
          {sources.length} semanas ·{" "}
          {sources.some((w) => !w.isFrozen) ? "Em apuração" : "Versões oficiais"}
        </div>
        <button
          className="btn-outline h-9"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          {query.isFetching ? "Atualizando…" : "Atualizar"}
        </button>
      </div>
      <div className="min-w-0 2xl:col-span-7">
        {!complete && (
          <p
            role="alert"
            className="mb-3 rounded-md border border-warning/50 bg-warning/10 p-3 text-sm"
          >
            RS indisponível:{" "}
            {sources
              .filter((w) => !w.valid)
              .map((w) => `${w.week.code}: ${w.issues.join(", ")}`)
              .join(" · ")}
            . As semanas sem dados não são consideradas zero.
          </p>
        )}
        <RsContent
          afterResults={afterResults}
          week={weeks[0]}
          data={data}
          userId={userId}
          worksiteId={worksiteId}
          worksiteCode={worksiteCode}
          local={local}
          hideNonRs={hideNonRs}
          onSaved={async () => {
            await query.refetch();
          }}
        />
      </div>
    </div>
  );
}

function WeeklyResults({
  afterResults,
  week,
  userId,
  worksiteId,
  worksiteCode,
  mode,
  isAdmin,
  local,
  hideNonRs,
}: {
  afterResults?: ReactNode;
  week: Week;
  userId: string;
  worksiteId: string;
  worksiteCode: string;
  mode: "indicator" | "availability";
  isAdmin: boolean;
  local: string;
  hideNonRs: boolean;
}) {
  const qc = useQueryClient();
  const [version, setVersion] = useState<number | null>(null);
  const data = useQuery({
    queryKey: ["weekly-rs", userId, worksiteId, week.id, mode, local, version],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc(
        mode === "availability" ? "get_weekly_realization" : "get_weekly_rs_report",
        mode === "availability"
          ? { p_week_id: week.id }
          : { p_week_id: week.id, p_local: local || null, p_version: version },
      );
      if (error) throw error;
      return data as RsData;
    },
    staleTime: 30_000,
    refetchInterval: 5 * 60_000,
  });
  if (data.isLoading)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Carregando realização semanal…
      </p>
    );
  if (data.isError || !data.data)
    return (
      <EmptyState
        title="Não foi possível calcular a realização semanal"
        description={
          data.error instanceof Error ? data.error.message : "Atualize e tente novamente."
        }
        action={
          <button className="btn-ghost" onClick={() => void data.refetch()}>
            Tentar novamente
          </button>
        }
      />
    );
  if (mode === "availability")
    return (
      <AvailabilityScreen
        week={week}
        data={data.data}
        userId={userId}
        worksiteId={worksiteId}
        onSaved={() =>
          qc.invalidateQueries({ queryKey: ["weekly-rs", userId, worksiteId, week.id] })
        }
      />
    );
  return (
    <div className="contents">
      <div className="flex min-w-0 items-end gap-3 2xl:contents">
        <div className="min-w-0 flex-1">
          <WeeklyRsArchive
            weekId={week.id}
            userId={userId}
            worksiteId={worksiteId}
            isAdmin={isAdmin}
            version={version}
            onVersion={setVersion}
            closure={data.data.closure}
            isFrozen={data.data.isFrozen}
            legacy={data.data.legacyClosedWithoutSnapshot}
            deadlinePassed={data.data.deadlinePassed}
          />
        </div>
        <button
          type="button"
          className="btn-outline inline-flex h-9 shrink-0 items-center justify-center gap-2 whitespace-nowrap px-3 text-xs"
          disabled={data.isFetching}
          onClick={() => {
            void data.refetch();
            void qc.invalidateQueries({
              queryKey: ["weekly-rs-pending", userId, worksiteId, week.id],
            });
          }}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          {data.isFetching ? "Atualizando…" : "Atualizar"}
        </button>
      </div>
      <div className="min-w-0 2xl:col-span-7">
        <RsContent
          afterResults={afterResults}
          key={week.id + local}
          week={week}
          data={data.data}
          userId={userId}
          worksiteId={worksiteId}
          local={local}
          hideNonRs={hideNonRs}
          worksiteCode={worksiteCode}
          onSaved={() =>
            qc.invalidateQueries({ queryKey: ["weekly-rs", userId, worksiteId, week.id] })
          }
        />
      </div>
    </div>
  );
}

function RsContent({
  afterResults,
  week,
  data,
  onSaved,
  userId,
  worksiteId,
  local,
  hideNonRs,
}: {
  afterResults?: ReactNode;
  week: Week;
  data: RsData;
  worksiteCode: string;
  onSaved: () => Promise<unknown>;
  userId: string;
  worksiteId: string;
  local: string;
  hideNonRs: boolean;
}) {
  const errors = useMemo(
    () =>
      data.isFrozen || data.consolidated
        ? []
        : data.availability
          ? validateAvailability(data.availability.rows, week)
          : [],
    [data.availability, data.isFrozen, data.consolidated, week],
  );
  const calculation = useMemo(
    () =>
      data.consolidated
        ? data.consolidated.calculation
        : data.isFrozen && data.frozenCalculation
          ? data.frozenCalculation
          : calculateSpecialtyRealization(
              data.availability?.rows ?? [],
              data.centers ?? [],
              !!data.source,
              local,
            ),
    [
      data.availability,
      data.centers,
      data.source,
      local,
      data.isFrozen,
      data.frozenCalculation,
      data.consolidated,
    ],
  );
  const { totals, rows, unmapped } = calculation;
  const allCenterRows = useMemo(
    () =>
      data.consolidated
        ? data.consolidated.calculation.centerRows
        : data.isFrozen && data.frozenCalculation
          ? data.frozenCalculation.centerRows
          : rows.flatMap((row) =>
              calculateCenterRealization(
                data.availability?.rows ?? [],
                data.centers ?? [],
                !!data.source,
                row.specialty,
                row.includedInRs,
                local,
              ),
            ),
    [
      data.isFrozen,
      data.frozenCalculation,
      data.consolidated,
      data.availability,
      data.centers,
      data.source,
      rows,
      local,
    ],
  );
  const displayRows = rows.filter(hasRsDisplayLoad).map((row) => ({
    ...row,
    centers: allCenterRows
      .filter(
        (center) =>
          availabilityKey(center.specialty) === availabilityKey(row.specialty) &&
          center.includedInRs === row.includedInRs &&
          hasRsDisplayLoad(center),
      )
      .map((center) => center.center),
  }));
  const visibleRows = hideNonRs ? displayRows.filter((row) => row.includedInRs) : displayRows;
  const [selectedSpecialty, setSelectedSpecialty] = useState<{
    specialty: string;
    includedInRs: boolean;
  } | null>(null);
  const [selectedCenter, setSelectedCenter] = useState<string | null>(null);
  const pendingSources = data.consolidated
    ? data.consolidated.weeks.map((item) => ({
        week_id: item.week.id,
        closure_id: item.isFrozen ? (item.closure?.id ?? null) : null,
      }))
    : [{ week_id: week.id, closure_id: data.isFrozen ? (data.closure?.id ?? null) : null }];
  const pendingRevision = JSON.stringify([
    pendingSources,
    local,
    data.consolidated?.weeks.map((item) => item.source?.imported_at) ?? data.source?.imported_at,
  ]);
  useEffect(() => {
    setSelectedCenter(null);
  }, [pendingRevision, selectedSpecialty?.specialty, selectedSpecialty?.includedInRs]);
  useEffect(() => {
    if (hideNonRs)
      setSelectedSpecialty((selected) => (selected?.includedInRs === false ? null : selected));
  }, [hideNonRs]);
  const centerRows = selectedSpecialty
    ? allCenterRows.filter(
        (row) =>
          availabilityKey(row.specialty) === availabilityKey(selectedSpecialty.specialty) &&
          row.includedInRs === selectedSpecialty.includedInRs &&
          hasRsDisplayLoad(row),
      )
    : [];
  const result =
    data.isFrozen || data.consolidated
      ? calculation.result
      : data.invalidPlannedHours === 0 &&
          !errors.length &&
          (!(local || data.programBasis?.kind === "official") || !data.unresolvedLocal)
        ? calculation.result
        : null;
  const hasSource = data.consolidated ? data.consolidated.complete : !!data.source;
  const hasAvailability = !!data.availability || !!data.consolidated;
  const programmedConsidered = data.consolidated
    ? (result?.programmedConsidered ?? null)
    : Math.min(totals.programmed, totals.available);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {data.consolidated
            ? data.consolidated.weeks.map((w) => w.week.code).join(" | ") +
              (data.consolidated.weeks.some((w) => !w.isFrozen)
                ? " · Resultado em apuração"
                : " · Versões oficiais preservadas")
            : data.source
              ? "SAP atualizado em " +
                new Date(data.source.imported_at).toLocaleString("pt-BR") +
                " · " +
                (data.source.imported_by_name ?? "Responsável não informado") +
                " · " +
                data.source.row_count +
                " linhas"
              : "Sem carga SAP detalhada para esta semana"}
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="HH programado original"
          value={hasAvailability ? hours(totals.programmed) : "—"}
          hint={`Considerado: ${hours(programmedConsidered)}${data.consolidated ? "" : ` · ${data.pendingSummary.programmed} tarefas`}`}
        />
        <KpiCard
          label="HH disponível para RS"
          value={hasAvailability ? hours(totals.available) : "—"}
          hint="Somente elegíveis ao RS · EEP incluída"
        />
        <KpiCard
          label="HH apropriado elegível"
          value={hours(hasSource && hasAvailability ? totals.completed + totals.immediate : null)}
          hint="Elegíveis ao RS · antes do teto"
        />
        <KpiCard
          label="HH considerado no RS"
          value={result ? hours(totals.considered) : "—"}
          hint={
            result
              ? hours(totals.excess) + " de excesso desconsiderado"
              : "Depende da disponibilidade e dos vínculos dos centros"
          }
        />
      </div>
      {!hasSource && !data.consolidated && (
        <p className="rounded-md border border-border bg-muted p-3 text-sm">
          Importe o SAP na tela de Atividades. O status EXECUTADO não substitui HH apropriado.
        </p>
      )}
      {data.invalidPlannedHours > 0 && (
        <p role="alert" className="text-sm text-destructive">
          Existem {data.invalidPlannedHours} tarefas sem HH programado válido. Corrija a base antes
          de calcular o RS.
        </p>
      )}
      {data.availability && unmapped.length > 0 && (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 p-3 text-xs text-destructive"
        >
          RS geral indisponível: faltam vínculos de disponibilidade/especialidade para os centros:{" "}
          {unmapped.join(", ")}. Cadastre os centros mesmo quando a disponibilidade for zero.
          Nenhuma hora foi descartada silenciosamente.
        </p>
      )}
      {(errors.length > 0 || calculation.invalid.length > 0) && (
        <p role="alert" className="text-sm text-destructive">
          Confira a disponibilidade e os HH de origem antes de calcular o indicador.
        </p>
      )}
      {data.unresolvedLocal > 0 && (
        <p role="alert" className="text-xs text-warning-foreground">
          Há {data.unresolvedLocal} registros elegíveis sem local identificável na base ou na carga.{" "}
          {local || data.programBasis?.kind === "official"
            ? "O RS ficará indisponível até resolver o vínculo, para não omitir HH."
            : "Confira os vínculos antes de usar os filtros por local."}
        </p>
      )}
      {(data.outsidePeriod > 0 || data.missingDates > 0 || data.unclassified > 0) && (
        <p className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-warning-foreground">
          RS em prévia: há {data.outsidePeriod} registros SAP com execução fora da semana;{" "}
          {data.missingDates} sem período de execução; {hours(data.unclassified)} fora da
          programação sem código 1 ou 2. As horas são as da carga vinculada à semana, sem rateio
          entre semanas. Confira a carga antes da medição.
        </p>
      )}
      <RsResult result={result} />
      <RsSpecialtyBars
        rows={displayRows}
        hasSap={hasSource}
        period={data.consolidated ? "selection" : "weekly"}
      />
      {hasAvailability && (
        <Panel title="Realização Semanal (RS)">
          <p className="mb-3 text-xs text-muted-foreground">
            {data.consolidated
              ? "Soma dos valores já limitados em cada semana selecionada. O excesso de uma semana ou especialidade não compensa outra. Valores em HH."
              : "O limite é aplicado à soma de TCpr + TCoi de cada especialidade na semana inteira, dentro do local selecionado. O excesso de uma especialidade não compensa outra. Valores em HH."}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full whitespace-nowrap text-xs">
              <thead className="bg-muted">
                <tr>
                  {[
                    "Especialidade",
                    "Disponível",
                    "Programado original",
                    "Programado considerado",
                    "OM",
                    "TCpr SAP",
                    "TCpr (Limite)",
                    "TCoi SAP",
                    "Considerado",
                    "Excesso",
                    "RS",
                  ].map((h) => (
                    <th
                      key={h}
                      className={"p-2 " + (h === "Especialidade" ? "text-left" : "text-right")}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {!visibleRows.length && (
                  <tr>
                    <td colSpan={11} className="p-4 text-center text-muted-foreground">
                      Nenhum centro com HH disponível ou programado neste recorte.
                    </td>
                  </tr>
                )}
                {visibleRows.map((r, index) => {
                  const expanded =
                    selectedSpecialty?.specialty === r.specialty &&
                    selectedSpecialty.includedInRs === r.includedInRs;
                  return (
                    <Fragment key={`${r.specialty}:${r.includedInRs}`}>
                      <tr className="row-zebra rs-hover-row">
                        <td className="p-2 font-medium">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 text-primary underline underline-offset-2 hover:opacity-80"
                            onClick={() => setSelectedSpecialty(expanded ? null : r)}
                            aria-expanded={expanded}
                            aria-controls={expanded ? `rs-centers-${index}` : undefined}
                            aria-label={`${expanded ? "Recolher" : "Ver"} RS dos centros de ${r.specialty}`}
                          >
                            <ChevronDown
                              aria-hidden="true"
                              className={`h-3.5 w-3.5 transition-transform ${expanded ? "" : "-rotate-90"}`}
                            />
                            {r.specialty}
                          </button>
                          <span className="block text-[10px] font-normal text-muted-foreground">
                            {r.centers.join(", ")}
                          </span>
                          {!r.includedInRs && (
                            <span className="ml-2 text-[10px] text-muted-foreground">
                              Somente acompanhamento · fora do total
                            </span>
                          )}
                        </td>
                        <td className="p-2 text-right">{number(r.available)}</td>
                        <td className="p-2 text-right">{number(r.programmed)}</td>
                        <td className="p-2 text-right">{number(r.programmedConsidered)}</td>
                        <td className="p-2 text-right">
                          {r.occupation === null ? "—" : number(r.occupation * 100) + "%"}
                        </td>
                        <td className="p-2 text-right">{hasSource ? number(r.completed) : "—"}</td>
                        <td className="p-2 text-right">
                          {hasSource ? number(r.completedForRs) : "—"}
                        </td>
                        <td className="p-2 text-right">{hasSource ? number(r.immediate) : "—"}</td>
                        <td className="p-2 text-right">{hasSource ? number(r.considered) : "—"}</td>
                        <td className="p-2 text-right">{hasSource ? number(r.excess) : "—"}</td>
                        <td className="p-2 text-right">
                          <RsAlertBadge value={r.rs} included={r.includedInRs} />
                        </td>
                      </tr>
                      {expanded && (
                        <tr id={`rs-centers-${index}`} className="bg-primary/5">
                          <td colSpan={11} className="px-4 py-2 text-xs text-muted-foreground">
                            Centros de {r.specialty} · {local || "IARI + ROTINA"}. Cada centro
                            mostra seu próprio teto semanal. O RS oficial continua consolidado por
                            especialidade; não some nem faça média simples dos percentuais dos
                            centros.
                          </td>
                        </tr>
                      )}
                      {expanded &&
                        centerRows.map((center, centerIndex) => (
                          <Fragment key={center.center}>
                            <tr className="rs-hover-row border-b border-border/50 bg-primary/5">
                              <td className="p-2 pl-7 font-medium">
                                <span className="mr-2 text-muted-foreground" aria-hidden="true">
                                  ↳
                                </span>
                                <button
                                  type="button"
                                  className="inline-flex items-center gap-1 text-primary underline underline-offset-2 hover:opacity-80"
                                  aria-expanded={selectedCenter === center.center}
                                  aria-controls={
                                    selectedCenter === center.center
                                      ? `rs-pending-${index}-${centerIndex}`
                                      : undefined
                                  }
                                  aria-label={`Ver tarefas sem apropriação SAP de ${center.center}`}
                                  onClick={() =>
                                    setSelectedCenter((old) =>
                                      old === center.center ? null : center.center,
                                    )
                                  }
                                >
                                  <ChevronDown
                                    aria-hidden="true"
                                    className={`h-3.5 w-3.5 transition-transform ${selectedCenter === center.center ? "" : "-rotate-90"}`}
                                  />
                                  {center.center}
                                </button>
                              </td>
                              {[
                                center.available,
                                center.programmed,
                                center.programmedConsidered,
                              ].map((value, i) => (
                                <td className="p-2 text-right" key={i}>
                                  {number(value)}
                                </td>
                              ))}
                              <td className="p-2 text-right">
                                {center.occupation === null
                                  ? "—"
                                  : number(center.occupation * 100) + "%"}
                              </td>
                              {[
                                center.completed,
                                center.completedForRs,
                                center.immediate,
                                center.considered,
                                center.excess,
                              ].map((value, i) => (
                                <td className="p-2 text-right" key={i}>
                                  {hasSource ? number(value) : "—"}
                                </td>
                              ))}
                              <td className="p-2 text-right">
                                <RsAlertBadge value={center.rs} included={center.includedInRs} />
                              </td>
                            </tr>
                            {selectedCenter === center.center && (
                              <tr
                                id={`rs-pending-${index}-${centerIndex}`}
                                className="bg-primary/5"
                              >
                                <td colSpan={11} className="px-5 py-4">
                                  <RsCenterPendingTasks
                                    key={center.center + pendingRevision}
                                    center={center.center}
                                    sources={pendingSources}
                                    local={local}
                                    userId={userId}
                                    worksiteId={worksiteId}
                                    revision={pendingRevision}
                                    onClose={() => setSelectedCenter(null)}
                                  />
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        ))}
                    </Fragment>
                  );
                })}
              </tbody>
              <tfoot className="border-t border-border font-semibold">
                <tr className="rs-hover-row">
                  <td className="p-2">
                    Total elegível ao RS{unmapped.length ? " · vínculo incompleto" : ""}
                  </td>
                  <td className="p-2 text-right">{number(totals.available)}</td>
                  <td className="p-2 text-right">{number(totals.programmed)}</td>
                  <td className="p-2 text-right">
                    {programmedConsidered === null ? "—" : number(programmedConsidered)}
                  </td>
                  <td className="p-2 text-right">
                    {result ? number(result.occupation * 100) + "%" : "—"}
                  </td>
                  <td className="p-2 text-right">{hasSource ? number(totals.completed) : "—"}</td>
                  <td className="p-2 text-right">
                    {hasSource ? number(totals.completedForRs) : "—"}
                  </td>
                  <td className="p-2 text-right">{hasSource ? number(totals.immediate) : "—"}</td>
                  <td className="p-2 text-right">{result ? number(totals.considered) : "—"}</td>
                  <td className="p-2 text-right">{result ? number(totals.excess) : "—"}</td>
                  <td className="p-2 text-right">{result ? number(result.rs) + "%" : "—"}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Cores contratuais: vermelho abaixo de 95%; amarelo de 95% até menos de 98%; verde de 98%
            até 100%, inclusive; azul acima de 100%. Cinza indica acompanhamento ou RS indisponível.
            O geral usa os totais ponderados pela disponibilidade, não a média simples dos
            percentuais. Especialidades com disponibilidade zero têm RS indefinido e HH considerado
            igual a zero.
          </p>
        </Panel>
      )}
      {!result &&
        data.availability &&
        hasSource &&
        !unmapped.length &&
        !data.invalidPlannedHours && (
          <p className="text-sm text-muted-foreground">
            O RS requer disponibilidade total positiva, HH válidos e TP semanal maior que zero.
          </p>
        )}
      {afterResults}
      {data.consolidated ? (
        <Panel title="Memória de cálculo">
          <p className="text-xs text-muted-foreground">
            As semanas selecionadas entram integralmente. O RS usa a soma dos HH considerados de
            cada semana dividida pela soma do HH disponível, sem média dos percentuais e sem
            compensar excesso entre semanas.
          </p>
          <details className="mt-3 text-xs">
            <summary className="cursor-pointer">Fontes das semanas selecionadas</summary>
            <ul className="mt-2 space-y-2">
              {data.consolidated.weeks.map((item) => (
                <li key={item.week.id}>
                  {item.week.code} ·{" "}
                  {item.isFrozen ? `Fechamento v${item.closure?.version}` : "Em apuração"} ·{" "}
                  {item.basis?.kind === "official"
                    ? `Base oficial v${item.basis.version}`
                    : "Base operacional"}{" "}
                  · {item.source?.source_file_name ?? "Sem SAP"}
                </li>
              ))}
            </ul>
          </details>
        </Panel>
      ) : (
        <Panel title="Memória de cálculo">
          <div className="space-y-2 text-xs text-muted-foreground">
            {data.source && (
              <p className="break-words">Fonte SAP: {data.source.source_file_name}</p>
            )}
            <p className="font-mono text-foreground">
              TCpr: menor entre HH SAP e HH programado por confirmação na semana. HH considerado da
              especialidade = menor entre (TCpr limitado + TCoi) e HH disponível semanal
            </p>
            <p className="font-mono text-foreground">
              TP considerado = menor entre HH programado original e HH disponível total; OM = TP
              considerado ÷ HH disponível total
            </p>
            <p className="font-mono text-foreground">
              RS geral = (Σ HH executado considerado por especialidade ÷ TP considerado geral) × OM
              geral × 100
            </p>
            <p>
              O filtro de local aplica-se a todos os componentes. Alpinismo (incluindo
              Alpinista/Alpinistas) e os centros INSPPINT, TECNIEND, TECNINSC, HIDROJAT e HIDROJATO
              ficam excluídos dos HH programados, disponíveis e apropriados usados no RS. Sua
              visualização é apenas de acompanhamento.
            </p>
            <p>
              Aplicamos RS = ((TCpr + TCoi) ÷ TP considerado) × OM × 100, após aplicar o teto
              semanal por especialidade. OM é limitado a 100% em cada especialidade e no geral; os
              HH reais são preservados. Não há teto diário. A tabela já inclui EEP: não somamos
              horas adicionais nem usamos referência fixa.
            </p>
            {result && (
              <p className="text-sm text-foreground">
                RS = ({number(totals.considered)} ÷{" "}
                {number(Math.min(totals.programmed, totals.available))}) ×{" "}
                {number(result.occupation * 100)}% × 100 ≈ <strong>{number(result.rs)}%</strong>. O
                cálculo usa valores sem arredondamento.
              </p>
            )}
            <p>
              {data.programBasis?.kind === "official"
                ? "TCpr considera cada linha SAP uma única vez quando sua confirmação está na base oficial da semana. A coluna Trabalho entra inteira na semana selecionada, sem vínculo às datas operacionais e sem rateio pelas datas da planilha."
                : "Sem base oficial: TCpr usa a programação operacional e exige um dia coberto pelo período real SAP. Importe a aba Programação SAP para usar o vínculo semanal por confirmação."}{" "}
              Confirmações repetidas em vários dias não multiplicam a apropriação.
            </p>
            <p>
              TCoi inclui somente apropriações externas à programação com código 2. Código 1 (
              {hours(data.unprogrammed)}) não entra no RS. Somente linhas confirmadas com HH
              positivo da última carga SAP detalhada são consideradas; estornos devem ser
              conciliados na origem.
            </p>
            <p>
              Centros da programação e do SAP são vinculados às especialidades pela disponibilidade,
              sem inferência pelo nome. TP inclui todos os status programados e exclui tarefas
              cadastradas como imediatas.
            </p>
            {data.emptyProgrammedRows > 0 && (
              <p>
                {data.emptyProgrammedRows} linhas vazias foram desconsideradas somente neste
                indicador. Nenhuma atividade foi excluída.
              </p>
            )}
            <p>
              Com o teto confirmado, o RS não ultrapassa 100%; a faixa acima de 100% permanece como
              referência contratual. De 95% até menos de 98%, o fator é −0,01; de 98% até 100%,
              inclusive, é 0,00.
            </p>
          </div>
        </Panel>
      )}
      <details className="surface-card p-4">
        <summary className="cursor-pointer text-sm font-medium">
          Simulador de uma especialidade · não altera dados salvos
        </summary>
        <div className="mt-4">
          <RsSimulator />
        </div>
      </details>
    </div>
  );
}

type AvailabilityHistoryEntry = {
  version: number;
  updated_at: string;
  updated_by_name: string;
  source_file_name: string | null;
  row_count: number;
  total_hh: number;
  previous_total_hh: number | null;
};

function AvailabilityScreen({
  week,
  data,
  userId,
  worksiteId,
  onSaved,
}: {
  week: Week;
  data: RsData;
  userId: string;
  worksiteId: string;
  onSaved: () => Promise<unknown>;
}) {
  const [revision, setRevision] = useState(0);
  const [expandedHistoryVersion, setExpandedHistoryVersion] = useState<number | null>(null);
  const [cursors, setCursors] = useState<Array<number | null>>([null]);
  const qc = useQueryClient();
  const cursor = cursors[cursors.length - 1];
  const history = useQuery({
    queryKey: ["weekly-rs-history", userId, worksiteId, week.id, cursor],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("list_weekly_rs_availability_history", {
        p_week_id: week.id,
        p_before_version: cursor,
        p_limit: 21,
      });
      if (error) throw error;
      return data as AvailabilityHistoryEntry[];
    },
    staleTime: 30_000,
  });
  return (
    <div className="space-y-4">
      <WeeklyAvailabilityEditor
        key={revision}
        week={week}
        document={data.availability}
        previous={data.previousAvailability}
        readOnly={week.sap_closure_status === "closed"}
        onSaved={async () => {
          await onSaved();
          setRevision((v) => v + 1);
          setCursors([null]);
          await qc.invalidateQueries({
            queryKey: ["weekly-rs-history", userId, worksiteId, week.id],
          });
        }}
      />
      <Panel title="Histórico de alterações da disponibilidade">
        <p className="mb-3 text-xs text-muted-foreground">
          Cada salvamento preserva a versão anterior, o responsável, a data e a origem. Alterar uma
          semana não muda a disponibilidade de outras semanas.
        </p>
        {history.isLoading ? (
          <p role="status" className="text-sm">
            Carregando histórico…
          </p>
        ) : history.isError ? (
          <p role="alert" className="text-sm text-destructive">
            Não foi possível carregar o histórico.{" "}
            <button className="underline" onClick={() => void history.refetch()}>
              Tentar novamente
            </button>
          </p>
        ) : !history.data?.length ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma alteração registrada nesta página.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted">
                <tr>
                  {[
                    "Versão",
                    "Alterado em",
                    "Responsável",
                    "HH anterior",
                    "HH salvo",
                    "Linhas",
                    "Origem",
                    "Alterações por centro",
                  ].map((label) => (
                    <th key={label} className="whitespace-nowrap p-2 text-left">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.data.slice(0, 20).map((entry) => (
                  <Fragment key={entry.version}>
                    <tr className="row-zebra">
                      <td className="p-2">{entry.version}</td>
                      <td className="whitespace-nowrap p-2">
                        {new Date(entry.updated_at).toLocaleString("pt-BR")}
                      </td>
                      <td className="p-2">{entry.updated_by_name}</td>
                      <td className="whitespace-nowrap p-2">{hours(entry.previous_total_hh)}</td>
                      <td className="whitespace-nowrap p-2">{hours(entry.total_hh)}</td>
                      <td className="p-2">{entry.row_count}</td>
                      <td className="min-w-40 p-2">
                        {entry.source_file_name ?? "Preenchimento no NEXO"}
                      </td>
                      <td className="p-2">
                        <button
                          type="button"
                          className="btn-ghost whitespace-nowrap text-xs"
                          aria-expanded={expandedHistoryVersion === entry.version}
                          onClick={() =>
                            setExpandedHistoryVersion((old) =>
                              old === entry.version ? null : entry.version,
                            )
                          }
                        >
                          {expandedHistoryVersion === entry.version
                            ? "Ocultar detalhes"
                            : "Ver alterações"}
                        </button>
                      </td>
                    </tr>
                    {expandedHistoryVersion === entry.version && (
                      <tr className="bg-primary/5">
                        <td colSpan={8} className="p-4">
                          <AvailabilityHistoryDetails
                            key={`${week.id}:${entry.version}`}
                            weekId={week.id}
                            version={entry.version}
                            userId={userId}
                            worksiteId={worksiteId}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-3 flex items-center justify-between text-xs">
          <button
            className="btn-ghost"
            disabled={cursors.length < 2 || history.isFetching}
            onClick={() => setCursors((old) => old.slice(0, -1))}
          >
            Mais recentes
          </button>
          <span>Página {cursors.length}</span>
          <button
            className="btn-ghost"
            disabled={(history.data?.length ?? 0) <= 20 || history.isFetching}
            onClick={() => {
              if (history.data?.[19]) setCursors((old) => [...old, history.data![19].version]);
            }}
          >
            Mais antigas
          </button>
        </div>
      </Panel>
    </div>
  );
}

function HoursInput({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label htmlFor={id} className="block text-xs font-medium">
      <span className="mb-1 block">{label}</span>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0,00"
        className="input-base"
        aria-invalid={parseServiceHours(value) === null}
      />
    </label>
  );
}

function RsResult({ result }: { result: ReturnType<typeof calculateWeeklyRealization> }) {
  const activeBand = result ? bands.find((band) => band.factor === result.factor) : undefined;
  const factor = activeBand?.display ?? "—";
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <KpiCard label="Ocupação · OM" value={result ? `${number(result.occupation * 100)}%` : "—"} />
      <KpiCard
        label="Realização Semanal · RS"
        value={result ? `${number(result.rs)}%` : "—"}
        tone="primary"
      />
      <KpiCard
        label="Fator contratual"
        value={factor}
        hint="Enquadramento sobre o RS sem arredondamento"
        tone={(result?.factor ?? 0) < 0 ? "warning" : "default"}
      />
      <div className="overflow-x-auto sm:col-span-3">
        <table className="w-full text-xs">
          <thead className="bg-muted">
            <tr>
              <th className="p-2 text-left">Resultado do RS</th>
              <th className="p-2 text-right">Fator contratual</th>
            </tr>
          </thead>
          <tbody>
            {bands.map((b) => (
              <tr
                key={b.label}
                className={activeBand === b ? "bg-accent text-accent-foreground" : "row-zebra"}
              >
                <td className="p-2">
                  {b.label}
                  {activeBand === b ? " · Faixa atual" : ""}
                </td>
                <td className="p-2 text-right">{b.display}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RsSimulator() {
  const [values, setValues] = useState(example);
  const parsed = Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, parseServiceHours(value)]),
  );
  const valid = Object.values(parsed).every((v) => v !== null);
  const actual = valid ? parsed.completed! + parsed.immediate! : null;
  const considered = valid ? Math.min(actual!, parsed.available!) : null;
  const result = valid
    ? calculateWeeklyRealization({
        programmed: parsed.programmed!,
        completed: considered!,
        immediate: 0,
        reference: parsed.available!,
        eep: 0,
      })
    : null;
  const labels = {
    programmed: "HH programado",
    completed: "HH apropriado da programação",
    immediate: "HH apropriado de imediatas",
    available: "HH disponível total (já inclui EEP)",
  };
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Valores ilustrativos de uma especialidade. O teto é semanal.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {(Object.keys(labels) as Array<keyof typeof labels>).map((key) => (
          <HoursInput
            key={key}
            id={"rs-sim-" + key}
            label={labels[key]}
            value={values[key]}
            onChange={(value) => setValues((old) => ({ ...old, [key]: value }))}
          />
        ))}
      </div>
      <p className="text-xs">
        HH considerado: {hours(considered)} · Excesso desconsiderado:{" "}
        {hours(actual === null ? null : actual - considered!)}
      </p>
      <button className="btn-ghost text-xs" onClick={() => setValues(example)}>
        Restaurar exemplo
      </button>
      <RsResult result={result} />
      {!result && (
        <p className="text-sm text-muted-foreground">
          Informe HH válidos, TP maior que zero e disponibilidade positiva.
        </p>
      )}
    </div>
  );
}
