import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { createImmediateActivity, bulkCreateImmediateActivities } from "@/lib/activities.functions";
import { importWeek, activateWeek, deleteWeek } from "@/lib/week-import.functions";
import { toast } from "sonner";
import { Zap, Upload, Download, CheckCircle2, AlertTriangle, FileSpreadsheet, FileDown, Trash2 } from "lucide-react";
import type { SessionInfo } from "./route";
import { PageHeader, Panel, EmptyState, Modal, Field } from "@/components/ui-kit";

export const Route = createFileRoute("/_authenticated/planejamento")({
  beforeLoad: ({ context }) => {
    const s = (context as { session: SessionInfo }).session;
    if (!s.roles.some((role) => role === "planning" || role === "admin")) throw redirect({ to: "/atividades" });
  },
  component: PlanejamentoPage,
});

// Colunas do modelo de programação semanal (mesma estrutura da planilha importada)
const IMMEDIATE_COLUMNS = [
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
  "Status",
  "Justificativa",
  "Observações",
] as const;
type ImmCol = (typeof IMMEDIATE_COLUMNS)[number];

const WEEKLY_TEMPLATE_COLUMNS = [
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

const TEMPLATE_STATUSES = ["Sem apontamento", "EXECUTADO", "NÃO EXECUTADO"];
const TEMPLATE_JUSTIFICATIONS = [
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

async function downloadWeeklyTemplate() {
  const XLSX = await import("xlsx");
  const acompanhamento = XLSX.utils.aoa_to_sheet([[...WEEKLY_TEMPLATE_COLUMNS]]);
  acompanhamento["!cols"] = WEEKLY_TEMPLATE_COLUMNS.map((name) => ({
    wch:
      name === "TxtDesc.Oper."
        ? 42
        : name === "Justificativa" || name === "Observações"
          ? 34
          : Math.max(11, name.length + 2),
  }));

  const dadosRows = [["Status", "Justificativa"]];
  const total = Math.max(TEMPLATE_STATUSES.length, TEMPLATE_JUSTIFICATIONS.length);
  for (let i = 0; i < total; i++) dadosRows.push([TEMPLATE_STATUSES[i] ?? "", TEMPLATE_JUSTIFICATIONS[i] ?? ""]);
  const dados = XLSX.utils.aoa_to_sheet(dadosRows);
  dados["!cols"] = [{ wch: 22 }, { wch: 74 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, acompanhamento, "Acompanhamento");
  XLSX.utils.book_append_sheet(wb, dados, "Dados");
  XLSX.writeFile(wb, "Modelo programação.xlsx");
  toast.success("Modelo semanal baixado.");
}

function normalize(s: string) {
  return s
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function parseWorkbook(file: File): Promise<{ sheetName: string; rows: Record<string, any>[]; headerRow: string[] }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = async () => {
      try {
        const XLSX = await import("xlsx");
        const wb = XLSX.read(reader.result, { type: "array", cellDates: true });
        const sheetName = wb.SheetNames[0];
        const ws = wb.Sheets[sheetName];
        const arr = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: null, raw: false });
        if (!arr.length) return resolve({ sheetName, rows: [], headerRow: [] });
        const headerRow = (arr[0] as any[]).map((v) => (v == null ? "" : String(v)));
        const rows: Record<string, any>[] = [];
        for (let i = 1; i < arr.length; i++) {
          const row = arr[i] as any[];
          if (!row || row.every((c) => c == null || c === "")) continue;
          const obj: Record<string, any> = {};
          for (let c = 0; c < Math.max(headerRow.length, 20); c++) {
            const key = headerRow[c]?.trim() || `col_${c}`;
            obj[key] = row[c] ?? null;
          }
          obj.__row = i + 1;
          rows.push(obj);
        }
        resolve({ sheetName, rows, headerRow });
      } catch (e) {
        reject(e);
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

function extractField(row: Record<string, any>, ...aliases: string[]): string | null {
  for (const key of Object.keys(row)) {
    const n = normalize(key);
    if (aliases.some((a) => n === normalize(a))) {
      const v = row[key];
      return v == null || v === "" ? null : String(v);
    }
  }
  return null;
}

function toISODate(v: any): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return s.slice(0, 10);
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function PlanejamentoPage() {
  const qc = useQueryClient();
  const [showImm, setShowImm] = useState(false);
  const [showImmImport, setShowImmImport] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [exportingId, setExportingId] = useState<string | null>(null);

  const activeWeek = useQuery({
    queryKey: ["active-week"],
    queryFn: async () =>
      (
        await supabase
          .from("weeks")
          .select("id,code,label,start_date,end_date,is_active")
          .eq("is_active", true)
          .maybeSingle()
      ).data,
  });

  const weeksList = useQuery({
    queryKey: ["weeks-list"],
    queryFn: async () =>
      (
        await supabase
          .from("weeks")
          .select("id, code, label, start_date, end_date, is_active")
          .order("start_date", { ascending: false })
      ).data ?? [],
  });

  const activateFn = useServerFn(activateWeek);
  const deleteFn = useServerFn(deleteWeek);

  async function exportWeekById(week: { id: string; code: string }) {
    if (exportingId) return;
    setExportingId(week.id);
    try {
      const XLSX = await import("xlsx");
      const acts: any[] = [];
      const chunk = 1000;
      for (let from = 0; ; from += chunk) {
        const { data, error } = await supabase
          .from("activities")
          .select(
            "planning_data,status,justification,observation,reported_by_name,reported_by_email,reported_at,source_row_number,scheduled_date,pbs,pt_number,release_type",
          )
          .eq("week_id", week.id)
          .order("source_row_number", { ascending: true })
          .range(from, from + chunk - 1);
        if (error) {
          toast.error(error.message);
          return;
        }
        if (!data?.length) break;
        acts.push(...data);
        if (data.length < chunk) break;
      }

      if (acts.length === 0) {
        toast.error("Esta semana não possui atividades para exportar.");
        return;
      }

      const RESPONSAVEL = "Responsável pela informação";
      const DATA_INFO = "Data da informação";
      const EXTRA_HEADERS = ["Ger", "Nº PT"];
      const exportHeaders = [...WEEKLY_TEMPLATE_COLUMNS, ...EXTRA_HEADERS, RESPONSAVEL, DATA_INFO];
      const gerByArea: Record<string, string> = {
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

      const formatReportedAt = (value: unknown): string => {
        if (!value) return "";
        try {
          const d = new Date(value as string);
          if (isNaN(d.getTime())) return "";
          const pad = (n: number) => String(n).padStart(2, "0");
          return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
        } catch {
          return "";
        }
      };

      const pad2 = (n: number) => String(n).padStart(2, "0");
      const formatDateOnly = (value: unknown): string => {
        if (value === null || value === undefined || value === "") return "";
        try {
          if (value instanceof Date) {
            if (isNaN(value.getTime())) return "";
            return `${pad2(value.getDate())}/${pad2(value.getMonth() + 1)}/${value.getFullYear()}`;
          }
          if (typeof value === "number" && isFinite(value)) {
            // Excel serial date (days since 1899-12-30)
            const ms = Math.round((value - 25569) * 86400 * 1000);
            const d = new Date(ms);
            if (isNaN(d.getTime())) return "";
            return `${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
          }
          if (typeof value === "string") {
            const s = value.trim();
            if (!s) return "";
            const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
            if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
            const br = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
            if (br) return `${pad2(Number(br[1]))}/${pad2(Number(br[2]))}/${br[3]}`;
            const d = new Date(s);
            if (!isNaN(d.getTime())) {
              return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
            }
          }
          return "";
        } catch {
          return "";
        }
      };

      const rows = acts.map((activity: any) => {
        const planning = (activity.planning_data ?? {}) as Record<string, any>;
        const row: Record<string, any> = {};
        for (const header of WEEKLY_TEMPLATE_COLUMNS) {
          if (header === "PBS") row[header] = activity.pbs ?? planning[header] ?? "";
          else if (header === "Tipo de Liberação") row[header] = activity.release_type ?? planning[header] ?? "";
          else if (header === "Data início") row[header] = formatDateOnly(activity.scheduled_date ?? planning[header]);
          else if (header === "Status") row[header] = activity.status ?? "Sem apontamento";
          else if (header === "Justificativa") row[header] = activity.justification ?? "";
          else if (header === "Observações") row[header] = activity.observation ?? "";
          else if (header === "Data fim") row[header] = formatDateOnly(planning[header]);
          else row[header] = planning[header] ?? "";
        }

        const operationalArea = String(planning["Área op"] ?? planning["Área Op"] ?? planning["Area Op"] ?? "")
          .trim()
          .toLocaleUpperCase("pt-BR");
        row["Ger"] = gerByArea[operationalArea] ?? "Não mapeado";
        row["Nº PT"] = activity.pt_number ?? "";
        row[RESPONSAVEL] = activity.reported_by_name || activity.reported_by_email || "";
        row[DATA_INFO] = formatReportedAt(activity.reported_at);
        return row;
      });

      const ws = XLSX.utils.json_to_sheet(rows, { header: exportHeaders });
      ws["!cols"] = exportHeaders.map((name) => ({
        wch:
          name === "TxtDesc.Oper."
            ? 42
            : name === "Justificativa" || name === "Observações" || name === RESPONSAVEL
              ? 34
              : name === "Tipo de Liberação" || name === DATA_INFO
                ? 18
                : Math.max(11, name.length + 2),
      }));

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Acompanhamento");
      XLSX.writeFile(wb, `${week.code.replace(/\//g, "-")}-apontamentos.xlsx`);
      toast.success(`Semana ${week.code} exportada.`);
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao exportar.");
    } finally {
      setExportingId(null);
    }
  }

  async function exportWeek() {
    if (!activeWeek.data) return;
    await exportWeekById({ id: activeWeek.data.id, code: activeWeek.data.code });
  }

  return (
    <main className="mx-auto max-w-none px-4 py-6 sm:px-6">
      <PageHeader
        eyebrow="Planejamento"
        title="Ciclo semanal"
        description="Importe a planilha da semana e exporte os apontamentos consolidados quando desejar."
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel
          title="Semana ativa"
          description={
            activeWeek.data ? `${activeWeek.data.start_date} → ${activeWeek.data.end_date}` : "Nenhuma semana ativa."
          }
          className="lg:col-span-2"
        >
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Código</div>
              <div className="mt-1 font-mono text-sm text-foreground">{activeWeek.data?.code ?? "—"}</div>
              <div className="mt-3 text-lg font-semibold text-foreground">{activeWeek.data?.label ?? "—"}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={downloadWeeklyTemplate} className="btn-ghost">
                <FileDown className="h-4 w-4" /> Baixar modelo semanal
              </button>
              <button onClick={() => setShowImport(true)} className="btn-primary">
                <Upload className="h-4 w-4" /> Importar planilha
              </button>
              <button
                onClick={exportWeek}
                disabled={!activeWeek.data || exportingId !== null}
                className="btn-ghost disabled:opacity-50"
              >
                <Download className="h-4 w-4" />
                {exportingId && activeWeek.data && exportingId === activeWeek.data.id
                  ? "Exportando…"
                  : "Exportar apontamentos"}
              </button>
            </div>
          </div>
        </Panel>

        <Panel title="Atividades imediatas" description="Somente planejamento/administrador.">
          <p className="text-[12px] text-muted-foreground">
            Registre ordens surgidas fora do ciclo. Ficam destacadas com o indicador âmbar.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() => setShowImm(true)}
              disabled={!activeWeek.data}
              className="inline-flex items-center gap-1.5 rounded-md border border-warning/50 bg-warning/15 px-3 py-2 text-[12px] font-semibold text-warning-foreground hover:bg-warning/25 disabled:opacity-50"
            >
              <Zap className="h-4 w-4" /> Cadastrar imediata
            </button>
            <button
              onClick={() => setShowImmImport(true)}
              disabled={!activeWeek.data}
              className="btn-ghost py-2 text-[12px]"
            >
              <Upload className="h-4 w-4" /> Importar imediatas
            </button>
            <button onClick={downloadImmediateTemplate} className="btn-ghost py-2 text-[12px]">
              <FileDown className="h-4 w-4" /> Baixar modelo
            </button>
          </div>
        </Panel>
      </div>

      <div className="mt-5">
        <Panel title="Semanas importadas" description={`${weeksList.data?.length ?? 0} registros`} padded={false}>
          {weeksList.data && weeksList.data.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="border-b border-border bg-muted text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">Código</th>
                    <th className="px-3 py-2 text-left font-semibold">Rótulo</th>
                    <th className="px-3 py-2 text-left font-semibold">Período</th>
                    <th className="px-3 py-2 text-left font-semibold">Status</th>
                    <th className="px-3 py-2 text-right font-semibold">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {weeksList.data.map((w: any) => (
                    <tr key={w.id} className="row-zebra hover:bg-accent/60">
                      <td className="px-3 py-2 font-mono text-[11px]">{w.code}</td>
                      <td className="px-3 py-2">{w.label}</td>
                      <td className="px-3 py-2 text-[11px] tabular text-muted-foreground">
                        {w.start_date} → {w.end_date}
                      </td>
                      <td className="px-3 py-2">
                        {w.is_active ? (
                          <span className="status-pill border-success/40 bg-success/10 text-success">
                            <CheckCircle2 className="h-3 w-3" /> Ativa
                          </span>
                        ) : (
                          <span className="text-[11px] text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex flex-wrap justify-end gap-1">
                          <button
                            onClick={() => exportWeekById({ id: w.id, code: w.code })}
                            disabled={exportingId === w.id}
                            className="btn-ghost py-1 text-[11px] disabled:opacity-50"
                            title={`Baixar apontamentos da semana ${w.code}`}
                          >
                            <Download className="h-3.5 w-3.5" />
                            {exportingId === w.id ? "Baixando…" : "Baixar"}
                          </button>
                          {!w.is_active && (
                            <>
                              <button
                                onClick={async () => {
                                  const res = await activateFn({ data: { weekId: w.id } });
                                  if (!res.ok) return toast.error(res.error);
                                  toast.success("Semana ativada.");
                                  qc.invalidateQueries({ queryKey: ["active-week"] });
                                  qc.invalidateQueries({ queryKey: ["weeks-list"] });
                                  qc.invalidateQueries({ queryKey: ["activities"] });
                                }}
                                className="btn-ghost py-1 text-[11px]"
                              >
                                Ativar
                              </button>
                              <button
                                onClick={async () => {
                                  if (
                                    !window.confirm(
                                      `Excluir definitivamente ${w.code}? Exporte o backup antes de continuar.`,
                                    )
                                  )
                                    return;
                                  const res = await deleteFn({ data: { weekId: w.id } });
                                  if (!res.ok) return toast.error(res.error);
                                  toast.success("Semana excluída.");
                                  qc.invalidateQueries({ queryKey: ["weeks-list"] });
                                }}
                                className="btn-ghost py-1 text-[11px] text-destructive"
                                title="Excluir semana inativa"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-4">
              <EmptyState
                icon={<FileSpreadsheet className="h-4 w-4" />}
                title="Nenhuma semana importada"
                description="Importe uma planilha .xlsx para iniciar o ciclo."
              />
            </div>
          )}
        </Panel>
      </div>

      {showImport && (
        <ImportModal
          onClose={() => setShowImport(false)}
          onDone={() => {
            setShowImport(false);
            qc.invalidateQueries({ queryKey: ["active-week"] });
            qc.invalidateQueries({ queryKey: ["weeks-list"] });
            qc.invalidateQueries({ queryKey: ["activities"] });
          }}
        />
      )}
      {showImm && activeWeek.data && (
        <ImmediateModal
          weekId={activeWeek.data.id}
          onClose={() => setShowImm(false)}
          onSaved={() => {
            setShowImm(false);
            qc.invalidateQueries({ queryKey: ["activities"] });
            toast.success("Imediata cadastrada.");
          }}
        />
      )}
      {showImmImport && activeWeek.data && (
        <ImmediateImportModal
          weekId={activeWeek.data.id}
          onClose={() => setShowImmImport(false)}
          onDone={(n) => {
            setShowImmImport(false);
            qc.invalidateQueries({ queryKey: ["activities"] });
            toast.success(`${n} imediatas cadastradas.`);
          }}
        />
      )}
    </main>
  );
}

async function downloadImmediateTemplate() {
  const XLSX = await import("xlsx");
  // O modelo de imediatas usa exatamente as mesmas colunas e sequência da programação semanal.
  const acompanhamento = XLSX.utils.aoa_to_sheet([[...WEEKLY_TEMPLATE_COLUMNS]]);
  acompanhamento["!cols"] = WEEKLY_TEMPLATE_COLUMNS.map((name) => ({
    wch:
      name === "TxtDesc.Oper."
        ? 42
        : name === "Justificativa" || name === "Observações"
          ? 34
          : Math.max(11, name.length + 2),
  }));

  const dadosRows = [["Status", "Justificativa"]];
  const total = Math.max(TEMPLATE_STATUSES.length, TEMPLATE_JUSTIFICATIONS.length);
  for (let i = 0; i < total; i++) dadosRows.push([TEMPLATE_STATUSES[i] ?? "", TEMPLATE_JUSTIFICATIONS[i] ?? ""]);
  const dados = XLSX.utils.aoa_to_sheet(dadosRows);
  dados["!cols"] = [{ wch: 22 }, { wch: 74 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, acompanhamento, "Acompanhamento");
  XLSX.utils.book_append_sheet(wb, dados, "Dados");
  XLSX.writeFile(wb, "Modelo programação - imediatas.xlsx");
  toast.success("Modelo de imediatas baixado.");
}

function ImportModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<{ rows: Record<string, any>[]; sheetName: string; headerRow: string[] } | null>(
    null,
  );
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [activate, setActivate] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const call = useServerFn(importWeek);

  async function handleFile(f: File) {
    setFile(f);
    setError(null);
    try {
      const res = await parseWorkbook(f);
      if (!res.rows.length) {
        setError("A planilha não contém linhas de dados.");
        setParsed(null);
        return;
      }
      setParsed(res);
      const base = f.name.replace(/\.[^.]+$/, "");
      if (!code) setCode(base.slice(0, 32));
      if (!label) setLabel(base);
    } catch (e: any) {
      setError(e?.message ?? "Falha ao ler a planilha.");
      setParsed(null);
    }
  }

  async function submit() {
    if (!parsed) return;
    if (!code.trim() || !label.trim() || !startDate || !endDate) return setError("Preencha código, rótulo e datas.");
    setBusy(true);
    setError(null);
    try {
      const payload = parsed.rows.map((r, idx) => {
        const order = extractField(r, "Ordem", "Ordem de serviço", "OS", "Nº ordem", "Numero da ordem");
        const note = extractField(r, "Nota", "Nº nota", "Numero da nota");
        const operation = extractField(r, "Op", "Operação", "Operacao");
        const suboperation = extractField(r, "Subop", "Sub operação", "Sub operacao");
        const desc = extractField(r, "TxtDesc.Oper.", "Descrição", "Descricao", "Serviço", "Servico") ?? "";
        const area = extractField(r, "Gerência", "Gerencia");
        const spec = extractField(r, "CenTrab", "Centro de trabalho", "Especialidade", "Disciplina");
        const dateRaw = extractField(
          r,
          "Data início",
          "Data inicio",
          "Data",
          "Data programada",
          "Data prevista",
          "Data planejada",
        );
        const sourceParts = [order, operation, suboperation, note].map((value) => value?.trim()).filter(Boolean);
        return {
          source_key: `${sourceParts.length ? sourceParts.join("|") : "SEM-CHAVE"}|ROW-${r.__row ?? idx + 2}`,
          order_number: order,
          note_number: note,
          description: desc,
          area,
          specialty: spec,
          scheduled_date: toISODate(dateRaw),
          pbs: extractField(r, "PBS"),
          release_type:
            extractField(r, "Tipo de Liberação", "Tipo de Liberacao")?.trim().toLocaleUpperCase("pt-BR") ?? null,
          planning_data: r,
          source_row_number: r.__row ?? null,
        };
      });
      const res = await call({
        data: {
          code: code.trim(),
          label: label.trim(),
          start_date: startDate,
          end_date: endDate,
          activate,
          source_file_name: file?.name ?? null,
          sheet_name: parsed.sheetName,
          rows: payload,
        },
      });
      if (!res.ok) {
        setError(res.error);
        setBusy(false);
        return;
      }
      toast.success(`Semana importada — ${res.count} atividades.`);
      onDone();
    } catch (e: any) {
      setError(e?.message ?? "Erro ao importar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Importar planilha semanal"
      description="A programação importada inclui PBS e Tipo de Liberação; o planejamento poderá atualizá-los depois."
      onClose={onClose}
      size="lg"
      footer={
        <>
          <button onClick={onClose} className="btn-ghost">
            Cancelar
          </button>
          <button onClick={submit} disabled={busy || !parsed} className="btn-primary">
            {busy ? "Importando…" : "Importar semana"}
          </button>
        </>
      }
    >
      <div className="rounded-md border border-dashed border-border bg-muted/40 p-4">
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        />
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => inputRef.current?.click()} className="btn-ghost">
            <Upload className="h-4 w-4" /> {file ? "Trocar arquivo" : "Selecionar arquivo"}
          </button>
          {file && (
            <div className="text-[12px] text-muted-foreground">
              <span className="font-medium text-foreground">{file.name}</span>
              {parsed && (
                <span>
                  {" "}
                  · {parsed.rows.length} linhas · aba “{parsed.sheetName}”
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="Código da semana" required>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Ex: 030/2026"
            className="input-base"
          />
        </Field>
        <Field label="Rótulo" required>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Ex: Semana 030/2026"
            className="input-base"
          />
        </Field>
        <Field label="Início" required>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="input-base" />
        </Field>
        <Field label="Fim" required>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="input-base" />
        </Field>
      </div>

      <label className="mt-3 flex items-center gap-2 text-[12px]">
        <input type="checkbox" checked={activate} onChange={(e) => setActivate(e.target.checked)} />
        Ativar esta semana imediatamente (desativa a atual)
      </label>

      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-[12px] text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}
    </Modal>
  );
}

function ImmediateModal({ weekId, onClose, onSaved }: { weekId: string; onClose: () => void; onSaved: () => void }) {
  const [values, setValues] = useState<Record<ImmCol, string>>(() => {
    const obj = {} as Record<ImmCol, string>;
    for (const c of IMMEDIATE_COLUMNS) obj[c] = "";
    obj["Data início"] = new Date().toISOString().slice(0, 10);
    obj["Data fim"] = new Date().toISOString().slice(0, 10);
    return obj;
  });
  const [saving, setSaving] = useState(false);
  const call = useServerFn(createImmediateActivity);

  function set(col: ImmCol, v: string) {
    setValues((p) => ({ ...p, [col]: v }));
  }

  async function save() {
    const order = values["Ordem"].trim();
    const desc = values["TxtDesc.Oper."].trim();
    if (!order || !desc) return toast.error("Ordem e Descrição (TxtDesc.Oper.) são obrigatórios.");
    setSaving(true);
    try {
      const planning: Record<string, any> = {};
      for (const c of IMMEDIATE_COLUMNS) {
        const v = values[c];
        planning[c] = v === "" ? null : v;
      }
      const res = await call({
        data: {
          weekId,
          order_number: order,
          note_number: values["Nota"].trim() || null,
          description: desc,
          area: values["Gerência"].trim() || null,
          specialty: values["CenTrab"].trim() || null,
          scheduled_date: values["Data início"] || null,
          planning_data: planning,
        },
      });
      if (!res.ok) return toast.error(res.error);
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  const dateCols = new Set<ImmCol>(["Data início", "Data fim"]);
  const timeCols = new Set<ImmCol>(["Hora início", "Hora fim"]);
  const numCols = new Set<ImmCol>(["Nº", "Op", "Trab", "Dur n"]);
  const wideCols = new Set<ImmCol>(["TxtDesc.Oper."]);

  return (
    <Modal
      title="Cadastrar atividade imediata"
      description="Preencha os mesmos campos da programação semanal. Destaque âmbar identifica a imediata."
      onClose={onClose}
      size="lg"
      footer={
        <>
          <button onClick={onClose} className="btn-ghost">
            Cancelar
          </button>
          <button onClick={save} disabled={saving} className="btn-primary">
            {saving ? "Salvando…" : "Cadastrar"}
          </button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {IMMEDIATE_COLUMNS.map((c) => {
          const required = c === "Ordem" || c === "TxtDesc.Oper.";
          const type = dateCols.has(c) ? "date" : timeCols.has(c) ? "time" : numCols.has(c) ? "number" : "text";
          const label = c + (c === "TxtDesc.Oper." ? " (Descrição)" : "");
          return (
            <div key={c} className={wideCols.has(c) ? "sm:col-span-2" : ""}>
              <Field label={label} required={required}>
                <input type={type} value={values[c]} onChange={(e) => set(c, e.target.value)} className="input-base" />
              </Field>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

function ImmediateImportModal({
  weekId,
  onClose,
  onDone,
}: {
  weekId: string;
  onClose: () => void;
  onDone: (count: number) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<{ rows: Record<string, any>[]; sheetName: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const call = useServerFn(bulkCreateImmediateActivities);

  async function handleFile(f: File) {
    setFile(f);
    setError(null);
    try {
      const res = await parseWorkbook(f);
      if (!res.rows.length) {
        setError("A planilha não contém linhas de dados.");
        setParsed(null);
        return;
      }
      setParsed(res);
    } catch (e: any) {
      setError(e?.message ?? "Falha ao ler a planilha.");
      setParsed(null);
    }
  }

  async function submit() {
    if (!parsed) return;
    setBusy(true);
    setError(null);
    try {
      const items = [];
      for (const r of parsed.rows) {
        const order = extractField(r, "Ordem", "Ordem de serviço", "OS");
        const desc = extractField(r, "TxtDesc.Oper.", "Descrição", "Descricao") ?? "";
        if (!order || !desc) continue;
        const planning: Record<string, any> = {};
        for (const c of IMMEDIATE_COLUMNS) {
          const key = Object.keys(r).find((k) => normalize(k) === normalize(c));
          planning[c] = key ? (r[key] ?? null) : null;
        }
        items.push({
          order_number: String(order),
          note_number: extractField(r, "Nota", "Nº nota"),
          description: String(desc),
          area: extractField(r, "Gerência", "Área", "Area"),
          specialty: extractField(r, "CenTrab", "Especialidade"),
          scheduled_date: toISODate(extractField(r, "Data início", "Data", "Data programada")),
          planning_data: planning,
        });
      }
      if (!items.length) {
        setError("Nenhuma linha válida (Ordem e Descrição são obrigatórios).");
        setBusy(false);
        return;
      }
      const res = await call({ data: { weekId, items } });
      if (!res.ok) {
        setError(res.error);
        setBusy(false);
        return;
      }
      onDone(res.count);
    } catch (e: any) {
      setError(e?.message ?? "Erro ao importar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Importar atividades imediatas"
      description="Use o mesmo formato da programação semanal. Baixe o modelo se precisar."
      onClose={onClose}
      size="lg"
      footer={
        <>
          <button onClick={downloadImmediateTemplate} className="btn-ghost">
            <FileDown className="h-4 w-4" /> Baixar modelo
          </button>
          <button onClick={onClose} className="btn-ghost">
            Cancelar
          </button>
          <button onClick={submit} disabled={busy || !parsed} className="btn-primary">
            {busy ? "Importando…" : "Importar imediatas"}
          </button>
        </>
      }
    >
      <div className="rounded-md border border-dashed border-border bg-muted/40 p-4">
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        />
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => inputRef.current?.click()} className="btn-ghost">
            <Upload className="h-4 w-4" /> {file ? "Trocar arquivo" : "Selecionar arquivo"}
          </button>
          {file && (
            <div className="text-[12px] text-muted-foreground">
              <span className="font-medium text-foreground">{file.name}</span>
              {parsed && (
                <span>
                  {" "}
                  · {parsed.rows.length} linhas · aba “{parsed.sheetName}”
                </span>
              )}
            </div>
          )}
        </div>
        <p className="mt-3 text-[11px] text-muted-foreground">Colunas esperadas: {IMMEDIATE_COLUMNS.join(", ")}.</p>
      </div>
      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-[12px] text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}
    </Modal>
  );
}
