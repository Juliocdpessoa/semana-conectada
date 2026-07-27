import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Timer, CheckCircle2, XCircle, Clock, Utensils, ListChecks, Search, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, Panel, KpiCard, EmptyState, Modal, Field } from "@/components/ui-kit";
import { cn } from "@/lib/utils";
import type { SessionInfo } from "./route";
import { createOvertimeRequest, decideOvertimeRequest, cancelOvertimeRequest } from "@/lib/overtime.functions";

type OvertimeRow = {
  id: string;
  request_number: number;
  requester_user_id: string;
  requester_name: string;
  requester_email: string;
  employee_name: string;
  employee_registration: string;
  employee_role: string;
  activity_id: string | null;
  week_id: string | null;
  order_number: string | null;
  service_description: string;
  overtime_date: string;
  departure_time: string;
  needs_snack: boolean;
  justification: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  manager_comment: string | null;
  decided_by_name: string | null;
  decided_at: string | null;
  version: number;
  created_at: string;
};

export const Route = createFileRoute("/_authenticated/hora-extra")({
  beforeLoad: ({ context }) => {
    const s = (context as { session: SessionInfo }).session;
    if (s.role !== "leader" && s.role !== "manager" && s.role !== "admin") {
      throw redirect({ to: "/atividades" });
    }
  },
  component: OvertimePage,
});

