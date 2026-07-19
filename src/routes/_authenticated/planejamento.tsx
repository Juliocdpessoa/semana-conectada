import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { createImmediateActivity, bulkCreateImmediateActivities } from "@/lib/activities.functions";
import { importWeek, activateWeek } from "@/lib/week-import.functions";
import { toast } from "sonner";
import { Zap, Upload, Download, CheckCircle2, AlertTriangle, FileSpreadsheet, FileDown } from "lucide-react";
import type { SessionInfo } from "./route";
import { PageHeader, Panel, EmptyState, Modal, Field } from "@/components/ui-kit";

export const Route = createFileRoute("/_authenticated/planejamento")({
  beforeLoad: ({ context }) => {
    const s = (context as { session: SessionInfo }).session;
    if (s.role !== "planning" && s.role !== "admin") throw redirect({ to: "/atividades" });
  },
  component: PlanejamentoPage,
});

// Colunas do modelo de programação semanal (mesma estrutura da planilha importada)
const IMMEDIATE_COLUMNS = [
  "Ordem", "Nº", "Nota", "Op", "Subop", "TxtDesc.Oper.",
  "Gerência", "Área op", "Localização", "Local",
  "CenTrab", "Gr pl", "Trab", "Dur n",
  "Data início", "Hora início", "Data fim", "Hora fim",
  "Tipo de Nota", "Confirmação",
] as const;
type ImmCol = (typeof IMMEDIATE_COLUMNS)[number];


const COLUMN_HEADERS = [
  "Ordem", "Nota", "Descrição", "Área", "Especialidade", "Data", "Turno", "Equipe",
  "Prioridade", "Duração (h)", "Local", "Equipamento", "TAG", "Serviço", "Origem",
  "Contrato", "PEP", "Centro de custo", "Observação planejamento", "Responsável planejamento",
  "Status", "Justificativa", "Observações", "Responsável pela informação",
];

