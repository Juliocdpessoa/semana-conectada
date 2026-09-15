import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useDeferredValue, useMemo, useRef, useState } from "react";
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
  Upload,
} from "lucide-react";
import logoAsset from "@/assets/normatel-logo.png.asset.json";
import type { SessionInfo } from "./route";
import {
  PageHeader,
  KpiCard,
  Toolbar,
  EmptyState,
  Skeleton,
  StatusPill,
  Modal,
  Field,
} from "@/components/ui-kit";
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

type SapConfirmationOverview = {
  deadline: string;
  hasImport: boolean;
  importedRows: number;
  statuses: Record<string, SapConfirmationStatus>;
  counts: Partial<Record<SapConfirmationStatus, number>>;
  unprogrammedCount: number;
  unprogrammed: Array<{
    id: string;
    order_number: string;
    operation: string | null;
    suboperation: string | null;
    description: string | null;
    actual_start_date: string | null;
    actual_end_date: string | null;
    actual_work: number | null;
    confirmation: string;
    sap_status: string;
  }>;
};

type SapConfirmationStatus =
  | "Aguardando confirmação"
  | "Confirmada no SAP"
  | "Confirmada sem HH"
  | "Não confirmada no SAP"
  | "Confirmação não esperada"
  | "Divergência";

const SAP_STATUS_OPTIONS: SapConfirmationStatus[] = [
  "Confirmada no SAP",
  "Confirmada sem HH",
  "Aguardando confirmação",
  "Não confirmada no SAP",
  "Confirmação não esperada",
  "Divergência",
];

type SapImportRow = {
  source_row_number: number;
  order_number: string;
  operation: string | null;
  suboperation: string | null;
  planning_code: string | null;
  work_center: string | null;
  description: string | null;
  actual_start_date: string | null;
  actual_end_date: string | null;
  system_status: string | null;
  normal_duration: number | null;
  planned_work: number | null;
  actual_work: number | null;
  user_status: string | null;
  operational_area: string | null;
  confirmation: string;
};

type SapImportPreview = {
  fileName: string;
  rows: SapImportRow[];
  confirmed: number;
  confirmedWithoutHours: number;
  withoutConfirmation: number;
};

type PtImportChange = {
  row: ActivityRow;
  confirmation: string;
  nextPtNumber: string | null;
  nextPtColor: PtColor | null;
  replacesExisting: boolean;
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
const PLANNING_WORKFLOW_STATUSES = new Set([
  "AGUARDANDO PRÉ-EMISSÃO DE PT",
  "PT EM ASSINATURA",
  "PT ENVIADA P/ CAMPO",
]);
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
const PT_COLOR_LABELS: Record<PtColor, string> = {
  red: "Vermelha",
  yellow: "Amarela",
  white: "Branca",
};
const ACTIVITY_SORT_COLLATOR = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" });
const pad2 = (value: number) => String(value).padStart(2, "0");

function SapStatusPill({ status }: { status?: SapConfirmationStatus }) {
  if (!status) return <span className="text-[11px] text-muted-foreground">Sem carga SAP</span>;
  const styles: Record<SapConfirmationStatus, string> = {
    "Confirmada no SAP": "border-success/40 bg-success/10 text-success",
    "Confirmada sem HH": "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300",
    "Aguardando confirmação": "border-warning/50 bg-warning/15 text-warning-foreground",
    "Não confirmada no SAP": "border-destructive/40 bg-destructive/10 text-destructive",
    "Confirmação não esperada": "border-border bg-muted text-muted-foreground",
    Divergência: "border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  };
  return <span className={cn("status-pill whitespace-nowrap", styles[status])}>{status}</span>;
}

function normalizedSpreadsheetHeader(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Z0-9]/gi, "")
    .toUpperCase();
}

function sapText(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

function sapNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = String(value).trim();
  if (!text) return null;
  const normalized = text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : text;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function sapDate(value: unknown, XLSX: any): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;
  }
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    return parsed ? `${parsed.y}-${pad2(parsed.m)}-${pad2(parsed.d)}` : null;
  }
  const text = String(value ?? "").trim();
  if (!text) return null;
  const br = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (br) return `${br[3]}-${pad2(Number(br[2]))}-${pad2(Number(br[1]))}`;
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
}

