import { useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { calculateWeeklyRealization, parseServiceHours } from "@/lib/weekly-realization";
import {
  calculateSpecialtyRealization,
  validateAvailability,
  type CenterHours,
} from "@/lib/weekly-availability";
import {
  WeeklyAvailabilityEditor,
  type AvailabilityDocument,
} from "@/components/weekly-availability-editor";
import { EmptyState, KpiCard, PageHeader, Panel } from "@/components/ui-kit";
import {
  WeeklyRsEvidence,
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
};
type RsData = {
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
  { label: "Exatamente 95%", factor: 0, display: "0,00 (0%)" },
  { label: "Acima de 95% até 98%", factor: -0.01, display: "−0,01 (−1%)" },
  { label: "Acima de 98% até 100%", factor: 0, display: "0,00 (0%)" },
  { label: "Acima de 100%", factor: 0.01, display: "+0,01 (+1%)" },
];

export function WeeklyRealizationPanel({
  tabs,
  userId,
  worksiteId,
  worksiteCode,
  mode = "indicator",
}: {
  tabs: ReactNode;
  userId: string;
  worksiteId: string;
  worksiteCode: string;
  mode?: "indicator" | "availability";
}) {
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
        .select("id,label,code,start_date,end_date,is_active")
        .eq("worksite_id", worksiteId)
        .order("start_date", { ascending: false })
        .limit(8);
      if (error) throw error;
      return (data ?? []) as Week[];
    },
    staleTime: 60_000,
  });
  const week =
    weeks.data?.find((w) => w.id === selected) ??
    weeks.data?.find((w) => w.is_active) ??
    weeks.data?.[0];
  return (
    <main className="mx-auto max-w-none px-4 py-6 sm:px-6">
      <PageHeader
        eyebrow="Painel"
        title={
          mode === "availability" ? "Disponibilidade semanal de HH" : "Realização Semanal (RS)"
        }
        description={
          mode === "availability"
            ? "Mantenha a base da semana e consulte quem alterou cada versão."
            : "Cálculo em HH com as apropriações da última carga SAP da semana."
        }
      />
      {tabs}
      <div className="mb-4 max-w-md">
        <label
          htmlFor="rs-week"
          className="mb-1 block text-[11px] font-medium uppercase text-muted-foreground"
        >
          Semana · {worksiteCode}
        </label>
        <select
          id="rs-week"
          value={week?.id ?? ""}
          onChange={(e) => {
            setSelected(e.target.value);
            const url = new URL(window.location.href);
            url.searchParams.set("week", e.target.value);
            window.history.replaceState({}, "", url);
          }}
          className="input-base"
        >
          {!week && <option value="">{weeks.isLoading ? "Carregando…" : "Nenhuma semana"}</option>}
          {weeks.data?.map((w) => (
            <option key={w.id} value={w.id}>
              {w.label} · {date(w.start_date)} a {date(w.end_date)}
              {w.is_active ? " · Operacional" : ""}
            </option>
          ))}
        </select>
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
      ) : week ? (
        <WeeklyResults
          key={week.id}
          week={week}
          userId={userId}
          worksiteId={worksiteId}
          worksiteCode={worksiteCode}
          mode={mode}
        />
      ) : (
        !weeks.isLoading && <EmptyState title="Nenhuma semana disponível nesta obra" />
      )}
    </main>
  );
}