function OvertimePage() {
  const { session } = Route.useRouteContext() as { session: SessionInfo };
  const s = session;
  const isManager = s.role === "manager" || s.role === "admin";
  const canRequest = s.role === "leader" || s.role === "admin";

  const [tab, setTab] = useState<"list" | "queue" | "new">(canRequest ? "list" : "queue");
  const [showNew, setShowNew] = useState(false);

  const qc = useQueryClient();
  const requests = useQuery({
    queryKey: ["overtime-requests", s.userId, isManager],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("overtime_requests")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as OvertimeRow[];
    },
  });

  const rows = requests.data ?? [];
  const kpis = useMemo(() => {
    const total = rows.length;
    const pending = rows.filter((r) => r.status === "pending").length;
    const approved = rows.filter((r) => r.status === "approved").length;
    const rejected = rows.filter((r) => r.status === "rejected").length;
    const snacks = rows.filter((r) => r.needs_snack && r.status === "approved").length;
    return { total, pending, approved, rejected, snacks };
  }, [rows]);

  return (
    <main className="mx-auto w-full max-w-[1400px] overflow-x-hidden px-3 py-4 sm:px-6 sm:py-6">
      <PageHeader
        eyebrow="Operação"
        title="Hora Extra"
        description="Solicitação e aprovação de horas extras da equipe."
        actions={
          canRequest && (
            <button onClick={() => setShowNew(true)} className="btn-primary text-[12px]">
              <Plus className="h-3.5 w-3.5" /> Nova solicitação
            </button>
          )
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        <KpiCard label="Total" value={kpis.total} icon={<ListChecks className="h-3.5 w-3.5" />} />
        <KpiCard label="Pendentes" value={kpis.pending} tone="warning" icon={<Clock className="h-3.5 w-3.5" />} />
        <KpiCard
          label="Aprovadas"
          value={kpis.approved}
          tone="success"
          icon={<CheckCircle2 className="h-3.5 w-3.5" />}
        />
        <KpiCard
          label="Reprovadas"
          value={kpis.rejected}
          tone="destructive"
          icon={<XCircle className="h-3.5 w-3.5" />}
        />
        <div className="col-span-2 sm:col-span-1">
          <KpiCard
            label="Lanches necessários"
            value={kpis.snacks}
            tone="primary"
            icon={<Utensils className="h-3.5 w-3.5" />}
          />
        </div>
      </div>

      <div className="mb-3 flex w-full max-w-full overflow-x-auto rounded-md border border-border bg-card p-1 text-[12px] sm:inline-flex sm:w-auto">
        {canRequest && (
          <TabBtn active={tab === "list"} onClick={() => setTab("list")}>
            {isManager ? "Minhas solicitações" : "Minhas solicitações"}
          </TabBtn>
        )}
        {isManager && (
          <TabBtn active={tab === "queue"} onClick={() => setTab("queue")}>
            Aprovações{" "}
            {kpis.pending > 0 && (
              <span className="ml-1 rounded bg-warning/20 px-1 text-[10px] text-warning-foreground">
                {kpis.pending}
              </span>
            )}
          </TabBtn>
        )}
      </div>

      {tab === "list" && canRequest && (
        <MyRequests
          rows={rows.filter((r) => r.requester_user_id === s.userId)}
          onCancel={async (row) => {
            if (!confirm(`Cancelar solicitação #${row.request_number}?`)) return;
            try {
              const res = await cancelOvertimeRequest({ data: { id: row.id, expectedVersion: row.version } });
              if (!res.ok) return toast.error(res.error);
              toast.success("Solicitação cancelada.");
              qc.invalidateQueries({ queryKey: ["overtime-requests"] });
            } catch (error) {
              toast.error(error instanceof Error ? error.message : "Não foi possível cancelar a solicitação.");
            }
          }}
        />
      )}

      {tab === "queue" && isManager && (
        <ApprovalQueue rows={rows} onDecided={() => qc.invalidateQueries({ queryKey: ["overtime-requests"] })} />
      )}

      {showNew && canRequest && (
        <NewRequestModal
          onClose={() => setShowNew(false)}
          onCreated={() => {
            setShowNew(false);
            qc.invalidateQueries({ queryKey: ["overtime-requests"] });
          }}
        />
      )}
    </main>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "min-w-max flex-1 rounded px-3 py-2 font-medium transition-colors sm:flex-none sm:py-1.5",
        active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}

/* ---------- My Requests ---------- */
function MyRequests({ rows, onCancel }: { rows: OvertimeRow[]; onCancel: (r: OvertimeRow) => void }) {
  if (rows.length === 0) {
    return (
      <Panel padded={false}>
        <div className="p-6">
          <EmptyState
            icon={<Timer className="h-4 w-4" />}
            title="Nenhuma solicitação"
            description="Clique em Nova solicitação para começar."
          />
        </div>
      </Panel>
    );
  }
  return (
    <Panel title="Minhas solicitações" padded={false}>
      <RequestsTable rows={rows} showRequester={false} onCancel={onCancel} />
    </Panel>
  );
}

/* ---------- Approval Queue ---------- */
function ApprovalQueue({ rows, onDecided }: { rows: OvertimeRow[]; onDecided: () => void }) {
  const [status, setStatus] = useState<"all" | OvertimeRow["status"]>("pending");
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [decideRow, setDecideRow] = useState<{ row: OvertimeRow; decision: "approved" | "rejected" } | null>(null);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (status !== "all" && r.status !== status) return false;
      if (from && r.overtime_date < from) return false;
      if (to && r.overtime_date > to) return false;
      if (q) {
        const t = q.toLowerCase();
        const hay =
          `${r.employee_name} ${r.employee_registration} ${r.requester_name} ${r.order_number ?? ""} ${r.service_description}`.toLowerCase();
        if (!hay.includes(t)) return false;
      }
      return true;
    });
  }, [rows, status, from, to, q]);

  return (
    <>
      <Panel padded={false}>
        <div className="grid grid-cols-1 gap-3 border-b border-border p-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
          <Field label="Buscar">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Colaborador, matrícula, ordem…"
                className="input-base pl-7 text-[12px]"
              />
            </div>
          </Field>
          <Field label="Status">
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as any)}
              className="input-base text-[12px]"
            >
              <option value="all">Todos</option>
              <option value="pending">Pendentes</option>
              <option value="approved">Aprovadas</option>
              <option value="rejected">Reprovadas</option>
              <option value="cancelled">Canceladas</option>
            </select>
          </Field>
          <Field label="De">
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="input-base text-[12px]"
            />
          </Field>
          <Field label="Até">
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="input-base text-[12px]" />
          </Field>
        </div>
        {filtered.length === 0 ? (
          <div className="p-6">
            <EmptyState icon={<ListChecks className="h-4 w-4" />} title="Nenhuma solicitação" />
          </div>
        ) : (
          <RequestsTable
            rows={filtered}
            showRequester
            onApprove={(row) => setDecideRow({ row, decision: "approved" })}
            onReject={(row) => setDecideRow({ row, decision: "rejected" })}
          />
        )}
      </Panel>

      {decideRow && (
        <DecideModal
          row={decideRow.row}
          decision={decideRow.decision}
          onClose={() => setDecideRow(null)}
          onDone={() => {
            setDecideRow(null);
            onDecided();
          }}
        />
      )}
    </>
  );
}

