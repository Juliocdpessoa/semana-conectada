import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useRef, useState } from "react";
import type { ClipboardEvent, DragEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  updateActivity,
  bulkUpdateActivities,
  bulkUpdateActivityPlanningFields,
  getActivityDateEditSettings,
  updateActivityDateEditCutoff,
} from "@/lib/activities.functions";
import { toast } from "sonner";
import {
  Search,
  X,
  Zap,
  CheckCircle2,
  AlertTriangle,
  Clock,
  RefreshCw,
  Download,
  Printer,
  ListChecks,
  Percent,
  ChevronDown,
} from "lucide-react";
import logoAsset from "@/assets/normatel-logo.png.asset.json";
import type { SessionInfo } from "./route";
import { PageHeader, KpiCard, Toolbar, EmptyState, Skeleton, StatusPill, Modal, Field } from "@/components/ui-kit";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

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
  source_row_number: number | null;
  planning_data: Record<string, unknown> | null;
  pbs: string | null;
  pt_number: string | null;
  pt_color: "red" | "yellow" | "white" | null;
  release_type: "PT" | "PTT" | "ATRE" | "OFICINAS" | null;
};

const STATUSES = [
  "Sem apontamento",
  "EXECUTADO",
  "NÃO EXECUTADO",
  "AGUARDANDO PRÉ-EMISSÃO DE PT",
  "PT EM ASSINATURA",
  "PT ENVIADA P/ CAMPO",
  "CANCELADA",
];
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
const CANCELLATION_JUSTIFICATIONS = [
  "11 - MUDANÇA DE ESCOPO DA INTERVENÇÃO",
  "12 - SERVIÇO CANCELADO",
  "15 - PROGRAMAÇÃO INDEVIDA",
  "17 - TAREFA ELIMINADA EQUIVOCADAMENTE DO SAP",
  "22 - ATIVIDADE EXECUTADA ANTERIORMENTE",
  "29 - OUTROS TIPOS DE PENDENCIAS",
];
const REQUIRES_JUSTIFICATION = new Set(["NÃO EXECUTADO", "CANCELADA"]);
const PLANNING_WORKFLOW_STATUSES = new Set(["AGUARDANDO PRÉ-EMISSÃO DE PT", "PT EM ASSINATURA", "PT ENVIADA P/ CAMPO"]);
const PENDING_REPORT_FILTER = "__PENDING_REPORT__";
const PENDING_REPORT_STATUSES = new Set([
  "Sem apontamento",
  "AGUARDANDO PRÉ-EMISSÃO DE PT",
  "PT EM ASSINATURA",
  "PT ENVIADA P/ CAMPO",
]);
const IMMEDIATE_JUSTIFICATION = "08 - ATENDIMENTO DE ORDEM IMEDIATA";
const RELEASE_TYPES = ["PT", "PTT", "ATRE", "OFICINAS"] as const;
const PT_COLORS = ["red", "yellow", "white"] as const;
type PtColor = (typeof PT_COLORS)[number];
const PT_COLOR_LABELS: Record<PtColor, string> = { red: "Vermelha", yellow: "Amarela", white: "Branca" };
const ACTIVITY_SORT_COLLATOR = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" });