async function parseSapWorkbook(file: File): Promise<SapImportPreview> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  const worksheet = workbook.Sheets[workbook.SheetNames[0]];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1,
    defval: "",
    raw: true,
  });
  if (matrix.length < 2) throw new Error("A planilha SAP não contém linhas de dados.");

  const header = matrix[0].map(normalizedSpreadsheetHeader);
  const aliases: Record<string, string[]> = {
    order_number: ["ORDEM"],
    operation: ["OPERACAO"],
    suboperation: ["SUBOPERACAO"],
    planning_code: ["CODPLANORDEM"],
    work_center: ["CENTRABOPERACAO"],
    description: ["TXTDESCOPER"],
    actual_start_date: ["DATAINICREAL", "DTINICIOEXECUCAO", "DATAINICIOEXECUCAO"],
    actual_end_date: ["DATAFIMREAL", "DATADOFIMEXECUCAO", "DTFIMEXECUCAO"],
    system_status: ["SISTSTATOPER"],
    normal_duration: ["DURACAONORMAL"],
    planned_work: ["TRABALHO"],
    actual_work: ["TRABALHOREAL"],
    user_status: ["STATUSUSUARIO"],
    operational_area: ["AREAOPERACION"],
    confirmation: ["CONFIRMACAO"],
  };
  const indexes = Object.fromEntries(
    Object.entries(aliases).map(([key, names]) => [
      key,
      header.findIndex((value) => names.includes(value)),
    ]),
  ) as Record<keyof typeof aliases, number>;
  const missing = Object.entries(indexes)
    .filter(([, index]) => index < 0)
    .map(([key]) => key);
  if (missing.length) {
    throw new Error(`Colunas obrigatórias ausentes ou renomeadas: ${missing.join(", ")}.`);
  }

  const rows = matrix.slice(1).flatMap((source, index) => {
    const value = (key: keyof typeof aliases) => source[indexes[key]];
    const order = sapText(value("order_number"));
    const confirmation = sapText(value("confirmation"));
    if (!order && !confirmation && source.every((cell) => sapText(cell) === null)) return [];
    if (!order || !confirmation) {
      throw new Error(`Linha ${index + 2}: Ordem e Confirmação são obrigatórias.`);
    }
    return [{
      source_row_number: index + 2,
      order_number: order,
      operation: sapText(value("operation")),
      suboperation: sapText(value("suboperation")),
      planning_code: sapText(value("planning_code")),
      work_center: sapText(value("work_center")),
      description: sapText(value("description")),
      actual_start_date: sapDate(value("actual_start_date"), XLSX),
      actual_end_date: sapDate(value("actual_end_date"), XLSX),
      system_status: sapText(value("system_status")),
      normal_duration: sapNumber(value("normal_duration")),
      planned_work: sapNumber(value("planned_work")),
      actual_work: sapNumber(value("actual_work")),
      user_status: sapText(value("user_status")),
      operational_area: sapText(value("operational_area")),
      confirmation,
    } satisfies SapImportRow];
  });
  if (!rows.length) throw new Error("A planilha SAP não contém registros válidos.");
  if (rows.length > 5000) throw new Error("A planilha excede o limite de 5.000 registros.");

  const hasConf = (row: SapImportRow) =>
    (row.system_status ?? "").toUpperCase().split(/\s+/).includes("CONF");
  return {
    fileName: file.name,
    rows,
    confirmed: rows.filter((row) => hasConf(row) && (row.actual_work ?? 0) > 0).length,
    confirmedWithoutHours: rows.filter((row) => hasConf(row) && (row.actual_work ?? 0) <= 0).length,
    withoutConfirmation: rows.filter((row) => !hasConf(row)).length,
  };
}

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
function areaLabel(r: {
  area: string | null;
  planning_data: Record<string, unknown> | null;
}): string | null {
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
    fmtPlan(r.planning_data, "Área op") ??
    fmtPlan(r.planning_data, "Área Op") ??
    fmtPlan(r.planning_data, "Area Op")
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
          className="input-base flex w-full items-center justify-between gap-2 py-2 text-left text-xs sm:w-auto sm:max-w-[260px]"
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
          {visible.length === 0 && (
            <p className="px-2 py-3 text-xs text-muted-foreground">Nenhum centro encontrado.</p>
          )}
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
            <button
              type="button"
              className="btn-ghost py-1 text-[11px]"
              onClick={() => onChange([])}
            >
              Limpar
            </button>
          </div>
          <button
            type="button"
            className="btn-primary py-1 text-[11px]"
            onClick={() => setOpen(false)}
          >
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
              backgroundColor:
                color === "red" ? "#dc2626" : color === "yellow" ? "#facc15" : "#ffffff",
              borderColor: color === "red" ? "#991b1b" : color === "yellow" ? "#ca8a04" : "#64748b",
            }}
            className={cn(
              "relative h-5 w-5 rounded-full border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
              selected
                ? "scale-110 ring-2 ring-primary ring-offset-1"
                : "opacity-55 hover:scale-105 hover:opacity-100",
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
  const effectiveRoles = session.roles.length > 0 ? session.roles : session.role ? [session.role] : [];
  const isLeaderOnly = effectiveRoles.length === 1 && effectiveRoles[0] === "leader";
  const canEditPlanningFields = session.roles.some(
    (role) => role === "planning" || role === "admin",
  );
  const isPlanning =
    session.roles.includes("planning") ||
    (session.roles.includes("admin") &&
      session.email.trim().toLowerCase() === "julio.pessoa@normatel.com.br");
  const canAccessSap = isPlanning;
  const canAccessPreparation = canEditPlanningFields;
  const isDateEditAdmin = session.email.trim().toLowerCase() === "julio.pessoa@normatel.com.br";
  const canLoadDateEditSettings =
    canEditPlanningFields || session.roles.includes("admin") || isDateEditAdmin;
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
  const [planningGroupFilters, setPlanningGroupFilters] = useState<string[]>([]);
  const [gerFilters, setGerFilters] = useState<string[]>([]);
  const [dateFilters, setDateFilters] = useState<string[]>([]);
  const [originFilters, setOriginFilters] = useState<string[]>([]);
  const [sapStatusFilters, setSapStatusFilters] = useState<SapConfirmationStatus[]>([]);
  const [selectedWeekId, setSelectedWeekId] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [editing, setEditing] = useState<ActivityRow | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [planningFieldsOpen, setPlanningFieldsOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);
  const [isPtTemplateDownloading, setIsPtTemplateDownloading] = useState(false);
  const [isPtImporting, setIsPtImporting] = useState(false);
  const [ptImportChanges, setPtImportChanges] = useState<PtImportChange[]>([]);
  const [ptImportIgnored, setPtImportIgnored] = useState<string[]>([]);
  const [ptImportOpen, setPtImportOpen] = useState(false);
  const [sapUnprogrammedOpen, setSapUnprogrammedOpen] = useState(false);
  const [sapImportPreview, setSapImportPreview] = useState<SapImportPreview | null>(null);
  const [isSapImporting, setIsSapImporting] = useState(false);
  const ptImportInputRef = useRef<HTMLInputElement | null>(null);
  const sapImportInputRef = useRef<HTMLInputElement | null>(null);
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
        canAccessPreparation && selectedWeekId
          ? request.eq("id", selectedWeekId)
          : request.eq("is_active", true);
      const { data, error } = await request.maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const deferredSearch = useDeferredValue(search);
  const activityFilters = {
    search: deferredSearch,
    statuses: isLeaderOnly ? [] : statusFilters,
    releaseTypes: canEditPlanningFields ? releaseTypeFilters : [],
    ptColors: isLeaderOnly ? [] : ptColorFilters,
    areas: areaFilters,
    workCenters: workCenterFilters,
    planningGroups: isLeaderOnly ? [] : planningGroupFilters,
    gers: gerFilters,
    dates: dateFilters,
    origins: originFilters,
  };
  const hasSapSummaryFilters = Boolean(
    deferredSearch.trim() ||
      statusFilters.length ||
      releaseTypeFilters.length ||
      ptColorFilters.length ||
      areaFilters.length ||
      workCenterFilters.length ||
      planningGroupFilters.length ||
      gerFilters.length ||
      dateFilters.length ||
      originFilters.length ||
      sapStatusFilters.length,
  );

  async function fetchActivitiesPage(pageIndex: number, size: number) {
    const { data, error } = await (supabase as any).rpc("get_activities_page", {
      p_week_id: activeWeek.data!.id,
      p_filters: activityFilters,
      p_page: pageIndex,
      p_page_size: size,
    });
    if (error) throw error;
    return data as {
      rows: ActivityRow[];
      totalAll: number;
      kpis: {
        total: number;
        concluded: number;
        impeded: number;
        noReport: number;
        cancelled: number;
        hours: number;
        percent: number;
      };
      options: {
        statuses: string[];
        releaseTypes: string[];
        hasEmptyReleaseType: boolean;
        ptColors: string[];
        areas: string[];
        workCenters: string[];
        planningGroups: string[];
        gers: string[];
        dates: string[];
        origins: string[];
      };
    };
  }

  async function fetchActivitiesForDay(date: string) {
    const { data, error } = await (supabase as any).rpc("get_activities_page", {
      p_week_id: activeWeek.data!.id,
      p_filters: { dates: [date] },
      p_page: 0,
      p_page_size: 5000,
    });
    if (error) throw error;
    return (data?.rows ?? []) as ActivityRow[];
  }

  const activities = useQuery({
    queryKey: ["activities", activeWeek.data?.id, page, activityFilters],
    enabled: !!activeWeek.data?.id,
    queryFn: () => fetchActivitiesPage(page, pageSize),
    placeholderData: (previous) => previous,
  });

  const sapOverview = useQuery({
    queryKey: ["sap-confirmation-overview", activeWeek.data?.id],
    enabled: Boolean(activeWeek.data?.id) && canAccessSap,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_sap_confirmation_overview", {
        p_week_id: activeWeek.data!.id,
      });
      if (error) throw error;
      return data as SapConfirmationOverview | null;
    },
    refetchInterval: 5 * 60_000,
  });

  const sapCountsByCurrentFilters = useQuery({
    queryKey: [
      "sap-counts-by-current-filters",
      activeWeek.data?.id,
      activityFilters,
      sapStatusFilters,
      sapOverview.data?.statuses,
    ],
    enabled:
      Boolean(activeWeek.data?.id) &&
      canAccessSap &&
      Boolean(sapOverview.data?.hasImport) &&
      hasSapSummaryFilters,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_activities_page", {
        p_week_id: activeWeek.data!.id,
        p_filters: activityFilters,
        p_page: 0,
        p_page_size: 5000,
      });
      if (error) throw error;

      return ((data?.rows ?? []) as ActivityRow[]).reduce(
        (counts, row) => {
          const sapStatus = sapOverview.data?.statuses?.[row.id];
          if (
            sapStatus &&
            (sapStatusFilters.length === 0 || sapStatusFilters.includes(sapStatus))
          ) {
            counts[sapStatus] = (counts[sapStatus] ?? 0) + 1;
          }
          return counts;
        },
        {} as Partial<Record<SapConfirmationStatus, number>>,
      );
    },
  });

  const sapFilteredActivities = useQuery({
    queryKey: [
      "activities-sap-filtered",
      activeWeek.data?.id,
      page,
      activityFilters,
      sapStatusFilters,
      sapOverview.data?.statuses,
    ],
    enabled:
      Boolean(activeWeek.data?.id) &&
      canAccessSap &&
      sapStatusFilters.length > 0 &&
      Boolean(sapOverview.data),
    queryFn: async () => {
      const result = await fetchActivitiesPage(0, 5000);
      const matching = result.rows.filter((row) => {
        const status = sapOverview.data?.statuses?.[row.id];
        return Boolean(status && sapStatusFilters.includes(status));
      });
      const concluded = matching.filter((row) => row.status === "EXECUTADO").length;
      const total = matching.length;
      return {
        ...result,
        rows: matching.slice(page * pageSize, (page + 1) * pageSize),
        totalAll: total,
        kpis: {
          total,
          concluded,
          impeded: matching.filter((row) => row.status === "NÃO EXECUTADO").length,
          noReport: matching.filter((row) => PENDING_REPORT_STATUSES.has(row.status)).length,
          cancelled: matching.filter((row) => row.status === "CANCELADA").length,
          hours: matching.reduce((sum, row) => sum + activityHours(row.planning_data), 0),
          percent: total > 0 ? Math.round((concluded / total) * 100) : 0,
        },
      };
    },
    placeholderData: (previous) => previous,
  });

  const sapLatestImport = useQuery({
    queryKey: ["sap-confirmation-latest-import", activeWeek.data?.id],
    enabled: Boolean(activeWeek.data?.id) && canAccessSap,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("sap_confirmation_imports")
        .select("id,source_file_name,row_count,imported_at,imported_by,imported_by_name,imported_by_email")
        .eq("week_id", activeWeek.data!.id)
        .order("imported_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data ?? null;
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

  const activityResult = sapStatusFilters.length > 0 ? sapFilteredActivities.data : activities.data;
  const allRows = activityResult?.rows ?? [];
  const filtered = allRows;
  const paged = allRows;
  const serverOptions = activityResult?.options;
  const statusOptions = STATUSES.filter(
    (value) => statusFilters.includes(value) || serverOptions?.statuses?.includes(value),
  );
  const releaseTypeOptions = RELEASE_TYPES.filter(
    (value) => releaseTypeFilters.includes(value) || serverOptions?.releaseTypes?.includes(value),
  );
  const hasEmptyReleaseType =
    releaseTypeFilters.includes("__EMPTY__") || Boolean(serverOptions?.hasEmptyReleaseType);
  const ptColorOptions = PT_COLORS.filter(
    (value) => ptColorFilters.includes(value) || serverOptions?.ptColors?.includes(value),
  );
  const areas = Array.from(new Set([...(serverOptions?.areas ?? []), ...areaFilters])).sort(
    (a, b) => a.localeCompare(b, "pt-BR"),
  );
  const gerOptions = Array.from(new Set([...(serverOptions?.gers ?? []), ...gerFilters])).sort(
    (a, b) => (a === "Não mapeado" ? 1 : b === "Não mapeado" ? -1 : a.localeCompare(b, "pt-BR")),
  );
  const workCenters = Array.from(
    new Set([...(serverOptions?.workCenters ?? []), ...workCenterFilters]),
  ).sort((a, b) => a.localeCompare(b, "pt-BR"));
  const planningGroups = Array.from(
    new Set([...(serverOptions?.planningGroups ?? []), ...planningGroupFilters]),
  ).sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }));
  const dateOptions = Array.from(new Set([...(serverOptions?.dates ?? []), ...dateFilters])).sort();
  const hasProgrammed =
    originFilters.includes("programmed") || Boolean(serverOptions?.origins?.includes("programmed"));
  const hasImmediate =
    originFilters.includes("immediate") || Boolean(serverOptions?.origins?.includes("immediate"));
  const kpis = activityResult?.kpis ?? {
    total: 0,
    concluded: 0,
    impeded: 0,
    noReport: 0,
    cancelled: 0,
    hours: 0,
    percent: 0,
  };
  const totalPages = Math.max(1, Math.ceil(kpis.total / pageSize));
  const sapCounts =
    hasSapSummaryFilters
      ? (sapCountsByCurrentFilters.data ?? {})
      : (sapOverview.data?.counts ?? {});
  const sapCount = (status: SapConfirmationStatus) => sapCounts[status] ?? 0;

  function toggleSapStatus(status: SapConfirmationStatus) {
    if (!canAccessSap) return;
    setSapStatusFilters((current) =>
      current.includes(status) ? current.filter((item) => item !== status) : [...current, status],
    );
    setPage(0);
  }

  function toggleKpiStatus(nextStatus: string) {
    if (isLeaderOnly) return;
    setStatusFilters((current) =>
      !nextStatus
        ? []
        : current.includes(nextStatus)
          ? current.filter((s) => s !== nextStatus)
          : [...current, nextStatus],
    );
    setPage(0);
  }

  function refreshActivitiesAndSapStatus() {
    void qc.invalidateQueries({ queryKey: ["activities"] });
    if (!activeWeek.data?.id || !canAccessSap) return;
    void qc.invalidateQueries({
      queryKey: ["sap-confirmation-overview", activeWeek.data.id],
    });
    void qc.invalidateQueries({ queryKey: ["sap-counts-by-current-filters"] });
  }

  const activeFilters = [
    search,
    !isLeaderOnly && statusFilters.length > 0 ? "1" : "",
    canEditPlanningFields && releaseTypeFilters.length > 0 ? "1" : "",
    !isLeaderOnly && ptColorFilters.length > 0 ? "1" : "",
    areaFilters.length > 0 ? "1" : "",
    workCenterFilters.length > 0 ? "1" : "",
    !isLeaderOnly && planningGroupFilters.length > 0 ? "1" : "",
    gerFilters.length > 0 ? "1" : "",
    dateFilters.length > 0 ? "1" : "",
    originFilters.length > 0 ? "1" : "",
    canAccessSap && sapStatusFilters.length > 0 ? "1" : "",
  ].filter(Boolean).length;

  function clearFilters() {
    setSearch("");
    setStatusFilters([]);
    setReleaseTypeFilters([]);
    setPtColorFilters([]);
    setAreaFilters([]);
    setWorkCenterFilters([]);
    setPlanningGroupFilters([]);
    setGerFilters([]);
    setDateFilters([]);
    setOriginFilters([]);
    setSapStatusFilters([]);
    setPage(0);
  }

  function planningValue(row: ActivityRow, field: PlanningField | "pt_color"): string {
    const draft = planningDrafts[row.id];
    if (draft && Object.prototype.hasOwnProperty.call(draft, field)) return draft[field] ?? "";
    const value = row[field];
    return value == null ? "" : String(value);
  }

  function effectivePtColor(row: ActivityRow): PtColor | null {
    const releaseType = planningValue(row, "release_type");
    if (releaseType === "ATRE" || releaseType === "OFICINAS") return null;
    const savedColor = planningValue(row, "pt_color") as PtColor | "";
    if (savedColor) return savedColor;
    return releaseType === "PTT" ? "white" : null;
  }

  function hasPtColorChoice(row: ActivityRow): boolean {
    const releaseType = planningValue(row, "release_type");
    return releaseType !== "ATRE" && releaseType !== "OFICINAS";
  }

  function setPlanningValue(rowId: string, field: PlanningField | "pt_color", value: string) {
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

  async function persistPlanningRows(
    payload: ReturnType<typeof planningPayload>[],
    showSuccess = false,
  ) {
    planningSavesPendingRef.current += 1;
    setPlanningSavePending(true);
    const run = planningSaveQueueRef.current.then(async () => {
      const versionedPayload = payload.map((row) => ({
        ...row,
        expectedVersion: Math.max(
          planningVersionsRef.current.get(row.id) ?? 0,
          row.expectedVersion,
        ),
      }));
      try {
        const result = await savePlanningFields({ data: { rows: versionedPayload } });
        if (!result.ok) throw new Error(result.error);
        for (const row of versionedPayload)
          planningVersionsRef.current.set(row.id, row.expectedVersion + 1);
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
      toast.error(
        `A alteração de datas está bloqueada após ${dateEditSettings.data?.cutoffTime ?? "15:00"}.`,
      );
      return;
    }
    try {
      const value = normalizeGridValue(field, rawValue);
      setPlanningValue(row.id, field, value);
      const overrides: Partial<PlanningDraft> = { [field]: value };
      if (field === "release_type") {
        if (value === "ATRE" || value === "OFICINAS") {
          overrides.pt_color = "";
          setPlanningValue(row.id, "pt_color", "");
        } else if (value === "PTT" && !planningValue(row, "pt_color")) {
          overrides.pt_color = "white";
          setPlanningValue(row.id, "pt_color", "white");
        }
      }
      await persistPlanningRows([planningPayload(row, overrides)]);
    } catch (error: any) {
      toast.error(error?.message ?? "Valor inválido.");
    }
  }

  async function pastePlanningGrid(
    event: ClipboardEvent<HTMLElement>,
    startRow: number,
    startField: PlanningField,
  ) {
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
      toast.error(
        `A alteração de datas está bloqueada após ${dateEditSettings.data?.cutoffTime ?? "15:00"}.`,
      );
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
      if (n.has(id)) n.delete(id);
      else n.add(id);
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
    if (!activeWeek.data || kpis.total === 0) {
      toast.error("Não há atividades nos filtros atuais para exportar.");
      return;
    }
    setIsExporting(true);
    try {
      const fetched = (await fetchActivitiesPage(0, 5000)).rows;
      const filtered =
        canAccessSap && sapStatusFilters.length > 0
          ? fetched.filter((row) => {
              const status = sapOverview.data?.statuses?.[row.id];
              return Boolean(status && sapStatusFilters.includes(status));
            })
          : fetched;
      const XLSX = await import("xlsx");
      const responsibleHeader = "Responsável pela informação";
      const reportedAtHeader = "Data da informação";
      const extraHeaders = [
        "Ger",
        "Nº PT",
        "Cor da PT",
        ...(canAccessSap ? ["Status SAP"] : []),
      ];
      const exportHeaders = [
        ...ACTIVITY_EXPORT_COLUMNS,
        ...extraHeaders,
        responsibleHeader,
        reportedAtHeader,
      ];
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
          (a, b) =>
            (a.source_row_number ?? Number.MAX_SAFE_INTEGER) -
            (b.source_row_number ?? Number.MAX_SAFE_INTEGER),
        )
        .map((activity) => {
          const planning = activity.planning_data ?? {};
          const row: Record<string, unknown> = {};
          for (const header of ACTIVITY_EXPORT_COLUMNS) {
            if (header === "PBS")
              row[header] = planningValue(activity, "pbs") || planning[header] || "";
            else if (header === "Tipo de Liberação")
              row[header] = planningValue(activity, "release_type") || planning[header] || "";
            else if (header === "Data início")
              row[header] = formatDateOnly(
                planningValue(activity, "scheduled_date") || planning[header],
              );
            else if (header === "Status") row[header] = activity.status ?? "Sem apontamento";
            else if (header === "Justificativa") row[header] = activity.justification ?? "";
            else if (header === "Observações") row[header] = activity.observation ?? "";
            else if (header === "Data fim") row[header] = formatDateOnly(planning[header]);
            else row[header] = planning[header] ?? "";
          }
          row["Ger"] = gerLabel(activity);
          row["Nº PT"] = planningValue(activity, "pt_number");
          const color = effectivePtColor(activity);
          row["Cor da PT"] = color ? PT_COLOR_LABELS[color] : "";
          if (canAccessSap) {
            row["Status SAP"] = sapOverview.data?.statuses?.[activity.id] ?? "Sem carga SAP";
          }
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
      toast.success(
        `${rows.length.toLocaleString("pt-BR")} atividade(s) exportada(s) com os filtros atuais.`,
      );
    } catch (error: any) {
      toast.error(error?.message ?? "Falha ao exportar as atividades filtradas.");
    } finally {
      setIsExporting(false);
    }
  }

  function selectedPtImportDay() {
    if (dateFilters.length !== 1) {
      toast.info("Selecione exatamente um dia no filtro de data para trabalhar com PTs em massa.");
      return null;
    }
    return dateFilters[0];
  }

  async function prepareSapImport(file: File) {
    try {
      setIsSapImporting(true);
      setSapImportPreview(await parseSapWorkbook(file));
    } catch (error: any) {
      toast.error(error?.message ?? "Não foi possível ler a planilha SAP.");
      setSapImportPreview(null);
    } finally {
      setIsSapImporting(false);
      if (sapImportInputRef.current) sapImportInputRef.current.value = "";
    }
  }

  async function confirmSapImport() {
    if (!activeWeek.data || !sapImportPreview || isSapImporting) return;
    setIsSapImporting(true);
    try {
      const { data, error } = await (supabase as any).rpc("import_sap_confirmations", {
        p_week_id: activeWeek.data.id,
        p_source_file_name: sapImportPreview.fileName,
        p_rows: sapImportPreview.rows,
      });
      if (error) throw error;
      const count = Number(data?.count ?? sapImportPreview.rows.length);
      toast.success(`${count.toLocaleString("pt-BR")} registros SAP importados para ${activeWeek.data.label}.`);
      setSapImportPreview(null);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["sap-confirmation-overview", activeWeek.data.id] }),
        qc.invalidateQueries({ queryKey: ["sap-confirmation-latest-import", activeWeek.data.id] }),
      ]);
    } catch (error: any) {
      toast.error(error?.message ?? "Não foi possível importar as confirmações SAP.");
    } finally {
      setIsSapImporting(false);
    }
  }

  async function downloadPtImportTemplate() {
    const day = selectedPtImportDay();
    if (!day || !activeWeek.data || isPtTemplateDownloading) return;
    setIsPtTemplateDownloading(true);
    try {
      const XLSX = await import("xlsx");
      const worksheet = XLSX.utils.aoa_to_sheet([["Confirmação", "Nº da PT", "Cor da PT"]]);
      worksheet["!cols"] = [{ wch: 22 }, { wch: 22 }, { wch: 18 }];
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "PTs");
      XLSX.writeFile(workbook, `modelo-pts-${day}.xlsx`);
      toast.success(
        `Modelo vazio gerado para preenchimento e importação no dia ${formatDate(day)}.`,
      );
    } catch (error: any) {
      toast.error(error?.message ?? "Não foi possível gerar o modelo de PTs.");
    } finally {
      setIsPtTemplateDownloading(false);
    }
  }

  async function preparePtImport(file: File) {
    const day = selectedPtImportDay();
    if (!day || !activeWeek.data) return;
    try {
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const imported = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: "" });
      const dayRows = await fetchActivitiesForDay(day);
      const byConfirmation = new Map<string, ActivityRow[]>();
      for (const row of dayRows) {
        const confirmation = String(row.planning_data?.["Confirmação"] ?? "").trim();
        if (!confirmation) continue;
        const matches = byConfirmation.get(confirmation) ?? [];
        matches.push(row);
        byConfirmation.set(confirmation, matches);
      }
      const colorMap: Record<string, PtColor> = {
        VERMELHO: "red",
        VERMELHA: "red",
        RED: "red",
        AMARELO: "yellow",
        AMARELA: "yellow",
        YELLOW: "yellow",
        BRANCO: "white",
        BRANCA: "white",
        WHITE: "white",
      };
      const changes: PtImportChange[] = [];
      const ignored: string[] = [];
      const seen = new Set<string>();
      for (const item of imported) {
        const confirmation = String(
          item["Confirmação"] ?? item["CONFIRMAÇÃO"] ?? item["Confirmacao"] ?? "",
        ).trim();
        const ptNumber = String(
          item["Nº da PT"] ?? item["N° da PT"] ?? item["Numero da PT"] ?? "",
        ).trim();
        const rawColor = String(item["Cor da PT"] ?? item["COR DA PT"] ?? "")
          .trim()
          .toLocaleUpperCase("pt-BR");
        if (!confirmation || (!ptNumber && !rawColor)) continue;
        if (seen.has(confirmation)) {
          ignored.push(`${confirmation}: confirmação repetida na planilha`);
          continue;
        }
        seen.add(confirmation);
        const matchingRows = byConfirmation.get(confirmation);
        if (!matchingRows?.length) {
          ignored.push(`${confirmation}: não pertence ao dia ${formatDate(day)}`);
          continue;
        }
        const importedColor = rawColor ? colorMap[rawColor] : null;
        if (rawColor && !importedColor) {
          ignored.push(`${confirmation}: cor inválida (${rawColor})`);
          continue;
        }
        for (const row of matchingRows) {
          const nextColor = rawColor ? importedColor : effectivePtColor(row);
          const normalizedColor =
            row.release_type === "ATRE" || row.release_type === "OFICINAS" ? null : nextColor;
          const nextPtNumber = ptNumber || row.pt_number;
          if (
            (nextPtNumber ?? "") === (row.pt_number ?? "") &&
            normalizedColor === effectivePtColor(row)
          )
            continue;
          changes.push({
            row,
            confirmation,
            nextPtNumber,
            nextPtColor: normalizedColor,
            replacesExisting: Boolean(row.pt_number || effectivePtColor(row)),
          });
        }
      }
      setPtImportChanges(changes);
      setPtImportIgnored(ignored);
      setPtImportOpen(true);
    } catch (error: any) {
      toast.error(error?.message ?? "Não foi possível ler a planilha de PTs.");
    } finally {
      if (ptImportInputRef.current) ptImportInputRef.current.value = "";
    }
  }

  async function confirmPtImport() {
    if (isPtImporting || ptImportChanges.length === 0) return;
    setIsPtImporting(true);
    try {
      const result = await savePlanningFields({
        data: {
          rows: ptImportChanges.map(({ row, nextPtNumber, nextPtColor }) => ({
            id: row.id,
            expectedVersion: row.version,
            pbs: row.pbs,
            ptNumber: nextPtNumber,
            ptColor: nextPtColor,
            releaseType: row.release_type as "PT" | "PTT" | "ATRE" | "OFICINAS" | null,
            scheduledDate: row.scheduled_date,
          })),
        },
      });
      if (!result.ok) throw new Error(result.error);
      toast.success(
        `${result.count} atividade(s) atualizada(s). As alterações foram registradas no histórico.`,
      );
      setPtImportOpen(false);
      setPtImportChanges([]);
      setPtImportIgnored([]);
      await qc.invalidateQueries({ queryKey: ["activities"] });
    } catch (error: any) {
      toast.error(error?.message ?? "Não foi possível importar as PTs.");
    } finally {
      setIsPtImporting(false);
    }
  }

  async function exportPrintableSchedule() {
    if (isPrinting) return;
    if (planningSavesPendingRef.current > 0) {
      toast.info("Aguarde o término do salvamento antes de gerar a impressão.");
      return;
    }
    if (!activeWeek.data || kpis.total === 0) {
      toast.error("Não há atividades nos filtros atuais para imprimir.");
      return;
    }

    setIsPrinting(true);
    try {
      const filtered = (await fetchActivitiesPage(0, 5000)).rows;
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
          row.getCell(column).fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: `FF${headerFill}` },
          };
          row.getCell(column).font = {
            name: "Arial",
            size: 10,
            bold: true,
            color: { argb: "FFFFFFFF" },
          };
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
          (a, b) =>
            (a.source_row_number ?? Number.MAX_SAFE_INTEGER) -
            (b.source_row_number ?? Number.MAX_SAFE_INTEGER),
        )
        .map((activity) => {
          const planning = activity.planning_data ?? {};
          return [
            gerLabel(activity),
            planning["Localização"] ?? "",
            activity.note_number ?? planning["Nota"] ?? "",
            planningValue(activity, "release_type"),
            planningValue(activity, "pt_number"),
            effectivePtColor(activity) ? PT_COLOR_LABELS[effectivePtColor(activity)!] : "",
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
      worksheet.getRow(9).font = {
        name: "Arial",
        size: 9,
        bold: true,
        color: { argb: "FFFFFFFF" },
      };
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
            cell.fill = {
              type: "pattern",
              pattern: "solid",
              fgColor: { argb: `FF${tableStripeFill}` },
            };
          }
        }
        row.getCell(10).numFmt = "dd/mm/yyyy";
        for (const column of [1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15, 16, 17, 18, 19, 20]) {
          row.getCell(column).alignment = {
            horizontal: "center",
            vertical: "middle",
            wrapText: true,
          };
        }
      }

      [11, 13, 13, 13, 13, 9, 17, 9, 9, 12, 10, 9, 16, 42, 8, 8, 8, 7, 7, 7, 36].forEach(
        (width, index) => {
          worksheet.getColumn(index + 1).width = width;
        },
      );

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
      toast.success(
        `${rows.length.toLocaleString("pt-BR")} atividade(s) preparadas no modelo de impressão.`,
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Não foi possível gerar o modelo de impressão.",
      );
    } finally {
      setIsPrinting(false);
    }
  }

  return (
    <main className="mx-auto max-w-none px-4 py-6 sm:px-6">
      <PageHeader
        eyebrow={
          activeWeek.data?.lifecycle_status === "preparation"
            ? "Semana em preparação"
            : "Semana operacional"
        }
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
                    {week.label} —{" "}
                    {week.lifecycle_status === "preparation" ? "Em preparação" : "Operacional"}
                  </option>
                ))}
              </select>
            )}
            {canAccessSap && (
              <>
                <button
                  onClick={() => sapImportInputRef.current?.click()}
                  disabled={isSapImporting || !activeWeek.data}
                  className="btn-ghost h-10 min-h-10 justify-center px-3 py-0 text-xs"
                  title={`Importar a extração SAP para ${activeWeek.data?.label ?? "a semana selecionada"}`}
                >
                  <Upload className="h-3.5 w-3.5" />
                  {isSapImporting ? "Lendo SAP…" : "Importar SAP"}
                </button>
                <input
                  ref={sapImportInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void prepareSapImport(file);
                  }}
                />
                <button
                  onClick={exportPrintableSchedule}
                  disabled={isPrinting || planningSavePending || kpis.total === 0}
                  className="btn-ghost h-10 min-h-10 justify-center px-3 py-0 text-xs"
                  title="Gerar o modelo de impressão com os filtros atuais"
                >
                  <Printer className="h-3.5 w-3.5" />
                  {planningSavePending
                    ? "Salvando…"
                    : isPrinting
                      ? "Gerando…"
                      : "Imprimir programação"}
                </button>
                <button
                  onClick={exportFilteredActivities}
                  disabled={isExporting || planningSavePending || kpis.total === 0}
                  className="btn-ghost h-10 min-h-10 justify-center px-3 py-0 text-xs"
                  title="Exportar as atividades com os filtros atuais"
                >
                  <Download className="h-3.5 w-3.5" />
                  {planningSavePending ? "Salvando…" : isExporting ? "Exportando…" : "Exportar"}
                </button>
              </>
            )}
            {isPlanning && (
              <>
                <button
                  onClick={downloadPtImportTemplate}
                  disabled={isPtTemplateDownloading || planningSavePending}
                  className="btn-ghost h-10 min-h-10 justify-center px-3 py-0 text-xs"
                  title="Baixar modelo de PT para o dia selecionado"
                >
                  <Download className="h-3.5 w-3.5" />
                  {isPtTemplateDownloading ? "Gerando…" : "Modelo de PT"}
                </button>
                <button
                  onClick={() => selectedPtImportDay() && ptImportInputRef.current?.click()}
                  disabled={isPtImporting || planningSavePending}
                  className="btn-ghost h-10 min-h-10 justify-center px-3 py-0 text-xs"
                  title="Importar números e cores de PT para o dia selecionado"
                >
                  <Upload className="h-3.5 w-3.5" /> Importar PTs
                </button>
                <input
                  ref={ptImportInputRef}
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void preparePtImport(file);
                  }}
                />
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
              <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Conclusão
              </div>
              <div className="text-lg font-semibold leading-none text-foreground tabular">
                {kpis.percent}%
              </div>
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
          <KpiCard
            label="Programadas"
            value={kpis.total}
            icon={<ListChecks className="h-3.5 w-3.5" />}
          />
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
          <KpiCard
            label="Sem apontamento"
            value={kpis.noReport}
            icon={<Clock className="h-3.5 w-3.5" />}
          />
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
          <KpiCard
            label="Canceladas"
            value={kpis.cancelled}
            tone="warning"
            icon={<X className="h-3.5 w-3.5" />}
          />
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

      {canAccessSap && sapOverview.data?.hasImport && (
        <section className="mb-5 rounded-md border border-border bg-card p-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1 overflow-x-auto">
              <div className="flex min-w-max items-baseline gap-1 whitespace-nowrap text-[11px] text-muted-foreground">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-foreground">
                  Conferência SAP
                </h2>
                <span>|</span>
                <span>
                  {sapOverview.data.importedRows.toLocaleString("pt-BR")} linhas oficiais - prazo até{" "}
                  {formatDateTime(sapOverview.data.deadline)}
                </span>
                {sapLatestImport.data && (
                  <>
                    <span>|</span>
                    <span>
                      Atualizado em {formatDateTime(sapLatestImport.data.imported_at)} | Responsável:{" "}
                      <span className="font-medium text-foreground">
                        {sapLatestImport.data.imported_by_name ||
                          sapLatestImport.data.imported_by_email ||
                          "Carga do sistema"}
                      </span>
                    </span>
                  </>
                )}
              </div>
            </div>
            <span className="hidden shrink-0 text-[10px] text-muted-foreground xl:inline">
              O status SAP não altera o apontamento operacional.
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
            {SAP_STATUS_OPTIONS.map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => toggleSapStatus(status)}
                aria-pressed={sapStatusFilters.includes(status)}
                className={cn(
                  "rounded-md text-left transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
                  sapStatusFilters.includes(status) && "ring-2 ring-primary/60",
                )}
                title={`Filtrar por ${status}`}
              >
                <KpiCard
                  label={
                    status === "Confirmada no SAP"
                      ? "Confirmadas no SAP"
                      : status === "Confirmada sem HH"
                        ? "Confirmadas sem HH"
                        : status === "Não confirmada no SAP"
                          ? "Não confirmadas"
                          : status === "Confirmação não esperada"
                            ? "Não esperadas"
                            : status === "Divergência"
                              ? "Divergências"
                              : status
                  }
                  value={sapCount(status)}
                  tone={
                    status === "Confirmada no SAP"
                      ? "success"
                      : status === "Não confirmada no SAP"
                        ? "destructive"
                        : status === "Aguardando confirmação" || status === "Divergência"
                          ? "warning"
                          : undefined
                  }
                />
              </button>
            ))}
            <button
              type="button"
              onClick={() => setSapUnprogrammedOpen(true)}
              className="rounded-md text-left transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              title="Ver as atividades encontradas no SAP e ausentes da programação semanal"
            >
              <KpiCard label="Não programadas" value={sapOverview.data.unprogrammedCount} tone="primary" />
            </button>
          </div>
        </section>
      )}

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
            placeholder="Buscar por ordem, nota, nº de PT, operação, suboperação, descrição, área ou responsável…"
            className="input-base pl-8"
          />
        </div>
        {!isLeaderOnly && (
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
            optionLabel={(value) =>
              value === PENDING_REPORT_FILTER ? "Sem apontamento + fluxo de PT" : value
            }
          />
        )}
        {canAccessSap && sapOverview.data?.hasImport && (
          <FilterMultiSelect
            options={SAP_STATUS_OPTIONS}
            selected={sapStatusFilters}
            onChange={(next) => {
              setSapStatusFilters(next as SapConfirmationStatus[]);
              setPage(0);
            }}
            allLabel="Todos os status SAP"
            ariaLabel="Filtrar por status SAP"
            searchPlaceholder="Buscar status SAP..."
            selectedPlural="status SAP selecionados"
          />
        )}
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
        {!isLeaderOnly && (
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
        )}
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
        {!isLeaderOnly && (
          <FilterMultiSelect
            options={planningGroups}
            selected={planningGroupFilters}
            onChange={(next) => {
              setPlanningGroupFilters(next);
              setPage(0);
            }}
            allLabel="Todos Gr pl"
            ariaLabel="Filtrar por Gr pl"
            searchPlaceholder="Buscar Gr pl..."
            selectedPlural="Gr pl selecionados"
          />
        )}

        <FilterMultiSelect
          options={[
            ...(hasProgrammed ? ["programmed"] : []),
            ...(hasImmediate ? ["immediate"] : []),
          ]}
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
          {kpis.total.toLocaleString("pt-BR")}{" "}
          <span className="opacity-60">
            de {(activityResult?.totalAll ?? 0).toLocaleString("pt-BR")}
          </span>
        </div>
      </Toolbar>

      {/* Ações de lote */}
      {selected.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-primary/30 bg-primary/[0.06] px-3 py-2">
          <div className="text-[13px]">
            <span className="font-semibold tabular">{selected.size}</span> atividade(s)
            selecionada(s)
          </div>
          <div className="flex gap-2">
            <button onClick={() => setSelected(new Set())} className="btn-ghost py-1 text-xs">
              Cancelar
            </button>
            {canEditPlanningFields && (
              <button
                onClick={() => setPlanningFieldsOpen(true)}
                className="btn-ghost py-1 text-xs"
              >
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
      {activities.isLoading || (sapStatusFilters.length > 0 && sapFilteredActivities.isLoading) ? (
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
              <table className="min-w-[1810px] w-full text-[13px]">
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
                    {canEditPlanningFields && (
                      <th className="px-2 py-2 text-left font-semibold">Localização</th>
                    )}
                    <th className="px-2 py-2 text-left font-semibold">Área / Especialidade</th>
                    <th className="px-2 py-2 text-left font-semibold">PBS</th>
                    <th className="px-2 py-2 text-left font-semibold">Nº PT / Cor</th>
                    <th className="px-2 py-2 text-left font-semibold">Tipo de Liberação</th>
                    <th className="px-2 py-2 text-left font-semibold">Data</th>
                    <th className="px-2 py-2 text-left font-semibold">Status</th>
                    {canAccessSap && (
                      <th className="px-2 py-2 text-left font-semibold">Status SAP</th>
                    )}
                    <th className="px-2 py-2 text-left font-semibold">Responsável</th>
                    <th className="px-2 py-2 text-right font-semibold">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {paged.map((r) => (
                    <tr key={r.id} className="row-zebra hover:bg-accent/60">
                      <td className="px-2 py-2 align-top">
                        <input
                          type="checkbox"
                          checked={selected.has(r.id)}
                          onChange={() => toggleSelect(r.id)}
                        />
                      </td>
                      <td className="px-2 py-2 align-top font-mono text-[11px]">
                        <div className="text-foreground">{r.order_number}</div>
                        <div className="text-muted-foreground">{r.note_number}</div>
                      </td>
                      <td className="px-2 py-2 align-top font-mono text-[11px]">
                        <div className="text-foreground">
                          {fmtPlan(r.planning_data, "Op") ?? "—"}
                        </div>
                        <div className="text-muted-foreground">
                          {fmtPlan(r.planning_data, "Subop") ?? "—"}
                        </div>
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
                      {(
                        ["pbs", "pt_number", "release_type", "scheduled_date"] as PlanningField[]
                      ).map((field) => {
                        const rowIndex = paged.findIndex((row) => row.id === r.id);
                        return (
                          <td key={field} className="px-1 py-1.5 align-top text-[11px]">
                            <div
                              className={cn(
                                field === "pt_number" && "flex min-w-[185px] items-center gap-2",
                              )}
                            >
                              <PlanningGridCell
                                value={planningValue(r, field)}
                                field={field}
                                editable={
                                  canEditPlanningFields &&
                                  (field !== "scheduled_date" || canEditPlanningDate)
                                }
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
                                  if (target)
                                    void fillPlanningByDrag(target.rowIndex, target.field);
                                }}
                                onDrop={() => fillPlanningByDrag(rowIndex, field)}
                              />
                              {field === "pt_number" &&
                                (hasPtColorChoice(r) ? (
                                  <PtColorSelector
                                    value={effectivePtColor(r)}
                                    editable={canEditPlanningFields}
                                    onChange={(color) => void changePtColor(r, color)}
                                  />
                                ) : (
                                  <span
                                    className="px-1 text-sm text-muted-foreground"
                                    title="Este tipo de liberação não possui cor de PT"
                                  >
                                    —
                                  </span>
                                ))}
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
                      {canAccessSap && (
                        <td className="px-2 py-2 align-top">
                          <SapStatusPill status={sapOverview.data?.statuses?.[r.id]} />
                        </td>
                      )}
                      <td className="px-2 py-2 align-top text-[11px]">
                        {r.reported_by_name || <span className="text-muted-foreground">—</span>}
                        {r.reported_at && (
                          <div className="text-[10px] text-muted-foreground tabular">
                            {formatDateTime(r.reported_at)}
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right align-top">
                        <button
                          onClick={() => setEditing(r)}
                          className="btn-primary py-1 text-[11px]"
                        >
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
              <div
                key={r.id}
                className={`surface-card p-3 ${r.is_immediate ? "border-l-[3px] border-l-warning" : ""}`}
              >
                <div className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={selected.has(r.id)}
                    onChange={() => toggleSelect(r.id)}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="font-mono text-[11px] text-foreground">
                        {r.order_number}
                      </span>
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
                    <div className="mt-1 text-[13px] leading-snug text-foreground">
                      {r.description}
                    </div>
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
                      PBS: {r.pbs || "—"} · Nº PT: {r.pt_number || "—"} ·{" "}
                      {r.release_type || "Sem liberação"}
                    </div>
                    <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground">
                      <span>Cor da PT:</span>
                      {hasPtColorChoice(r) ? (
                        <PtColorSelector
                          value={effectivePtColor(r)}
                          editable={canEditPlanningFields}
                          onChange={(color) => void changePtColor(r, color)}
                        />
                      ) : (
                        <span
                          className="text-sm"
                          title="Este tipo de liberação não possui cor de PT"
                        >
                          —
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <StatusPill status={r.status} />
                    {canAccessSap && (
                      <SapStatusPill status={sapOverview.data?.statuses?.[r.id]} />
                    )}
                  </div>
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
              Página <span className="font-semibold text-foreground">{page + 1}</span> de{" "}
              {totalPages}
            </div>
            <div className="flex gap-1">
              <button
                onClick={() => {
                  setSelected(new Set());
                  setPage((p) => Math.max(0, p - 1));
                }}
                disabled={page === 0}
                className="btn-ghost py-1 text-xs disabled:opacity-40"
              >
                Anterior
              </button>
              <button
                onClick={() => {
                  setSelected(new Set());
                  setPage((p) => Math.min(totalPages - 1, p + 1));
                }}
                disabled={page >= totalPages - 1}
                className="btn-ghost py-1 text-xs disabled:opacity-40"
              >
                Próxima
              </button>
            </div>
          </div>
        </>
      )}

      {canAccessSap && sapUnprogrammedOpen && sapOverview.data && (
        <Modal
          title="Atividades não programadas"
          description="Registros da carga SAP oficial que não foram localizados na programação da semana."
          size="lg"
          onClose={() => setSapUnprogrammedOpen(false)}
          footer={
            <button className="btn-primary" onClick={() => setSapUnprogrammedOpen(false)}>
              Fechar
            </button>
          }
        >
          <div className="mb-3 text-xs text-muted-foreground">
            {sapOverview.data.unprogrammedCount.toLocaleString("pt-BR")} registro(s). Eles não entram
            nos cartões operacionais da programação.
          </div>
          <div className="max-h-[58vh] overflow-auto rounded-md border border-border">
            <table className="min-w-[760px] w-full text-xs">
              <thead className="sticky top-0 bg-muted text-[10px] uppercase text-muted-foreground">
                <tr>
                  <th className="px-2 py-2 text-left">Ordem</th>
                  <th className="px-2 py-2 text-left">Oper / Sub</th>
                  <th className="px-2 py-2 text-left">Descrição</th>
                  <th className="px-2 py-2 text-left">Fim real</th>
                  <th className="px-2 py-2 text-left">HH real</th>
                  <th className="px-2 py-2 text-left">Confirmação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {sapOverview.data.unprogrammed.map((row) => (
                  <tr key={row.id} className="row-zebra">
                    <td className="px-2 py-2 font-mono">{row.order_number}</td>
                    <td className="px-2 py-2 font-mono">
                      {row.operation ?? "—"} / {row.suboperation ?? "—"}
                    </td>
                    <td className="px-2 py-2">{row.description ?? "—"}</td>
                    <td className="px-2 py-2 tabular">{formatDate(row.actual_end_date)}</td>
                    <td className="px-2 py-2 tabular">{formatActivityHours(row.actual_work ?? 0)}</td>
                    <td className="px-2 py-2 font-mono">{row.confirmation}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Modal>
      )}

      {canAccessSap && sapImportPreview && activeWeek.data && (
        <Modal
          title="Conferir importação SAP"
          description={`A carga ficará vinculada à obra atual e à ${activeWeek.data.label}.`}
          size="lg"
          onClose={() => !isSapImporting && setSapImportPreview(null)}
          footer={
            <>
              <button
                type="button"
                className="btn-ghost"
                disabled={isSapImporting}
                onClick={() => setSapImportPreview(null)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={isSapImporting}
                onClick={confirmSapImport}
              >
                {isSapImporting
                  ? "Importando…"
                  : `Confirmar ${sapImportPreview.rows.length.toLocaleString("pt-BR")} registros`}
              </button>
            </>
          }
        >
          <div className="space-y-3">
            <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning-foreground">
              {sapLatestImport.data
                ? "Já existe uma carga para esta semana. A nova carga substituirá a atual no comparativo SAP."
                : "Confira a semana selecionada antes de confirmar. A importação não altera o status operacional das atividades."}
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <KpiCard label="Linhas" value={sapImportPreview.rows.length} />
              <KpiCard label="Confirmadas" value={sapImportPreview.confirmed} tone="success" />
              <KpiCard label="Confirmadas sem HH" value={sapImportPreview.confirmedWithoutHours} />
              <KpiCard label="Sem CONF" value={sapImportPreview.withoutConfirmation} tone="warning" />
            </div>
            <div className="text-xs text-muted-foreground">
              Arquivo: <span className="font-medium text-foreground">{sapImportPreview.fileName}</span>
            </div>
            <div className="max-h-72 overflow-auto rounded-md border border-border">
              <table className="min-w-[760px] w-full text-xs">
                <thead className="sticky top-0 bg-muted text-[10px] uppercase text-muted-foreground">
                  <tr>
                    <th className="px-2 py-2 text-left">Linha</th>
                    <th className="px-2 py-2 text-left">Ordem</th>
                    <th className="px-2 py-2 text-left">Oper / Sub</th>
                    <th className="px-2 py-2 text-left">Descrição</th>
                    <th className="px-2 py-2 text-left">Confirmação</th>
                    <th className="px-2 py-2 text-left">Status SAP</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {sapImportPreview.rows.slice(0, 50).map((row) => {
                    const confirmed = (row.system_status ?? "")
                      .toUpperCase()
                      .split(/\s+/)
                      .includes("CONF");
                    return (
                      <tr key={row.source_row_number} className="row-zebra">
                        <td className="px-2 py-2 tabular">{row.source_row_number}</td>
                        <td className="px-2 py-2 font-mono">{row.order_number}</td>
                        <td className="px-2 py-2 font-mono">
                          {row.operation ?? "—"} / {row.suboperation ?? "—"}
                        </td>
                        <td className="max-w-72 truncate px-2 py-2" title={row.description ?? ""}>
                          {row.description ?? "—"}
                        </td>
                        <td className="px-2 py-2 font-mono">{row.confirmation}</td>
                        <td className="px-2 py-2">
                          <SapStatusPill
                            status={
                              confirmed
                                ? (row.actual_work ?? 0) > 0
                                  ? "Confirmada no SAP"
                                  : "Confirmada sem HH"
                                : "Não confirmada no SAP"
                            }
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {sapImportPreview.rows.length > 50 && (
              <p className="text-[11px] text-muted-foreground">
                Prévia das primeiras 50 linhas. Todos os {sapImportPreview.rows.length.toLocaleString("pt-BR")} registros serão importados.
              </p>
            )}
          </div>
        </Modal>
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

      {ptImportOpen && (
        <Modal
          onClose={() => !isPtImporting && setPtImportOpen(false)}
          title="Conferir importação de PTs"
          description={`Atualização restrita ao dia ${formatDate(dateFilters[0] ?? "")}. Confirme antes de substituir os valores atuais.`}
          footer={
            <>
              <button
                type="button"
                className="btn-ghost"
                disabled={isPtImporting}
                onClick={() => setPtImportOpen(false)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={isPtImporting || ptImportChanges.length === 0}
                onClick={confirmPtImport}
              >
                {isPtImporting
                  ? "Importando…"
                  : `Confirmar ${ptImportChanges.length} atualização(ões)`}
              </button>
            </>
          }
        >
          <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="rounded-md border bg-muted/30 p-3">
                <div className="text-[10px] uppercase text-muted-foreground">
                  Novos preenchimentos
                </div>
                <div className="text-xl font-semibold tabular">
                  {ptImportChanges.filter((item) => !item.replacesExisting).length}
                </div>
              </div>
              <div className="rounded-md border border-warning/40 bg-warning/10 p-3">
                <div className="text-[10px] uppercase text-muted-foreground">Substituições</div>
                <div className="text-xl font-semibold tabular">
                  {ptImportChanges.filter((item) => item.replacesExisting).length}
                </div>
              </div>
              <div className="rounded-md border bg-muted/30 p-3">
                <div className="text-[10px] uppercase text-muted-foreground">Ignoradas</div>
                <div className="text-xl font-semibold tabular">{ptImportIgnored.length}</div>
              </div>
            </div>
            {ptImportChanges.some((item) => item.replacesExisting) && (
              <div className="rounded-md border border-warning/50 bg-warning/10 px-3 py-2 text-xs text-warning-foreground">
                Algumas atividades já possuem PT ou cor. Ao confirmar, os valores atuais serão
                substituídos pelos valores da planilha.
              </div>
            )}
            <div className="max-h-72 overflow-auto rounded-md border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted text-left text-[10px] uppercase text-muted-foreground">
                  <tr>
                    <th className="px-2 py-2">Confirmação</th>
                    <th className="px-2 py-2">PT atual</th>
                    <th className="px-2 py-2">Nova PT</th>
                    <th className="px-2 py-2">Cor atual</th>
                    <th className="px-2 py-2">Nova cor</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {ptImportChanges.map((item) => (
                    <tr
                      key={item.row.id}
                      className={item.replacesExisting ? "bg-warning/[0.05]" : ""}
                    >
                      <td className="px-2 py-2 font-mono">{item.confirmation}</td>
                      <td className="px-2 py-2">{item.row.pt_number || "—"}</td>
                      <td className="px-2 py-2 font-medium">{item.nextPtNumber || "—"}</td>
                      <td className="px-2 py-2">
                        {effectivePtColor(item.row)
                          ? PT_COLOR_LABELS[effectivePtColor(item.row)!]
                          : "—"}
                      </td>
                      <td className="px-2 py-2 font-medium">
                        {item.nextPtColor ? PT_COLOR_LABELS[item.nextPtColor] : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {ptImportIgnored.length > 0 && (
              <details className="rounded-md border px-3 py-2 text-xs">
                <summary className="cursor-pointer font-medium">
                  Ver {ptImportIgnored.length} linha(s) ignorada(s)
                </summary>
                <ul className="mt-2 max-h-32 space-y-1 overflow-auto text-muted-foreground">
                  {ptImportIgnored.map((message, index) => (
                    <li key={`${message}-${index}`}>{message}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        </Modal>
      )}

      {editing && (
        <ApontarModal
          activity={editing}
          canCancel={canEditPlanningFields}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refreshActivitiesAndSapStatus();
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
            refreshActivitiesAndSapStatus();
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
  return new Date(d).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
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
      .map((row) =>
        [row.pbs ?? "", row.pt_number ?? "", row.release_type ?? "", row.scheduled_date ?? ""].join(
          "\t",
        ),
      )
      .join("\n"),
  );

  async function save() {
    try {
      const lines = grid.replace(/\r/g, "").split("\n");
      if (lines.length !== rows.length)
        throw new Error(
          `Cole exatamente ${rows.length} linha(s), uma para cada atividade selecionada.`,
        );
      const parsed = lines.map((line, index) => {
        const cells = line.split("\t");
        if (cells.length > 4) throw new Error(`A linha ${index + 1} possui mais de 4 colunas.`);
        while (cells.length < 4) cells.push("");
        const [pbs, ptNumber, releaseType, scheduledDate] = cells.map((cell) => cell.trim());
        if (releaseType && !RELEASE_TYPES.includes(releaseType as (typeof RELEASE_TYPES)[number])) {
          throw new Error(
            `Tipo de liberação inválido na linha ${index + 1}. Use PT, PTT, ATRE ou Oficina.`,
          );
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
          <button
            type="button"
            onClick={save}
            className="btn-primary"
            disabled={saving || rows.length === 0}
          >
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
          São necessárias {rows.length} linha(s). Campos vazios apagam o valor atual. Tipos aceitos:
          PT, PTT, ATRE e Oficina. A data deve estar no formato AAAA-MM-DD.
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
  const needsImmediateLink =
    status === "NÃO EXECUTADO" && justification === IMMEDIATE_JUSTIFICATION;

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
        if ((res as any).conflict)
          toast.error("Esta atividade foi alterada por outro usuário. Recarregue e revise.");
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
              if (
                nextStatus === "CANCELADA" &&
                !CANCELLATION_JUSTIFICATIONS.includes(justification)
              )
                setJustification("");
              setStatus(nextStatus);
            }}
            className="input-base"
          >
            {STATUSES.filter(
              (s) =>
                (!PLANNING_WORKFLOW_STATUSES.has(s) && s !== "CANCELADA") ||
                canCancel ||
                activity.status === s,
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
              if (status === "NÃO EXECUTADO" && value === IMMEDIATE_JUSTIFICATION)
                setImmediatePickerOpen(true);
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
                <div className="text-[11px] font-semibold text-warning-foreground">
                  Imediatas atendidas
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {selectedImmediateIds.size > 0
                    ? `${selectedImmediateIds.size} atividade(s) vinculada(s)`
                    : "Selecione a atividade imediata que causou o desvio."}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setImmediatePickerOpen(true)}
                className="btn-ghost text-xs"
              >
                <Zap className="h-3.5 w-3.5" />{" "}
                {selectedImmediateIds.size ? "Alterar vínculo" : "Selecionar imediatas"}
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
  if (
    (key === "scheduled_date" || key === "d1_date") &&
    typeof v === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(v)
  ) {
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
        .select(
          "id, changed_at, changed_by_name, changed_by_email, change_source, previous_values, new_values",
        )
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
        <div className="text-[12px] text-muted-foreground">
          Nenhuma alteração registrada até agora.
        </div>
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
                  <span className="text-muted-foreground">
                    {h.changed_by_name || h.changed_by_email || "Sistema"}
                  </span>
                  <span className="status-pill border-border bg-muted text-muted-foreground">
                    {h.change_source === "planning" ? "Planejamento" : h.change_source}
                  </span>
                </div>
                <div className="mt-1 space-y-0.5">
                  {keys.length === 0 ? (
                    <div className="text-[11px] text-muted-foreground">
                      Atualização sem mudança de campos.
                    </div>
                  ) : (
                    keys.map((k) => (
                      <div key={k} className="text-[11px]">
                        <span className="font-medium text-foreground">{HISTORY_LABELS[k]}: </span>
                        <span className="text-muted-foreground line-through">
                          {historyValue(prev[k], k)}
                        </span>
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
        .select(
          "id,order_number,note_number,description,scheduled_date,status,area,specialty,planning_data",
        )
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
      if (next.has(id)) next.delete(id);
      else next.add(id);
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
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(row.id)}
                  className="mt-1"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[11px] font-semibold">
                      {row.order_number || "—"}
                    </span>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      Op {fmtPlan(row.planning_data, "Op") ?? "—"} · Sub{" "}
                      {fmtPlan(row.planning_data, "Subop") ?? "—"}
                    </span>
                    {sameDay && (
                      <span className="rounded bg-warning/15 px-1.5 py-0.5 text-[9px] font-semibold text-warning-foreground">
                        Mesma data
                      </span>
                    )}
                    <StatusPill status={row.status} />
                  </div>
                  <div className="mt-1 text-[12px] leading-snug text-foreground">
                    {row.description}
                  </div>
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
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
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
  const needsImmediateLink =
    status === "NÃO EXECUTADO" && justification === IMMEDIATE_JUSTIFICATION;

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
          <b className="tabular">{count}</b> atividade(s) receberão o mesmo status. Você será
          registrado como responsável em todas.
        </div>
      </div>
      <div className="mt-4 space-y-3">
        <Field label="Status" required>
          <select
            value={status}
            onChange={(e) => {
              const nextStatus = e.target.value;
              if (!REQUIRES_JUSTIFICATION.has(nextStatus)) setJustification("");
              if (
                nextStatus === "CANCELADA" &&
                !CANCELLATION_JUSTIFICATIONS.includes(justification)
              )
                setJustification("");
              setStatus(nextStatus);
            }}
            className="input-base"
          >
            {STATUSES.filter(
              (s) => canCancel || (s !== "CANCELADA" && !PLANNING_WORKFLOW_STATUSES.has(s)),
            ).map((s) => (
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
              if (status === "NÃO EXECUTADO" && value === IMMEDIATE_JUSTIFICATION)
                setImmediatePickerOpen(true);
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
                <div className="text-[11px] font-semibold text-warning-foreground">
                  Imediatas atendidas
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {selectedImmediateIds.size > 0
                    ? `${selectedImmediateIds.size} atividade(s) vinculada(s) às ${count} programadas`
                    : "Selecione a imediata que causou a parada das atividades."}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setImmediatePickerOpen(true)}
                className="btn-ghost text-xs"
              >
                <Zap className="h-3.5 w-3.5" />{" "}
                {selectedImmediateIds.size ? "Alterar vínculo" : "Selecionar imediatas"}
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
