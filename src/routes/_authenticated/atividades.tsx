import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { updateActivity, bulkUpdateActivities } from "@/lib/activities.functions";
import { toast } from "sonner";
import { Search, X, Filter, Zap, CheckCircle2, AlertTriangle, Clock, RefreshCw } from "lucide-react";
import type { SessionInfo } from "./route";

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
  sync_status: "synced" | "pending" | "error";
  week_id: string;
};

const STATUSES = [
  "Sem apontamento",
  "EXECUTADO",
  "NÃO EXECUTADO",
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
const REQUIRES_JUSTIFICATION = new Set(["NÃO EXECUTADO"]);


function AtividadesPage() {
  const { session } = Route.useRouteContext() as { session: SessionInfo };
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [areaFilter, setAreaFilter] = useState<string>("");
  const [dateFilter, setDateFilter] = useState<string>("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<ActivityRow | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
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
      const pageSize = 1000;
      const all: any[] = [];
      for (let from = 0; ; from += pageSize) {
        const { data, error } = await supabase
          .from("activities")
          .select("*")
          .eq("week_id", activeWeek.data!.id)
          .order("scheduled_date", { ascending: true })
          .order("order_number", { ascending: true })
          .range(from, from + pageSize - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        all.push(...data);
        if (data.length < pageSize) break;
      }
      return all as ActivityRow[];
    },
  });

  const filtered = useMemo(() => {
    const rows = activities.data ?? [];
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter && r.status !== statusFilter) return false;
      if (areaFilter && r.area !== areaFilter) return false;
      if (dateFilter && r.scheduled_date !== dateFilter) return false;
      if (!q) return true;
      return (
        r.order_number?.toLowerCase().includes(q) ||
        r.note_number?.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q) ||
        r.area?.toLowerCase().includes(q) ||
        r.specialty?.toLowerCase().includes(q) ||
        r.reported_by_name?.toLowerCase().includes(q)
      );
    });
  }, [activities.data, search, statusFilter, areaFilter, dateFilter]);

  const paged = filtered.slice(page * pageSize, (page + 1) * pageSize);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));

  const kpis = useMemo(() => {
    const rows = activities.data ?? [];
    const total = rows.length;
    const concluded = rows.filter((r) => r.status === "Concluída").length;
    const impeded = rows.filter((r) => r.status === "Impedida" || r.status === "Não realizada").length;
    const noReport = rows.filter((r) => r.status === "Sem apontamento").length;
    const immediates = rows.filter((r) => r.is_immediate).length;
    const percent = total ? Math.round((concluded / total) * 100) : 0;
    return { total, concluded, impeded, noReport, immediates, percent };
  }, [activities.data]);

  const areas = useMemo(() => {
    return Array.from(new Set((activities.data ?? []).map((r) => r.area).filter(Boolean))) as string[];
  }, [activities.data]);

  function clearFilters() {
    setSearch("");
    setStatusFilter("");
    setAreaFilter("");
    setDateFilter("");
    setPage(0);
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

  return (
    <main className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6">
      {/* Cabeçalho da semana */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs text-muted-foreground">Semana ativa</div>
          <h1 className="text-xl font-semibold text-foreground">
            {activeWeek.data?.label ?? "—"}
          </h1>
        </div>
        <div className="text-xs text-muted-foreground">
          {kpis.concluded} de {kpis.total} concluídas ({kpis.percent}%)
        </div>
      </div>

      {/* Indicadores */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi label="Programadas" value={kpis.total} icon={<Clock className="h-4 w-4 text-muted-foreground" />} />
        <Kpi label="Concluídas" value={kpis.concluded} icon={<CheckCircle2 className="h-4 w-4 text-success" />} />
        <Kpi label="Impedidas/N/R" value={kpis.impeded} icon={<AlertTriangle className="h-4 w-4 text-warning" />} />
        <Kpi label="Sem apontamento" value={kpis.noReport} icon={<Clock className="h-4 w-4 text-muted-foreground" />} />
        <Kpi label="IMEDIATAS" value={kpis.immediates} icon={<Zap className="h-4 w-4 text-destructive" />} />
        <Kpi label="Conclusão" value={`${kpis.percent}%`} icon={<CheckCircle2 className="h-4 w-4 text-success" />} />
      </div>

      {/* Barra de progresso semanal */}
      <div className="mb-6 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-success transition-all" style={{ width: `${kpis.percent}%` }} />
      </div>

      {/* Filtros */}
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            placeholder="Buscar por ordem, nota, descrição, área ou responsável..."
            className="w-full rounded-md border border-input bg-card py-2 pl-8 pr-3 text-sm outline-none focus:border-ring focus:ring-1 focus:ring-ring"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}
          className="rounded-md border border-input bg-card px-2 py-2 text-xs"
        >
          <option value="">Todos os status</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select
          value={areaFilter}
          onChange={(e) => { setAreaFilter(e.target.value); setPage(0); }}
          className="rounded-md border border-input bg-card px-2 py-2 text-xs"
        >
          <option value="">Todas as áreas</option>
          {areas.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <input
          type="date"
          value={dateFilter}
          onChange={(e) => { setDateFilter(e.target.value); setPage(0); }}
          className="rounded-md border border-input bg-card px-2 py-2 text-xs"
        />
        {(search || statusFilter || areaFilter || dateFilter) && (
          <button onClick={clearFilters} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1.5 text-xs hover:bg-accent">
            <X className="h-3 w-3" /> Limpar
          </button>
        )}
        <button
          onClick={() => activities.refetch()}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1.5 text-xs hover:bg-accent"
          title="Atualizar"
        >
          <RefreshCw className="h-3 w-3" />
          Atualizar
        </button>
        <div className="ml-auto text-xs text-muted-foreground">
          {filtered.length} de {activities.data?.length ?? 0}
        </div>
      </div>

      {/* Ações de lote */}
      {selected.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
          <div className="text-sm">
            <span className="font-semibold">{selected.size}</span> atividade(s) selecionada(s)
          </div>
          <div className="flex gap-2">
            <button onClick={() => setSelected(new Set())} className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent">
              Cancelar
            </button>
            <button onClick={() => setBulkOpen(true)} className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-secondary">
              Apontar em lote
            </button>
          </div>
        </div>
      )}

      {/* Tabela (desktop) / Cartões (mobile) */}
      {activities.isLoading ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          Carregando atividades...
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          Nenhuma atividade encontrada.
        </div>
      ) : (
        <>
          {/* Desktop */}
          <div className="hidden overflow-hidden rounded-lg border border-border bg-card md:block">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="w-8 px-2 py-2">
                    <input type="checkbox" checked={paged.length > 0 && selected.size === paged.length} onChange={toggleAll} />
                  </th>
                  <th className="px-2 py-2 text-left font-medium">Ordem / Nota</th>
                  <th className="px-2 py-2 text-left font-medium">Atividade</th>
                  <th className="px-2 py-2 text-left font-medium">Área / Especialidade</th>
                  <th className="px-2 py-2 text-left font-medium">Data</th>
                  <th className="px-2 py-2 text-left font-medium">Status</th>
                  <th className="px-2 py-2 text-left font-medium">Responsável</th>
                  <th className="px-2 py-2 text-left font-medium">Sinc.</th>
                  <th className="px-2 py-2 text-right font-medium">Ação</th>
                </tr>
              </thead>
              <tbody>
                {paged.map((r) => (
                  <tr key={r.id} className={`border-b border-border/60 hover:bg-accent/40 ${r.is_immediate ? "bg-destructive/5" : ""}`}>
                    <td className="px-2 py-2">
                      <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleSelect(r.id)} />
                    </td>
                    <td className="px-2 py-2 font-mono text-xs">
                      <div>{r.order_number}</div>
                      <div className="text-muted-foreground">{r.note_number}</div>
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex items-start gap-2">
                        {r.is_immediate && (
                          <span className="mt-0.5 inline-flex items-center gap-1 rounded bg-destructive px-1.5 py-0.5 text-[10px] font-bold uppercase text-destructive-foreground">
                            <Zap className="h-2.5 w-2.5" /> Imediata
                          </span>
                        )}
                        <div className="text-foreground">{r.description}</div>
                      </div>
                    </td>
                    <td className="px-2 py-2 text-xs">
                      <div>{r.area}</div>
                      <div className="text-muted-foreground">{r.specialty}</div>
                    </td>
                    <td className="px-2 py-2 text-xs">{formatDate(r.scheduled_date)}</td>
                    <td className="px-2 py-2"><StatusPill status={r.status} /></td>
                    <td className="px-2 py-2 text-xs">
                      {r.reported_by_name || <span className="text-muted-foreground">—</span>}
                      {r.reported_at && <div className="text-[11px] text-muted-foreground">{formatDateTime(r.reported_at)}</div>}
                    </td>
                    <td className="px-2 py-2"><SyncPill status={r.sync_status} /></td>
                    <td className="px-2 py-2 text-right">
                      <button onClick={() => setEditing(r)} className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-secondary">
                        {r.status === "Sem apontamento" ? "Apontar" : "Atualizar"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile */}
          <div className="space-y-2 md:hidden">
            {paged.map((r) => (
              <div key={r.id} className={`rounded-lg border border-border bg-card p-3 ${r.is_immediate ? "border-l-4 border-l-destructive" : ""}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleSelect(r.id)} />
                      <div className="font-mono text-xs text-muted-foreground">{r.order_number} · {r.note_number}</div>
                    </div>
                    <div className="mt-1 text-sm text-foreground">{r.description}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{r.area} · {r.specialty} · {formatDate(r.scheduled_date)}</div>
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <StatusPill status={r.status} />
                  <button onClick={() => setEditing(r)} className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground">
                    {r.status === "Sem apontamento" ? "Apontar" : "Atualizar"}
                  </button>
                </div>
                {r.reported_by_name && (
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    Últ.: {r.reported_by_name} · {formatDateTime(r.reported_at)}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Paginação */}
          <div className="mt-3 flex items-center justify-between text-xs">
            <div className="text-muted-foreground">
              Página {page + 1} de {totalPages}
            </div>
            <div className="flex gap-1">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="rounded-md border border-border px-3 py-1 disabled:opacity-40 hover:bg-accent"
              >Anterior</button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="rounded-md border border-border px-3 py-1 disabled:opacity-40 hover:bg-accent"
              >Próxima</button>
            </div>
          </div>
        </>
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

function Kpi({ label, value, icon }: { label: string; value: number | string; icon: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        {icon}
      </div>
      <div className="mt-1 text-xl font-semibold text-foreground">{value}</div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const styles: Record<string, string> = {
    "Concluída": "border-success/40 bg-success/10 text-success",
    "Em execução": "border-secondary/40 bg-secondary/10 text-secondary",
    "Sem apontamento": "border-border bg-muted text-muted-foreground",
    "Impedida": "border-warning/50 bg-warning/15 text-warning-foreground",
    "Não realizada": "border-destructive/40 bg-destructive/10 text-destructive",
    "Reprogramada": "border-warning/40 bg-warning/10 text-warning-foreground",
    "Cancelada": "border-border bg-muted text-muted-foreground line-through",
  };
  return <span className={`status-pill ${styles[status] ?? "border-border bg-muted text-muted-foreground"}`}>{status}</span>;
}

function SyncPill({ status }: { status: "synced" | "pending" | "error" }) {
  const label = status === "synced" ? "OK" : status === "pending" ? "Pendente" : "Erro";
  const style = status === "synced" ? "border-success/40 bg-success/10 text-success"
    : status === "pending" ? "border-warning/40 bg-warning/10 text-warning-foreground"
    : "border-destructive/40 bg-destructive/10 text-destructive";
  return <span className={`status-pill ${style}`}>{label}</span>;
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

function ApontarModal({ activity, onClose, onSaved }: { activity: ActivityRow; onClose: () => void; onSaved: () => void }) {
  const [status, setStatus] = useState(activity.status);
  const [justification, setJustification] = useState(activity.justification ?? "");
  const [observation, setObservation] = useState(activity.observation ?? "");
  const [saving, setSaving] = useState(false);
  const call = useServerFn(updateActivity);

  const needsJust = REQUIRES_JUSTIFICATION.has(status);

  async function save() {
    if (needsJust && !justification.trim()) {
      toast.error("Justificativa é obrigatória para este status.");
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
        },
      });
      if (!res.ok) {
        if ((res as any).conflict) {
          toast.error("Esta atividade foi alterada por outro usuário. Recarregue e revise.");
        } else {
          toast.error(res.error ?? "Erro ao salvar apontamento.");
        }
        return;
      }
      toast.success("Apontamento salvo.");
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onClose} title="Apontar atividade">
      <div className="rounded-md border border-border bg-muted/40 p-3 text-xs">
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <span><b>Ordem:</b> {activity.order_number}</span>
          <span><b>Nota:</b> {activity.note_number}</span>
          <span><b>Área:</b> {activity.area}</span>
          <span><b>Data:</b> {formatDate(activity.scheduled_date)}</span>
        </div>
        <div className="mt-1 text-sm text-foreground">{activity.description}</div>
      </div>

      <label className="mt-4 block text-xs font-medium">Status <span className="text-destructive">*</span></label>
      <select value={status} onChange={(e) => setStatus(e.target.value)} className="mt-1 w-full rounded-md border border-input bg-card px-3 py-2 text-sm">
        {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>

      <label className="mt-4 block text-xs font-medium">
        Justificativa {needsJust && <span className="text-destructive">*</span>}
      </label>
      <select value={justification} onChange={(e) => setJustification(e.target.value)} className="mt-1 w-full rounded-md border border-input bg-card px-3 py-2 text-sm">
        <option value="">— Selecione —</option>
        {JUSTIFICATIONS.map((j) => <option key={j} value={j}>{j}</option>)}
      </select>

      <label className="mt-4 block text-xs font-medium">Observações</label>
      <textarea
        value={observation}
        onChange={(e) => setObservation(e.target.value)}
        rows={3}
        maxLength={2000}
        className="mt-1 w-full rounded-md border border-input bg-card px-3 py-2 text-sm"
      />

      <p className="mt-3 text-[11px] text-muted-foreground">
        Você será registrado automaticamente como responsável por esta informação.
      </p>

      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm hover:bg-accent">Cancelar</button>
        <button onClick={save} disabled={saving} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-secondary disabled:opacity-60">
          {saving ? "Salvando..." : "Salvar apontamento"}
        </button>
      </div>
    </Modal>
  );
}

function BulkModal({ count, ids, onClose, onSaved }: { count: number; ids: string[]; onClose: () => void; onSaved: () => void }) {
  const [status, setStatus] = useState("Concluída");
  const [justification, setJustification] = useState("");
  const [observation, setObservation] = useState("");
  const [saving, setSaving] = useState(false);
  const call = useServerFn(bulkUpdateActivities);

  const needsJust = REQUIRES_JUSTIFICATION.has(status);

  async function save() {
    if (needsJust && !justification.trim()) {
      toast.error("Justificativa é obrigatória para este status.");
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
        },
      });
      if (!res.ok) return toast.error(res.error ?? "Erro ao salvar lote.");
      toast.success(`${res.count} atividade(s) atualizada(s).`);
      onSaved();
    } finally { setSaving(false); }
  }

  return (
    <Modal onClose={onClose} title={`Apontar ${count} atividade(s) em lote`}>
      <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-warning-foreground">
        <b>{count}</b> atividade(s) receberão o mesmo status e justificativa. Você será registrado como responsável em todas.
      </div>
      <label className="mt-4 block text-xs font-medium">Status</label>
      <select value={status} onChange={(e) => setStatus(e.target.value)} className="mt-1 w-full rounded-md border border-input bg-card px-3 py-2 text-sm">
        {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
      <label className="mt-4 block text-xs font-medium">Justificativa {needsJust && <span className="text-destructive">*</span>}</label>
      <select value={justification} onChange={(e) => setJustification(e.target.value)} className="mt-1 w-full rounded-md border border-input bg-card px-3 py-2 text-sm">
        <option value="">— Selecione —</option>
        {JUSTIFICATIONS.map((j) => <option key={j} value={j}>{j}</option>)}
      </select>
      <label className="mt-4 block text-xs font-medium">Observação (opcional)</label>
      <textarea value={observation} onChange={(e) => setObservation(e.target.value)} rows={2} maxLength={2000} className="mt-1 w-full rounded-md border border-input bg-card px-3 py-2 text-sm" />
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm hover:bg-accent">Cancelar</button>
        <button onClick={save} disabled={saving} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60 hover:bg-secondary">
          {saving ? "Salvando..." : `Aplicar a ${count} atividade(s)`}
        </button>
      </div>
    </Modal>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-t-xl bg-card p-5 shadow-lg sm:rounded-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-accent"><X className="h-4 w-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
