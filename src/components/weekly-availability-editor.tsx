import { useMemo, useRef, useState } from "react";
import { Plus, Save, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Modal, Panel } from "@/components/ui-kit";
import { availabilityWeekDates, createAvailabilityCenter } from "@/lib/new-availability-center";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  filterAvailabilityDraft,
  filteredAvailabilityHours,
} from "@/lib/weekly-availability-filters";
import {
  availabilityKey,
  parseAvailabilityGrid,
  prepareAvailabilityReuse,
  validateAvailability,
  weekCode,
  isRsMonitoringOnly,
  type AvailabilityRow,
  type AvailabilityWeek,
} from "@/lib/weekly-availability";
import { parseServiceHours, serviceHoursInput } from "@/lib/weekly-realization";

export type AvailabilityDocument = {
  rows: AvailabilityRow[];
  source_file_name: string | null;
  version: number;
  updated_at: string;
  updated_by_name: string;
};
type DraftRow = Omit<AvailabilityRow, "hours"> & { hours: string };
const draftRows = (rows: AvailabilityRow[]): DraftRow[] =>
  rows.map((r) => ({ ...r, hours: serviceHoursInput(r.hours) }));

function AvailabilityFilter({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: Array<{ value: string; label: string }>;
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [search, setSearch] = useState("");
  const visible = options.filter((option) =>
    availabilityKey(option.label).includes(availabilityKey(search)),
  );
  return (
    <div className="w-full sm:w-56">
      <span className="mb-1 block text-[11px] font-medium text-muted-foreground">{label}</span>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="input-base flex w-full items-center justify-between text-left text-xs"
            aria-label={`Filtrar ${label}`}
            title={options
              .filter((option) => selected.includes(option.value))
              .map((option) => option.label)
              .join(", ")}
          >
            <span className="truncate">
              {selected.length ? `${selected.length} selecionado(s)` : "Todos"}
            </span>
            <span aria-hidden="true">▾</span>
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-2">
          <input
            className="input-base mb-2 text-xs"
            aria-label={`Buscar ${label}`}
            placeholder="Buscar…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <button
            type="button"
            className="btn-ghost mb-1 w-full text-xs"
            onClick={() => onChange([])}
          >
            Todos / limpar seleção
          </button>
          <div className="max-h-52 overflow-y-auto">
            {visible.map((option) => (
              <label
                key={option.value}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-muted"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(option.value)}
                  onChange={(event) =>
                    onChange(
                      event.target.checked
                        ? [...selected, option.value]
                        : selected.filter((value) => value !== option.value),
                    )
                  }
                />
                {option.label}
              </label>
            ))}
            {!visible.length && (
              <p className="p-2 text-xs text-muted-foreground">Nenhuma opção encontrada.</p>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

export function WeeklyAvailabilityEditor({
  week,
  document: latestDocument,
  previous,
  onSaved,
  readOnly = false,
}: {
  week: AvailabilityWeek & { id: string };
  document: AvailabilityDocument | null;
  previous?: (AvailabilityDocument & { week_code: string }) | null;
  onSaved: () => Promise<unknown>;
  readOnly?: boolean;
}) {
  // Keep the base version with the draft. Background refreshes must not silently
  // discard edits or let an old draft overwrite a newer server version.
  const [document] = useState(latestDocument);
  const [initialReuse] = useState(() =>
    !latestDocument && previous ? prepareAvailabilityReuse(previous.rows, week) : null,
  );
  const [rows, setRows] = useState<DraftRow[]>(() =>
    draftRows(document?.rows ?? initialReuse?.rows ?? []),
  );
  const [source, setSource] = useState(
    document?.source_file_name ??
      (initialReuse && previous
        ? "Base reaproveitada de " + weekCode(previous.week_code)
        : "Preenchimento no NEXO"),
  );
  const [saving, setSaving] = useState(false);
  const [reading, setReading] = useState(false);
  const [paste, setPaste] = useState("");
  const [page, setPage] = useState(0);
  const [centerFilters, setCenterFilters] = useState<string[]>([]);
  const [dateFilters, setDateFilters] = useState<string[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [newCenter, setNewCenter] = useState<null | {
    center: string;
    local: string;
    specialty: string;
    days: Array<{ date: string; hours: string }>;
  }>(null);
  const file = useRef<HTMLInputElement>(null);
  const converted = useMemo(
    () =>
      rows.map((r) => ({
        ...r,
        hours: parseServiceHours(r.hours) ?? NaN,
        week: weekCode(week.code),
      })),
    [rows, week.code],
  );
  const errors = useMemo(() => validateAvailability(converted, week), [converted, week]);
  const total = errors.length ? null : converted.reduce((sum, r) => sum + r.hours, 0);
  const dirty = JSON.stringify(rows) !== JSON.stringify(draftRows(document?.rows ?? []));
  const filtered = useMemo(
    () => filterAvailabilityDraft(rows, centerFilters, dateFilters, editingIndex),
    [rows, centerFilters, dateFilters, editingIndex],
  );
  const filteredHours = filteredAvailabilityHours(filtered.map(({ row }) => row));
  const centerOptions = useMemo(
    () =>
      [...new Set([...rows.map((row) => availabilityKey(row.center)), ...centerFilters])]
        .filter(Boolean)
        .sort()
        .map((value) => ({ value, label: value })),
    [rows, centerFilters],
  );
  const dateOptions = useMemo(
    () =>
      [...new Set([...rows.map((row) => row.date), ...dateFilters])]
        .filter(Boolean)
        .sort()
        .map((value) => ({
          value,
          label: /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.split("-").reverse().join("/") : value,
        })),
    [rows, dateFilters],
  );
  const count = 40,
    currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / count) - 1));

  function clearFilters() {
    setCenterFilters([]);
    setDateFilters([]);
    setPage(0);
    setEditingIndex(null);
  }

  function edit(index: number, key: keyof DraftRow, value: string) {
    setRows((current) => current.map((r, i) => (i === index ? { ...r, [key]: value } : r)));
    setSource("Edição no NEXO");
  }
  function replaceDraft(next: AvailabilityRow[], name: string) {
    if (
      rows.length &&
      !window.confirm(
        "Substituir a tabela em edição? Os dados salvos e as atividades não serão alterados até você salvar a disponibilidade.",
      )
    )
      return;
    setRows(draftRows(next));
    setSource(name);
    clearFilters();
    setPage(0);
    toast.success(`${next.length} linhas conferidas. Revise e salve a disponibilidade.`);
  }
  async function importFile(input: File) {
    if (readOnly) return;
    if (input.size > 10 * 1024 * 1024) {
      toast.error("Use um arquivo de até 10 MB.");
      return;
    }
    setReading(true);
    try {
      const XLSX = await import("xlsx");
      const book = XLSX.read(await input.arrayBuffer(), { type: "array", cellDates: false });
      const names = book.SheetNames.filter((name) =>
        ["DISPONIBILIDADE", "OCUPACAO"].includes(availabilityKey(name)),
      );
      if (names.length > 1)
        throw new Error("Mantenha apenas uma aba chamada Disponibilidade ou Ocupação no arquivo.");
      const name = names[0] ?? (book.SheetNames.length === 1 ? book.SheetNames[0] : null);
      if (!name)
        throw new Error(
          "Nomeie a aba de capacidade como Disponibilidade ou Ocupação. A aba Programação não será alterada.",
        );
      const grid = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[name], {
        header: 1,
        defval: null,
        raw: true,
      });
      replaceDraft(parseAvailabilityGrid(grid, week), input.name);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Não foi possível ler a disponibilidade.",
      );
    } finally {
      setReading(false);
      if (file.current) file.current.value = "";
    }
  }
  async function save() {
    if (readOnly || errors.length || saving || !dirty) return;
    if (
      !window.confirm(
        `Salvar todas as ${rows.length} linhas da semana ${weekCode(week.code)}, inclusive as ocultas pelos filtros? A versão anterior ficará registrada. Não serão alteradas atividades nem apropriações SAP.`,
      )
    )
      return;
    setSaving(true);
    try {
      const { error } = await (supabase as any).rpc("save_weekly_rs_availability", {
        p_week_id: week.id,
        p_rows: converted,
        p_expected_version: document?.version ?? 0,
        p_source_file_name: source,
      });
      if (error) throw error;
      await onSaved();
      toast.success("Disponibilidade semanal salva e RS atualizado.");
    } catch (error) {
      toast.error(
        String(
          (error as { message?: string })?.message ??
            "Não foi possível salvar. Atualize antes de tentar novamente.",
        ),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel title="Disponibilidade semanal · total já inclui EEP">
      {readOnly && (
        <p className="mb-3 text-xs text-muted-foreground">
          Semana fechada: disponibilidade somente para consulta. O administrador deve reabrir o
          fechamento para corrigir e gerar uma nova versão.
        </p>
      )}
      <div className="min-w-0">
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Preencha aqui ou importe a aba Disponibilidade/Ocupação do Excel. O teto é a soma
            semanal por especialidade, juntando todos os dias e locais. Não há acréscimo de EEP nem
            referência fixa de 4.708 HH.
          </p>
          <p className="text-xs text-muted-foreground">
            {document
              ? `Versão ${document.version} · ${document.updated_by_name} · ${new Date(document.updated_at).toLocaleString("pt-BR")} · ${document.source_file_name ?? "Preenchimento no NEXO"}`
              : "Nenhuma disponibilidade cadastrada para esta semana. Não será calculado RS sem essa base."}
          </p>
          {initialReuse && previous && (
            <p className="text-xs text-muted-foreground">
              Rascunho preparado com a última base salva de uma semana anterior (
              {weekCode(previous.week_code)}, por {previous.updated_by_name}). As datas foram
              adaptadas por dia da semana. Revise e salve para usar no RS; nenhuma semana anterior
              será alterada.
              {initialReuse.missing > 0
                ? ` Há ${initialReuse.missing} campos sem referência para esse dia da semana: preencha o HH, inclusive zero quando não houver disponibilidade.`
                : ""}
            </p>
          )}
          {(latestDocument?.version ?? 0) !== (document?.version ?? 0) && (
            <p role="alert" className="text-xs text-destructive">
              Existe uma versão mais recente no banco. Sua edição foi preservada, mas não poderá
              sobrescrever essa versão. Reabra a semana para carregar os dados atuais.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={file}
              type="file"
              accept=".xlsx,.xls"
              className="sr-only"
              aria-label="Importar disponibilidade do Excel"
              onChange={(e) => {
                if (e.target.files?.[0]) void importFile(e.target.files[0]);
              }}
            />
            <button
              className="btn-ghost"
              disabled={readOnly || reading || saving}
              onClick={() => file.current?.click()}
            >
              <Upload className="h-4 w-4" />
              {reading ? "Lendo…" : "Importar disponibilidade"}
            </button>
            {previous && (
              <button
                className="btn-ghost"
                disabled={readOnly || saving || reading}
                onClick={() => {
                  try {
                    const reused = prepareAvailabilityReuse(previous.rows, week);
                    replaceDraft(
                      reused.rows,
                      "Base reaproveitada de " + weekCode(previous.week_code),
                    );
                    if (reused.missing)
                      toast.warning("Preencha os HH dos dias sem referência na base anterior.");
                  } catch (error) {
                    toast.error(
                      error instanceof Error
                        ? error.message
                        : "Não foi possível reutilizar a base.",
                    );
                  }
                }}
              >
                Reutilizar última base · {weekCode(previous.week_code)}
              </button>
            )}
            <button
              type="button"
              className="btn-outline"
              disabled={readOnly || saving || reading || rows.length >= 5000}
              onClick={() => {
                try {
                  setNewCenter({
                    center: "",
                    local: "",
                    specialty: "",
                    days: availabilityWeekDates(week).map((date) => ({ date, hours: "" })),
                  });
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : "Período inválido.");
                }
              }}
            >
              <Plus className="h-4 w-4" /> Novo centro de trabalho
            </button>
            <button
              className="btn-ghost"
              disabled={readOnly || saving || rows.length >= 5000}
              onClick={() => {
                clearFilters();
                setRows((r) => [
                  ...r,
                  {
                    center: "",
                    date: week.start_date,
                    hours: "",
                    week: weekCode(week.code),
                    local: "",
                    specialty: "",
                  },
                ]);
                setPage(Math.floor(rows.length / count));
                setSource("Edição no NEXO");
              }}
            >
              <Plus className="h-4 w-4" />
              Adicionar linha
            </button>
            <button
              className="btn-primary"
              disabled={readOnly || saving || reading || errors.length > 0 || !dirty}
              onClick={() => void save()}
            >
              <Save className="h-4 w-4" />
              {saving ? "Salvando…" : "Salvar disponibilidade"}
            </button>
            <span className="text-xs text-muted-foreground">
              Total da semana: {rows.length} linhas ·{" "}
              {total === null
                ? "Confira as pendências"
                : `${total.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} HH disponíveis`}
            </span>
          </div>
          <details className="rounded-md border border-border p-3">
            <summary className="cursor-pointer text-xs font-medium">
              Colar tabela do Excel / ver colunas esperadas
            </summary>
            <p className="my-2 text-xs text-muted-foreground">
              Copie as seis colunas, incluindo o cabeçalho: CENTRO DE TRABALHO · DATA · HH DIÁRIO
              DISPONÍVEL · SEMANA · LOCAL · ESPECIALIDADE. A semana deve ser {weekCode(week.code)}.
              Aceita zero, mas não HH em branco. Um centro deve pertencer a uma única especialidade
              na semana.
            </p>
            <textarea
              aria-label="Tabela de disponibilidade copiada do Excel"
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              className="input-base min-h-24"
              placeholder={
                "CENTRO DE TRABALHO\tDATA\tHH DIÁRIO DISPONÍVEL\tSEMANA\tLOCAL\tESPECIALIDADE"
              }
            />
            <button
              className="btn-ghost mt-2"
              disabled={readOnly || !paste.trim() || saving}
              onClick={() => {
                try {
                  replaceDraft(
                    parseAvailabilityGrid(
                      paste
                        .trim()
                        .split(/\r?\n/)
                        .map((r) => r.split("\t")),
                      week,
                    ),
                    "Tabela colada do Excel",
                  );
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : "Tabela inválida");
                }
              }}
            >
              Conferir tabela colada
            </button>
          </details>
          <div className="flex flex-wrap items-end gap-3 rounded-md border border-border p-3">
            <AvailabilityFilter
              label="Centro de trabalho"
              options={centerOptions}
              selected={centerFilters}
              onChange={(next) => {
                setCenterFilters(next);
                setPage(0);
                setEditingIndex(null);
              }}
            />
            <AvailabilityFilter
              label="Data"
              options={dateOptions}
              selected={dateFilters}
              onChange={(next) => {
                setDateFilters(next);
                setPage(0);
                setEditingIndex(null);
              }}
            />
            <button
              type="button"
              className="btn-ghost"
              disabled={!centerFilters.length && !dateFilters.length}
              onClick={clearFilters}
            >
              Limpar filtros
            </button>
            <p role="status" className="text-xs text-muted-foreground">
              Recorte: {filtered.length} de {rows.length} linhas ·{" "}
              {filteredHours === null
                ? "HH inválido ou em branco no recorte"
                : `${filteredHours.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} HH disponíveis`}
            </p>
            <p className="w-full text-[11px] text-muted-foreground">
              Os filtros alteram apenas a visualização. Salvar disponibilidade mantém todas as
              linhas da semana, inclusive as ocultas. O histórico abaixo continua mostrando a semana
              completa.
            </p>
          </div>
          {dirty && (
            <p role="status" className="text-xs text-warning-foreground">
              Alterações ainda não salvas. O indicador abaixo continua usando a última
              disponibilidade salva.
            </p>
          )}
          {errors.length > 0 && rows.length > 0 && (
            <div role="alert" className="text-xs text-destructive">
              {errors.slice(0, 4).map((error) => (
                <p key={error}>{error}</p>
              ))}
              {errors.length > 4 && <p>Mais {errors.length - 4} pendências.</p>}
            </div>
          )}
          {rows.length > 0 && (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted">
                    <tr>
                      {[
                        "Centro de trabalho",
                        "Data",
                        "HH disponível",
                        "Semana",
                        "Local",
                        "Especialidade",
                        "",
                      ].map((h, i) => (
                        <th key={i} className="p-2 text-left">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered
                      .slice(currentPage * count, (currentPage + 1) * count)
                      .map(({ row, index }) => {
                        return (
                          <tr
                            key={index}
                            className="row-zebra"
                            onFocusCapture={() => setEditingIndex(index)}
                            onBlurCapture={(event) => {
                              if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                                setEditingIndex(null);
                            }}
                          >
                            {(["center", "date", "hours"] as const).map((key) => (
                              <td key={key} className="p-1">
                                <input
                                  aria-label={`${key === "center" ? "Centro" : key === "date" ? "Data" : "HH disponível"} da linha ${index + 1}`}
                                  type={key === "date" ? "date" : "text"}
                                  inputMode={key === "hours" ? "decimal" : undefined}
                                  min={key === "date" ? week.start_date : undefined}
                                  max={key === "date" ? week.end_date : undefined}
                                  className="input-base min-w-28"
                                  value={row[key]}
                                  disabled={readOnly || saving}
                                  onChange={(e) => edit(index, key, e.target.value)}
                                />
                              </td>
                            ))}
                            <td className="whitespace-nowrap p-2">{weekCode(week.code)}</td>
                            {(["local", "specialty"] as const).map((key) => (
                              <td key={key} className="p-1">
                                <input
                                  aria-label={`${key === "local" ? "Local" : "Especialidade"} da linha ${index + 1}`}
                                  className="input-base min-w-32"
                                  maxLength={160}
                                  value={row[key]}
                                  disabled={readOnly || saving}
                                  onChange={(e) => edit(index, key, e.target.value)}
                                />
                              </td>
                            ))}
                            <td className="p-1">
                              <button
                                className="btn-ghost"
                                aria-label={`Remover linha ${index + 1} da tabela em edição`}
                                disabled={readOnly || saving}
                                onClick={() => {
                                  setEditingIndex(null);
                                  setRows((r) => r.filter((_, i) => i !== index));
                                  setSource("Edição no NEXO");
                                }}
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
                {!filtered.length && (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    Nenhuma linha encontrada para os filtros selecionados. Limpe os filtros para ver
                    a tabela completa.
                  </p>
                )}
              </div>
              <div className="flex items-center justify-between gap-2 text-xs">
                <button
                  className="btn-ghost"
                  disabled={currentPage === 0}
                  onClick={() => setPage(currentPage - 1)}
                >
                  Anterior
                </button>
                <span>
                  Página {currentPage + 1} de {Math.max(1, Math.ceil(filtered.length / count))}
                </span>
                <button
                  className="btn-ghost"
                  disabled={(currentPage + 1) * count >= filtered.length}
                  onClick={() => setPage(currentPage + 1)}
                >
                  Próxima
                </button>
              </div>
            </>
          )}
        </div>
      </div>
      {newCenter && (
        <Modal
          title={`Novo centro · semana ${weekCode(week.code)}`}
          onClose={() => setNewCenter(null)}
          footer={
            <button
              type="button"
              className="btn-primary"
              disabled={readOnly || saving}
              onClick={() => {
                if (readOnly || saving) return;
                try {
                  const added = createAvailabilityCenter(converted, week, {
                    ...newCenter,
                    days: newCenter.days.map((day) => ({
                      ...day,
                      hours: parseServiceHours(day.hours) ?? NaN,
                    })),
                  });
                  clearFilters();
                  setRows((current) => [...current, ...draftRows(added)]);
                  setPage(Math.floor(rows.length / count));
                  setSource("Cadastro de centro no NEXO");
                  setNewCenter(null);
                  toast.success(
                    "Centro adicionado ao rascunho. Salve a disponibilidade para aplicar ao RS e registrar no histórico.",
                  );
                } catch (error) {
                  toast.error(
                    error instanceof Error ? error.message : "Confira os dados do centro.",
                  );
                }
              }}
            >
              Adicionar à disponibilidade
            </button>
          }
        >
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              O centro será cadastrado somente na semana selecionada. Use o mesmo código da
              programação e do SAP para vincular as horas corretamente. A disponibilidade total já
              deve incluir a EEP.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs">
                Código do centro no SAP *
                <input
                  className="input-base mt-1"
                  maxLength={160}
                  value={newCenter.center}
                  onChange={(e) => setNewCenter({ ...newCenter, center: e.target.value })}
                />
              </label>
              <label className="text-xs">
                Local *
                <select
                  className="input-base mt-1"
                  value={newCenter.local}
                  onChange={(e) => setNewCenter({ ...newCenter, local: e.target.value })}
                >
                  <option value="">Selecione</option>
                  <option value="IARI">IARI</option>
                  <option value="ROTINA">ROTINA</option>
                </select>
              </label>
              <label className="text-xs sm:col-span-2">
                Especialidade *
                <input
                  className="input-base mt-1"
                  list="rs-new-center-specialties"
                  maxLength={160}
                  value={newCenter.specialty}
                  onChange={(e) => setNewCenter({ ...newCenter, specialty: e.target.value })}
                  placeholder="Selecione uma existente ou digite uma nova"
                />
                <datalist id="rs-new-center-specialties">
                  {[...new Set(rows.map((row) => row.specialty.trim()).filter(Boolean))]
                    .sort()
                    .map((specialty) => (
                      <option key={specialty} value={specialty} />
                    ))}
                </datalist>
              </label>
            </div>
            <p className="text-xs font-medium">
              {isRsMonitoringOnly(newCenter.specialty, newCenter.center)
                ? "Somente acompanhamento: este centro/especialidade não entra no RS."
                : "Participará do RS após salvar uma especialidade válida e a disponibilidade."}
            </p>
            <fieldset className="space-y-2">
              <legend className="mb-2 text-xs font-medium">
                HH disponível por dia * · informe zero quando não houver carga
              </legend>
              {newCenter.days.map((day, index) => (
                <label key={day.date} className="flex items-center justify-between gap-3 text-xs">
                  {new Date(day.date + "T12:00:00").toLocaleDateString("pt-BR", {
                    weekday: "short",
                    day: "2-digit",
                    month: "2-digit",
                  })}
                  <input
                    aria-label={`HH disponível em ${day.date}`}
                    className="input-base w-32"
                    inputMode="decimal"
                    value={day.hours}
                    onChange={(e) =>
                      setNewCenter({
                        ...newCenter,
                        days: newCenter.days.map((item, i) =>
                          i === index ? { ...item, hours: e.target.value } : item,
                        ),
                      })
                    }
                  />
                </label>
              ))}
            </fieldset>
            <p className="text-xs text-muted-foreground">
              Adicionar prepara as linhas sem alterar o banco. Confirme em Salvar disponibilidade
              para registrar responsável, data e versão. O código deve manter a mesma especialidade
              nos dois locais.
            </p>
          </div>
        </Modal>
      )}
    </Panel>
  );
}