/** HH planejado da atividade: valor da coluna Trab importada da programação. */
function activityHours(planningData: Record<string, unknown> | null): number {
  if (!planningData) return 0;
  const raw = planningData.Trab ?? planningData.TRAB ?? planningData.trab;
  if (raw === null || raw === undefined || raw === "") return 0;
  if (typeof raw === "number") return Number.isFinite(raw) && raw > 0 ? raw : 0;
  if (typeof raw !== "string") return 0;
  let normalized = raw.trim().replace(/\s*h(?:oras?)?$/i, "");
  if (normalized.includes(",")) normalized = normalized.replace(/\./g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function formatActivityHours(value: number) {
  return `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(Math.round(value * 10) / 10)} h`;
}
const ACTIVITY_EXPORT_COLUMNS = [
  "Tipo de Nota",
  "Nota",
  "Confirmação",
  "Ordem",
  "Op",
  "Subop",
  "Data início",
  "Hora início",
  "Data fim",
  "Hora fim",
  "Gr pl",
  "Área op",
  "CenTrab",
  "TxtDesc.Oper.",
  "Localização",
  "Nº",
  "Dur n",
  "Trab",
  "Gerência",
  "Local",
  "PBS",
  "Tipo de Liberação",
  "Status",
  "Justificativa",
  "Observações",
] as const;
type PlanningField = "pbs" | "pt_number" | "release_type" | "scheduled_date";
type PlanningDraft = Record<PlanningField | "pt_color", string>;
const PLANNING_FIELDS: PlanningField[] = ["pbs", "pt_number", "release_type", "scheduled_date"];

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
function FilterMultiSelect({
  options,
  selected,
  onChange,
  allLabel = "Todos os centros de trabalho",
  ariaLabel = "Filtrar por centro de trabalho",
  searchPlaceholder = "Buscar centro...",
  selectedPlural = "itens selecionados",
  optionLabel = (option: string) => option,
}: {
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  allLabel?: string;
  ariaLabel?: string;
  searchPlaceholder?: string;
  selectedPlural?: string;
  optionLabel?: (option: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.toLowerCase().includes(q)) : options;
  }, [options, query]);

  const label =
    selected.length === 0
      ? allLabel
      : selected.length === 1
        ? optionLabel(selected[0])
        : `${selected.length} ${selectedPlural}`;

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
                <span className="truncate">{optionLabel(o)}</span>
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

function PtColorSelector({
  value,
  editable,
  disabled = false,
  onChange,
}: {
  value: PtColor | null;
  editable: boolean;
  disabled?: boolean;
  onChange?: (value: PtColor | null) => void;
}) {
  return (
    <div
      className="flex shrink-0 items-center gap-1"
      aria-label={value ? `Cor da PT: ${PT_COLOR_LABELS[value]}` : "Cor da PT não definida"}
    >
      {PT_COLORS.map((color) => {
        const selected = value === color;
        return (
          <button
            key={color}
            type="button"
            disabled={!editable || disabled}
            onClick={() => onChange?.(selected ? null : color)}
            title={`${selected ? "Remover" : "Selecionar"} PT ${PT_COLOR_LABELS[color].toLowerCase()}`}
            aria-pressed={selected}
            style={{
              backgroundColor: color === "red" ? "#dc2626" : color === "yellow" ? "#facc15" : "#ffffff",
              borderColor: color === "red" ? "#991b1b" : color === "yellow" ? "#ca8a04" : "#64748b",
            }}
            className={cn(
              "relative h-5 w-5 rounded-full border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
              selected ? "scale-110 ring-2 ring-primary ring-offset-1" : "opacity-55 hover:scale-105 hover:opacity-100",
              (!editable || disabled) && "cursor-default",
            )}
          >
            {selected && (
              <span
                className={cn(
                  "absolute inset-0 grid place-items-center text-[11px] font-bold",
                  color === "white" ? "text-slate-700" : "text-white",
                )}
              >
                ✓
              </span>
            )}
          </button>
        );
      })}
    </div>
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
  onDragEnter,
  onDragEnd,
  onDrop,
}: {
  value: string;
  field: PlanningField;
  editable: boolean;
  onChange: (value: string) => void;
  onCommit: (value: string) => void;
  onPaste: (event: ClipboardEvent<HTMLElement>) => void;
  onDragStart: () => void;
  onDragEnter: () => void;
  onDragEnd: () => void;
  onDrop: () => void;
}) {
  const [isDragOver, setIsDragOver] = useState(false);

  if (!editable) {
    return field === "scheduled_date" ? <>{formatDate(value || null)}</> : <>{value || "—"}</>;
  }

  const sharedClass =
    "h-7 w-full min-w-[92px] rounded border border-transparent bg-transparent px-1.5 text-[11px] outline-none transition-colors hover:border-border hover:bg-background focus:border-primary focus:bg-background focus:ring-1 focus:ring-primary/30";

  return (
    <div
      className={cn(
        "group/cell relative min-w-[96px] rounded transition",
        isDragOver && "bg-primary/10 ring-2 ring-inset ring-primary/50",
      )}
      onPaste={onPaste}
      onDragEnter={() => {
        setIsDragOver(true);
        onDragEnter();
      }}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setIsDragOver(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) setIsDragOver(false);
      }}
      onDrop={(event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        setIsDragOver(false);
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
          type={field === "scheduled_date" ? "date" : "text"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={(event) => onCommit(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          className={sharedClass}
          aria-label={field === "pbs" ? "PBS" : field === "pt_number" ? "Número da PT" : "Data"}
        />
      )}
      <span
        draggable
        title="Segure e arraste para copiar o valor às células abaixo"
        onDragStart={(event: DragEvent<HTMLSpanElement>) => {
          event.dataTransfer.effectAllowed = "copy";
          event.dataTransfer.setData("text/plain", value);
          onDragStart();
        }}
        onDragEnd={onDragEnd}
        className="absolute -bottom-1 -right-1 z-10 flex h-3.5 w-3.5 cursor-copy select-none items-center justify-center rounded-sm border-2 border-background bg-primary text-[9px] font-bold leading-none text-primary-foreground opacity-40 shadow-sm transition-opacity hover:opacity-100 group-hover/cell:opacity-100 group-focus-within/cell:opacity-100"
        aria-hidden="true"
      >
        +
      </span>
    </div>
  );
}

function AtividadesPage() {
  const { session } = Route.useRouteContext() as { session: SessionInfo };
  const canEditPlanningFields = session.roles.some((role) => role === "planning" || role === "admin");
  const canAccessPreparation = canEditPlanningFields;
  const isDateEditAdmin = session.email.trim().toLowerCase() === "julio.pessoa@normatel.com.br";
  const canLoadDateEditSettings = canEditPlanningFields || session.roles.includes("admin") || isDateEditAdmin;
  const qc = useQueryClient();
  const savePlanningFields = useServerFn(bulkUpdateActivityPlanningFields);
  const loadDateEditSettings = useServerFn(getActivityDateEditSettings);
  const saveDateEditCutoff = useServerFn(updateActivityDateEditCutoff);
  const [cutoffDraft, setCutoffDraft] = useState("15:00");
  const [planningDrafts, setPlanningDrafts] = useState<Record<string, Partial<PlanningDraft>>>({});
  const planningSavesPendingRef = useRef(0);
  const planningSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const planningVersionsRef = useRef(new Map<string, number>());
  const [planningSavePending, setPlanningSavePending] = useState(false);
  const dragSource = useRef<{ rowIndex: number; field: PlanningField } | null>(null);
  const dragTarget = useRef<{ rowIndex: number; field: PlanningField } | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilters, setStatusFilters] = useState<string[]>([]);
  const [releaseTypeFilters, setReleaseTypeFilters] = useState<string[]>([]);
  const [ptColorFilters, setPtColorFilters] = useState<string[]>([]);
  const [areaFilters, setAreaFilters] = useState<string[]>([]);
  const [workCenterFilters, setWorkCenterFilters] = useState<string[]>([]);
  const [gerFilters, setGerFilters] = useState<string[]>([]);
  const [dateFilters, setDateFilters] = useState<string[]>([]);
  const [originFilters, setOriginFilters] = useState<string[]>([]);
  const [selectedWeekId, setSelectedWeekId] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [editing, setEditing] = useState<ActivityRow | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [planningFieldsOpen, setPlanningFieldsOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);
  const [page, setPage] = useState(0);
  const pageSize = 50;

  const availableWeeks = useQuery({
    queryKey: ["activity-working-weeks"],
    enabled: canAccessPreparation,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("weeks")
        .select("id,code,label,start_date,end_date,is_active,lifecycle_status")
        .in("lifecycle_status", ["operational", "preparation"])
        .order("start_date", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const activeWeek = useQuery({
    queryKey: ["active-week", canAccessPreparation ? selectedWeekId : "operational"],
    queryFn: async () => {
      let request = (supabase as any).from("weeks").select("*");
      request =
        canAccessPreparation && selectedWeekId ? request.eq("id", selectedWeekId) : request.eq("is_active", true);
      const { data, error } = await request.maybeSingle();
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

  const dateEditSettings = useQuery({
    queryKey: ["activity-date-edit-settings"],
    enabled: canLoadDateEditSettings,
    queryFn: async () => {
      const result = await loadDateEditSettings();
      setCutoffDraft(result.cutoffTime);
      return result;
    },
    refetchInterval: 60_000,
  });
  const dateEditLocked = dateEditSettings.data?.locked ?? false;
  const canConfigureDateCutoff = dateEditSettings.data?.canConfigure ?? false;
  const canEditPlanningDate = canEditPlanningFields && !dateEditLocked;

  type FilterDimension = "status" | "releaseType" | "ptColor" | "area" | "workCenter" | "ger" | "date" | "origin";
  const allRows = activities.data ?? [];
  const workCenterKeys = new Set(workCenterFilters.map((value) => normalizeKey(value)));
  const gerKeys = new Set(gerFilters.map((value) => normalizeKey(value)));
  const areaKeys = new Set(areaFilters.map((value) => normalizeKey(value)));

  function matchesActiveFilters(row: ActivityRow, omitted?: FilterDimension) {
    const query = search.trim().toLowerCase();
    if (omitted !== "status" && statusFilters.length > 0) {
      const matchesStatus = statusFilters.some((status) =>
        status === PENDING_REPORT_FILTER ? PENDING_REPORT_STATUSES.has(row.status) : row.status === status,
      );
      if (!matchesStatus) return false;
    }
    if (canEditPlanningFields && omitted !== "releaseType") {
      if (
        releaseTypeFilters.length > 0 &&
        !releaseTypeFilters.some((type) => (type === "__EMPTY__" ? !row.release_type : row.release_type === type))
      )
        return false;
    }
    if (omitted !== "ptColor" && ptColorFilters.length > 0 && !ptColorFilters.includes(row.pt_color ?? ""))
      return false;
    if (omitted !== "area" && areaKeys.size > 0 && !areaKeys.has(normalizeKey(areaLabel(row)))) return false;
    if (omitted !== "workCenter" && workCenterKeys.size > 0 && !workCenterKeys.has(normalizeKey(workCenterLabel(row))))
      return false;
    if (omitted !== "ger" && gerKeys.size > 0 && !gerKeys.has(normalizeKey(gerLabel(row)))) return false;
    if (omitted !== "date" && dateFilters.length > 0 && !dateFilters.includes(row.scheduled_date ?? "")) return false;
    if (omitted !== "origin" && originFilters.length > 0) {
      const origin = row.is_immediate ? "immediate" : "programmed";
      if (!originFilters.includes(origin)) return false;
    }
    if (!query) return true;
    return (
      row.order_number?.toLowerCase().includes(query) ||
      row.note_number?.toLowerCase().includes(query) ||
      row.description.toLowerCase().includes(query) ||
      row.area?.toLowerCase().includes(query) ||
      row.specialty?.toLowerCase().includes(query) ||
      fmtPlan(row.planning_data, "Op")?.toLowerCase().includes(query) ||
      fmtPlan(row.planning_data, "Subop")?.toLowerCase().includes(query) ||
      row.reported_by_name?.toLowerCase().includes(query)
    );
  }

  const filtered = allRows
    .filter((row) => matchesActiveFilters(row))
    .sort((a, b) => {
      const fields: Array<[string | null | undefined, string | null | undefined]> = [
        [a.order_number, b.order_number],
        [fmtPlan(a.planning_data, "Op"), fmtPlan(b.planning_data, "Op")],
        [fmtPlan(a.planning_data, "Subop"), fmtPlan(b.planning_data, "Subop")],
      ];

      for (const [leftValue, rightValue] of fields) {
        const left = leftValue?.trim() ?? "";
        const right = rightValue?.trim() ?? "";
        if (!left && right) return 1;
        if (left && !right) return -1;
        const comparison = ACTIVITY_SORT_COLLATOR.compare(left, right);
        if (comparison !== 0) return comparison;
      }

      return (a.source_row_number ?? Number.MAX_SAFE_INTEGER) - (b.source_row_number ?? Number.MAX_SAFE_INTEGER);
    });

  const statusOptions = STATUSES.filter(
    (status) =>
      statusFilters.includes(status) ||
      allRows.some((row) => row.status === status && matchesActiveFilters(row, "status")),
  );

  const releaseTypeOptions = RELEASE_TYPES.filter(
    (type) =>
      releaseTypeFilters.includes(type) ||
      allRows.some((row) => row.release_type === type && matchesActiveFilters(row, "releaseType")),
  );
  const hasEmptyReleaseType =
    releaseTypeFilters.includes("__EMPTY__") ||
    allRows.some((row) => !row.release_type && matchesActiveFilters(row, "releaseType"));

  const ptColorOptions = PT_COLORS.filter(
    (color) =>
      ptColorFilters.includes(color) ||
      allRows.some((row) => row.pt_color === color && matchesActiveFilters(row, "ptColor")),
  );

  const areas = (() => {
    const values = new Map<string, string>();
    for (const row of allRows) {
      if (!matchesActiveFilters(row, "area")) continue;
      const label = areaLabel(row);
      if (!label || isNumericOnly(label)) continue;
      const key = normalizeKey(label);
      if (key && !values.has(key)) values.set(key, label);
    }
    for (const selected of areaFilters) values.set(normalizeKey(selected), selected);
    return Array.from(values.values()).sort((a, b) => a.localeCompare(b, "pt-BR"));
  })();

  const gerOptions = (() => {
    const values = new Set<string>();
    for (const row of allRows) if (matchesActiveFilters(row, "ger")) values.add(gerLabel(row));
    for (const selected of gerFilters) values.add(selected);
    return Array.from(values).sort((a, b) => {
      if (a === "Não mapeado") return 1;
      if (b === "Não mapeado") return -1;
      return a.localeCompare(b, "pt-BR");
    });
  })();

  const workCenters = (() => {
    const values = new Map<string, string>();
    for (const row of allRows) {
      if (!matchesActiveFilters(row, "workCenter")) continue;
      const label = workCenterLabel(row);
      if (!label) continue;
      const key = normalizeKey(label);
      if (key && !values.has(key)) values.set(key, label);
    }
    for (const selected of workCenterFilters) values.set(normalizeKey(selected), selected);
    return Array.from(values.values()).sort((a, b) => a.localeCompare(b, "pt-BR"));
  })();

  const dateOptions = Array.from(
    new Set(
      allRows
        .filter((row) => matchesActiveFilters(row, "date"))
        .map((row) => row.scheduled_date)
        .filter((value): value is string => Boolean(value)),
    ),
  ).sort();
  for (const selected of dateFilters) if (!dateOptions.includes(selected)) dateOptions.push(selected);

  const originRows = allRows.filter((row) => matchesActiveFilters(row, "origin"));
  const hasProgrammed = originFilters.includes("programmed") || originRows.some((row) => !row.is_immediate);
  const hasImmediate = originFilters.includes("immediate") || originRows.some((row) => row.is_immediate);

  const paged = filtered.slice(page * pageSize, (page + 1) * pageSize);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));

  // Todos os indicadores usam o conjunto já filtrado (busca, status, área, centro, tipo e data)
  const kpis = useMemo(() => {
    const rows = filtered;
    const total = rows.length;
    const concluded = rows.filter((r) => r.status === "EXECUTADO").length;
    const impeded = rows.filter((r) => r.status === "NÃO EXECUTADO").length;
    const noReport = rows.filter((r) => PENDING_REPORT_STATUSES.has(r.status)).length;
    const cancelled = rows.filter((r) => r.status === "CANCELADA").length;
    const hours = rows.reduce((totalHours, row) => totalHours + activityHours(row.planning_data), 0);
    const validTotal = total - cancelled;
    const percent = validTotal > 0 ? Math.round((concluded / validTotal) * 100) : 0;
    return { total, concluded, impeded, noReport, cancelled, hours, percent };
  }, [filtered]);

  function toggleKpiStatus(nextStatus: string) {
    setStatusFilters((current) =>
      !nextStatus
        ? []
        : current.includes(nextStatus)
          ? current.filter((s) => s !== nextStatus)
          : [...current, nextStatus],
    );
    setPage(0);
  }

  const activeFilters = [
    search,
    statusFilters.length > 0 ? "1" : "",
    canEditPlanningFields && releaseTypeFilters.length > 0 ? "1" : "",
    ptColorFilters.length > 0 ? "1" : "",
    areaFilters.length > 0 ? "1" : "",
    workCenterFilters.length > 0 ? "1" : "",
    gerFilters.length > 0 ? "1" : "",
    dateFilters.length > 0 ? "1" : "",
    originFilters.length > 0 ? "1" : "",
  ].filter(Boolean).length;

  function clearFilters() {
    setSearch("");
    setStatusFilters([]);
    setReleaseTypeFilters([]);
    setPtColorFilters([]);
    setAreaFilters([]);
    setWorkCenterFilters([]);
    setGerFilters([]);
    setDateFilters([]);
    setOriginFilters([]);
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
    if (field === "scheduled_date" && clean) {
      const br = clean.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      const iso = br
        ? `${br[3]}-${String(Number(br[2])).padStart(2, "0")}-${String(Number(br[1])).padStart(2, "0")}`
        : clean;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw new Error(`Data inválida: "${clean}".`);
      return iso;
    }
    return clean;
  }

  function planningPayload(row: ActivityRow, overrides: Partial<PlanningDraft> = {}) {
    const current = {
      pbs: planningValue(row, "pbs"),
      pt_number: planningValue(row, "pt_number"),
      pt_color: row.pt_color ?? "",
      release_type: planningValue(row, "release_type"),
      scheduled_date: planningValue(row, "scheduled_date"),
      ...overrides,
    };
    return {
      id: row.id,
      expectedVersion: Math.max(planningVersionsRef.current.get(row.id) ?? 0, row.version),
      pbs: current.pbs || null,
      ptNumber: current.pt_number || null,
      ptColor: (current.pt_color || null) as PtColor | null,
      releaseType: (current.release_type || null) as (typeof RELEASE_TYPES)[number] | null,
      scheduledDate: current.scheduled_date || null,
    };
  }

  async function persistPlanningRows(payload: ReturnType<typeof planningPayload>[], showSuccess = false) {
    planningSavesPendingRef.current += 1;
    setPlanningSavePending(true);
    const run = planningSaveQueueRef.current.then(async () => {
      const versionedPayload = payload.map((row) => ({
        ...row,
        expectedVersion: Math.max(planningVersionsRef.current.get(row.id) ?? 0, row.expectedVersion),
      }));
      try {
        const result = await savePlanningFields({ data: { rows: versionedPayload } });
        if (!result.ok) throw new Error(result.error);
        for (const row of versionedPayload) planningVersionsRef.current.set(row.id, row.expectedVersion + 1);
        if (showSuccess) toast.success(`${result.count} atividade(s) preenchida(s).`);
        qc.invalidateQueries({ queryKey: ["activities"] });
      } catch (error: any) {
        const failedIds = new Set(payload.map((row) => row.id));
        setPlanningDrafts((previous) =>
          Object.fromEntries(Object.entries(previous).filter(([id]) => !failedIds.has(id))),
        );
        qc.invalidateQueries({ queryKey: ["activities"] });
        toast.error(error?.message ?? "Não foi possível salvar os campos de liberação.");
      } finally {
        planningSavesPendingRef.current = Math.max(0, planningSavesPendingRef.current - 1);
        if (planningSavesPendingRef.current === 0) setPlanningSavePending(false);
      }
    });
    planningSaveQueueRef.current = run.catch(() => undefined);
    await run;
  }

  async function changePtColor(row: ActivityRow, color: PtColor | null) {
    setPlanningValue(row.id, "pt_color", color ?? "");
    await persistPlanningRows([planningPayload(row, { pt_color: color ?? "" })]);
  }

  async function commitPlanningCell(row: ActivityRow, field: PlanningField, rawValue: string) {
    if (field === "scheduled_date" && !canEditPlanningDate) {
      toast.error(`A alteração de datas está bloqueada após ${dateEditSettings.data?.cutoffTime ?? "15:00"}.`);
      return;
    }
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
          if (field && (field !== "scheduled_date" || canEditPlanningDate)) {
            values[field] = normalizeGridValue(field, cell);
          }
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
    dragTarget.current = null;
    if (!source || source.field !== targetField || source.rowIndex === targetRow) return;
    if (targetField === "scheduled_date" && !canEditPlanningDate) {
      toast.error(`A alteração de datas está bloqueada após ${dateEditSettings.data?.cutoffTime ?? "15:00"}.`);
      return;
    }
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

  async function exportFilteredActivities() {
    if (isExporting) return;
    if (planningSavesPendingRef.current > 0) {
      toast.info("Aguarde o término do salvamento antes de exportar.");
      return;
    }
    if (!activeWeek.data || filtered.length === 0) {
      toast.error("Não há atividades nos filtros atuais para exportar.");
      return;
    }
    setIsExporting(true);
    try {
      const XLSX = await import("xlsx");
      const responsibleHeader = "Responsável pela informação";
      const reportedAtHeader = "Data da informação";
      const extraHeaders = ["Ger", "Nº PT", "Cor da PT"];
      const exportHeaders = [...ACTIVITY_EXPORT_COLUMNS, ...extraHeaders, responsibleHeader, reportedAtHeader];
      const pad2 = (value: number) => String(value).padStart(2, "0");
      const formatDateOnly = (value: unknown): string => {
        if (value === null || value === undefined || value === "") return "";
        if (value instanceof Date) {
          if (isNaN(value.getTime())) return "";
          return `${pad2(value.getDate())}/${pad2(value.getMonth() + 1)}/${value.getFullYear()}`;
        }
        if (typeof value === "number" && isFinite(value)) {
          const date = new Date(Math.round((value - 25569) * 86400 * 1000));
          if (isNaN(date.getTime())) return "";
          return `${pad2(date.getUTCDate())}/${pad2(date.getUTCMonth() + 1)}/${date.getUTCFullYear()}`;
        }
        const text = String(value).trim();
        if (!text) return "";
        const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
        const br = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
        if (br) return `${pad2(Number(br[1]))}/${pad2(Number(br[2]))}/${br[3]}`;
        const date = new Date(text);
        return isNaN(date.getTime())
          ? ""
          : `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()}`;
      };
      const formatReportedAt = (value: string | null): string => {
        if (!value) return "";
        const date = new Date(value);
        if (isNaN(date.getTime())) return "";
        return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()} ${pad2(
          date.getHours(),
        )}:${pad2(date.getMinutes())}`;
      };

      const rows = filtered
        .slice()
        .sort(
          (a, b) => (a.source_row_number ?? Number.MAX_SAFE_INTEGER) - (b.source_row_number ?? Number.MAX_SAFE_INTEGER),
        )
        .map((activity) => {
          const planning = activity.planning_data ?? {};
          const row: Record<string, unknown> = {};
          for (const header of ACTIVITY_EXPORT_COLUMNS) {
            if (header === "PBS") row[header] = planningValue(activity, "pbs") || planning[header] || "";
            else if (header === "Tipo de Liberação")
              row[header] = planningValue(activity, "release_type") || planning[header] || "";
            else if (header === "Data início")
              row[header] = formatDateOnly(planningValue(activity, "scheduled_date") || planning[header]);
            else if (header === "Status") row[header] = activity.status ?? "Sem apontamento";
            else if (header === "Justificativa") row[header] = activity.justification ?? "";
            else if (header === "Observações") row[header] = activity.observation ?? "";
            else if (header === "Data fim") row[header] = formatDateOnly(planning[header]);
            else row[header] = planning[header] ?? "";
          }
          row["Ger"] = gerLabel(activity);
          row["Nº PT"] = planningValue(activity, "pt_number");
          row["Cor da PT"] = activity.pt_color ? PT_COLOR_LABELS[activity.pt_color] : "";
          row[responsibleHeader] = activity.reported_by_name || activity.reported_by_email || "";
          row[reportedAtHeader] = formatReportedAt(activity.reported_at);
          return row;
        });

      const worksheet = XLSX.utils.json_to_sheet(rows, { header: exportHeaders });
      worksheet["!cols"] = exportHeaders.map((name) => ({
        wch:
          name === "TxtDesc.Oper."
            ? 42
            : name === "Justificativa" || name === "Observações" || name === responsibleHeader
              ? 34
              : name === "Tipo de Liberação" || name === reportedAtHeader
                ? 18
                : Math.max(11, name.length + 2),
      }));
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Acompanhamento");
      const code = String(activeWeek.data.code ?? "semana").replace(/\//g, "-");
      XLSX.writeFile(workbook, `${code}-apontamentos-filtrados.xlsx`);
      toast.success(`${rows.length.toLocaleString("pt-BR")} atividade(s) exportada(s) com os filtros atuais.`);
    } catch (error: any) {
      toast.error(error?.message ?? "Falha ao exportar as atividades filtradas.");
    } finally {
      setIsExporting(false);
    }
  }

  async function exportPrintableSchedule() {
    if (isPrinting) return;
    if (planningSavesPendingRef.current > 0) {
      toast.info("Aguarde o término do salvamento antes de gerar a impressão.");
      return;
    }
    if (!activeWeek.data || filtered.length === 0) {
      toast.error("Não há atividades nos filtros atuais para imprimir.");
      return;
    }

    setIsPrinting(true);
    try {
      const ExcelJS = (await import("exceljs")).default;
      const workbook = new ExcelJS.Workbook();
      workbook.creator = "NEXO";
      workbook.created = new Date();
      const worksheet = workbook.addWorksheet("Impressão", {
        views: [{ showGridLines: false }],
        pageSetup: {
          orientation: "landscape",
          paperSize: 9,
          fitToPage: true,
          fitToWidth: 1,
          fitToHeight: 0,
          margins: { left: 0, right: 0, top: 0, bottom: 0, header: 0, footer: 0 },
        },
      });

      worksheet.mergeCells("D1:Q1");
      worksheet.mergeCells("D2:Q2");
      worksheet.mergeCells("D3:Q3");
      worksheet.mergeCells("S1:T1");
      worksheet.mergeCells("S2:T2");
      worksheet.mergeCells("S3:T3");
      worksheet.mergeCells("F7:G7");
      worksheet.mergeCells("H7:J7");

      worksheet.getCell("D1").value = "SISTEMA DE GESTÃO INTEGRADO";
      worksheet.getCell("D2").value = "FORMULÁRIO DE GESTÃO";
      worksheet.getCell("D3").value = "PROGRAMAÇÃO DE EXECUÇÃO SEMANAL";
      worksheet.getCell("S1").value = "FG-ENG-068-751";
      worksheet.getCell("S2").value = "REV.: 00";
      worksheet.getCell("S3").value = new Date(2023, 3, 25);
      worksheet.getCell("S3").numFmt = "dd/mm/yyyy";

      worksheet.getCell("A5").value = "Período de execução:";
      worksheet.getCell("B5").value = new Date(`${activeWeek.data.start_date}T12:00:00`);
      worksheet.getCell("B5").numFmt = "dd/mm/yyyy";
      worksheet.getCell("D5").value = "à";
      worksheet.getCell("E5").value = new Date(`${activeWeek.data.end_date}T12:00:00`);
      worksheet.getCell("E5").numFmt = "dd/mm/yyyy";
      worksheet.getCell("I5").value = "SEMANA:";
      worksheet.getCell("J5").value = activeWeek.data.label || activeWeek.data.code;

      worksheet.getCell("A7").value = "Contrat.:";
      worksheet.getCell("B7").value = "Petróleo Brasileiro S.A/RPBC";
      worksheet.getCell("F7").value = "Contratada:";
      worksheet.getCell("H7").value = "Normatel Engenharia Ltda.";

      const headerFill = "385723";
      const tableStripeFill = "E2F0D9";
      const thinBorder = {
        top: { style: "thin" as const, color: { argb: "FF7F8C99" } },
        left: { style: "thin" as const, color: { argb: "FF7F8C99" } },
        bottom: { style: "thin" as const, color: { argb: "FF7F8C99" } },
        right: { style: "thin" as const, color: { argb: "FF7F8C99" } },
      };
      for (let row = 1; row <= 3; row += 1) {
        worksheet.getRow(row).height = 18;
        for (let column = 1; column <= 21; column += 1) {
          const cell = worksheet.getRow(row).getCell(column);
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${headerFill}` } };
          cell.font = { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
          cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
        }
      }

      try {
        const logoResponse = await fetch(logoAsset.url);
        if (logoResponse.ok) {
          const logoId = workbook.addImage({
            buffer: (await logoResponse.arrayBuffer()) as any,
            extension: "png",
          });
          worksheet.addImage(logoId, {
            tl: { col: 0.2, row: 0.2 },
            br: { col: 2.8, row: 2.8 },
          } as any);
        }
      } catch {
        // A geração continua mesmo se o logotipo estiver temporariamente indisponível.
      }

      worksheet.getRow(4).height = 6;
      worksheet.getRow(5).height = 18;
      worksheet.getRow(6).height = 6;
      worksheet.getRow(7).height = 18;
      worksheet.getRow(8).height = 11.4;
      for (const rowNumber of [5, 7]) {
        const row = worksheet.getRow(rowNumber);
        row.font = { name: "Arial", size: 10, bold: true };
        row.alignment = { vertical: "middle" };
        for (let column = 1; column <= 21; column += 1) {
          row.getCell(column).fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${headerFill}` } };
          row.getCell(column).font = { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
        }
      }

      const printHeaders = [
        "Ger",
        "Localização",
        "Nota",
        "Tipo de Lib",
        "Nº PT",
        "Cor PT",
        "Ordem",
        "Op",
        "Sub",
        "Data",
        "Gr pl",
        "Área Op",
        "CenTrab",
        "TxtDesc.Oper.",
        "Nº",
        "Dur n",
        "Trab",
        "EXE.",
        "AND",
        "N.EXE",
        "Observação",
      ];
      const rows = filtered
        .slice()
        .sort(
          (a, b) => (a.source_row_number ?? Number.MAX_SAFE_INTEGER) - (b.source_row_number ?? Number.MAX_SAFE_INTEGER),
        )
        .map((activity) => {
          const planning = activity.planning_data ?? {};
          return [
            gerLabel(activity),
            planning["Localização"] ?? "",
            activity.note_number ?? planning["Nota"] ?? "",
            planningValue(activity, "release_type"),
            planningValue(activity, "pt_number"),
            activity.pt_color ? PT_COLOR_LABELS[activity.pt_color] : "",
            activity.order_number ?? planning["Ordem"] ?? "",
            planning["Op"] ?? "",
            planning["Subop"] ?? "",
            activity.scheduled_date ? new Date(`${activity.scheduled_date}T12:00:00`) : "",
            planning["Gr pl"] ?? "",
            planning["Área op"] ?? "",
            planning["CenTrab"] ?? "",
            activity.description || planning["TxtDesc.Oper."] || "",
            planning["Nº"] ?? "",
            planning["Dur n"] ?? "",
            planning["Trab"] ?? "",
            "",
            "",
            "",
            "",
          ];
        });

      worksheet.getRow(9).values = printHeaders;
      rows.forEach((values) => worksheet.addRow(values));

      worksheet.getRow(9).height = 18;
      worksheet.getRow(9).font = { name: "Arial", size: 9, bold: true, color: { argb: "FFFFFFFF" } };
      worksheet.getRow(9).alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      for (let column = 1; column <= 21; column += 1) {
        const cell = worksheet.getRow(9).getCell(column);
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${headerFill}` } };
        cell.border = thinBorder;
      }
      for (let rowNumber = 10; rowNumber <= rows.length + 9; rowNumber += 1) {
        const row = worksheet.getRow(rowNumber);
        row.height = 21;
        row.font = { name: "Arial", size: 8 };
        row.alignment = { vertical: "middle", wrapText: true };
        for (let column = 1; column <= 21; column += 1) {
          const cell = row.getCell(column);
          cell.border = thinBorder;
          if (rowNumber % 2 === 0) {
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${tableStripeFill}` } };
          }
        }
        row.getCell(10).numFmt = "dd/mm/yyyy";
        for (const column of [1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15, 16, 17, 18, 19, 20]) {
          row.getCell(column).alignment = { horizontal: "center", vertical: "middle", wrapText: true };
        }
      }

      [11, 13, 13, 13, 13, 9, 17, 9, 9, 12, 10, 9, 16, 42, 8, 8, 8, 7, 7, 7, 36].forEach((width, index) => {
        worksheet.getColumn(index + 1).width = width;
      });

      const lastRow = rows.length + 9;
      worksheet.pageSetup.printArea = `A1:U${lastRow}`;
      worksheet.pageSetup.printTitlesRow = "1:9";

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer as BlobPart], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const code = String(activeWeek.data.code ?? "semana").replace(/\//g, "-");
      anchor.href = url;
      anchor.download = `programacao-impressao-${code}.xlsx`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast.success(`${rows.length.toLocaleString("pt-BR")} atividade(s) preparadas no modelo de impressão.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível gerar o modelo de impressão.");
    } finally {
      setIsPrinting(false);
    }
  }

  return (
    <main className="mx-auto max-w-none px-4 py-6 sm:px-6">
      <PageHeader
        eyebrow={activeWeek.data?.lifecycle_status === "preparation" ? "Semana em preparação" : "Semana operacional"}
        title={activeWeek.data?.label ?? "—"}
        description={
          activeWeek.data
            ? `${formatDate(activeWeek.data.start_date)} a ${formatDate(activeWeek.data.end_date)} · ${kpis.total} atividades programadas`
            : "Nenhuma semana operacional."
        }
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {canAccessPreparation && (availableWeeks.data?.length ?? 0) > 0 && (
              <select
                value={selectedWeekId || activeWeek.data?.id || ""}
                onChange={(event) => {
                  setSelectedWeekId(event.target.value);
                  setSelected(new Set());
                  setPage(0);
                }}
                className="input-base h-10 min-h-10 w-[155px] max-w-full py-0 text-xs sm:w-[170px]"
                aria-label="Selecionar semana de trabalho"
              >
                {(availableWeeks.data ?? []).map((week: any) => (
                  <option key={week.id} value={week.id}>
                    {week.label} — {week.lifecycle_status === "preparation" ? "Em preparação" : "Operacional"}
                  </option>
                ))}
              </select>
            )}
            {canEditPlanningFields && (
              <>
                <button
                  onClick={exportPrintableSchedule}
                  disabled={isPrinting || planningSavePending || filtered.length === 0}
                  className="btn-ghost h-10 min-h-10 justify-center px-3 py-0 text-xs"
                  title="Gerar o modelo de impressão com os filtros atuais"
                >
                  <Printer className="h-3.5 w-3.5" />
                  {planningSavePending ? "Salvando…" : isPrinting ? "Gerando…" : "Imprimir programação"}
                </button>
                <button
                  onClick={exportFilteredActivities}
                  disabled={isExporting || planningSavePending || filtered.length === 0}
                  className="btn-ghost h-10 min-h-10 justify-center px-3 py-0 text-xs"
                  title="Exportar as atividades com os filtros atuais"
                >
                  <Download className="h-3.5 w-3.5" />
                  {planningSavePending ? "Salvando…" : isExporting ? "Exportando…" : "Exportar"}
                </button>
              </>
            )}
            <button
              onClick={() => activities.refetch()}
              className="btn-ghost h-10 min-h-10 justify-center px-3 py-0 text-xs"
              title="Recarregar"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Atualizar
            </button>
            <div className="hidden text-right sm:block">
              <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Conclusão</div>
              <div className="text-lg font-semibold leading-none text-foreground tabular">{kpis.percent}%</div>
            </div>
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

      {canLoadDateEditSettings && (
        <div
          className={cn(
            "mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2 text-xs",
            dateEditLocked
              ? "border-destructive/30 bg-destructive/5 text-destructive"
              : "border-success/30 bg-success/5 text-foreground",
          )}
        >
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4" />
            <span>
              Alteração de datas {dateEditLocked ? "bloqueada" : "liberada"}. Corte diário às{" "}
              <strong>{dateEditSettings.data?.cutoffTime ?? "15:00"}</strong> (horário de Brasília).
            </span>
          </div>
          {canConfigureDateCutoff && (
            <form
              className="flex items-center gap-2"
              onSubmit={async (event) => {
                event.preventDefault();
                const result = await saveDateEditCutoff({ data: { cutoffTime: cutoffDraft } });
                if (!result.ok) {
                  toast.error(result.error);
                  return;
                }
                toast.success(`Horário de corte alterado para ${result.cutoffTime}.`);
                dateEditSettings.refetch();
              }}
            >
              <label htmlFor="date-edit-cutoff" className="font-medium">
                Horário de corte
              </label>
              <input
                id="date-edit-cutoff"
                type="time"
                value={cutoffDraft}
                onChange={(event) => setCutoffDraft(event.target.value)}
                className="input-base w-[110px] py-1.5 text-xs"
                required
              />
              <button type="submit" className="btn-primary py-1.5 text-xs">
                Salvar
              </button>
            </form>
          )}
        </div>
      )}

      {/* KPIs */}
      <section className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
        <button
          type="button"
          onClick={() => toggleKpiStatus("")}
          className="rounded-md text-left transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          title="Mostrar todos os status dentro dos demais filtros"
        >
          <KpiCard label="Programadas" value={kpis.total} icon={<ListChecks className="h-3.5 w-3.5" />} />
        </button>
        <button
          type="button"
          onClick={() => toggleKpiStatus("EXECUTADO")}
          className={cn(
            "rounded-md text-left transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
            statusFilters.includes("EXECUTADO") && "ring-2 ring-success/50",
          )}
          aria-pressed={statusFilters.includes("EXECUTADO")}
        >
          <KpiCard
            label="Executadas"
            value={kpis.concluded}
            tone="success"
            icon={<CheckCircle2 className="h-3.5 w-3.5" />}
          />
        </button>
        <button
          type="button"
          onClick={() => toggleKpiStatus("NÃO EXECUTADO")}
          className={cn(
            "rounded-md text-left transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
            statusFilters.includes("NÃO EXECUTADO") && "ring-2 ring-destructive/50",
          )}
          aria-pressed={statusFilters.includes("NÃO EXECUTADO")}
        >
          <KpiCard
            label="Não executadas"
            value={kpis.impeded}
            tone="destructive"
            icon={<AlertTriangle className="h-3.5 w-3.5" />}
          />
        </button>
        <button
          type="button"
          onClick={() => toggleKpiStatus(PENDING_REPORT_FILTER)}
          className={cn(
            "rounded-md text-left transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
            statusFilters.includes(PENDING_REPORT_FILTER) && "ring-2 ring-border",
          )}
          aria-pressed={statusFilters.includes(PENDING_REPORT_FILTER)}
          title="Inclui Sem apontamento e os três status do fluxo de PT"
        >
          <KpiCard label="Sem apontamento" value={kpis.noReport} icon={<Clock className="h-3.5 w-3.5" />} />
        </button>
        <button
          type="button"
          onClick={() => toggleKpiStatus("CANCELADA")}
          className={cn(
            "rounded-md text-left transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
            statusFilters.includes("CANCELADA") && "ring-2 ring-warning/50",
          )}
          aria-pressed={statusFilters.includes("CANCELADA")}
        >
          <KpiCard label="Canceladas" value={kpis.cancelled} tone="warning" icon={<X className="h-3.5 w-3.5" />} />
        </button>
        <KpiCard
          label="HH programado"
          value={formatActivityHours(kpis.hours)}
          icon={<Clock className="h-3.5 w-3.5" />}
        />
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
        <FilterMultiSelect
          options={[PENDING_REPORT_FILTER, ...statusOptions]}
          selected={statusFilters}
          onChange={(next) => {
            setStatusFilters(next);
            setPage(0);
          }}
          allLabel="Todos os status"
          ariaLabel="Filtrar por status"
          searchPlaceholder="Buscar status..."
          selectedPlural="status selecionados"
          optionLabel={(value) => (value === PENDING_REPORT_FILTER ? "Sem apontamento + fluxo de PT" : value)}
        />
        {canEditPlanningFields && (
          <FilterMultiSelect
            options={[...releaseTypeOptions, ...(hasEmptyReleaseType ? ["__EMPTY__"] : [])]}
            selected={releaseTypeFilters}
            onChange={(next) => {
              setReleaseTypeFilters(next);
              setPage(0);
            }}
            allLabel="Todos os tipos de liberação"
            ariaLabel="Filtrar por tipo de liberação"
            searchPlaceholder="Buscar tipo..."
            selectedPlural="tipos selecionados"
            optionLabel={(value) => (value === "__EMPTY__" ? "Sem tipo de liberação" : value)}
          />
        )}
        <FilterMultiSelect
          options={[...ptColorOptions]}
          selected={ptColorFilters}
          onChange={(next) => {
            setPtColorFilters(next);
            setPage(0);
          }}
          allLabel="Todas as cores de PT"
          ariaLabel="Filtrar por cor da PT"
          selectedPlural="cores selecionadas"
          optionLabel={(value) => PT_COLOR_LABELS[value as PtColor]}
        />
        <FilterMultiSelect
          options={areas}
          selected={areaFilters}
          onChange={(next) => {
            setAreaFilters(next);
            setPage(0);
          }}
          allLabel="Todas as áreas"
          ariaLabel="Filtrar por área"
          searchPlaceholder="Buscar área..."
          selectedPlural="áreas selecionadas"
        />
        <FilterMultiSelect
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
        <FilterMultiSelect
          options={workCenters}
          selected={workCenterFilters}
          onChange={(next) => {
            setWorkCenterFilters(next);
            setPage(0);
          }}
        />

        <FilterMultiSelect
          options={[...(hasProgrammed ? ["programmed"] : []), ...(hasImmediate ? ["immediate"] : [])]}
          selected={originFilters}
          onChange={(next) => {
            setOriginFilters(next);
            setPage(0);
          }}
          allLabel="Todas as atividades"
          ariaLabel="Filtrar por origem da atividade"
          selectedPlural="origens selecionadas"
          optionLabel={(value) => (value === "programmed" ? "Programadas" : "Imediatas")}
        />
        <FilterMultiSelect
          options={dateOptions}
          selected={dateFilters}
          onChange={(next) => {
            setDateFilters(next);
            setPage(0);
          }}
          allLabel="Todas as datas"
          ariaLabel="Filtrar por data"
          searchPlaceholder="Buscar data..."
          selectedPlural="datas selecionadas"
          optionLabel={(value) => formatDate(value)}
        />
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
                    <th className="px-2 py-2 text-left font-semibold">Oper / Sub</th>
                    <th className="px-2 py-2 text-left font-semibold">Atividade</th>
                    {canEditPlanningFields && <th className="px-2 py-2 text-left font-semibold">Localização</th>}
                    <th className="px-2 py-2 text-left font-semibold">Área / Especialidade</th>
                    <th className="px-2 py-2 text-left font-semibold">PBS</th>
                    <th className="px-2 py-2 text-left font-semibold">Nº PT / Cor</th>
                    <th className="px-2 py-2 text-left font-semibold">Tipo de Liberação</th>
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
                      {canEditPlanningFields && (
                        <td className="px-2 py-2 align-top text-[11px]">
                          {fmtPlan(r.planning_data, "Localização") ?? "—"}
                        </td>
                      )}
                      <td className="px-2 py-2 align-top text-[11px]">
                        <div className="text-foreground">{r.area}</div>
                        <div className="text-muted-foreground">{r.specialty}</div>
                      </td>
                      {(["pbs", "pt_number", "release_type", "scheduled_date"] as PlanningField[]).map((field) => {
                        const rowIndex = paged.findIndex((row) => row.id === r.id);
                        return (
                          <td key={field} className="px-1 py-1.5 align-top text-[11px]">
                            <div className={cn(field === "pt_number" && "flex min-w-[185px] items-center gap-2")}>
                              <PlanningGridCell
                                value={planningValue(r, field)}
                                field={field}
                                editable={canEditPlanningFields && (field !== "scheduled_date" || canEditPlanningDate)}
                                onChange={(value) => setPlanningValue(r.id, field, value)}
                                onCommit={(value) => commitPlanningCell(r, field, value)}
                                onPaste={(event) => pastePlanningGrid(event, rowIndex, field)}
                                onDragStart={() => {
                                  dragSource.current = { rowIndex, field };
                                  dragTarget.current = { rowIndex, field };
                                }}
                                onDragEnter={() => {
                                  if (dragSource.current?.field === field) {
                                    dragTarget.current = { rowIndex, field };
                                  }
                                }}
                                onDragEnd={() => {
                                  const target = dragTarget.current;
                                  if (target) void fillPlanningByDrag(target.rowIndex, target.field);
                                }}
                                onDrop={() => fillPlanningByDrag(rowIndex, field)}
                              />
                              {field === "pt_number" && (
                                <PtColorSelector
                                  value={r.pt_color}
                                  editable={canEditPlanningFields}
                                  onChange={(color) => void changePtColor(r, color)}
                                />
                              )}
                            </div>
                          </td>
                        );
                      })}
                      <td className="px-2 py-2 align-top">
                        <StatusPill status={r.status} />
                        {r.status === "CANCELADA" && r.justification && (
                          <div className="mt-1 max-w-44 text-[10px] leading-tight text-muted-foreground">
                            {r.justification}
                          </div>
                        )}
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
                    {canEditPlanningFields && (
                      <div className="mt-1 text-[10px] text-muted-foreground">
                        Localização: {fmtPlan(r.planning_data, "Localização") ?? "—"}
                      </div>
                    )}
                    <div className="mt-1 text-[10px] text-muted-foreground">
                      PBS: {r.pbs || "—"} · Nº PT: {r.pt_number || "—"} · {r.release_type || "Sem liberação"}
                    </div>
                    <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground">
                      <span>Cor da PT:</span>
                      <PtColorSelector
                        value={r.pt_color}
                        editable={canEditPlanningFields}
                        onChange={(color) => void changePtColor(r, color)}
                      />
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <StatusPill status={r.status} />
                  <button onClick={() => setEditing(r)} className="btn-primary py-1.5 text-xs">
                    {r.status === "Sem apontamento" ? "Apontar" : "Atualizar"}
                  </button>
                </div>
                {r.status === "CANCELADA" && r.justification && (
                  <div className="mt-2 rounded-md border border-warning/40 bg-warning/10 px-2 py-1.5 text-[11px] text-warning-foreground">
                    <span className="font-semibold">Motivo do cancelamento:</span> {r.justification}
                  </div>
                )}
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
          canCancel={canEditPlanningFields}
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
          rows={allRows
            .filter((row) => selected.has(row.id))
            .map((row) => ({ id: row.id, expectedVersion: row.version }))}
          weekId={activeWeek.data!.id}
          canCancel={canEditPlanningFields}
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
      .map((row) => [row.pbs ?? "", row.pt_number ?? "", row.release_type ?? "", row.scheduled_date ?? ""].join("\t"))
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
        const [pbs, ptNumber, releaseType, scheduledDate] = cells.map((cell) => cell.trim());
        if (releaseType && !RELEASE_TYPES.includes(releaseType as (typeof RELEASE_TYPES)[number])) {
          throw new Error(`Tipo de liberação inválido na linha ${index + 1}. Use PT, PTT, ATRE ou Oficina.`);
        }
        if (scheduledDate && !/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)) {
          throw new Error(`Data inválida na linha ${index + 1}. Use AAAA-MM-DD.`);
        }
        return {
          id: rows[index].id,
          pbs: pbs || null,
          ptNumber: ptNumber || null,
          releaseType: (releaseType || null) as (typeof RELEASE_TYPES)[number] | null,
          scheduledDate: scheduledDate || null,
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
          <span>Data</span>
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
  canCancel,
  onClose,
  onSaved,
}: {
  activity: ActivityRow;
  canCancel: boolean;
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
          <select
            value={status}
            onChange={(e) => {
              const nextStatus = e.target.value;
              if (!REQUIRES_JUSTIFICATION.has(nextStatus)) setJustification("");
              if (nextStatus === "CANCELADA" && !CANCELLATION_JUSTIFICATIONS.includes(justification))
                setJustification("");
              setStatus(nextStatus);
            }}
            className="input-base"
          >
            {STATUSES.filter(
              (s) => (!PLANNING_WORKFLOW_STATUSES.has(s) && s !== "CANCELADA") || canCancel || activity.status === s,
            ).map((s) => (
              <option
                key={s}
                value={s}
                disabled={(s === "CANCELADA" || PLANNING_WORKFLOW_STATUSES.has(s)) && !canCancel}
              >
                {s}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Justificativa" required={needsJust}>
          <select
            value={needsJust ? justification : ""}
            onChange={(e) => {
              const value = e.target.value;
              setJustification(value);
              if (status === "NÃO EXECUTADO" && value === IMMEDIATE_JUSTIFICATION) setImmediatePickerOpen(true);
            }}
            className="input-base"
            disabled={!needsJust}
          >
            <option value="">— Selecione —</option>
            {(status === "CANCELADA" ? CANCELLATION_JUSTIFICATIONS : JUSTIFICATIONS).map((j) => (
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
  order_number: "Ordem",
  note_number: "Nota",
  description: "Descrição",
  area: "Área",
  specialty: "Especialidade",
  scheduled_date: "Data",
  pbs: "PBS",
  pt_number: "Nº PT",
  pt_color: "Cor da PT",
  release_type: "Tipo de Liberação",
  d1_date: "Data D-1",
  is_immediate: "Atividade imediata",
};

function historyValue(v: unknown, key?: string): string {
  if (v === null || v === undefined || v === "") return "—";
  if (key === "pt_color" && typeof v === "string" && PT_COLORS.includes(v as PtColor)) {
    return PT_COLOR_LABELS[v as PtColor];
  }
  if ((key === "scheduled_date" || key === "d1_date") && typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [year, month, day] = v.split("-");
    return `${day}/${month}/${year}`;
  }
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
              (k) => k in next && historyValue(prev[k], k) !== historyValue(next[k], k),
            );
            return (
              <li key={h.id} className="relative border-l border-border pl-3">
                <span className="absolute -left-[3px] top-1.5 h-1.5 w-1.5 rounded-full bg-primary" />
                <div className="flex flex-wrap items-baseline gap-x-2 text-[11px]">
                  <span className="tabular font-medium text-foreground">
                    {new Date(h.changed_at).toLocaleString("pt-BR")}
                  </span>
                  <span className="text-muted-foreground">{h.changed_by_name || h.changed_by_email || "Sistema"}</span>
                  <span className="status-pill border-border bg-muted text-muted-foreground">
                    {h.change_source === "planning" ? "Planejamento" : h.change_source}
                  </span>
                </div>
                <div className="mt-1 space-y-0.5">
                  {keys.length === 0 ? (
                    <div className="text-[11px] text-muted-foreground">Atualização sem mudança de campos.</div>
                  ) : (
                    keys.map((k) => (
                      <div key={k} className="text-[11px]">
                        <span className="font-medium text-foreground">{HISTORY_LABELS[k]}: </span>
                        <span className="text-muted-foreground line-through">{historyValue(prev[k], k)}</span>
                        <span className="text-muted-foreground"> → </span>
                        <span className="text-foreground">{historyValue(next[k], k)}</span>
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
  rows,
  weekId,
  canCancel,
  onClose,
  onSaved,
}: {
  count: number;
  rows: { id: string; expectedVersion: number }[];
  weekId: string;
  canCancel: boolean;
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
          rows,
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
          <select
            value={status}
            onChange={(e) => {
              const nextStatus = e.target.value;
              if (!REQUIRES_JUSTIFICATION.has(nextStatus)) setJustification("");
              if (nextStatus === "CANCELADA" && !CANCELLATION_JUSTIFICATIONS.includes(justification))
                setJustification("");
              setStatus(nextStatus);
            }}
            className="input-base"
          >
            {STATUSES.filter((s) => canCancel || (s !== "CANCELADA" && !PLANNING_WORKFLOW_STATUSES.has(s))).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Justificativa" required={needsJust}>
          <select
            value={needsJust ? justification : ""}
            onChange={(e) => {
              const value = e.target.value;
              setJustification(value);
              if (status === "NÃO EXECUTADO" && value === IMMEDIATE_JUSTIFICATION) setImmediatePickerOpen(true);
            }}
            className="input-base"
            disabled={!needsJust}
          >
            <option value="">— Selecione —</option>
            {(status === "CANCELADA" ? CANCELLATION_JUSTIFICATIONS : JUSTIFICATIONS).map((j) => (
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