function WeeklyResults({
  week,
  userId,
  worksiteId,
  worksiteCode,
  mode,
}: {
  week: Week;
  userId: string;
  worksiteId: string;
  worksiteCode: string;
  mode: "indicator" | "availability";
}) {
  const qc = useQueryClient();
  const [local, setLocal] = useState(() => {
    const value =
      typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("local");
    return value === "IARI" || value === "ROTINA" ? value : "";
  });
  const data = useQuery({
    queryKey: ["weekly-rs", userId, worksiteId, week.id, mode, local],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc(
        mode === "availability" ? "get_weekly_realization" : "get_weekly_rs_analysis",
        mode === "availability"
          ? { p_week_id: week.id }
          : { p_week_id: week.id, p_local: local || null },
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
    <RsContent
      key={week.id + local}
      week={week}
      data={data.data}
      userId={userId}
      worksiteId={worksiteId}
      local={local}
      onLocalChange={(next) => {
        setLocal(next);
        const url = new URL(window.location.href);
        if (next) url.searchParams.set("local", next);
        else url.searchParams.delete("local");
        window.history.replaceState({}, "", url);
      }}
      worksiteCode={worksiteCode}
      refreshing={data.isFetching}
      refresh={() => {
        void data.refetch();
        void qc.invalidateQueries({ queryKey: ["weekly-rs-pending", userId, worksiteId, week.id] });
      }}
      onSaved={() => qc.invalidateQueries({ queryKey: ["weekly-rs", userId, worksiteId, week.id] })}
    />
  );
}

function RsContent({
  week,
  data,
  refreshing,
  refresh,
  onSaved,
  userId,
  worksiteId,
  local,
  onLocalChange,
}: {
  week: Week;
  data: RsData;
  worksiteCode: string;
  refreshing: boolean;
  refresh: () => void;
  onSaved: () => Promise<unknown>;
  userId: string;
  worksiteId: string;
  local: string;
  onLocalChange: (value: string) => void;
}) {
  const errors = useMemo(
    () => (data.availability ? validateAvailability(data.availability.rows, week) : []),
    [data.availability, week],
  );
  const calculation = useMemo(
    () =>
      calculateSpecialtyRealization(
        data.availability?.rows ?? [],
        data.centers ?? [],
        !!data.source,
        local,
      ),
    [data.availability, data.centers, data.source, local],
  );
  const { totals, rows, unmapped } = calculation;
  const result =
    data.invalidPlannedHours === 0 && !errors.length && (!local || !data.unresolvedLocal)
      ? calculation.result
      : null;
  const hasSource = !!data.source;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-md border border-border bg-card p-3">
        <label className="w-full text-xs sm:w-60">
          Local da realização semanal
          <select
            className="input-base mt-1"
            value={local}
            onChange={(e) => onLocalChange(e.target.value)}
          >
            <option value="">IARI + ROTINA · todos os locais</option>
            <option value="IARI">IARI</option>
            <option value="ROTINA">ROTINA</option>
          </select>
        </label>
        <p className="max-w-2xl text-xs text-muted-foreground">
          O recorte aplica-se ao RS, aos HH, às especialidades e às pendências abaixo. Alpinismo e
          os centros INSPPINT, TECNIEND, TECNINSC e HIDROJATO ficam somente para acompanhamento,
          fora do cálculo. Em Todos, o teto considera a especialidade na semana inteira dos dois
          locais; o RS geral não é a média dos RS de IARI e ROTINA.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {data.source
            ? "SAP atualizado em " +
              new Date(data.source.imported_at).toLocaleString("pt-BR") +
              " · " +
              (data.source.imported_by_name ?? "Responsável não informado") +
              " · " +
              data.source.row_count +
              " linhas"
            : "Sem carga SAP detalhada para esta semana"}
        </span>
        <button type="button" className="btn-ghost text-xs" disabled={refreshing} onClick={refresh}>
          <RefreshCw className="h-3.5 w-3.5" />
          {refreshing ? "Atualizando…" : "Atualizar"}
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        {data.availability
          ? "Disponibilidade: versão " +
            data.availability.version +
            " · " +
            data.availability.updated_by_name +
            " · " +
            new Date(data.availability.updated_at).toLocaleString("pt-BR")
          : "Cadastre a disponibilidade desta semana na aba Disponibilidade HH para calcular o RS."}{" "}
        <a
          className="font-medium text-primary underline"
          href={"?view=disponibilidade-hh&week=" + encodeURIComponent(week.id)}
        >
          Editar disponibilidade e ver histórico
        </a>
      </p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="TP · HH programado para RS"
          value={data.availability ? hours(totals.programmed) : "—"}
          hint={data.pendingSummary.programmed + " tarefas elegíveis ao RS"}
        />
        <KpiCard
          label="HH disponível para RS"
          value={data.availability ? hours(totals.available) : "—"}
          hint="Somente elegíveis ao RS · EEP incluída"
        />
        <KpiCard
          label="HH apropriado elegível"
          value={hours(hasSource && data.availability ? totals.completed + totals.immediate : null)}
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
      {!hasSource && (
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
          Há {data.unresolvedLocal} apropriações elegíveis sem local identificável na carga.{" "}
          {local
            ? "O RS do recorte ficará indisponível até resolver o vínculo, para não omitir HH."
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
      <RsSpecialtyBars rows={rows} hasSap={hasSource} />
      {calculation.monitoring.length > 0 && (
        <Panel title="Fora do RS · somente acompanhamento">
          <p className="mb-2 text-xs text-muted-foreground">
            Não participa do numerador nem do denominador do RS e da ocupação. As atividades
            continuam disponíveis para acompanhamento.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <KpiCard
              label="HH programado fora do RS"
              value={hours(calculation.monitoring.reduce((s, r) => s + r.programmed, 0))}
            />
            <KpiCard
              label="HH SAP fora do RS"
              value={
                hasSource
                  ? hours(calculation.monitoring.reduce((s, r) => s + r.completed + r.immediate, 0))
                  : "—"
              }
            />
          </div>
        </Panel>
      )}
      {data.availability ? (
        <WeeklyRsEvidence
          key={week.id + local}
          weekId={week.id}
          userId={userId}
          worksiteId={worksiteId}
          local={local}
          summary={data.pendingSummary}
          reasons={data.reasons}
          hasSap={hasSource}
        />
      ) : (
        <Panel title="Conferência da programação">
          <p className="text-sm text-muted-foreground">
            Cadastre a disponibilidade da semana para vincular os centros às especialidades e
            separar os grupos de acompanhamento antes de listar as pendências do RS.
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
      {data.availability && (
        <Panel title="Realização por especialidade · teto semanal">
          <p className="mb-3 text-xs text-muted-foreground">
            O limite é aplicado à soma de TCpr + TCoi de cada especialidade na semana inteira,
            dentro do local selecionado. O excesso de uma especialidade não compensa outra. Valores
            em HH.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full whitespace-nowrap text-xs">
              <thead className="bg-muted">
                <tr>
                  {[
                    "Especialidade",
                    "Disponível",
                    "Programado",
                    "OM",
                    "TCpr SAP",
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
                {rows.map((r) => (
                  <tr key={`${r.specialty}:${r.includedInRs}`} className="row-zebra">
                    <td className="p-2 font-medium">
                      {r.specialty}
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
                    <td className="p-2 text-right">
                      {r.occupation === null ? "—" : number(r.occupation * 100) + "%"}
                    </td>
                    <td className="p-2 text-right">{hasSource ? number(r.completed) : "—"}</td>
                    <td className="p-2 text-right">{hasSource ? number(r.immediate) : "—"}</td>
                    <td className="p-2 text-right">{hasSource ? number(r.considered) : "—"}</td>
                    <td className="p-2 text-right">{hasSource ? number(r.excess) : "—"}</td>
                    <td className="p-2 text-right">
                      {!r.includedInRs
                        ? "Acompanhamento"
                        : r.rs === null
                          ? "—"
                          : number(r.rs) + "%"}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-border font-semibold">
                <tr>
                  <td className="p-2">
                    Total elegível ao RS{unmapped.length ? " · vínculo incompleto" : ""}
                  </td>
                  <td className="p-2 text-right">{number(totals.available)}</td>
                  <td className="p-2 text-right">{number(totals.programmed)}</td>
                  <td className="p-2 text-right">
                    {result ? number(result.occupation * 100) + "%" : "—"}
                  </td>
                  <td className="p-2 text-right">{hasSource ? number(totals.completed) : "—"}</td>
                  <td className="p-2 text-right">{hasSource ? number(totals.immediate) : "—"}</td>
                  <td className="p-2 text-right">{result ? number(totals.considered) : "—"}</td>
                  <td className="p-2 text-right">{result ? number(totals.excess) : "—"}</td>
                  <td className="p-2 text-right">{result ? number(result.rs) + "%" : "—"}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            O geral usa os totais ponderados pela disponibilidade, não a média simples dos
            percentuais. Especialidades com disponibilidade zero têm RS indefinido e HH considerado
            igual a zero.
          </p>
        </Panel>
      )}
      <Panel title="Memória de cálculo">
        <div className="space-y-2 text-xs text-muted-foreground">
          {data.source && <p className="break-words">Fonte SAP: {data.source.source_file_name}</p>}
          <p className="font-mono text-foreground">
            HH considerado da especialidade = menor entre (TCpr + TCoi) e HH disponível semanal
          </p>
          <p className="font-mono text-foreground">
            OM = menor entre (HH programado ÷ HH disponível total) e 100%
          </p>
          <p className="font-mono text-foreground">
            RS geral = (Σ HH considerado por especialidade ÷ TP geral) × OM geral × 100
          </p>
          <p>
            O filtro de local aplica-se a todos os componentes. Alpinismo (incluindo
            Alpinista/Alpinistas) e os centros INSPPINT, TECNIEND, TECNINSC e HIDROJATO ficam
            excluídos dos HH programados, disponíveis e apropriados usados no RS. Sua visualização é
            apenas de acompanhamento.
          </p>
          <p>
            Aplicamos RS = ((TCpr + TCoi) ÷ TP) × OM × 100, após aplicar o teto semanal por
            especialidade. OM é limitado a 100% em cada especialidade e no geral; os HH reais são
            preservados. Não há teto diário. A tabela já inclui EEP: não somamos horas adicionais
            nem usamos referência fixa.
          </p>
          {result && (
            <p className="text-sm text-foreground">
              RS = ({number(totals.considered)} ÷ {number(totals.programmed)}) ×{" "}
              {number(result.occupation * 100)}% × 100 ≈ <strong>{number(result.rs)}%</strong>. O
              cálculo usa valores sem arredondamento.
            </p>
          )}
          <p>
            TCpr considera cada linha SAP uma única vez: confirmação presente na programação em dia
            coberto pelo período real SAP. Confirmações repetidas em vários dias não multiplicam a
            apropriação.
          </p>
          <p>
            TCoi inclui somente apropriações externas à programação com código 2. Código 1 (
            {hours(data.unprogrammed)}) não entra no RS. Somente linhas confirmadas com HH positivo
            da última carga SAP detalhada são consideradas; estornos devem ser conciliados na
            origem.
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
            referência contratual. Exatamente 95% tem fator contratual 0,00.
          </p>
        </div>
      </Panel>
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
                  ].map((label) => (
                    <th key={label} className="whitespace-nowrap p-2 text-left">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.data.slice(0, 20).map((entry) => (
                  <tr key={entry.version} className="row-zebra">
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
                  </tr>
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
  const activeBand = result
    ? result.at95
      ? bands[1]
      : bands.find((band, index) => index !== 1 && band.factor === result.factor)
    : undefined;
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
        hint={result?.at95 ? "RS = 95%: fator 0,00" : "Enquadramento sobre o RS sem arredondamento"}
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