/* ---------- Table ---------- */
function RequestsTable({
  rows,
  showRequester,
  onApprove,
  onReject,
  onCancel,
}: {
  rows: OvertimeRow[];
  showRequester: boolean;
  onApprove?: (r: OvertimeRow) => void;
  onReject?: (r: OvertimeRow) => void;
  onCancel?: (r: OvertimeRow) => void;
}) {
  return (
    <>
      <div className="grid gap-3 p-3 md:hidden">
        {rows.map((r) => (
          <article key={r.id} className="min-w-0 rounded-lg border border-border bg-card p-3 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold text-muted-foreground">
                  #{r.request_number} · {formatDate(r.overtime_date)}
                </div>
                <h3 className="break-words text-sm font-semibold">{r.employee_name}</h3>
                <p className="break-words text-[11px] text-muted-foreground">
                  {r.employee_registration} · {r.employee_role}
                </p>
              </div>
              <OvertimeStatus status={r.status} />
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-[12px]">
              <div>
                <dt className="text-[10px] uppercase text-muted-foreground">Ordem</dt>
                <dd className="break-words font-medium">{r.order_number || "—"}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase text-muted-foreground">Saída / Lanche</dt>
                <dd>
                  {r.departure_time} · {r.needs_snack ? "Sim" : "Não"}
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="text-[10px] uppercase text-muted-foreground">Serviço</dt>
                <dd className="break-words">{r.service_description}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-[10px] uppercase text-muted-foreground">Justificativa</dt>
                <dd className="break-words">{r.justification}</dd>
              </div>
              {showRequester && (
                <div className="col-span-2">
                  <dt className="text-[10px] uppercase text-muted-foreground">Solicitante</dt>
                  <dd className="break-words">{r.requester_name || r.requester_email}</dd>
                </div>
              )}
              {r.decided_at && (
                <div className="col-span-2">
                  <dt className="text-[10px] uppercase text-muted-foreground">Decisão</dt>
                  <dd className="break-words">
                    {r.decided_by_name} · {formatDateTime(r.decided_at)}
                    {r.manager_comment ? ` · ${r.manager_comment}` : ""}
                  </dd>
                </div>
              )}
            </dl>
            {r.status === "pending" && (onApprove || onReject || onCancel) && (
              <div className="mt-3 grid grid-cols-2 gap-2 border-t border-border pt-3">
                {onApprove && (
                  <button onClick={() => onApprove(r)} className="btn-success min-h-10 justify-center text-[12px]">
                    Aprovar
                  </button>
                )}
                {onReject && (
                  <button
                    onClick={() => onReject(r)}
                    className="min-h-10 rounded-md border border-destructive/40 bg-destructive/10 px-3 text-[12px] font-medium text-destructive"
                  >
                    Reprovar
                  </button>
                )}
                {onCancel && (
                  <button
                    onClick={() => onCancel(r)}
                    className="col-span-2 min-h-10 rounded-md border border-border bg-card px-3 text-[12px] font-medium"
                  >
                    Cancelar
                  </button>
                )}
              </div>
            )}
          </article>
        ))}
      </div>
      <div className="hidden overflow-x-auto md:block">
        <table className="min-w-[1180px] w-full text-[12px]">
          <thead className="border-b border-border bg-muted text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">#</th>
              <th className="px-3 py-2 text-left font-semibold">Data</th>
              <th className="px-3 py-2 text-left font-semibold">Colaborador</th>
              <th className="px-3 py-2 text-left font-semibold">Matrícula</th>
              <th className="px-3 py-2 text-left font-semibold">Função</th>
              <th className="px-3 py-2 text-left font-semibold">Ordem</th>
              <th className="px-3 py-2 text-left font-semibold">Serviço</th>
              <th className="px-3 py-2 text-left font-semibold">Saída</th>
              <th className="px-3 py-2 text-left font-semibold">Lanche</th>
              {showRequester && <th className="px-3 py-2 text-left font-semibold">Solicitante</th>}
              <th className="px-3 py-2 text-left font-semibold">Status</th>
              <th className="px-3 py-2 text-left font-semibold">Decisão</th>
              <th className="px-3 py-2 text-right font-semibold">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {rows.map((r) => (
              <tr key={r.id} className="row-zebra align-top">
                <td className="px-3 py-2 tabular font-medium">#{r.request_number}</td>
                <td className="px-3 py-2 tabular whitespace-nowrap">{formatDate(r.overtime_date)}</td>
                <td className="px-3 py-2">{r.employee_name}</td>
                <td className="px-3 py-2 tabular">{r.employee_registration}</td>
                <td className="px-3 py-2">{r.employee_role}</td>
                <td className="px-3 py-2 tabular">
                  {r.order_number || <span className="text-muted-foreground">—</span>}
                </td>
                <td className="px-3 py-2 max-w-[240px]">
                  <div className="line-clamp-2">{r.service_description}</div>
                </td>
                <td className="px-3 py-2 tabular whitespace-nowrap">{r.departure_time}</td>
                <td className="px-3 py-2">{r.needs_snack ? "Sim" : "Não"}</td>
                {showRequester && <td className="px-3 py-2">{r.requester_name || r.requester_email}</td>}
                <td className="px-3 py-2">
                  <OvertimeStatus status={r.status} />
                </td>
                <td className="px-3 py-2 text-[11px]">
                  {r.decided_at ? (
                    <>
                      <div className="font-medium">{r.decided_by_name}</div>
                      <div className="text-muted-foreground">{formatDateTime(r.decided_at)}</div>
                      {r.manager_comment && (
                        <div className="mt-1 max-w-[240px] text-muted-foreground">"{r.manager_comment}"</div>
                      )}
                    </>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  <div className="inline-flex flex-wrap justify-end gap-1">
                    {onApprove && r.status === "pending" && (
                      <button onClick={() => onApprove(r)} className="btn-success py-1 text-[11px]">
                        Aprovar
                      </button>
                    )}
                    {onReject && r.status === "pending" && (
                      <button
                        onClick={() => onReject(r)}
                        className="inline-flex items-center gap-1 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-[11px] font-medium text-destructive hover:bg-destructive/15"
                      >
                        Reprovar
                      </button>
                    )}
                    {onCancel && r.status === "pending" && (
                      <button
                        onClick={() => onCancel(r)}
                        className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted"
                      >
                        Cancelar
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function OvertimeStatus({ status }: { status: OvertimeRow["status"] }) {
  const map: Record<OvertimeRow["status"], { label: string; cls: string }> = {
    pending: { label: "Pendente", cls: "border-warning/40 bg-warning/15 text-warning-foreground" },
    approved: { label: "Aprovada", cls: "border-success/40 bg-success/10 text-success" },
    rejected: { label: "Reprovada", cls: "border-destructive/40 bg-destructive/10 text-destructive" },
    cancelled: { label: "Cancelada", cls: "border-border bg-muted text-muted-foreground" },
  };
  const s = map[status];
  return <span className={cn("status-pill", s.cls)}>{s.label}</span>;
}

/* ---------- New Request Modal ---------- */
function NewRequestModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const call = useServerFn(createOvertimeRequest);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    employee_name: "",
    employee_registration: "",
    employee_role: "",
    activity_id: null as string | null,
    week_id: null as string | null,
    order_number: "",
    service_description: "",
    overtime_date: new Date().toISOString().slice(0, 10),
    departure_time: "18:00",
    needs_snack: false,
    justification: "",
  });
  const [search, setSearch] = useState("");
  const activeWeek = useQuery({
    queryKey: ["active-week"],
    queryFn: async () => {
      const { data, error } = await supabase.from("weeks").select("id").eq("is_active", true).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const activities = useQuery({
    queryKey: ["overtime-activity-search", activeWeek.data?.id, search],
    enabled: !!activeWeek.data?.id && search.trim().length >= 2,
    queryFn: async () => {
      const t = search
        .trim()
        .replace(/[,%()]/g, " ")
        .replace(/\s+/g, " ");
      const { data, error } = await supabase
        .from("activities")
        .select("id, week_id, order_number, description")
        .eq("week_id", activeWeek.data!.id)
        .or(`order_number.ilike.%${t}%,description.ilike.%${t}%`)
        .limit(20);
      if (error) throw error;
      return data ?? [];
    },
  });

  function pickActivity(a: { id: string; week_id: string; order_number: string | null; description: string }) {
    setForm((f) => ({
      ...f,
      activity_id: a.id,
      week_id: a.week_id,
      order_number: a.order_number ?? "",
      service_description: a.description ?? f.service_description,
    }));
    setSearch("");
  }

  async function submit() {
    if (!form.employee_name.trim() || !form.employee_registration.trim() || !form.employee_role.trim()) {
      return toast.error("Preencha os dados do colaborador.");
    }
    if (!form.service_description.trim() || !form.justification.trim()) {
      return toast.error("Descreva o serviço e a justificativa.");
    }
    setSaving(true);
    try {
      const res = await call({
        data: {
          employee_name: form.employee_name.trim(),
          employee_registration: form.employee_registration.trim(),
          employee_role: form.employee_role.trim(),
          activity_id: form.activity_id,
          week_id: form.week_id,
          order_number: form.order_number.trim() || null,
          service_description: form.service_description.trim(),
          overtime_date: form.overtime_date,
          departure_time: form.departure_time,
          needs_snack: form.needs_snack,
          justification: form.justification.trim(),
        },
      });
      if (!res.ok) return toast.error(res.error);
      toast.success(`Solicitação #${res.number} enviada.`);
      onCreated();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível enviar a solicitação.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onClose} title="Nova solicitação de hora extra" size="lg">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nome do colaborador" required>
          <input
            className="input-base"
            value={form.employee_name}
            onChange={(e) => setForm({ ...form, employee_name: e.target.value })}
          />
        </Field>
        <Field label="Matrícula" required>
          <input
            className="input-base"
            value={form.employee_registration}
            onChange={(e) => setForm({ ...form, employee_registration: e.target.value })}
          />
        </Field>
        <Field label="Função" required>
          <input
            className="input-base"
            value={form.employee_role}
            onChange={(e) => setForm({ ...form, employee_role: e.target.value })}
          />
        </Field>
        <Field label="Data da hora extra" required>
          <input
            type="date"
            className="input-base"
            value={form.overtime_date}
            onChange={(e) => setForm({ ...form, overtime_date: e.target.value })}
          />
        </Field>
        <Field label="Horário de saída" required>
          <input
            type="time"
            className="input-base"
            value={form.departure_time}
            onChange={(e) => setForm({ ...form, departure_time: e.target.value })}
          />
        </Field>
        <Field label="Precisa de lanche?">
          <select
            className="input-base"
            value={form.needs_snack ? "1" : "0"}
            onChange={(e) => setForm({ ...form, needs_snack: e.target.value === "1" })}
          >
            <option value="0">Não</option>
            <option value="1">Sim</option>
          </select>
        </Field>
      </div>

      <div className="mt-4 rounded-md border border-border bg-muted/30 p-3">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Vincular atividade da semana ativa (opcional)
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            className="input-base pl-7 text-[12px]"
            placeholder="Buscar por ordem ou descrição…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {activities.data && activities.data.length > 0 && (
          <div className="mt-2 max-h-40 divide-y divide-border overflow-auto rounded border border-border bg-card">
            {activities.data.map((a: any) => (
              <button
                key={a.id}
                type="button"
                onClick={() => pickActivity(a)}
                className="flex w-full items-start gap-2 p-2 text-left text-[12px] hover:bg-muted"
              >
                <span className="tabular font-medium">{a.order_number || "—"}</span>
                <span className="flex-1 truncate text-muted-foreground">{a.description}</span>
              </button>
            ))}
          </div>
        )}
        {form.activity_id && (
          <div className="mt-2 flex flex-col gap-2 rounded border border-primary/30 bg-primary/5 p-2 text-[12px] sm:flex-row sm:items-center sm:justify-between">
            <span>
              Vinculada: <b className="tabular">{form.order_number}</b>
            </span>
            <button
              type="button"
              onClick={() => setForm({ ...form, activity_id: null, week_id: null })}
              className="text-[11px] text-muted-foreground hover:text-foreground"
            >
              Remover vínculo
            </button>
          </div>
        )}
      </div>

      <div className="mt-3 grid gap-3">
        <Field label="Número da ordem">
          <input
            className="input-base"
            value={form.order_number}
            onChange={(e) => setForm({ ...form, order_number: e.target.value })}
            placeholder="Preenchido ao vincular, ou digite manualmente"
          />
        </Field>
        <Field label="Serviço / atividade" required>
          <textarea
            rows={2}
            className="input-base"
            value={form.service_description}
            onChange={(e) => setForm({ ...form, service_description: e.target.value })}
          />
        </Field>
        <Field label="Justificativa" required>
          <textarea
            rows={3}
            className="input-base"
            value={form.justification}
            onChange={(e) => setForm({ ...form, justification: e.target.value })}
          />
        </Field>
      </div>

      <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button
          onClick={onClose}
          disabled={saving}
          className="min-h-10 w-full rounded-md border border-border bg-card px-3 py-2 text-[12px] hover:bg-muted disabled:opacity-60 sm:w-auto"
        >
          Cancelar
        </button>
        <button
          onClick={submit}
          disabled={saving}
          className="btn-primary min-h-10 w-full justify-center text-[12px] disabled:opacity-60 sm:w-auto"
        >
          {saving ? "Enviando…" : "Enviar solicitação"}
        </button>
      </div>
    </Modal>
  );
}

/* ---------- Decide Modal ---------- */
function DecideModal({
  row,
  decision,
  onClose,
  onDone,
}: {
  row: OvertimeRow;
  decision: "approved" | "rejected";
  onClose: () => void;
  onDone: () => void;
}) {
  const call = useServerFn(decideOvertimeRequest);
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const isReject = decision === "rejected";

  async function submit() {
    if (isReject && !comment.trim()) return toast.error("Comentário é obrigatório para reprovação.");
    if (
      !confirm(
        isReject ? `Reprovar solicitação #${row.request_number}?` : `Aprovar solicitação #${row.request_number}?`,
      )
    )
      return;
    setSaving(true);
    try {
      const res = await call({
        data: { id: row.id, expectedVersion: row.version, decision, comment: comment.trim() || null },
      });
      if (!res.ok) {
        if (res.conflict) toast.error("Esta solicitação já foi decidida por outro usuário.");
        else toast.error(res.error);
        return;
      }
      toast.success(isReject ? "Solicitação reprovada." : "Solicitação aprovada.");
      onDone();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar a decisão.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onClose} title={isReject ? "Reprovar solicitação" : "Aprovar solicitação"}>
      <div className="rounded-md border border-border bg-muted/30 p-3 text-[12px]">
        <div>
          <b>#{row.request_number}</b> · {formatDate(row.overtime_date)}
        </div>
        <div className="mt-1">
          <b>Colaborador:</b> {row.employee_name} · {row.employee_registration} · {row.employee_role}
        </div>
        <div>
          <b>Ordem:</b> {row.order_number || "—"} · <b>Saída:</b> {row.departure_time} · <b>Lanche:</b>{" "}
          {row.needs_snack ? "Sim" : "Não"}
        </div>
        <div className="mt-1">
          <b>Serviço:</b> {row.service_description}
        </div>
        <div className="mt-1">
          <b>Justificativa:</b> {row.justification}
        </div>
        <div className="mt-1 text-muted-foreground">Solicitado por {row.requester_name || row.requester_email}</div>
      </div>
      <div className="mt-3">
        <Field label={isReject ? "Comentário (obrigatório)" : "Comentário (opcional)"} required={isReject}>
          <textarea rows={3} className="input-base" value={comment} onChange={(e) => setComment(e.target.value)} />
        </Field>
      </div>
      <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button
          onClick={onClose}
          disabled={saving}
          className="min-h-10 w-full rounded-md border border-border bg-card px-3 py-2 text-[12px] hover:bg-muted disabled:opacity-60 sm:w-auto"
        >
          Cancelar
        </button>
        <button
          onClick={submit}
          disabled={saving}
          className={cn(
            "min-h-10 w-full justify-center sm:w-auto",
            isReject
              ? "inline-flex items-center gap-1 rounded-md bg-destructive px-3 py-2 text-[12px] font-medium text-destructive-foreground hover:opacity-90 disabled:opacity-60"
              : "btn-success text-[12px] disabled:opacity-60",
          )}
        >
          {saving ? "Salvando…" : isReject ? "Confirmar reprovação" : "Confirmar aprovação"}
        </button>
      </div>
    </Modal>
  );
}

function formatDate(iso: string) {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}
function formatDateTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
