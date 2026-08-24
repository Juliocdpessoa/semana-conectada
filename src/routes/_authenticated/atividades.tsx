import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useRef, useState } from "react";
import type { ClipboardEvent, DragEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { updateActivity, bulkUpdateActivities, bulkUpdateActivityPlanningFields } from "@/lib/activities.functions";
import { toast } from "sonner";
import {
  Search,
  X,
  Zap,
  CheckCircle2,
  AlertTriangle,
  Clock,
  RefreshCw,
  ListChecks,
  Percent,
  ChevronDown,
} from "lucide-react";
import type { SessionInfo } from "./route";
import { PageHeader, KpiCard, Toolbar, EmptyState, Skeleton, StatusPill, Modal, Field } from "@/components/ui-kit";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export const Route = createFileRoute("/_authenticated/atividades")({
  component: AtividadesPage,
});

type ActivityRow = {
  id: string;
  version: number;
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
  week_id: string;
  planning_data: Record<string, unknown> | null;
  pbs: string | null;
  pt_number: string | null;
  release_type: "PT" | "PTT" | "ATRE" | "OFICINAS" | null;
  d1_date: string | null;
};

const STATUSES = ["Sem apontamento", "EXECUTADO", "NÃO EXECUTADO"];
const JUSTIFICATIONS = [
  "01 - ATRASO NA EXECUÇÃO",
  "02 - ATRASO NA LIBERAÇÃO OPERACIONAL",
  "03 - ATRASO NA LIBERAÇÃO DE SMS (RAS)",
  "04 - NÃO LIBERADO PELA OPERAÇÃO",
  "05 - NÃO LIBERADO PELO SMS",
  "06 - FALHA NA DOCUMENTAÇÃO OPERACIONAL (ARO, ADTCP)",
  "07 - FALHA DE LIBERAÇÃO OPERACIONAL (FALTOU APLICAR LIBRA)",
  "08 - ATENDIMENTO DE ORDEM IMEDIATA",
  "09 - QUANTIDADE DE EXECUTANTES PROGRAMADOS DIFERENTE DO DISPONÍVEL",
  "10 - ATRASO NA ENTREGA DE MATERIAL",
  "11 - MUDANÇA DE ESCOPO DA INTERVENÇÃO",
  "12 - SERVIÇO CANCELADO",
  "13 - CAUSAS EXTERNAS",
  "14 - CONDIÇÕES CLIMÁTICAS",
  "15 - PROGRAMAÇÃO INDEVIDA",
  "16 - FALHA NO PLANEJAMENTO",
  "17 - TAREFA ELIMINADA EQUIVOCADAMENTE DO SAP",
  "18 - TAREFA ANTECESSORA NÃO EXECUTADA - EQUIPE DO ED",
  "19 - TAREFA ANTECESSORA NÃO EXECUTADA - EQUIPE DO EE",
  "20 - TAREFA ANTECESSORA NÃO EXECUTADA - EQUIPE DA EI",
  "21 - EVENTOS EXTRAORDINÁRIOS (ASSEMBLÉIAS, MOVIMENTAÇÃO SINDICAL, ETC)",
  "22 - ATIVIDADE EXECUTADA ANTERIORMENTE",
  "23 - PT EMITIDA COM DIVERGENCIA",
  "24 - PT NÃO FOI EMITIDA E/OU NÃO ESTÁ NA CCL",
  "25 - NÃO CONSTA NA PROGRAMAÇÃO DIÁRIA",
  "26 - MÃO DE OBRA DESVIADA PARA SERVIÇOS EXTRA PROGRAMADOS",
  "27 - HH PROGRAMADO SUPERIOR AO HH DISPONÍVEL",
  "28 - PENDENCIA DE MATERIAL",
  "29 - OUTROS TIPOS DE PENDENCIAS",
];
const REQUIRES_JUSTIFICATION = new Set(["NÃO EXECUTADO"]);
const IMMEDIATE_JUSTIFICATION = "08 - ATENDIMENTO DE ORDEM IMEDIATA";
const RELEASE_TYPES = ["PT", "PTT", "ATRE", "OFICINAS"] as const;
type PlanningField = "pbs" | "pt_number" | "release_type" | "d1_date";
type PlanningDraft = Record<PlanningField, string>;
const PLANNING_FIELDS: PlanningField[] = ["pbs", "pt_number", "release_type", "d1_date"];

const GER_BY_OPERATIONAL_AREA: Record<string, string> = {
  "50": "TE",
  "20": "CRA",
  "40": "HDT",
  "30": "DE",
  "10": "CQG",
  "60": "UT",
  "70": "SMS",
  "4": "OFICINAS",
  "6": "INFRA",
  LAB: "LAB",
  PRO: "UTE",
  MAN: "UTE",
  SMS: "UTE",
};

function normalizeKey(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim().toLocaleUpperCase("pt-BR");
}

function isNumericOnly(value: string): boolean {
  return /^[\d\s.,]+$/.test(value.trim());
}

/** Área/gerência textual (CAT, DEC, TUT…). Ignora números de área operacional. */
function areaLabel(r: { area: string | null; planning_data: Record<string, unknown> | null }): string | null {
  const candidates = [fmtPlan(r.planning_data, "Gerência"), r.area];
  for (const c of candidates) {
    const v = c?.replace(/\s+/g, " ").trim();
    if (v && !isNumericOnly(v)) return v;
  }
  return null;
}

/** Centro de trabalho (CenTrab / CENTRO_DE_TRABALHO). */
function workCenterLabel(r: { planning_data: Record<string, unknown> | null }): string | null {
  const v =
    fmtPlan(r.planning_data, "CenTrab") ??
    fmtPlan(r.planning_data, "CENTRO_DE_TRABALHO") ??
    fmtPlan(r.planning_data, "Centro de trabalho");
  const clean = v?.replace(/\s+/g, " ").trim();
  return clean ? clean : null;
}

function operationalAreaValue(r: { planning_data: Record<string, unknown> | null }): string | null {
  return (
    fmtPlan(r.planning_data, "Área op") ?? fmtPlan(r.planning_data, "Área Op") ?? fmtPlan(r.planning_data, "Area Op")
  );
}

function gerLabel(r: { planning_data: Record<string, unknown> | null }): string {
  return GER_BY_OPERATIONAL_AREA[normalizeKey(operationalAreaValue(r))] ?? "Não mapeado";
}

/** Seleção múltipla pesquisável (mobile-friendly, acessível). */
function WorkCenterMultiSelect({
  options,
  selected,
  onChange,
  allLabel = "Todos os centros de trabalho",
  ariaLabel = "Filtrar por centro de trabalho",
  searchPlaceholder = "Buscar centro...",
  selectedPlural = "itens selecionados",
}: {
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  allLabel?: string;
  ariaLabel?: string;
  searchPlaceholder?: string;
  selectedPlural?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.toLowerCase().includes(q)) : options;
  }, [options, query]);

  const label =
    selected.length === 0 ? allLabel : selected.length === 1 ? selected[0] : `${selected.length} ${selectedPlural}`;

  function toggle(option: string) {
    const key = normalizeKey(option);
    const exists = selected.some((s) => normalizeKey(s) === key);
    onChange(exists ? selected.filter((s) => normalizeKey(s) !== key) : [...selected, option]);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          className="input-base flex w-full items-center justify-between gap-2 py-2 text-left text-xs sm:w-auto sm:min-w-[190px]"
        >
          <span className="truncate">{label}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(20rem,calc(100vw-2rem))] p-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {options.length > 8 && (
          <div className="border-b p-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              className="input-base w-full py-1.5 text-xs"
            />
          </div>
        )}
        <div className="max-h-64 overflow-y-auto overscroll-contain p-1">
          {visible.length === 0 && <p className="px-2 py-3 text-xs text-muted-foreground">Nenhum centro encontrado.</p>}
          {visible.map((o) => {
            const checked = selected.some((s) => normalizeKey(s) === normalizeKey(o));
            return (
              <label
                key={o}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-2 text-xs hover:bg-muted"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(o)}
                  className="h-4 w-4 shrink-0 accent-primary"
                />
                <span className="truncate">{o}</span>
              </label>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t p-2">
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-ghost py-1 text-[11px]"
              onClick={() => {
                const merged = [...selected];
                for (const o of visible) {
                  if (!merged.some((s) => normalizeKey(s) === normalizeKey(o))) merged.push(o);
                }
                onChange(merged);
              }}
            >
              Selecionar todos os visíveis
            </button>
            <button type="button" className="btn-ghost py-1 text-[11px]" onClick={() => onChange([])}>
              Limpar
            </button>
          </div>
          <button type="button" className="btn-primary py-1 text-[11px]" onClick={() => setOpen(false)}>
            Aplicar
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function PlanningGridCell({
  value,
  field,
  editable,
  onChange,
  onCommit,
  onPaste,
  onDragStart,
  onDrop,
}: {
  value: string;
  field: PlanningField;
  editable: boolean;
  onChange: (value: string) => void;
  onCommit: (value: string) => void;
  onPaste: (event: ClipboardEvent<HTMLElement>) => void;
  onDragStart: () => void;
  onDrop: () => void;
}) {
  if (!editable) {
    return field === "d1_date" ? <>{formatDate(value || null)}</> : <>{value || "—"}</>;
  }

  const sharedClass =
    "h-7 w-full min-w-[92px] rounded border border-transparent bg-transparent px-1.5 text-[11px] outline-none transition-colors hover:border-border hover:bg-background focus:border-primary focus:bg-background focus:ring-1 focus:ring-primary/30";

  return (
    <div
      className="group/cell relative min-w-[96px]"
      onPaste={onPaste}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        onDrop();
      }}
    >
      {field === "release_type" ? (
        <select
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
            onCommit(event.target.value);
          }}
          className={sharedClass}
          aria-label="Tipo de liberação"
        >
          <option value="">—</option>
          {RELEASE_TYPES.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : (
        <input
          type={field === "d1_date" ? "date" : "text"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={(event) => onCommit(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          className={sharedClass}
          aria-label={field === "pbs" ? "PBS" : field === "pt_number" ? "Número da PT" : "Data D-1"}
        />
      )}
      <span
        draggable
        title="Arraste para preencher as células abaixo"
        onDragStart={(event: DragEvent<HTMLSpanElement>) => {
          event.dataTransfer.effectAllowed = "copy";
          onDragStart();
        }}
        className="absolute -bottom-0.5 -right-0.5 hidden h-2.5 w-2.5 cursor-crosshair rounded-sm border border-background bg-primary group-hover/cell:block"
      />
    </div>
  );
}

function AtividadesPage() {
  const { session } = Route.useRouteContext() as { session: SessionInfo };
  const canEditPlanningFields = session.roles.includes("planning");
  const qc = useQueryClient();
  const savePlanningFields = useServerFn(bulkUpdateActivityPlanningFields);
  const [planningDrafts, setPlanningDrafts] = useState<Record<string, Partial<PlanningDraft>>>({});
  const dragSource = useRef<{ rowIndex: number; field: PlanningField } | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [areaFilter, setAreaFilter] = useState<string>("");
  const [workCenterFilters, setWorkCenterFilters] = useState<string[]>([]);
  const [gerFilters, setGerFilters] = useState<string[]>([]);
  const [dateFilter, setDateFilter] = useState<string>("");
  const [originFilter, setOriginFilter] = useState<"" | "programmed" | "immediate">("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [editing, setEditing] = useState<ActivityRow | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [planningFieldsOpen, setPlanningFieldsOpen] = useState(false);
  const [page, setPage] = useState(0);
  const pageSize = 50;

  const activeWeek = useQuery({
    queryKey: ["active-week"],
    queryFn: async () => {
      const { data, error } = await supabase.from("weeks").select("*").eq("is_active", true).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const activities = useQuery({
    queryKey: ["activities", activeWeek.data?.id],
    enabled: !!activeWeek.data?.id,
    queryFn: async () => {
      const chunk = 1000;
      const all: any[] = [];
      for (let from = 0; ; from += chunk) {
        const { data, error } = await supabase
          .from("activities")
          .select("*")
          .eq("week_id", activeWeek.data!.id)
          .order("scheduled_date", { ascending: true })
          .order("order_number", { ascending: true })
          .range(from, from + chunk - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        all.push(...data);
        if (data.length < chunk) break;
      }
      return all as ActivityRow[];
    },
  });

  const workCenterKeys = useMemo(() => new Set(workCenterFilters.map((c) => normalizeKey(c))), [workCenterFilters]);

  const gerKeys = useMemo(() => new Set(gerFilters.map(normalizeKey)), [gerFilters]);

  const filtered = useMemo(() => {
    const rows = activities.data ?? [];
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter && r.status !== statusFilter) return false;
      if (areaFilter && normalizeKey(areaLabel(r)) !== normalizeKey(areaFilter)) return false;
      if (workCenterKeys.size > 0 && !workCenterKeys.has(normalizeKey(workCenterLabel(r)))) return false;
      if (gerKeys.size > 0 && !gerKeys.has(normalizeKey(gerLabel(r)))) return false;
      if (dateFilter && r.scheduled_date !== dateFilter) return false;
      if (originFilter === "immediate" && !r.is_immediate) return false;
      if (originFilter === "programmed" && r.is_immediate) return false;
      if (!q) return true;
      return (
        r.order_number?.toLowerCase().includes(q) ||
        r.note_number?.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q) ||
        r.area?.toLowerCase().includes(q) ||
        r.specialty?.toLowerCase().includes(q) ||
        fmtPlan(r.planning_data, "Op")?.toLowerCase().includes(q) ||
        fmtPlan(r.planning_data, "Subop")?.toLowerCase().includes(q) ||
        r.reported_by_name?.toLowerCase().includes(q)
      );
    });
  }, [activities.data, search, statusFilter, areaFilter, workCenterKeys, gerKeys, dateFilter, originFilter]);

  const paged = filtered.slice(page * pageSize, (page + 1) * pageSize);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));

  // Todos os indicadores usam o conjunto já filtrado (busca, status, área, centro, tipo e data)
  const kpis = useMemo(() => {
    const rows = filtered;
    const total = rows.length;
    const concluded = rows.filter((r) => r.status === "EXECUTADO").length;
    const impeded = rows.filter((r) => r.status === "NÃO EXECUTADO").length;
    const noReport = rows.filter((r) => r.status === "Sem apontamento").length;
    const immediates = rows.filter((r) => r.is_immediate).length;
    const percent = total > 0 ? Math.round((concluded / total) * 100) : 0;
    return { total, concluded, impeded, noReport, immediates, percent };
  }, [filtered]);

  const areas = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of activities.data ?? []) {
      const label = areaLabel(r);
      if (!label) continue;
      const key = normalizeKey(label);
      if (!key || isNumericOnly(label)) continue;
      if (!map.has(key)) map.set(key, label);
    }
    return Array.from(map.values()).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [activities.data]);

  const gerOptions = useMemo(() => {
    const values = new Set((activities.data ?? []).map(gerLabel));
    return Array.from(values).sort((a, b) => {
      if (a === "Não mapeado") return 1;
      if (b === "Não mapeado") return -1;
      return a.localeCompare(b, "pt-BR");
    });
  }, [activities.data]);

  // Centros de trabalho dependentes da área selecionada
  const workCenters = useMemo(() => {
    const map = new Map<string, string>();
    const areaKey = normalizeKey(areaFilter);
    for (const r of activities.data ?? []) {
      if (areaKey && normalizeKey(areaLabel(r)) !== areaKey) continue;
      const label = workCenterLabel(r);
      if (!label) continue;
      const key = normalizeKey(label);
      if (!key) continue;
      if (!map.has(key)) map.set(key, label);
    }
    return Array.from(map.values()).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [activities.data, areaFilter]);

  const activeFilters = [
    search,
    statusFilter,
    areaFilter,
    workCenterFilters.length > 0 ? "1" : "",
    gerFilters.length > 0 ? "1" : "",
    dateFilter,
    originFilter,
  ].filter(Boolean).length;

  function clearFilters() {
    setSearch("");
    setStatusFilter("");
    setAreaFilter("");
    setWorkCenterFilters([]);
    setGerFilters([]);
    setDateFilter("");
    setOriginFilter("");
    setPage(0);
  }

  function planningValue(row: ActivityRow, field: PlanningField): string {
    const draft = planningDrafts[row.id];
    if (draft && Object.prototype.hasOwnProperty.call(draft, field)) return draft[field] ?? "";
    const value = row[field];
    return value == null ? "" : String(value);
  }

  function setPlanningValue(rowId: string, field: PlanningField, value: string) {
    setPlanningDrafts((previous) => ({
      ...previous,
      [rowId]: { ...previous[rowId], [field]: value },
    }));
  }

  function normalizeGridValue(field: PlanningField, value: string): string {
    const clean = value.trim();
    if (field === "release_type") {
      const normalized = clean.toLocaleUpperCase("pt-BR");
      if (normalized && !RELEASE_TYPES.includes(normalized as (typeof RELEASE_TYPES)[number])) {
        throw new Error(`Tipo de liberação inválido: "${clean}". Use PT, PTT, ATRE ou OFICINAS.`);
      }
      return normalized;
    }
    if (field === "d1_date" && clean) {
      const br = clean.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      const iso = br
        ? `${br[3]}-${String(Number(br[2])).padStart(2, "0")}-${String(Number(br[1])).padStart(2, "0")}`
        : clean;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw new Error(`Data D-1 inválida: "${clean}".`);
      return iso;
    }
    return clean;
  }

  function planningPayload(row: ActivityRow, overrides: Partial<PlanningDraft> = {}) {
    const current = {
      pbs: planningValue(row, "pbs"),
      pt_number: planningValue(row, "pt_number"),
      release_type: planningValue(row, "release_type"),
      d1_date: planningValue(row, "d1_date"),
      ...overrides,
    };
    return {
      id: row.id,
      pbs: current.pbs || null,
      ptNumber: current.pt_number || null,
      releaseType: (current.release_type || null) as (typeof RELEASE_TYPES)[number] | null,
      d1Date: current.d1_date || null,
    };
  }

  async function persistPlanningRows(payload: ReturnType<typeof planningPayload>[], showSuccess = false) {
    try {
      const result = await savePlanningFields({ data: { rows: payload } });
      if (!result.ok) throw new Error(result.error);
      if (showSuccess) toast.success(`${result.count} atividade(s) preenchida(s).`);
      qc.invalidateQueries({ queryKey: ["activities"] });
    } catch (error: any) {
      toast.error(error?.message ?? "Não foi possível salvar os campos de liberação.");
    }
  }

  async function commitPlanningCell(row: ActivityRow, field: PlanningField, rawValue: string) {
    try {
      const value = normalizeGridValue(field, rawValue);
      setPlanningValue(row.id, field, value);
      await persistPlanningRows([planningPayload(row, { [field]: value })]);
    } catch (error: any) {
      toast.error(error?.message ?? "Valor inválido.");
    }
  }

  async function pastePlanningGrid(event: ClipboardEvent<HTMLElement>, startRow: number, startField: PlanningField) {
    if (!canEditPlanningFields) return;
    event.preventDefault();
    try {
      const matrix = event.clipboardData
        .getData("text/plain")
        .replace(/\r/g, "")
        .replace(/\n$/, "")
        .split("\n")
        .map((line) => line.split("\t"));
      const startColumn = PLANNING_FIELDS.indexOf(startField);
      const updates = new Map<string, { row: ActivityRow; values: Partial<PlanningDraft> }>();

      matrix.forEach((cells, rowOffset) => {
        const row = paged[startRow + rowOffset];
        if (!row) return;
        const values: Partial<PlanningDraft> = {};
        cells.forEach((cell, columnOffset) => {
          const field = PLANNING_FIELDS[startColumn + columnOffset];
          if (field) values[field] = normalizeGridValue(field, cell);
        });
        if (Object.keys(values).length) updates.set(row.id, { row, values });
      });
      if (!updates.size) return;

      setPlanningDrafts((previous) => {
        const next = { ...previous };
        for (const [id, update] of updates) next[id] = { ...next[id], ...update.values };
        return next;
      });
      await persistPlanningRows(
        Array.from(updates.values()).map(({ row, values }) => planningPayload(row, values)),
        true,
      );
    } catch (error: any) {
      toast.error(error?.message ?? "Não foi possível colar os dados.");
    }
  }

  async function fillPlanningByDrag(targetRow: number, targetField: PlanningField) {
    const source = dragSource.current;
    dragSource.current = null;
    if (!source || source.field !== targetField || source.rowIndex === targetRow) return;
    const sourceRow = paged[source.rowIndex];
    if (!sourceRow) return;
    const value = planningValue(sourceRow, targetField);
    const first = Math.min(source.rowIndex, targetRow);
    const last = Math.max(source.rowIndex, targetRow);
    const rows = paged.slice(first, last + 1);

    setPlanningDrafts((previous) => {
      const next = { ...previous };
      for (const row of rows) next[row.id] = { ...next[row.id], [targetField]: value };
      return next;
    });
    await persistPlanningRows(
      rows.map((row) => planningPayload(row, { [targetField]: value })),
      true,
    );
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  function toggleAll() {
    if (selected.size === paged.length) setSelected(new Set());
    else setSelected(new Set(paged.map((r) => r.id)));
  }

  return (
    <main className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6">
      <PageHeader
        eyebrow="Semana ativa"
        title={activeWeek.data?.label ?? "—"}
        description={
          activeWeek.data
            ? `${formatDate(activeWeek.data.start_date)} a ${formatDate(activeWeek.data.end_date)} · ${kpis.total} atividades programadas`
            : "Nenhuma semana ativa."
        }
        actions={
          <div className="flex items-center gap-2">
            <div className="hidden text-right sm:block">
              <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Conclusão</div>
              <div className="text-lg font-semibold leading-none text-foreground tabular">{kpis.percent}%</div>
            </div>
            <button onClick={() => activities.refetch()} className="btn-ghost" title="Recarregar">
              <RefreshCw className="h-3.5 w-3.5" /> Atualizar
            </button>
          </div>
        }
      />

      {/* Barra de progresso semanal */}
      <div
        className="mb-5 h-1 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={kpis.percent}
      >
        <div className="h-full bg-success transition-all" style={{ width: `${kpis.percent}%` }} />
      </div>

      {/* KPIs */}
      <section className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard label="Programadas" value={kpis.total} icon={<ListChecks className="h-3.5 w-3.5" />} />
        <KpiCard
          label="Executadas"
          value={kpis.concluded}
          tone="success"
          icon={<CheckCircle2 className="h-3.5 w-3.5" />}
        />
        <KpiCard
          label="Não executadas"
          value={kpis.impeded}
          tone="destructive"
          icon={<AlertTriangle className="h-3.5 w-3.5" />}
        />
        <KpiCard label="Sem apontamento" value={kpis.noReport} icon={<Clock className="h-3.5 w-3.5" />} />
        <KpiCard label="Imediatas" value={kpis.immediates} tone="warning" icon={<Zap className="h-3.5 w-3.5" />} />
        <KpiCard
          label="Conclusão"
          value={`${kpis.percent}%`}
          tone="primary"
          icon={<Percent className="h-3.5 w-3.5" />}
        />
      </section>

      {/* Toolbar */}
      <Toolbar className="mb-3">
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            placeholder="Buscar por ordem, nota, operação, suboperação, descrição, área ou responsável…"
            className="input-base pl-8"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(0);
          }}
          className="input-base w-auto py-2 text-xs"
        >
          <option value="">Todos os status</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          value={areaFilter}
          onChange={(e) => {
            const next = e.target.value;
            setAreaFilter(next);
            setWorkCenterFilters((prev) => {
              if (!next) return prev;
              const allowed = new Set(
                (activities.data ?? [])
                  .filter((r) => normalizeKey(areaLabel(r)) === normalizeKey(next))
                  .map((r) => normalizeKey(workCenterLabel(r))),
              );
              return prev.filter((c) => allowed.has(normalizeKey(c)));
            });
            setPage(0);
          }}
          className="input-base w-auto py-2 text-xs"
        >
          <option value="">Todas as áreas</option>
          {areas.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <WorkCenterMultiSelect
          options={gerOptions}
          selected={gerFilters}
          onChange={(next) => {
            setGerFilters(next);
            setPage(0);
          }}
          allLabel="Todas as Ger"
          ariaLabel="Filtrar por Ger"
          searchPlaceholder="Buscar Ger..."
          selectedPlural="Ger selecionadas"
        />
        <WorkCenterMultiSelect
          options={workCenters}
          selected={workCenterFilters}
          onChange={(next) => {
            setWorkCenterFilters(next);
            setPage(0);
          }}
        />

        <select
          value={originFilter}
          onChange={(e) => {
            setOriginFilter(e.target.value as "" | "programmed" | "immediate");
            setPage(0);
          }}
          className="input-base w-auto py-2 text-xs"
          aria-label="Filtrar por origem da atividade"
        >
          <option value="">Todas as atividades</option>
          <option value="programmed">Somente programadas</option>
          <option value="immediate">Somente imediatas</option>
        </select>
        <label className="input-base flex w-auto min-w-[150px] items-center gap-2 py-2 text-xs">
          <span className="whitespace-nowrap text-muted-foreground">Data:</span>
          <input
            type="date"
            value={dateFilter}
            onChange={(e) => {
              setDateFilter(e.target.value);
              setPage(0);
            }}
            className="flex-1 min-w-0 bg-transparent outline-none text-xs"
          />
        </label>
        {activeFilters > 0 && (
          <button onClick={clearFilters} className="btn-ghost py-1.5 text-xs">
            <X className="h-3 w-3" /> Limpar {activeFilters}
          </button>
        )}
        <div className="ml-auto text-[11px] font-medium text-muted-foreground tabular">
          {filtered.length.toLocaleString("pt-BR")}{" "}
          <span className="opacity-60">de {(activities.data?.length ?? 0).toLocaleString("pt-BR")}</span>
        </div>
      </Toolbar>

      {/* Ações de lote */}
      {selected.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-primary/30 bg-primary/[0.06] px-3 py-2">
          <div className="text-[13px]">
            <span className="font-semibold tabular">{selected.size}</span> atividade(s) selecionada(s)
          </div>
          <div className="flex gap-2">
            <button onClick={() => setSelected(new Set())} className="btn-ghost py-1 text-xs">
              Cancelar
            </button>
            {canEditPlanningFields && (
              <button onClick={() => setPlanningFieldsOpen(true)} className="btn-ghost py-1 text-xs">
                Preencher liberação
              </button>
            )}
            <button onClick={() => setBulkOpen(true)} className="btn-primary py-1 text-xs">
              Apontar em lote
            </button>
          </div>
        </div>
      )}

      {/* Tabela / Cards */}
      {activities.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Search className="h-4 w-4" />}
          title="Nenhuma atividade encontrada"
          description="Ajuste os filtros ou limpe a busca para ver todas as atividades da semana."
          action={
            activeFilters > 0 && (
              <button onClick={clearFilters} className="btn-ghost text-xs">
                <X className="h-3 w-3" /> Limpar filtros
              </button>
            )
          }
        />
      ) : (
        <>
          {/* Desktop */}
          <div className="hidden overflow-hidden rounded-md border border-border bg-card md:block">
            <div className="max-h-[calc(100vh-360px)] overflow-auto">
              <table className="min-w-[1640px] w-full text-[13px]">
                <thead className="sticky top-0 z-10 border-b border-border bg-muted text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="w-8 px-2 py-2">
                      <input
                        type="checkbox"
                        checked={paged.length > 0 && selected.size === paged.length}
                        onChange={toggleAll}
                      />
                    </th>
                    <th className="px-2 py-2 text-left font-semibold">Ordem / Nota</th>
                    <th className="px-2 py-2 text-left font-semibold">Operação / Suboperação</th>
                    <th className="px-2 py-2 text-left font-semibold">Atividade</th>
                    <th className="px-2 py-2 text-left font-semibold">Área / Especialidade</th>
                    <th className="px-2 py-2 text-left font-semibold">PBS</th>
                    <th className="px-2 py-2 text-left font-semibold">Nº PT</th>
                    <th className="px-2 py-2 text-left font-semibold">Tipo de Liberação</th>
                    <th className="px-2 py-2 text-left font-semibold">Data D-1</th>
                    <th className="px-2 py-2 text-left font-semibold">Data</th>
                    <th className="px-2 py-2 text-left font-semibold">Status</th>
                    <th className="px-2 py-2 text-left font-semibold">Responsável</th>
                    <th className="px-2 py-2 text-right font-semibold">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {paged.map((r) => (
                    <tr key={r.id} className="row-zebra hover:bg-accent/60">
                      <td className="px-2 py-2 align-top">
                        <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleSelect(r.id)} />
                      </td>
                      <td className="px-2 py-2 align-top font-mono text-[11px]">
                        <div className="text-foreground">{r.order_number}</div>
                        <div className="text-muted-foreground">{r.note_number}</div>
                      </td>
                      <td className="px-2 py-2 align-top font-mono text-[11px]">
                        <div className="text-foreground">{fmtPlan(r.planning_data, "Op") ?? "—"}</div>
                        <div className="text-muted-foreground">{fmtPlan(r.planning_data, "Subop") ?? "—"}</div>
                      </td>
                      <td className="px-2 py-2 align-top">
                        <div className="flex items-start gap-1.5">
                          {r.is_immediate && (
                            <span className="mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-sm border border-warning/50 bg-warning/15 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider text-warning-foreground">
                              <Zap className="h-2.5 w-2.5" /> Imediata
                            </span>
                          )}
                          <div className="text-foreground">{r.description}</div>
                        </div>
                      </td>
                      <td className="px-2 py-2 align-top text-[11px]">
                        <div className="text-foreground">{r.area}</div>
                        <div className="text-muted-foreground">{r.specialty}</div>
                      </td>
                      {(["pbs", "pt_number", "release_type", "d1_date"] as PlanningField[]).map((field) => {
                        const rowIndex = paged.findIndex((row) => row.id === r.id);
                        return (
                          <td key={field} className="px-1 py-1.5 align-top text-[11px]">
                            <PlanningGridCell
                              value={planningValue(r, field)}
                              field={field}
                              editable={canEditPlanningFields}
                              onChange={(value) => setPlanningValue(r.id, field, value)}
                              onCommit={(value) => commitPlanningCell(r, field, value)}
                              onPaste={(event) => pastePlanningGrid(event, rowIndex, field)}
                              onDragStart={() => {
                                dragSource.current = { rowIndex, field };
                              }}
                              onDrop={() => fillPlanningByDrag(rowIndex, field)}
                            />
                          </td>
                        );
                      })}
                      <td className="px-2 py-2 align-top text-[11px] tabular">{formatDate(r.scheduled_date)}</td>
                      <td className="px-2 py-2 align-top">
                        <StatusPill status={r.status} />
                      </td>
                      <td className="px-2 py-2 align-top text-[11px]">
                        {r.reported_by_name || <span className="text-muted-foreground">—</span>}
                        {r.reported_at && (
                          <div className="text-[10px] text-muted-foreground tabular">
                            {formatDateTime(r.reported_at)}
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right align-top">
                        <button onClick={() => setEditing(r)} className="btn-primary py-1 text-[11px]">
                          {r.status === "Sem apontamento" ? "Apontar" : "Atualizar"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile */}
          <div className="space-y-2 md:hidden">
            {paged.map((r) => (
              <div key={r.id} className={`surface-card p-3 ${r.is_immediate ? "border-l-[3px] border-l-warning" : ""}`}>
                <div className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={selected.has(r.id)}
                    onChange={() => toggleSelect(r.id)}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="font-mono text-[11px] text-foreground">{r.order_number}</span>
                      {fmtPlan(r.planning_data, "Op") && (
                        <span className="font-mono text-[11px] text-muted-foreground">
                          · Op {fmtPlan(r.planning_data, "Op")}
                        </span>
                      )}
                      {fmtPlan(r.planning_data, "Subop") && (
                        <span className="font-mono text-[11px] text-muted-foreground">
                          · Sub {fmtPlan(r.planning_data, "Subop")}
                        </span>
                      )}
                      {r.is_immediate && (
                        <span className="inline-flex items-center gap-1 rounded-sm border border-warning/50 bg-warning/15 px-1 py-0.5 text-[9px] font-bold uppercase text-warning-foreground">
                          <Zap className="h-2.5 w-2.5" /> Imediata
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-[13px] leading-snug text-foreground">{r.description}</div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {r.area}
                      {r.specialty ? ` · ${r.specialty}` : ""} · {formatDate(r.scheduled_date)}
                    </div>
                    <div className="mt-1 text-[10px] text-muted-foreground">
                      PBS: {r.pbs || "—"} · Nº PT: {r.pt_number || "—"} · {r.release_type || "Sem liberação"} · D-1:{" "}
                      {formatDate(r.d1_date)}
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <StatusPill status={r.status} />
                  <button onClick={() => setEditing(r)} className="btn-primary py-1.5 text-xs">
                    {r.status === "Sem apontamento" ? "Apontar" : "Atualizar"}
                  </button>
                </div>
                {r.reported_by_name && (
                  <div className="mt-2 border-t border-border pt-1.5 text-[10px] text-muted-foreground">
                    Últ.: {r.reported_by_name} · {formatDateTime(r.reported_at)}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Paginação */}
          <div className="mt-4 flex items-center justify-between text-[11px]">
            <div className="text-muted-foreground tabular">
              Página <span className="font-semibold text-foreground">{page + 1}</span> de {totalPages}
            </div>
            <div className="flex gap-1">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="btn-ghost py-1 text-xs disabled:opacity-40"
              >
                Anterior
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="btn-ghost py-1 text-xs disabled:opacity-40"
              >
                Próxima
              </button>
            </div>
          </div>
        </>
      )}

      {planningFieldsOpen && (
        <PlanningFieldsModal
          rows={filtered.filter((row) => selected.has(row.id))}
          onClose={() => setPlanningFieldsOpen(false)}
          onSaved={() => {
            setPlanningFieldsOpen(false);
            setSelected(new Set());
            qc.invalidateQueries({ queryKey: ["activities"] });
          }}
        />
      )}

      {editing && (
        <ApontarModal
          activity={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            qc.invalidateQueries({ queryKey: ["activities"] });
          }}
        />
      )}
      {bulkOpen && (
        <BulkModal
          count={selected.size}
          ids={Array.from(selected)}
          weekId={activeWeek.data!.id}
          onClose={() => setBulkOpen(false)}
          onSaved={() => {
            setBulkOpen(false);
            setSelected(new Set());
            qc.invalidateQueries({ queryKey: ["activities"] });
          }}
        />
      )}
    </main>
  );
}

function formatDate(d: string | null) {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}
function formatDateTime(d: string | null) {
  if (!d) return "";
  return new Date(d).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}
function fmtPlan(pd: Record<string, unknown> | null, key: string): string | null {
  const v = pd?.[key];
  if (v === null || v === undefined || v === "") return null;
  return String(v);
}

function getLinkedImmediateIds(pd: Record<string, unknown> | null): string[] {
  const value = pd?.__linked_immediate_ids;
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
}

function PlanningFieldsModal({
  rows,
  onClose,
  onSaved,
}: {
  rows: ActivityRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const saveFields = useServerFn(bulkUpdateActivityPlanningFields);
  const [saving, setSaving] = useState(false);
  const [grid, setGrid] = useState(() =>
    rows
      .map((row) => [row.pbs ?? "", row.pt_number ?? "", row.release_type ?? "", row.d1_date ?? ""].join("\t"))
      .join("\n"),
  );

  async function save() {
    try {
      const lines = grid.replace(/\r/g, "").split("\n");
      if (lines.length !== rows.length)
        throw new Error(`Cole exatamente ${rows.length} linha(s), uma para cada atividade selecionada.`);
      const parsed = lines.map((line, index) => {
        const cells = line.split("\t");
        if (cells.length > 4) throw new Error(`A linha ${index + 1} possui mais de 4 colunas.`);
        while (cells.length < 4) cells.push("");
        const [pbs, ptNumber, releaseType, d1Date] = cells.map((cell) => cell.trim());
        if (releaseType && !RELEASE_TYPES.includes(releaseType as (typeof RELEASE_TYPES)[number])) {
          throw new Error(`Tipo de liberação inválido na linha ${index + 1}. Use PT, PTT, ATRE ou Oficina.`);
        }
        if (d1Date && !/^\d{4}-\d{2}-\d{2}$/.test(d1Date)) {
          throw new Error(`Data D-1 inválida na linha ${index + 1}. Use AAAA-MM-DD.`);
        }
        return {
          id: rows[index].id,
          pbs: pbs || null,
          ptNumber: ptNumber || null,
          releaseType: (releaseType || null) as (typeof RELEASE_TYPES)[number] | null,
          d1Date: d1Date || null,
        };
      });
      setSaving(true);
      const result = await saveFields({ data: { rows: parsed } });
      if (!result.ok) throw new Error(result.error);
      toast.success(`${result.count} atividade(s) atualizada(s).`);
      onSaved();
    } catch (error: any) {
      toast.error(error?.message ?? "Não foi possível salvar os campos de liberação.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      onClose={onClose}
      title="Preencher campos de liberação"
      description="Copie quatro colunas do Excel e cole abaixo. A ordem das linhas segue a tabela filtrada."
      footer={
        <>
          <button type="button" onClick={onClose} className="btn-ghost" disabled={saving}>
            Cancelar
          </button>
          <button type="button" onClick={save} className="btn-primary" disabled={saving || rows.length === 0}>
            {saving ? "Salvando…" : `Salvar ${rows.length} atividade(s)`}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-4 gap-1 rounded-md bg-muted px-2 py-1.5 text-[10px] font-semibold uppercase text-muted-foreground">
          <span>PBS</span>
          <span>Nº PT</span>
          <span>Tipo de Liberação</span>
          <span>Data D-1</span>
        </div>
        <textarea
          value={grid}
          onChange={(event) => setGrid(event.target.value)}
          rows={Math.min(16, Math.max(5, rows.length))}
          spellCheck={false}
          className="input-base min-h-40 w-full resize-y whitespace-pre font-mono text-xs"
          placeholder={"PBS\tNº PT\tPT\t2026-08-24"}
          aria-label="Dados de liberação em formato de planilha"
        />
        <p className="text-[11px] text-muted-foreground">
          São necessárias {rows.length} linha(s). Campos vazios apagam o valor atual. Tipos aceitos: PT, PTT, ATRE e
          Oficina. A data deve estar no formato AAAA-MM-DD.
        </p>
      </div>
    </Modal>
  );
}

function ApontarModal({
  activity,
  onClose,
  onSaved,
}: {
  activity: ActivityRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [status, setStatus] = useState(activity.status);
  const [justification, setJustification] = useState(activity.justification ?? "");
  const [observation, setObservation] = useState(activity.observation ?? "");
  const [saving, setSaving] = useState(false);
  const [immediatePickerOpen, setImmediatePickerOpen] = useState(false);
  const [selectedImmediateIds, setSelectedImmediateIds] = useState<Set<string>>(
    () => new Set(getLinkedImmediateIds(activity.planning_data)),
  );
  const call = useServerFn(updateActivity);
  const needsJust = REQUIRES_JUSTIFICATION.has(status);
  const needsImmediateLink = status === "NÃO EXECUTADO" && justification === IMMEDIATE_JUSTIFICATION;

  async function save() {
    if (needsJust && !justification.trim()) {
      toast.error("Justificativa é obrigatória para este status.");
      return;
    }
    if (needsImmediateLink && selectedImmediateIds.size === 0) {
      toast.error("Selecione ao menos uma atividade imediata atendida.");
      setImmediatePickerOpen(true);
      return;
    }
    setSaving(true);
    try {
      const res = await call({
        data: {
          activityId: activity.id,
          expectedVersion: activity.version,
          status,
          justification: justification.trim() || null,
          observation: observation.trim() || null,
          immediateActivityIds: needsImmediateLink ? Array.from(selectedImmediateIds) : [],
        },
      });
      if (!res.ok) {
        if ((res as any).conflict) toast.error("Esta atividade foi alterada por outro usuário. Recarregue e revise.");
        else toast.error(res.error ?? "Erro ao salvar apontamento.");
        return;
      }
      toast.success("Apontamento salvo.");
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Apontar atividade"
      description="Registre status, justificativa e observações."
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="btn-ghost">
            Cancelar
          </button>
          <button onClick={save} disabled={saving} className="btn-primary">
            {saving ? "Salvando…" : "Salvar apontamento"}
          </button>
        </>
      }
    >
      <div className="rounded-md border border-border bg-muted/50 p-3">
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] sm:grid-cols-4">
          <MetaItem label="Ordem" value={activity.order_number} />
          <MetaItem label="Operação" value={fmtPlan(activity.planning_data, "Op")} />
          <MetaItem label="Sub operação" value={fmtPlan(activity.planning_data, "Subop")} />
          <MetaItem label="Área" value={activity.area} />
          <MetaItem label="Data" value={formatDate(activity.scheduled_date)} />
        </div>
        <div className="mt-2 text-[13px] text-foreground">{activity.description}</div>
      </div>

      <div className="mt-4 space-y-3">
        <Field label="Status" required>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="input-base">
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Justificativa" required={needsJust}>
          <select
            value={justification}
            onChange={(e) => {
              const value = e.target.value;
              setJustification(value);
              if (status === "NÃO EXECUTADO" && value === IMMEDIATE_JUSTIFICATION) setImmediatePickerOpen(true);
            }}
            className="input-base"
          >
            <option value="">— Selecione —</option>
            {JUSTIFICATIONS.map((j) => (
              <option key={j} value={j}>
                {j}
              </option>
            ))}
          </select>
        </Field>

        {needsImmediateLink && (
          <div className="rounded-md border border-warning/50 bg-warning/10 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-[11px] font-semibold text-warning-foreground">Imediatas atendidas</div>
                <div className="text-[11px] text-muted-foreground">
                  {selectedImmediateIds.size > 0
                    ? `${selectedImmediateIds.size} atividade(s) vinculada(s)`
                    : "Selecione a atividade imediata que causou o desvio."}
                </div>
              </div>
              <button type="button" onClick={() => setImmediatePickerOpen(true)} className="btn-ghost text-xs">
                <Zap className="h-3.5 w-3.5" /> {selectedImmediateIds.size ? "Alterar vínculo" : "Selecionar imediatas"}
              </button>
            </div>
          </div>
        )}

        <Field label="Observações" hint="Você será registrado automaticamente como responsável.">
          <textarea
            value={observation}
            onChange={(e) => setObservation(e.target.value)}
            rows={3}
            maxLength={2000}
            className="input-base"
          />
        </Field>
      </div>

      <ActivityTimeline activityId={activity.id} />

      {immediatePickerOpen && (
        <ImmediatePicker
          weekId={activity.week_id}
          scheduledDate={activity.scheduled_date}
          selected={selectedImmediateIds}
          onClose={() => setImmediatePickerOpen(false)}
          onConfirm={(ids) => {
            setSelectedImmediateIds(ids);
            setImmediatePickerOpen(false);
          }}
        />
      )}
    </Modal>
  );
}

const HISTORY_LABELS: Record<string, string> = {
  status: "Status",
  justification: "Justificativa",
  observation: "Observações",
};

function historyValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  return String(v);
}

function ActivityTimeline({ activityId }: { activityId: string }) {
  const q = useQuery({
    queryKey: ["activity-timeline", activityId],
    queryFn: async () => {
      const { data } = await supabase
        .from("activity_history")
        .select("id, changed_at, changed_by_name, changed_by_email, change_source, previous_values, new_values")
        .eq("activity_id", activityId)
        .order("changed_at", { ascending: false })
        .limit(50);
      return data ?? [];
    },
  });

  return (
    <div className="mt-5 border-t border-border pt-4">
      <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <Clock className="h-3.5 w-3.5" /> Linha do tempo desta atividade
      </div>
      {q.isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : (q.data?.length ?? 0) === 0 ? (
        <div className="text-[12px] text-muted-foreground">Nenhuma alteração registrada até agora.</div>
      ) : (
        <ol className="max-h-64 space-y-3 overflow-y-auto pr-1">
          {q.data!.map((h: any) => {
            const prev = (h.previous_values ?? {}) as Record<string, unknown>;
            const next = (h.new_values ?? {}) as Record<string, unknown>;
            const keys = Object.keys(HISTORY_LABELS).filter(
              (k) => k in next && historyValue(prev[k]) !== historyValue(next[k]),
            );
            return (
              <li key={h.id} className="relative border-l border-border pl-3">
                <span className="absolute -left-[3px] top-1.5 h-1.5 w-1.5 rounded-full bg-primary" />
                <div className="flex flex-wrap items-baseline gap-x-2 text-[11px]">
                  <span className="tabular font-medium text-foreground">
                    {new Date(h.changed_at).toLocaleString("pt-BR")}
                  </span>
                  <span className="text-muted-foreground">{h.changed_by_name || h.changed_by_email || "Sistema"}</span>
                  <span className="status-pill border-border bg-muted text-muted-foreground">{h.change_source}</span>
                </div>
                <div className="mt-1 space-y-0.5">
                  {keys.length === 0 ? (
                    <div className="text-[11px] text-muted-foreground">Atualização sem mudança de campos.</div>
                  ) : (
                    keys.map((k) => (
                      <div key={k} className="text-[11px]">
                        <span className="font-medium text-foreground">{HISTORY_LABELS[k]}: </span>
                        <span className="text-muted-foreground line-through">{historyValue(prev[k])}</span>
                        <span className="text-muted-foreground"> → </span>
                        <span className="text-foreground">{historyValue(next[k])}</span>
                      </div>
                    ))
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function ImmediatePicker({
  weekId,
  scheduledDate,
  selected,
  onClose,
  onConfirm,
}: {
  weekId: string;
  scheduledDate: string | null;
  selected: Set<string>;
  onClose: () => void;
  onConfirm: (ids: Set<string>) => void;
}) {
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<Set<string>>(() => new Set(selected));
  const immediates = useQuery({
    queryKey: ["immediate-link-options", weekId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("activities")
        .select("id,order_number,note_number,description,scheduled_date,status,area,specialty,planning_data")
        .eq("week_id", weekId)
        .eq("is_immediate", true)
        .order("scheduled_date", { ascending: true })
        .order("order_number", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ActivityRow[];
    },
  });

  const options = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (immediates.data ?? [])
      .filter((row) => {
        if (!q) return true;
        return (
          row.order_number?.toLowerCase().includes(q) ||
          row.description.toLowerCase().includes(q) ||
          fmtPlan(row.planning_data, "Op")?.toLowerCase().includes(q) ||
          fmtPlan(row.planning_data, "Subop")?.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        const aSame = a.scheduled_date === scheduledDate ? 0 : 1;
        const bSame = b.scheduled_date === scheduledDate ? 0 : 1;
        return aSame - bSame || (a.scheduled_date ?? "").localeCompare(b.scheduled_date ?? "");
      });
  }, [immediates.data, scheduledDate, search]);

  function toggle(id: string) {
    setDraft((current) => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  return (
    <Modal
      title="Selecionar atividades imediatas"
      description="Vincule as imediatas atendidas à tarefa programada não executada. As da mesma data aparecem primeiro."
      onClose={onClose}
      size="lg"
      footer={
        <>
          <button type="button" onClick={onClose} className="btn-ghost">
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => {
              if (draft.size === 0) return toast.error("Selecione ao menos uma imediata.");
              onConfirm(draft);
            }}
            className="btn-primary"
          >
            Vincular {draft.size || ""}
          </button>
        </>
      }
    >
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por ordem, operação, suboperação ou descrição…"
          className="input-base pl-8"
          autoFocus
        />
      </div>
      {immediates.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : options.length === 0 ? (
        <EmptyState
          title="Nenhuma imediata encontrada"
          description="Cadastre ou importe as imediatas desta semana no Planejamento."
        />
      ) : (
        <div className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
          {options.map((row) => {
            const checked = draft.has(row.id);
            const sameDay = row.scheduled_date === scheduledDate;
            return (
              <label
                key={row.id}
                className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 transition ${checked ? "border-warning bg-warning/10" : "border-border hover:bg-muted/60"}`}
              >
                <input type="checkbox" checked={checked} onChange={() => toggle(row.id)} className="mt-1" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[11px] font-semibold">{row.order_number || "—"}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      Op {fmtPlan(row.planning_data, "Op") ?? "—"} · Sub {fmtPlan(row.planning_data, "Subop") ?? "—"}
                    </span>
                    {sameDay && (
                      <span className="rounded bg-warning/15 px-1.5 py-0.5 text-[9px] font-semibold text-warning-foreground">
                        Mesma data
                      </span>
                    )}
                    <StatusPill status={row.status} />
                  </div>
                  <div className="mt-1 text-[12px] leading-snug text-foreground">{row.description}</div>
                  <div className="mt-1 text-[10px] text-muted-foreground">
                    {formatDate(row.scheduled_date)}
                    {row.area ? ` · ${row.area}` : ""}
                  </div>
                </div>
              </label>
            );
          })}
        </div>
      )}
    </Modal>
  );
}

function MetaItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="tabular text-foreground">{value ?? "—"}</div>
    </div>
  );
}

function BulkModal({
  count,
  ids,
  weekId,
  onClose,
  onSaved,
}: {
  count: number;
  ids: string[];
  weekId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [status, setStatus] = useState("EXECUTADO");
  const [justification, setJustification] = useState("");
  const [observation, setObservation] = useState("");
  const [saving, setSaving] = useState(false);
  const [immediatePickerOpen, setImmediatePickerOpen] = useState(false);
  const [selectedImmediateIds, setSelectedImmediateIds] = useState<Set<string>>(new Set());
  const call = useServerFn(bulkUpdateActivities);
  const needsJust = REQUIRES_JUSTIFICATION.has(status);
  const needsImmediateLink = status === "NÃO EXECUTADO" && justification === IMMEDIATE_JUSTIFICATION;

  async function save() {
    if (needsJust && !justification.trim()) {
      toast.error("Justificativa é obrigatória para este status.");
      return;
    }
    if (needsImmediateLink && selectedImmediateIds.size === 0) {
      toast.error("Selecione ao menos uma atividade imediata atendida.");
      setImmediatePickerOpen(true);
      return;
    }
    setSaving(true);
    try {
      const res = await call({
        data: {
          ids,
          status,
          justification: justification.trim() || null,
          observation: observation.trim() || null,
          immediateActivityIds: needsImmediateLink ? Array.from(selectedImmediateIds) : [],
        },
      });
      if (!res.ok) return toast.error(res.error ?? "Erro ao salvar lote.");
      toast.success(`${res.count} atividade(s) atualizada(s).`);
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={`Apontar ${count} atividade(s) em lote`}
      description="O mesmo status, justificativa e vínculo serão aplicados a todas."
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="btn-ghost">
            Cancelar
          </button>
          <button onClick={save} disabled={saving} className="btn-primary">
            {saving ? "Salvando…" : `Aplicar a ${count}`}
          </button>
        </>
      }
    >
      <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-[12px] text-warning-foreground">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <b className="tabular">{count}</b> atividade(s) receberão o mesmo status. Você será registrado como
          responsável em todas.
        </div>
      </div>
      <div className="mt-4 space-y-3">
        <Field label="Status" required>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="input-base">
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Justificativa" required={needsJust}>
          <select
            value={justification}
            onChange={(e) => {
              const value = e.target.value;
              setJustification(value);
              if (status === "NÃO EXECUTADO" && value === IMMEDIATE_JUSTIFICATION) setImmediatePickerOpen(true);
            }}
            className="input-base"
          >
            <option value="">— Selecione —</option>
            {JUSTIFICATIONS.map((j) => (
              <option key={j} value={j}>
                {j}
              </option>
            ))}
          </select>
        </Field>
        {needsImmediateLink && (
          <div className="rounded-md border border-warning/50 bg-warning/10 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-[11px] font-semibold text-warning-foreground">Imediatas atendidas</div>
                <div className="text-[11px] text-muted-foreground">
                  {selectedImmediateIds.size > 0
                    ? `${selectedImmediateIds.size} atividade(s) vinculada(s) às ${count} programadas`
                    : "Selecione a imediata que causou a parada das atividades."}
                </div>
              </div>
              <button type="button" onClick={() => setImmediatePickerOpen(true)} className="btn-ghost text-xs">
                <Zap className="h-3.5 w-3.5" /> {selectedImmediateIds.size ? "Alterar vínculo" : "Selecionar imediatas"}
              </button>
            </div>
          </div>
        )}
        <Field label="Observação (opcional)">
          <textarea
            value={observation}
            onChange={(e) => setObservation(e.target.value)}
            rows={2}
            maxLength={2000}
            className="input-base"
          />
        </Field>
      </div>
      {immediatePickerOpen && (
        <ImmediatePicker
          weekId={weekId}
          scheduledDate={null}
          selected={selectedImmediateIds}
          onClose={() => setImmediatePickerOpen(false)}
          onConfirm={(selectedIds) => {
            setSelectedImmediateIds(selectedIds);
            setImmediatePickerOpen(false);
          }}
        />
      )}
    </Modal>
  );
}