function normalize(s: string) {
  return s.toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

function parseWorkbook(file: File): Promise<{ sheetName: string; rows: Record<string, any>[]; headerRow: string[] }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      try {
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
      } catch (e) { reject(e); }
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


  const activeWeek = useQuery({
    queryKey: ["active-week"],
    queryFn: async () => (await supabase.from("weeks").select("*").eq("is_active", true).maybeSingle()).data,
  });

  const weeksList = useQuery({
    queryKey: ["weeks-list"],
    queryFn: async () =>
      (await supabase.from("weeks").select("id, code, label, start_date, end_date, is_active").order("start_date", { ascending: false })).data ?? [],
  });

  const activateFn = useServerFn(activateWeek);

  async function exportWeek() {
    if (!activeWeek.data) return;
    const { data: acts, error } = await supabase
      .from("activities")
      .select("*")
      .eq("week_id", activeWeek.data.id)
      .order("source_row_number", { ascending: true });
    if (error) return toast.error(error.message);
    const rows = (acts ?? []).map((a: any) => {
      const pd = (a.planning_data ?? {}) as Record<string, any>;
      const line: Record<string, any> = {};
      for (const h of COLUMN_HEADERS.slice(0, 20)) {
        const key = Object.keys(pd).find((k) => normalize(k) === normalize(h));
        line[h] = key ? pd[key] : null;
      }
      if (!line["Ordem"]) line["Ordem"] = a.order_number;
      if (!line["Nota"]) line["Nota"] = a.note_number;
      if (!line["Descrição"]) line["Descrição"] = a.description;
      if (!line["Área"]) line["Área"] = a.area;
      if (!line["Especialidade"]) line["Especialidade"] = a.specialty;
      if (!line["Data"]) line["Data"] = a.scheduled_date;
      line["Status"] = a.status;
      line["Justificativa"] = a.justification;
      line["Observações"] = a.observation;
      line["Responsável pela informação"] = a.reported_by_name
        ? `${a.reported_by_name}${a.reported_by_email ? ` <${a.reported_by_email}>` : ""}`
        : "";
      return line;
    });
    const ws = XLSX.utils.json_to_sheet(rows, { header: COLUMN_HEADERS });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Programação");
    XLSX.writeFile(wb, `${activeWeek.data.code.replace(/\//g, "-")}-apontamentos.xlsx`);
    toast.success("Planilha exportada.");
  }

  return (
    <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
      <PageHeader
        eyebrow="Planejamento"
        title="Ciclo semanal"
        description="Importe a planilha da semana e exporte os apontamentos consolidados quando desejar."
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel
          title="Semana ativa"
          description={activeWeek.data ? `${activeWeek.data.start_date} → ${activeWeek.data.end_date}` : "Nenhuma semana ativa."}
          className="lg:col-span-2"
        >
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Código</div>
              <div className="mt-1 font-mono text-sm text-foreground">{activeWeek.data?.code ?? "—"}</div>
              <div className="mt-3 text-lg font-semibold text-foreground">{activeWeek.data?.label ?? "—"}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => setShowImport(true)} className="btn-primary">
                <Upload className="h-4 w-4" /> Importar planilha
              </button>
              <button onClick={exportWeek} disabled={!activeWeek.data} className="btn-ghost">
                <Download className="h-4 w-4" /> Exportar apontamentos
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
                      <td className="px-3 py-2 text-[11px] tabular text-muted-foreground">{w.start_date} → {w.end_date}</td>
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
                        {!w.is_active && (
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
                        )}
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

function downloadImmediateTemplate() {
  const header = [...IMMEDIATE_COLUMNS];
  const example: Record<string, any> = {
    "Ordem": "2027999999",
    "Nº": 1,
    "Nota": "14999999",
    "Op": 10,
    "Subop": "",
    "TxtDesc.Oper.": "Descrição da atividade imediata",
    "Gerência": "Oficinas",
    "Área op": "",
    "Localização": "",
    "Local": "ROTINA",
    "CenTrab": "MECANICO",
    "Gr pl": "COM",
    "Trab": 4,
    "Dur n": 4,
    "Data início": new Date().toISOString().slice(0, 10),
    "Hora início": "08:00",
    "Data fim": new Date().toISOString().slice(0, 10),
    "Hora fim": "12:00",
    "Tipo de Nota": "ZF",
    "Confirmação": "",
  };
  const ws = XLSX.utils.json_to_sheet([example], { header });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Imediatas");
  XLSX.writeFile(wb, "modelo-atividades-imediatas.xlsx");
}


function ImportModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<{ rows: Record<string, any>[]; sheetName: string; headerRow: string[] } | null>(null);
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
    setFile(f); setError(null);
    try {
      const res = await parseWorkbook(f);
      if (!res.rows.length) { setError("A planilha não contém linhas de dados."); setParsed(null); return; }
      setParsed(res);
      const base = f.name.replace(/\.[^.]+$/, "");
      if (!code) setCode(base.slice(0, 32));
      if (!label) setLabel(base);
    } catch (e: any) { setError(e?.message ?? "Falha ao ler a planilha."); setParsed(null); }
  }

  async function submit() {
    if (!parsed) return;
    if (!code.trim() || !label.trim() || !startDate || !endDate) return setError("Preencha código, rótulo e datas.");
    setBusy(true); setError(null);
    try {
      const payload = parsed.rows.map((r, idx) => {
        const order = extractField(r, "Ordem", "Ordem de serviço", "OS", "Nº ordem", "Numero da ordem");
        const note = extractField(r, "Nota", "Nº nota", "Numero da nota");
        const desc = extractField(r, "Descrição", "Descricao", "Serviço", "Servico") ?? "";
        const area = extractField(r, "Área", "Area");
        const spec = extractField(r, "Especialidade", "Disciplina");
        const dateRaw = extractField(r, "Data", "Data programada", "Data prevista", "Data planejada");
        return {
          source_key: order?.trim() || `ROW-${r.__row ?? idx + 2}`,
          order_number: order,
          note_number: note,
          description: desc,
          area, specialty: spec,
          scheduled_date: toISODate(dateRaw),
          planning_data: r,
          source_row_number: r.__row ?? null,
        };
      });
      const res = await call({
        data: {
          code: code.trim(), label: label.trim(),
          start_date: startDate, end_date: endDate,
          activate, source_file_name: file?.name ?? null, sheet_name: parsed.sheetName,
          rows: payload,
        },
      });
      if (!res.ok) { setError(res.error); setBusy(false); return; }
      toast.success(`Semana importada — ${res.count} atividades.`);
      onDone();
    } catch (e: any) { setError(e?.message ?? "Erro ao importar."); }
    finally { setBusy(false); }
  }

  return (
    <Modal
      title="Importar planilha semanal"
      description="Colunas A–T viram planejamento (leitura); U–X são preenchidas pelos apontamentos."
      onClose={onClose}
      size="lg"
      footer={
        <>
          <button onClick={onClose} className="btn-ghost">Cancelar</button>
          <button onClick={submit} disabled={busy || !parsed} className="btn-primary">
            {busy ? "Importando…" : "Importar semana"}
          </button>
        </>
      }
    >
      <div className="rounded-md border border-dashed border-border bg-muted/40 p-4">
        <input
          ref={inputRef} type="file" accept=".xlsx,.xls" className="hidden"
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        />
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => inputRef.current?.click()} className="btn-ghost">
            <Upload className="h-4 w-4" /> {file ? "Trocar arquivo" : "Selecionar arquivo"}
          </button>
          {file && (
            <div className="text-[12px] text-muted-foreground">
              <span className="font-medium text-foreground">{file.name}</span>
              {parsed && <span> · {parsed.rows.length} linhas · aba “{parsed.sheetName}”</span>}
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="Código da semana" required>
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Ex: 030/2026" className="input-base" />
        </Field>
        <Field label="Rótulo" required>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ex: Semana 030/2026" className="input-base" />
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
  const [order, setOrder] = useState("");
  const [note, setNote] = useState("");
  const [desc, setDesc] = useState("");
  const [area, setArea] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const call = useServerFn(createImmediateActivity);

  async function save() {
    if (!order.trim() || !desc.trim()) return toast.error("Ordem e descrição são obrigatórios.");
    setSaving(true);
    try {
      const res = await call({
        data: {
          weekId, order_number: order.trim(), note_number: note.trim() || null,
          description: desc.trim(), area: area.trim() || null,
          specialty: specialty.trim() || null, scheduled_date: date || null,
        },
      });
      if (!res.ok) return toast.error(res.error);
      onSaved();
    } finally { setSaving(false); }
  }

  return (
    <Modal
      title="Cadastrar atividade imediata"
      description="Registro fora do ciclo semanal, sinalizado com destaque âmbar."
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="btn-ghost">Cancelar</button>
          <button onClick={save} disabled={saving} className="btn-primary">
            {saving ? "Salvando…" : "Cadastrar"}
          </button>
        </>
      }
    >
      <div className="grid gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Ordem" required><input value={order} onChange={(e) => setOrder(e.target.value)} className="input-base" /></Field>
          <Field label="Nota"><input value={note} onChange={(e) => setNote(e.target.value)} className="input-base" /></Field>
        </div>
        <Field label="Descrição" required><input value={desc} onChange={(e) => setDesc(e.target.value)} className="input-base" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Área"><input value={area} onChange={(e) => setArea(e.target.value)} className="input-base" /></Field>
          <Field label="Especialidade"><input value={specialty} onChange={(e) => setSpecialty(e.target.value)} className="input-base" /></Field>
        </div>
        <Field label="Data"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input-base" /></Field>
      </div>
    </Modal>
  );
}
