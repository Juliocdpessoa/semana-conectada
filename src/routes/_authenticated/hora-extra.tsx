import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Timer,
  CheckCircle2,
  XCircle,
  Clock,
  Utensils,
  ListChecks,
  Search,
  Plus,
  Users,
  Upload,
  Download,
  UserCheck,
  UserX,
} from "lucide-react";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, Panel, KpiCard, EmptyState, Modal, Field } from "@/components/ui-kit";
import { cn } from "@/lib/utils";
import type { SessionInfo } from "./route";
import {
  createOvertimeRequest,
  decideOvertimeRequest,
  cancelOvertimeRequest,
  upsertEmployees,
  setEmployeeActive,
  listOvertimeForExport,
  listApprovedTransportRows,
} from "@/lib/overtime.functions";

type OvertimeRow = {
  id: string;
  batch_id: string | null;
  request_number: number;
  requester_user_id: string;
  requester_name: string;
  requester_email: string;
  employee_name: string;
  employee_registration: string;
  employee_external_id: string | null;
  employee_role: string;
  activity_id: string | null;
  week_id: string | null;
  order_number: string | null;
  service_description: string;
  overtime_date: string;
  entry_time: string | null;
  departure_time: string;
  needs_snack: boolean;
  needs_transport: boolean;
  justification: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  manager_comment: string | null;
  decided_by_name: string | null;
  decided_at: string | null;
  version: number;
  created_at: string;
};

type EmployeeRow = {
  id: string;
  badge: string;
  employee_id: string;
  admission_date: string;
  full_name: string;
  job_title: string;
  is_active: boolean;
};

type DisplayOvertimeRow = OvertimeRow & {
  groupMembers?: OvertimeRow[];
};

const MISSING_BADGE_PREFIX = "__missing_badge__:";
const MISSING_EMPLOYEE_ID_PREFIX = "__missing_employee_id__:";

const WEEKLY_ACTIVITY_EXPORT_COLUMNS = [
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

function sanitizeEmployeeRow(employee: EmployeeRow): EmployeeRow {
  return {
    ...employee,
    badge: employee.badge.startsWith(MISSING_BADGE_PREFIX) ? "" : employee.badge,
    employee_id: employee.employee_id.startsWith(MISSING_EMPLOYEE_ID_PREFIX) ? "" : employee.employee_id,
  };
}

export const Route = createFileRoute("/_authenticated/hora-extra")({
  beforeLoad: ({ context }) => {
    const s = (context as { session: SessionInfo }).session;
    if (
      s.role !== "leader" &&
      s.role !== "manager" &&
      s.role !== "admin" &&
      s.role !== "measurement_control" &&
      s.role !== "logistics"
    ) {
      throw redirect({ to: "/atividades" });
    }
  },
  component: OvertimePage,
});

function OvertimePage() {
  const { session } = Route.useRouteContext() as { session: SessionInfo };
  const s = session;
  const isManager = s.role === "manager" || s.role === "admin";
  const canRequest = s.role === "leader" || s.role === "admin" || s.role === "measurement_control";
  const isMeasurementControl = s.role === "measurement_control";
  const isLogistics = s.role === "logistics";
  const canExportOvertime = isMeasurementControl || s.role === "admin" || s.role === "manager";
  const canSeeTransport = isLogistics || isManager;
  const loadOvertimeForExport = useServerFn(listOvertimeForExport);
  const loadTransportRows = useServerFn(listApprovedTransportRows);
  const exportRequests = useQuery({
    queryKey: ["overtime-export-rows"],
    enabled: canExportOvertime,
    queryFn: async () => {
      const result = await loadOvertimeForExport({ data: {} });
      if (!result.ok) throw new Error(result.error);
      return result.rows as OvertimeRow[];
    },
  });
  const transportRequests = useQuery({
    queryKey: ["overtime-transport-rows"],
    enabled: canSeeTransport,
    queryFn: async () => {
      const result = await loadTransportRows({ data: {} });
      if (!result.ok) throw new Error(result.error);
      return result.rows as OvertimeRow[];
    },
  });

  const [tab, setTab] = useState<"list" | "queue" | "employees" | "export" | "weekly_export" | "transport">(
    isLogistics ? "transport" : isMeasurementControl ? "export" : canRequest ? "list" : "queue",
  );
  const [showNew, setShowNew] = useState(false);
  const [summaryDate, setSummaryDate] = useState("");

  const qc = useQueryClient();
  const requests = useQuery({
    queryKey: ["overtime-requests", s.userId, isManager],
    enabled: !isLogistics,
    queryFn: async () => {
      const pageSize = 1000;
      const allRows: OvertimeRow[] = [];
      let from = 0;

      while (true) {
        const { data, error } = await supabase
          .from("overtime_requests")
          .select("*")
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(from, from + pageSize - 1);
        if (error) throw error;

        const page = (data ?? []) as OvertimeRow[];
        allRows.push(...page);
        if (page.length < pageSize) break;
        from += pageSize;
      }

      return allRows;
    },
  });

  const rows = requests.data ?? [];
  const summaryRows = useMemo(
    () => (summaryDate ? rows.filter((row) => row.overtime_date === summaryDate) : rows),
    [rows, summaryDate],
  );
  const kpis = useMemo(() => {
    const total = summaryRows.length;
    const pending = summaryRows.filter((row) => row.status === "pending").length;
    const approved = summaryRows.filter((row) => row.status === "approved").length;
    const rejected = summaryRows.filter((row) => row.status === "rejected").length;
    const snacks = summaryRows.filter((row) => row.needs_snack && row.status === "approved").length;
    const transports = summaryRows.filter((row) => row.needs_transport && row.status === "approved").length;
    return { total, pending, approved, rejected, snacks, transports };
  }, [summaryRows]);

  return (
    <main className="mx-auto w-full max-w-[1400px] overflow-x-hidden px-3 py-4 sm:px-6 sm:py-6">
      <PageHeader
        eyebrow="Operação"
        title="Hora Extra"
        description={
          isLogistics
            ? "Transportes de colaboradores em horas extras aprovadas."
            : "Solicitação e aprovação de horas extras da equipe."
        }
        actions={
          canRequest && (
            <button onClick={() => setShowNew(true)} className="btn-primary text-[12px]">
              <Plus className="h-3.5 w-3.5" /> Nova solicitação
            </button>
          )
        }
      />

      {!isLogistics && (
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <KpiCard label="Total de colaboradores" value={kpis.total} icon={<ListChecks className="h-3.5 w-3.5" />} />
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
          <KpiCard
            label="Lanches aprovados"
            value={kpis.snacks}
            tone="primary"
            icon={<Utensils className="h-3.5 w-3.5" />}
          />
          <KpiCard
            label="Transportes aprovados"
            value={kpis.transports}
            tone="primary"
            icon={<Bus className="h-3.5 w-3.5" />}
          />
        </div>
      )}

      <div className="mb-3 flex w-full max-w-full overflow-x-auto rounded-md border border-border bg-card p-1 text-[12px] sm:inline-flex sm:w-auto">
        {canExportOvertime && (
          <TabBtn active={tab === "export"} onClick={() => setTab("export")}>
            Exportação diária
          </TabBtn>
        )}
        {isMeasurementControl && (
          <TabBtn active={tab === "weekly_export"} onClick={() => setTab("weekly_export")}>
            Exportação semanal
          </TabBtn>
        )}
        {canSeeTransport && (
          <TabBtn active={tab === "transport"} onClick={() => setTab("transport")}>
            Transportes
          </TabBtn>
        )}
        {canRequest && (
          <TabBtn active={tab === "list"} onClick={() => setTab("list")}>
            Minhas solicitações
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
        {isManager && (
          <TabBtn active={tab === "employees"} onClick={() => setTab("employees")}>
            Colaboradores
          </TabBtn>
        )}
      </div>

      {tab === "export" && canExportOvertime && <ApprovedDailyExport rows={exportRequests.data ?? []} />}

      {tab === "weekly_export" && isMeasurementControl && <WeeklyActivityExport />}

      {tab === "transport" && canSeeTransport && (
        <TransportView
          rows={transportRequests.data ?? []}
          loading={transportRequests.isLoading}
          defaultOnlyTransport={isLogistics}
        />
      )}

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
              qc.invalidateQueries({ queryKey: ["overtime-export-rows"] });
              qc.invalidateQueries({ queryKey: ["overtime-transport-rows"] });
            } catch (error) {
              toast.error(error instanceof Error ? error.message : "Não foi possível cancelar a solicitação.");
            }
          }}
        />
      )}

      {tab === "queue" && isManager && (
        <ApprovalQueue
          rows={rows}
          selectedDate={summaryDate}
          onSelectedDateChange={setSummaryDate}
          onDecided={() => {
            qc.invalidateQueries({ queryKey: ["overtime-requests"] });
            qc.invalidateQueries({ queryKey: ["overtime-export-rows"] });
            qc.invalidateQueries({ queryKey: ["overtime-transport-rows"] });
          }}
        />
      )}

      {tab === "employees" && isManager && <EmployeeManagement />}


      {showNew && canRequest && (
        <NewRequestModal
          onClose={() => setShowNew(false)}
          onCreated={() => {
            setShowNew(false);
            qc.invalidateQueries({ queryKey: ["overtime-requests"] });
            qc.invalidateQueries({ queryKey: ["overtime-export-rows"] });
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

/* ---------- Weekly activity export ---------- */
function WeeklyActivityExport() {
  const [selectedWeekId, setSelectedWeekId] = useState("");
  const weeks = useQuery({
    queryKey: ["measurement-weeks"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("weeks")
        .select("id,code,label,start_date,end_date,is_active")
        .order("start_date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const effectiveWeekId = selectedWeekId || weeks.data?.[0]?.id || "";
  const selectedWeek = (weeks.data ?? []).find((week) => week.id === effectiveWeekId);
  const activities = useQuery({
    queryKey: ["measurement-weekly-export", effectiveWeekId],
    enabled: Boolean(effectiveWeekId),
    queryFn: async () => {
      const all: any[] = [];
      const pageSize = 1000;
      for (let from = 0; ; from += pageSize) {
        const { data, error } = await supabase
          .from("activities")
          .select(
            "id,status,justification,observation,reported_by_name,reported_by_email,reported_at,planning_data,source_row_number",
          )
          .eq("week_id", effectiveWeekId)
          .in("status", ["EXECUTADO", "NÃO EXECUTADO"])
          .order("source_row_number", { ascending: true })
          .range(from, from + pageSize - 1);
        if (error) throw error;
        if (!data?.length) break;
        all.push(...data);
        if (data.length < pageSize) break;
      }
      return all;
    },
  });

  function formatPlanningDate(value: unknown) {
    if (value === null || value === undefined || value === "") return "";
    if (value instanceof Date && !isNaN(value.getTime())) {
      return (
        String(value.getDate()).padStart(2, "0") +
        "/" +
        String(value.getMonth() + 1).padStart(2, "0") +
        "/" +
        value.getFullYear()
      );
    }
    const text = String(value).trim();
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
    if (iso) return iso[3] + "/" + iso[2] + "/" + iso[1];
    const br = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(text);
    if (br) return String(Number(br[1])).padStart(2, "0") + "/" + String(Number(br[2])).padStart(2, "0") + "/" + br[3];
    return text;
  }

  function formatReportedDate(value: unknown) {
    if (!value) return "";
    const date = new Date(String(value));
    if (isNaN(date.getTime())) return "";
    const pad = (number: number) => String(number).padStart(2, "0");
    return (
      pad(date.getDate()) +
      "/" +
      pad(date.getMonth() + 1) +
      "/" +
      date.getFullYear() +
      " " +
      pad(date.getHours()) +
      ":" +
      pad(date.getMinutes())
    );
  }

  function exportWeeklyExcel() {
    if (!selectedWeek || !activities.data?.length) {
      return toast.error("Esta semana não possui atividades apontadas como executadas ou não executadas.");
    }
    const responsibleHeader = "Responsável pela informação";
    const reportedAtHeader = "Data da informação";
    const headers = [...WEEKLY_ACTIVITY_EXPORT_COLUMNS, responsibleHeader, reportedAtHeader];
    const values = activities.data.map((activity) => {
      const planning = (activity.planning_data ?? {}) as Record<string, unknown>;
      return headers.map((header) => {
        if (header === "Status") return activity.status;
        if (header === "Justificativa") return activity.justification ?? "";
        if (header === "Observações") return activity.observation ?? "";
        if (header === responsibleHeader) return activity.reported_by_name || activity.reported_by_email || "";
        if (header === reportedAtHeader) return formatReportedDate(activity.reported_at);
        if (header === "Data início" || header === "Data fim") return formatPlanningDate(planning[header]);
        return planning[header] ?? "";
      });
    });
    const sheet = XLSX.utils.aoa_to_sheet([headers, ...values]);
    sheet["!cols"] = headers.map((header) => ({
      wch:
        header === "TxtDesc.Oper."
          ? 42
          : header === "Justificativa" || header === "Observações" || header === responsibleHeader
            ? 34
            : header === reportedAtHeader
              ? 18
              : Math.max(11, header.length + 2),
    }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Acompanhamento");
    XLSX.writeFile(workbook, selectedWeek.code.replace(/\//g, "-") + "-atividades-apontadas.xlsx");
    toast.success(activities.data.length + " atividade(s) exportada(s).");
  }

  return (
    <Panel
      title="Exportação semanal de atividades"
      description="Baixe as atividades apontadas pelos encarregados como EXECUTADO ou NÃO EXECUTADO."
      padded={false}
    >
      <div className="grid gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <Field label="Semana">
          <select
            value={effectiveWeekId}
            onChange={(event) => setSelectedWeekId(event.target.value)}
            className="input-base block min-w-0 w-full max-w-full text-[16px] sm:text-[12px]"
          >
            {(weeks.data ?? []).map((week) => (
              <option key={week.id} value={week.id}>
                {week.label} · {formatDate(week.start_date)} a {formatDate(week.end_date)}
              </option>
            ))}
          </select>
        </Field>
        <button
          type="button"
          onClick={exportWeeklyExcel}
          disabled={!selectedWeek || activities.isLoading || !activities.data?.length}
          className="btn-primary min-h-10 w-full justify-center text-[12px] disabled:opacity-50 sm:w-auto"
        >
          <Download className="h-4 w-4" /> {activities.isLoading ? "Carregando…" : "Exportar semana"}
        </button>
      </div>
      <div className="border-t border-border p-3 text-[12px] text-muted-foreground">
        {activities.isLoading
          ? "Carregando atividades apontadas…"
          : (activities.data?.length ?? 0) + " atividade(s) com apontamento EXECUTADO ou NÃO EXECUTADO."}
      </div>
    </Panel>
  );
}

/* ---------- Approved daily export ---------- */
function ApprovedDailyExport({ rows }: { rows: OvertimeRow[] }) {
  const exportableRows = useMemo(() => rows.filter((row) => row.status !== "cancelled"), [rows]);
  const availableDates = useMemo(
    () => [...new Set(exportableRows.map((row) => row.overtime_date))].sort((a, b) => b.localeCompare(a)),
    [exportableRows],
  );
  const [selectedDate, setSelectedDate] = useState("");
  const effectiveDate = selectedDate || availableDates[0] || "";
  const dailyRows = useMemo(
    () => exportableRows.filter((row) => row.overtime_date === effectiveDate),
    [exportableRows, effectiveDate],
  );

  function exportDailyExcel() {
    if (!effectiveDate || dailyRows.length === 0)
      return toast.error("Não há solicitações de hora extra para exportar nesta data.");
    const headers = [
      "ID",
      "Matrícula",
      "Nome",
      "Função",
      "Data",
      "Horário de entrada",
      "Horário de saída",
      "Lanche",
      "Status",
      "Solicitante",
      "Ordem",
      "Serviço",
      "Justificativa",
    ];
    const values = dailyRows.map((row) => [
      row.employee_external_id || "",
      row.employee_registration || "",
      row.employee_name,
      row.employee_role,
      formatDate(row.overtime_date),
      row.entry_time || "",
      row.departure_time,
      row.needs_snack ? "Sim" : "Não",
      formatOvertimeStatus(row.status),
      row.requester_name || row.requester_email,
      row.order_number || "",
      row.service_description,
      row.justification,
    ]);
    const sheet = XLSX.utils.aoa_to_sheet([headers, ...values]);
    sheet["!cols"] = [
      { wch: 14 },
      { wch: 14 },
      { wch: 32 },
      { wch: 24 },
      { wch: 12 },
      { wch: 18 },
      { wch: 18 },
      { wch: 10 },
      { wch: 14 },
      { wch: 28 },
      { wch: 16 },
      { wch: 48 },
      { wch: 48 },
    ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Horas extras");
    XLSX.writeFile(workbook, "horas-extras-" + effectiveDate + ".xlsx");
    toast.success(dailyRows.length + " registro(s) exportado(s).");
  }

  return (
    <Panel
      title="Exportação diária de horas extras"
      description="Consulte e exporte pendentes, aprovadas e reprovadas. Solicitações canceladas não são incluídas."
      padded={false}
    >
      <div className="flex flex-col gap-3 border-b border-border p-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="w-full min-w-0 sm:max-w-xs">
          <Field label="Data da hora extra">
            <select
              value={effectiveDate}
              onChange={(event) => setSelectedDate(event.target.value)}
              className="input-base block min-w-0 w-full max-w-full text-[16px] sm:text-[12px]"
            >
              {availableDates.length === 0 && <option value="">Nenhuma data disponível</option>}
              {availableDates.map((date) => (
                <option key={date} value={date}>
                  {formatDate(date)}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <button
          type="button"
          onClick={exportDailyExcel}
          disabled={!effectiveDate || dailyRows.length === 0}
          className="btn-primary min-h-10 w-full justify-center text-[12px] disabled:opacity-50 sm:w-auto"
        >
          <Download className="h-4 w-4" /> Exportar Excel do dia
        </button>
      </div>

      {dailyRows.length === 0 ? (
        <div className="p-6">
          <EmptyState icon={<Timer className="h-4 w-4" />} title="Nenhuma solicitação de hora extra nesta data" />
        </div>
      ) : (
        <>
          <div className="grid gap-3 p-3 md:hidden">
            {dailyRows.map((row) => (
              <article
                key={row.id}
                className="min-w-0 rounded-lg border border-border bg-card p-3 text-[12px] shadow-sm"
              >
                <div className="font-semibold text-foreground">{row.employee_name}</div>
                <div className="mt-0.5 break-words text-[11px] text-muted-foreground">
                  Chapa {row.employee_registration || "—"} · ID {row.employee_external_id || "—"} · {row.employee_role}
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <div>
                    <b>Entrada:</b> {row.entry_time || "—"}
                  </div>
                  <div>
                    <b>Saída:</b> {row.departure_time}
                  </div>
                </div>
                <div className="mt-2 break-words">
                  <b>Solicitante:</b> {row.requester_name || row.requester_email}
                </div>
                <div className="mt-1 break-words">
                  <b>Ordem:</b> {row.order_number || "—"}
                </div>
                <div className="mt-1 break-words">
                  <b>Serviço:</b> {row.service_description}
                </div>
                <div className="mt-1 break-words">
                  <b>Justificativa:</b> {row.justification}
                </div>
              </article>
            ))}
          </div>
          <div className="hidden overflow-x-auto md:block">
            <table className="min-w-[1400px] w-full text-[12px]">
              <thead className="border-b border-border bg-muted text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  {[
                    "Data",
                    "Chapa",
                    "ID",
                    "Nome",
                    "Função",
                    "Entrada",
                    "Saída",
                    "Solicitante",
                    "Ordem",
                    "Serviço",
                    "Justificativa",
                  ].map((header) => (
                    <th key={header} className="px-3 py-2 text-left font-semibold">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {dailyRows.map((row) => (
                  <tr key={row.id} className="row-zebra align-top">
                    <td className="whitespace-nowrap px-3 py-2">{formatDate(row.overtime_date)}</td>
                    <td className="px-3 py-2">{row.employee_registration || "—"}</td>
                    <td className="px-3 py-2">{row.employee_external_id || "—"}</td>
                    <td className="px-3 py-2">{row.employee_name}</td>
                    <td className="px-3 py-2">{row.employee_role}</td>
                    <td className="whitespace-nowrap px-3 py-2">{row.entry_time || "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2">{row.departure_time}</td>
                    <td className="px-3 py-2">{row.requester_name || row.requester_email}</td>
                    <td className="px-3 py-2">{row.order_number || "—"}</td>
                    <td className="max-w-[280px] px-3 py-2">{row.service_description}</td>
                    <td className="max-w-[280px] px-3 py-2">{row.justification}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Panel>
  );
}

/* ---------- My Requests ---------- */
function MyRequests({ rows, onCancel }: { rows: OvertimeRow[]; onCancel: (r: OvertimeRow) => void }) {
  const [selectedDate, setSelectedDate] = useState("");
  const availableDates = useMemo(
    () => [...new Set(rows.map((row) => row.overtime_date))].sort((a, b) => b.localeCompare(a)),
    [rows],
  );
  const filteredRows = selectedDate ? rows.filter((row) => row.overtime_date === selectedDate) : rows;

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
      <div className="border-b border-border p-3">
        <Field label="Filtrar por data">
          <select
            value={selectedDate}
            onChange={(event) => setSelectedDate(event.target.value)}
            className="input-base block min-w-0 w-full max-w-full text-[12px] sm:max-w-xs"
          >
            <option value="">Todas as datas</option>
            {availableDates.map((date) => (
              <option key={date} value={date}>
                {formatDate(date)}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {filteredRows.length === 0 ? (
        <div className="p-6">
          <EmptyState icon={<Timer className="h-4 w-4" />} title="Nenhuma solicitação nesta data" />
        </div>
      ) : (
        <RequestsTable rows={filteredRows} showRequester={false} onCancel={onCancel} />
      )}
    </Panel>
  );
}

/* ---------- Approval Queue ---------- */
function ApprovalQueue({
  rows,
  selectedDate,
  onSelectedDateChange,
  onDecided,
}: {
  rows: OvertimeRow[];
  selectedDate: string;
  onSelectedDateChange: (date: string) => void;
  onDecided: () => void;
}) {
  const [status, setStatus] = useState<"all" | OvertimeRow["status"]>("pending");
  const [q, setQ] = useState("");
  const [decideRow, setDecideRow] = useState<{ row: OvertimeRow; decision: "approved" | "rejected" } | null>(null);
  const groupedRows = useMemo(() => {
    const groups = new Map<string, OvertimeRow[]>();
    rows.forEach((row) => {
      const key = row.batch_id || row.id;
      groups.set(key, [...(groups.get(key) ?? []), row]);
    });
    return [...groups.values()].map((members) => {
      const representative = members.find((member) => member.status === "pending") ?? members[0];
      const status: OvertimeRow["status"] = members.some((member) => member.status === "pending")
        ? "pending"
        : members.every((member) => member.status === "approved")
          ? "approved"
          : members.some((member) => member.status === "rejected")
            ? "rejected"
            : "cancelled";
      return {
        ...representative,
        request_number: Math.min(...members.map((member) => member.request_number)),
        employee_name: members.length === 1 ? members[0].employee_name : `${members.length} colaboradores`,
        employee_registration: `${members.length} colaborador(es)`,
        employee_role:
          members.length === 1
            ? members[0].employee_role
            : `${new Set(members.map((member) => member.employee_role)).size} função(ões)`,
        groupMembers: [...members].sort((a, b) => a.employee_name.localeCompare(b.employee_name, "pt-BR")),
        status,
      };
    });
  }, [rows]);
  const availableDates = useMemo(
    () => [...new Set(groupedRows.map((row) => row.overtime_date))].sort((a, b) => b.localeCompare(a)),
    [groupedRows],
  );

  const filtered = useMemo(() => {
    return groupedRows.filter((r) => {
      if (status !== "all" && r.status !== status) return false;
      if (selectedDate && r.overtime_date !== selectedDate) return false;
      if (q) {
        const t = q.toLowerCase();
        const team = (r.groupMembers ?? [])
          .map((member) => `${member.employee_name} ${member.employee_registration} ${member.employee_role}`)
          .join(" ");
        const hay =
          `${r.employee_name} ${r.employee_registration} ${team} ${r.requester_name} ${r.order_number ?? ""} ${r.service_description}`.toLowerCase();
        if (!hay.includes(t)) return false;
      }
      return true;
    });
  }, [groupedRows, status, selectedDate, q]);

  return (
    <>
      <Panel padded={false}>
        <div className="grid min-w-0 grid-cols-1 gap-3 border-b border-border p-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Buscar">
            <div className="relative min-w-0">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Colaborador, matrícula, ordem…"
                className="input-base block min-w-0 w-full max-w-full pl-7 text-[12px]"
              />
            </div>
          </Field>
          <Field label="Status">
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as any)}
              className="input-base block min-w-0 w-full max-w-full text-[12px]"
            >
              <option value="all">Todos</option>
              <option value="pending">Pendentes</option>
              <option value="approved">Aprovadas</option>
              <option value="rejected">Reprovadas</option>
              <option value="cancelled">Canceladas</option>
            </select>
          </Field>
          <Field label="Data da hora extra">
            <select
              value={selectedDate}
              onChange={(event) => onSelectedDateChange(event.target.value)}
              className="input-base block min-w-0 w-full max-w-full text-[12px]"
            >
              <option value="">Todas as datas</option>
              {availableDates.map((date) => (
                <option key={date} value={date}>
                  {formatDate(date)}
                </option>
              ))}
            </select>
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
            groupedTeamView
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
  groupedTeamView = false,
}: {
  rows: DisplayOvertimeRow[];
  showRequester: boolean;
  onApprove?: (r: OvertimeRow) => void;
  onReject?: (r: OvertimeRow) => void;
  onCancel?: (r: OvertimeRow) => void;
  groupedTeamView?: boolean;
}) {
  return (
    <>
      <div className="grid gap-3 p-3 md:hidden">
        {rows.map((r) => (
          <article key={r.id} className="min-w-0 rounded-lg border border-border bg-card p-3 shadow-sm">
            <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
              <div className="min-w-0">
                <div className="min-w-0 break-words text-[11px] font-semibold leading-4 text-muted-foreground">
                  <span className="inline-block">#{r.request_number}</span> ·{" "}
                  <span className="inline-block">{formatDate(r.overtime_date)}</span>
                </div>
                {!groupedTeamView && <h3 className="break-words text-sm font-semibold">{r.employee_name}</h3>}
                {!groupedTeamView && (
                  <p className="break-words text-[11px] text-muted-foreground">
                    {r.employee_registration} · {r.employee_role}
                  </p>
                )}
                {groupedTeamView && (
                  <p className="text-[12px] font-medium text-foreground">
                    {r.groupMembers?.length ?? 1} colaborador(es)
                  </p>
                )}
              </div>
              <span className="max-w-full shrink-0">
                <OvertimeStatus status={r.status} />
              </span>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-[12px]">
              <div>
                <dt className="text-[10px] uppercase text-muted-foreground">Ordem</dt>
                <dd className="break-words font-medium">{r.order_number || "—"}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase text-muted-foreground">Entrada / Saída / Lanche</dt>
                <dd>
                  {r.entry_time || "—"} · {r.departure_time} · Lanche: {r.needs_snack ? "Sim" : "Não"}
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
                  <dd className="min-w-0 break-words [overflow-wrap:anywhere]">
                    {r.decided_by_name} · {formatDateTime(r.decided_at)}
                    {r.manager_comment ? ` · ${r.manager_comment}` : ""}
                  </dd>
                </div>
              )}
            </dl>
            {groupedTeamView && r.groupMembers && r.groupMembers.length > 0 && (
              <div className="mt-3 overflow-hidden rounded-md border border-border">
                <div className="border-b border-border bg-muted/50 px-2.5 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Equipe desta solicitação
                </div>
                <div className="max-h-64 divide-y divide-border overflow-y-auto">
                  {r.groupMembers.map((member) => (
                    <div key={member.id} className="px-2.5 py-2 text-[11px]">
                      <div className="min-w-0">
                        <div className="tabular text-muted-foreground">
                          Matrícula {member.employee_registration || "—"}
                        </div>
                        <div className="break-words font-semibold">{member.employee_name}</div>
                        <div className="mt-0.5 break-words text-muted-foreground">{member.employee_role}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
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
              {!groupedTeamView && <th className="px-3 py-2 text-left font-semibold">Colaborador</th>}
              {!groupedTeamView && <th className="px-3 py-2 text-left font-semibold">Matrícula</th>}
              {!groupedTeamView && <th className="px-3 py-2 text-left font-semibold">Função</th>}
              <th className="px-3 py-2 text-left font-semibold">Ordem</th>
              <th className="px-3 py-2 text-left font-semibold">Serviço</th>
              <th className="px-3 py-2 text-left font-semibold">Entrada</th>
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
              <Fragment key={r.id}>
                <tr className="row-zebra align-top">
                  <td className="px-3 py-2 tabular font-medium">#{r.request_number}</td>
                  <td className="px-3 py-2 tabular whitespace-nowrap">{formatDate(r.overtime_date)}</td>
                  {!groupedTeamView && <td className="px-3 py-2">{r.employee_name}</td>}
                  {!groupedTeamView && <td className="px-3 py-2 tabular">{r.employee_registration}</td>}
                  {!groupedTeamView && <td className="px-3 py-2">{r.employee_role}</td>}
                  <td className="px-3 py-2 tabular">
                    {r.order_number || <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-3 py-2 max-w-[240px]">
                    <div className="line-clamp-2">{r.service_description}</div>
                  </td>
                  <td className="px-3 py-2 tabular whitespace-nowrap">{r.entry_time || "—"}</td>
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
                {groupedTeamView && r.groupMembers && r.groupMembers.length > 0 && (
                  <tr key={`${r.id}-team`} className="border-t-0 bg-muted/20">
                    <td
                      colSpan={groupedTeamView ? (showRequester ? 11 : 10) : showRequester ? 14 : 13}
                      className="px-3 pb-3 pt-0"
                    >
                      <div className="overflow-hidden rounded-md border border-border bg-card">
                        <div className="grid grid-cols-[minmax(110px,0.7fr)_minmax(220px,1.3fr)_minmax(220px,1fr)] gap-3 border-b border-border bg-muted/60 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                          <span>Matrícula</span>
                          <span>Colaborador</span>
                          <span>Função</span>
                        </div>
                        <div className="max-h-[360px] divide-y divide-border overflow-y-auto">
                          {r.groupMembers.map((member) => (
                            <div
                              key={member.id}
                              className="grid grid-cols-[minmax(110px,0.7fr)_minmax(220px,1.3fr)_minmax(220px,1fr)] gap-3 px-3 py-2.5 text-[12px]"
                            >
                              <span className="tabular">{member.employee_registration || "—"}</span>
                              <span className="font-medium">{member.employee_name}</span>
                              <span>{member.employee_role}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
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

/* ---------- Employee Management ---------- */
const EMPLOYEE_TEMPLATE_HEADERS = ["Chapa", "ID", "Data de Admissão", "Nome", "Função"] as const;

function downloadEmployeeTemplate() {
  const worksheet = XLSX.utils.aoa_to_sheet([[...EMPLOYEE_TEMPLATE_HEADERS]]);
  worksheet["!cols"] = [{ wch: 16 }, { wch: 16 }, { wch: 20 }, { wch: 38 }, { wch: 28 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Colaboradores");
  XLSX.writeFile(workbook, "modelo_importacao_colaboradores.xlsx");
}

function EmployeeManagement() {
  const qc = useQueryClient();
  const toggleActive = useServerFn(setEmployeeActive);
  const [search, setSearch] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [changingId, setChangingId] = useState<string | null>(null);
  const employees = useQuery({
    queryKey: ["employees"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("employees")
        .select("id,badge,employee_id,admission_date,full_name,job_title,is_active")
        .order("full_name")
        .limit(2000);
      if (error) throw error;
      return ((data ?? []) as EmployeeRow[]).map(sanitizeEmployeeRow);
    },
  });
  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("pt-BR");
    if (!term) return employees.data ?? [];
    return (employees.data ?? []).filter((employee) =>
      [employee.full_name, employee.badge, employee.employee_id, employee.job_title].some((value) =>
        value.toLocaleLowerCase("pt-BR").includes(term),
      ),
    );
  }, [employees.data, search]);

  async function changeStatus(employee: EmployeeRow) {
    setChangingId(employee.id);
    try {
      const res = await toggleActive({ data: { id: employee.id, active: !employee.is_active } });
      if (!res.ok) return toast.error(res.error);
      toast.success(employee.is_active ? "Colaborador inativado." : "Colaborador reativado.");
      qc.invalidateQueries({ queryKey: ["employees"] });
      qc.invalidateQueries({ queryKey: ["active-employees"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível alterar o colaborador.");
    } finally {
      setChangingId(null);
    }
  }

  return (
    <Panel title="Cadastro de colaboradores" padded={false}>
      <div className="flex flex-col gap-2 border-b border-border p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative min-w-0 flex-1 sm:max-w-md">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            className="input-base pl-7 text-[12px]"
            placeholder="Buscar por nome, chapa, ID ou função…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <button
            type="button"
            onClick={downloadEmployeeTemplate}
            className="min-h-10 w-full justify-center rounded border border-border px-3 text-[12px] hover:bg-muted sm:w-auto"
          >
            <span className="flex items-center justify-center gap-1.5">
              <Download className="h-3.5 w-3.5" /> Baixar modelo
            </span>
          </button>
          <button
            type="button"
            onClick={() => setShowImport(true)}
            className="btn-primary min-h-10 w-full justify-center text-[12px] sm:w-auto"
          >
            <Upload className="h-3.5 w-3.5" /> Importar / atualizar lista
          </button>
        </div>
      </div>
      {employees.isLoading ? (
        <div className="p-6 text-center text-[12px] text-muted-foreground">Carregando colaboradores…</div>
      ) : filtered.length === 0 ? (
        <div className="p-6">
          <EmptyState
            icon={<Users className="h-4 w-4" />}
            title="Nenhum colaborador"
            description="Importe a lista para disponibilizá-la nas solicitações."
          />
        </div>
      ) : (
        <>
          <div className="divide-y divide-border md:hidden">
            {filtered.map((employee) => (
              <div key={employee.id} className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-semibold">{employee.full_name}</div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      Chapa {employee.badge} · ID {employee.employee_id}
                    </div>
                  </div>
                  <span
                    className={cn(
                      "rounded px-2 py-1 text-[10px] font-medium",
                      employee.is_active ? "bg-success/10 text-success" : "bg-muted text-muted-foreground",
                    )}
                  >
                    {employee.is_active ? "Ativo" : "Inativo"}
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
                  <div>
                    <span className="text-muted-foreground">Admissão</span>
                    <div>{formatDate(employee.admission_date)}</div>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Função</span>
                    <div className="truncate">{employee.job_title}</div>
                  </div>
                </div>
                <button
                  disabled={changingId === employee.id}
                  onClick={() => changeStatus(employee)}
                  className="mt-3 flex min-h-9 w-full items-center justify-center gap-1 rounded border border-border text-[11px] hover:bg-muted disabled:opacity-60"
                >
                  {employee.is_active ? <UserX className="h-3.5 w-3.5" /> : <UserCheck className="h-3.5 w-3.5" />}
                  {employee.is_active ? "Inativar" : "Reativar"}
                </button>
              </div>
            ))}
          </div>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[850px] text-left text-[12px]">
              <thead className="border-b border-border bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Chapa</th>
                  <th className="px-3 py-2">ID</th>
                  <th className="px-3 py-2">Admissão</th>
                  <th className="px-3 py-2">Nome</th>
                  <th className="px-3 py-2">Função</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((employee) => (
                  <tr key={employee.id} className="hover:bg-muted/30">
                    <td className="px-3 py-2 tabular">{employee.badge}</td>
                    <td className="px-3 py-2 tabular">{employee.employee_id}</td>
                    <td className="px-3 py-2">{formatDate(employee.admission_date)}</td>
                    <td className="px-3 py-2 font-medium">{employee.full_name}</td>
                    <td className="px-3 py-2">{employee.job_title}</td>
                    <td className="px-3 py-2">{employee.is_active ? "Ativo" : "Inativo"}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        disabled={changingId === employee.id}
                        onClick={() => changeStatus(employee)}
                        className="rounded border border-border px-2 py-1 text-[11px] hover:bg-muted disabled:opacity-60"
                      >
                        {employee.is_active ? "Inativar" : "Reativar"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {showImport && (
        <BulkEmployeeModal
          onClose={() => setShowImport(false)}
          onSaved={() => {
            setShowImport(false);
            qc.invalidateQueries({ queryKey: ["employees"] });
            qc.invalidateQueries({ queryKey: ["active-employees"] });
          }}
        />
      )}
    </Panel>
  );
}

function normalizeEmployeeDate(value: string) {
  const clean = value.trim();
  const isoMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(clean);
  const brMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[T\s].*)?$/.exec(clean);
  const year = isoMatch ? isoMatch[1] : brMatch?.[3];
  const month = (isoMatch ? isoMatch[2] : brMatch?.[2])?.padStart(2, "0");
  const day = (isoMatch ? isoMatch[3] : brMatch?.[1])?.padStart(2, "0");
  if (!year || !month || !day) return null;
  const iso = `${year}-${month}-${day}`;
  const date = new Date(`${iso}T00:00:00Z`);
  return date.getUTCFullYear() === Number(year) &&
    date.getUTCMonth() + 1 === Number(month) &&
    date.getUTCDate() === Number(day)
    ? iso
    : null;
}

function formatEmployeeSpreadsheetDate(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const day = String(value.getUTCDate()).padStart(2, "0");
    const month = String(value.getUTCMonth() + 1).padStart(2, "0");
    return `${day}/${month}/${value.getUTCFullYear()}`;
  }
  const numericValue =
    typeof value === "number" ? value : /^\d+(?:\.\d+)?$/.test(String(value).trim()) ? Number(value) : null;
  if (numericValue !== null && numericValue > 0) {
    const parsed = XLSX.SSF.parse_date_code(numericValue);
    if (parsed) return `${String(parsed.d).padStart(2, "0")}/${String(parsed.m).padStart(2, "0")}/${parsed.y}`;
  }
  const clean = String(value ?? "").trim();
  const normalized = normalizeEmployeeDate(clean);
  if (!normalized) return clean;
  const [year, month, day] = normalized.split("-");
  return `${day}/${month}/${year}`;
}

function BulkEmployeeModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const call = useServerFn(upsertEmployees);
  const [raw, setRaw] = useState("");
  const [saving, setSaving] = useState(false);
  const [readingFile, setReadingFile] = useState(false);
  const parsed = useMemo(() => {
    const records: Array<{
      badge: string;
      employee_id: string;
      admission_date: string;
      full_name: string;
      job_title: string;
    }> = [];
    const errors: string[] = [];
    raw.split(/\r?\n/).forEach((line, index) => {
      if (!line.trim()) return;
      const columns = line.includes("\t") ? line.split("\t") : line.split(";");
      const values = columns.map((value) => value.trim());
      if (index === 0 && /chapa/i.test(values[0] ?? "")) return;
      if (values.length < 5) {
        errors.push(`Linha ${index + 1}: informe as 5 colunas.`);
        return;
      }
      const date = normalizeEmployeeDate(values[2]);
      if ((!values[0] && !values[1]) || !date || !values[3] || !values[4]) {
        errors.push(`Linha ${index + 1}: informe Chapa ou ID e verifique data, nome e função.`);
        return;
      }
      records.push({
        badge: values[0],
        employee_id: values[1],
        admission_date: date,
        full_name: values[3],
        job_title: values.slice(4).join(" "),
      });
    });
    return { records, errors };
  }, [raw]);
  async function importSpreadsheet(file?: File) {
    if (!file) return;
    setReadingFile(true);
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
      const firstSheetName = workbook.SheetNames[0];
      if (!firstSheetName) throw new Error("A planilha não possui nenhuma aba.");
      const worksheet = workbook.Sheets[firstSheetName];
      const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
        header: 1,
        defval: "",
        raw: true,
      });
      if (!rows.length) throw new Error("A planilha está vazia.");
      const receivedHeaders = rows[0].slice(0, EMPLOYEE_TEMPLATE_HEADERS.length).map((value) => String(value).trim());
      const validHeaders = EMPLOYEE_TEMPLATE_HEADERS.every((header, index) => receivedHeaders[index] === header);
      if (!validHeaders) {
        throw new Error("Cabeçalhos inválidos. Use exatamente: Chapa, ID, Data de Admissão, Nome, Função.");
      }
      const employeeRows = rows
        .slice(1)
        .map((row) =>
          row
            .slice(0, EMPLOYEE_TEMPLATE_HEADERS.length)
            .map((value, index) => (index === 2 ? formatEmployeeSpreadsheetDate(value) : String(value ?? "").trim())),
        )
        .filter((row) => row.some(Boolean));
      if (!employeeRows.length) throw new Error("A planilha não possui colaboradores preenchidos.");
      setRaw([Array.from(EMPLOYEE_TEMPLATE_HEADERS), ...employeeRows].map((row) => row.join("\t")).join("\n"));
      toast.success(`${employeeRows.length} colaborador(es) carregado(s) da planilha.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível ler a planilha.");
    } finally {
      setReadingFile(false);
    }
  }

  async function save() {
    if (!parsed.records.length) return toast.error("Importe ou cole ao menos um colaborador válido.");
    if (parsed.errors.length) return toast.error("Corrija as linhas inválidas antes de salvar.");
    setSaving(true);
    try {
      const res = await call({ data: { employees: parsed.records } });
      if (!res.ok) return toast.error(res.error);
      toast.success(`${res.count} colaborador(es) atualizado(s).`);
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível atualizar a lista.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal onClose={onClose} title="Importar / atualizar colaboradores" size="lg">
      <div className="rounded border border-primary/20 bg-primary/5 p-3 text-[12px]">
        <b>Como usar:</b> copie as linhas do Excel e cole abaixo, nesta ordem:{" "}
        <b>Chapa, ID, Data de Admissão, Nome, Função</b>. A data aceita dd/mm/aaaa ou aaaa-mm-dd. Chapas existentes
        serão atualizadas e reativadas.
      </div>
      <div className="mt-3 rounded border border-border p-3">
        <label
          className={cn(
            "flex min-h-10 w-full cursor-pointer items-center justify-center gap-1.5 rounded border border-border px-3 text-[12px] hover:bg-muted sm:w-fit",
            readingFile && "pointer-events-none opacity-60",
          )}
        >
          <Upload className="h-3.5 w-3.5" />
          {readingFile ? "Lendo planilha…" : "Selecionar planilha preenchida"}
          <input
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            disabled={readingFile || saving}
            onChange={async (event) => {
              await importSpreadsheet(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
        </label>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Aceita arquivos .xlsx ou .xls gerados pelo botão Baixar modelo. Os cabeçalhos e a ordem são validados antes da
          importação.
        </p>
      </div>
      <div className="mt-3 text-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        ou cole os dados abaixo
      </div>
      <textarea
        rows={10}
        className="input-base mt-2 min-h-56 font-mono text-[12px]"
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        placeholder={"Chapa\tID\tData de Admissão\tNome\tFunção\n1234\t9876\t15/01/2024\tMaria da Silva\tEletricista"}
      />
      <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
        <span className="rounded bg-success/10 px-2 py-1 text-success">{parsed.records.length} linha(s) válida(s)</span>
        {parsed.errors.length > 0 && (
          <span className="rounded bg-destructive/10 px-2 py-1 text-destructive">{parsed.errors.length} erro(s)</span>
        )}
      </div>
      {parsed.errors.length > 0 && (
        <div className="mt-2 max-h-24 overflow-auto rounded border border-destructive/20 bg-destructive/5 p-2 text-[11px] text-destructive">
          {parsed.errors.slice(0, 20).map((error) => (
            <div key={error}>{error}</div>
          ))}
        </div>
      )}
      {parsed.records.length > 0 && (
        <div className="mt-3 max-h-40 overflow-auto rounded border border-border">
          <table className="w-full min-w-[650px] text-left text-[11px]">
            <thead className="sticky top-0 bg-muted">
              <tr>
                <th className="p-2">Chapa</th>
                <th className="p-2">ID</th>
                <th className="p-2">Admissão</th>
                <th className="p-2">Nome</th>
                <th className="p-2">Função</th>
              </tr>
            </thead>
            <tbody>
              {parsed.records.slice(0, 100).map((employee, index) => (
                <tr key={`${employee.badge}-${index}`} className="border-t border-border">
                  <td className="p-2">{employee.badge}</td>
                  <td className="p-2">{employee.employee_id}</td>
                  <td className="p-2">{formatDate(employee.admission_date)}</td>
                  <td className="p-2">{employee.full_name}</td>
                  <td className="p-2">{employee.job_title}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button
          onClick={onClose}
          disabled={saving}
          className="min-h-10 w-full rounded border border-border px-3 text-[12px] hover:bg-muted sm:w-auto"
        >
          Cancelar
        </button>
        <button
          onClick={save}
          disabled={saving || !parsed.records.length || parsed.errors.length > 0}
          className="btn-primary min-h-10 w-full justify-center text-[12px] disabled:opacity-60 sm:w-auto"
        >
          {saving ? "Salvando…" : `Salvar ${parsed.records.length} colaborador(es)`}
        </button>
      </div>
    </Modal>
  );
}

/* ---------- New Request Modal ---------- */
function NewRequestModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const draftStorageKey = "nexo:overtime-request-draft";
  const call = useServerFn(createOvertimeRequest);
  const [saving, setSaving] = useState(false);
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<string[]>([]);
  const draftLoaded = useRef(false);
  const departureTimeOptions = ["18:30", "19:30", "20:00", "20:30", "04:30", "05:30", "06:30", "07:30"];
  const [form, setForm] = useState({
    activity_id: null as string | null,
    week_id: null as string | null,
    order_number: "",
    service_description: "",
    overtime_date: new Date().toISOString().slice(0, 10),
    entry_time: "",
    departure_time: "18:30",
    needs_snack: false,
    justification: "",
  });
  const [customEntryTime, setCustomEntryTime] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    try {
      const savedDraft = sessionStorage.getItem(draftStorageKey);
      if (savedDraft) {
        const parsed = JSON.parse(savedDraft) as {
          selectedEmployeeIds?: unknown;
          form?: Partial<typeof form>;
        };
        if (Array.isArray(parsed.selectedEmployeeIds)) {
          setSelectedEmployeeIds(parsed.selectedEmployeeIds.filter((id): id is string => typeof id === "string"));
        }
        if (parsed.form && typeof parsed.form === "object") {
          setForm((current) => ({ ...current, ...parsed.form }));
        }
      }
    } catch {
      sessionStorage.removeItem(draftStorageKey);
    } finally {
      draftLoaded.current = true;
    }
  }, []);

  useEffect(() => {
    if (!draftLoaded.current) return;
    sessionStorage.setItem(
      draftStorageKey,
      JSON.stringify({
        selectedEmployeeIds,
        form,
      }),
    );
  }, [selectedEmployeeIds, form]);
  const [dateYear, dateMonth, dateDay] = form.overtime_date.split("-");
  const monthOptions = [
    ["01", "Jan"],
    ["02", "Fev"],
    ["03", "Mar"],
    ["04", "Abr"],
    ["05", "Mai"],
    ["06", "Jun"],
    ["07", "Jul"],
    ["08", "Ago"],
    ["09", "Set"],
    ["10", "Out"],
    ["11", "Nov"],
    ["12", "Dez"],
  ];
  const currentYear = new Date().getFullYear();
  const dateYears = Array.from({ length: 4 }, (_, index) => String(currentYear - 1 + index));
  const dateDays = Array.from({ length: new Date(Number(dateYear), Number(dateMonth), 0).getDate() }, (_, index) =>
    String(index + 1).padStart(2, "0"),
  );

  function setDatePart(part: "year" | "month" | "day", value: string) {
    let year = dateYear;
    let month = dateMonth;
    let day = dateDay;
    if (part === "year") year = value;
    if (part === "month") month = value;
    if (part === "day") day = value;
    const lastDay = new Date(Number(year), Number(month), 0).getDate();
    day = String(Math.min(Number(day), lastDay)).padStart(2, "0");
    setForm((current) => ({ ...current, overtime_date: year + "-" + month + "-" + day }));
  }
  const employees = useQuery({
    queryKey: ["active-employees"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("employees")
        .select("id,badge,employee_id,admission_date,full_name,job_title,is_active")
        .eq("is_active", true)
        .order("full_name")
        .limit(2000);
      if (error) throw error;
      return ((data ?? []) as EmployeeRow[]).map(sanitizeEmployeeRow);
    },
  });
  const selectedEmployees = (employees.data ?? []).filter((employee) => selectedEmployeeIds.includes(employee.id));
  const filteredEmployees = useMemo(() => {
    const term = employeeSearch.trim().toLocaleLowerCase("pt-BR");
    if (term.length < 2) return [];
    return (employees.data ?? [])
      .filter((employee) =>
        [employee.full_name, employee.badge, employee.employee_id, employee.job_title].some((value) =>
          value.toLocaleLowerCase("pt-BR").includes(term),
        ),
      )
      .slice(0, 30);
  }, [employees.data, employeeSearch]);

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

  function toggleEmployee(id: string) {
    setSelectedEmployeeIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }
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
    if (selectedEmployeeIds.length === 0) return toast.error("Selecione ao menos um colaborador.");
    if (!form.overtime_date || !form.departure_time) return toast.error("Informe a data e o horário da hora extra.");
    if (!form.service_description.trim() || !form.justification.trim())
      return toast.error("Descreva o serviço e a justificativa.");
    setSaving(true);
    try {
      const res = await call({
        data: {
          employee_ids: selectedEmployeeIds,
          activity_id: form.activity_id,
          week_id: form.week_id,
          order_number: form.order_number.trim() || null,
          service_description: form.service_description.trim(),
          overtime_date: form.overtime_date,
          entry_time: form.entry_time || null,
          departure_time: form.departure_time,
          needs_snack: form.needs_snack,
          justification: form.justification.trim(),
        },
      });
      if (!res.ok) return toast.error(res.error);
      toast.success(`${res.count} solicitação(ões) enviada(s).`);
      sessionStorage.removeItem(draftStorageKey);
      onCreated();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível enviar as solicitações.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onClose} title="Nova solicitação de hora extra" size="lg">
      <div className="rounded-md border border-border bg-muted/30 p-3">
        <div className="mb-2 flex min-w-0 flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Colaboradores *
          </span>
          <span className="rounded bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary">
            {selectedEmployeeIds.length} selecionado(s)
          </span>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            className="input-base pl-7 text-[12px]"
            placeholder="Buscar por nome, chapa, ID ou função…"
            value={employeeSearch}
            onChange={(e) => setEmployeeSearch(e.target.value)}
          />
        </div>
        {employees.isLoading && <div className="mt-2 text-[12px] text-muted-foreground">Carregando colaboradores…</div>}
        {employeeSearch.trim().length >= 2 && (
          <div className="mt-2 max-h-48 divide-y divide-border overflow-auto rounded border border-border bg-card">
            {filteredEmployees.map((employee) => {
              const selected = selectedEmployeeIds.includes(employee.id);
              return (
                <button
                  key={employee.id}
                  type="button"
                  onClick={() => toggleEmployee(employee.id)}
                  className={cn(
                    "flex w-full items-start gap-2 p-2 text-left text-[12px] hover:bg-muted",
                    selected && "bg-primary/5",
                  )}
                >
                  <input type="checkbox" readOnly checked={selected} className="mt-0.5" />
                  <span className="min-w-0 flex-1">
                    <b>{employee.full_name}</b>
                    <span className="block text-[11px] text-muted-foreground">
                      Chapa {employee.badge} · ID {employee.employee_id} · {employee.job_title}
                    </span>
                  </span>
                </button>
              );
            })}
            {filteredEmployees.length === 0 && (
              <div className="p-3 text-[12px] text-muted-foreground">Nenhum colaborador ativo encontrado.</div>
            )}
          </div>
        )}
        {selectedEmployees.length > 0 && (
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {selectedEmployees.map((employee) => (
              <div
                key={employee.id}
                className="flex min-w-0 items-start justify-between gap-2 rounded border border-primary/20 bg-primary/5 p-2 text-[12px]"
              >
                <span className="min-w-0">
                  <b className="block truncate">{employee.full_name}</b>
                  <span className="text-[11px] text-muted-foreground">
                    {employee.badge} · {employee.job_title}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => toggleEmployee(employee.id)}
                  className="shrink-0 text-[11px] text-muted-foreground hover:text-destructive"
                >
                  Remover
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-3 grid min-w-0 max-w-full grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="min-w-0 max-w-full">
          <Field label="Data da hora extra" required>
            <div className="grid min-w-0 max-w-full grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)_minmax(0,1fr)] gap-2">
              <select
                aria-label="Dia da hora extra"
                className="input-base min-w-0 w-full max-w-full text-[16px] sm:text-[12px]"
                value={dateDay}
                onChange={(e) => setDatePart("day", e.target.value)}
              >
                {dateDays.map((day) => (
                  <option key={day} value={day}>
                    {day}
                  </option>
                ))}
              </select>
              <select
                aria-label="Mês da hora extra"
                className="input-base min-w-0 w-full max-w-full text-[16px] sm:text-[12px]"
                value={dateMonth}
                onChange={(e) => setDatePart("month", e.target.value)}
              >
                {monthOptions.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <select
                aria-label="Ano da hora extra"
                className="input-base min-w-0 w-full max-w-full text-[16px] sm:text-[12px]"
                value={dateYear}
                onChange={(e) => setDatePart("year", e.target.value)}
              >
                {dateYears.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </div>
          </Field>
        </div>
        <div className="min-w-0 max-w-full">
          <Field label="Horário de entrada (opcional)">
            <select
              className="input-base block min-w-0 w-full max-w-full text-[16px] sm:text-[12px]"
              value={
                customEntryTime ? "__other__" : departureTimeOptions.includes(form.entry_time) ? form.entry_time : ""
              }
              onChange={(e) => {
                const isOther = e.target.value === "__other__";
                setCustomEntryTime(isOther);
                setForm({ ...form, entry_time: isOther ? "" : e.target.value });
              }}
            >
              <option value="">Sem horário de entrada</option>
              {departureTimeOptions.map((time) => (
                <option key={time} value={time}>
                  {time.replace(/^0/, "")}
                </option>
              ))}
              <option value="__other__">Outro horário</option>
            </select>
            {customEntryTime && (
              <input
                type="time"
                aria-label="Outro horário de entrada"
                className="input-base mt-2 block min-w-0 w-full max-w-full text-[16px] sm:text-[12px]"
                style={{ width: "100%", minWidth: 0, maxWidth: "100%", boxSizing: "border-box" }}
                value={form.entry_time}
                onChange={(e) => setForm({ ...form, entry_time: e.target.value })}
              />
            )}
          </Field>
        </div>
        <div className="min-w-0 max-w-full">
          <Field label="Horário de saída" required>
            <select
              className="input-base block min-w-0 w-full max-w-full text-[16px] sm:text-[12px]"
              style={{ width: "100%", minWidth: 0, maxWidth: "100%", boxSizing: "border-box" }}
              value={departureTimeOptions.includes(form.departure_time) ? form.departure_time : "__other__"}
              onChange={(e) =>
                setForm({ ...form, departure_time: e.target.value === "__other__" ? "" : e.target.value })
              }
            >
              {departureTimeOptions.map((time) => (
                <option key={time} value={time}>
                  {time.replace(/^0/, "")}
                </option>
              ))}
              <option value="__other__">Outro horário</option>
            </select>
            {!departureTimeOptions.includes(form.departure_time) && (
              <input
                type="time"
                aria-label="Outro horário de saída"
                className="input-base mt-2 block min-w-0 w-full max-w-full text-[16px] sm:text-[12px]"
                style={{ width: "100%", minWidth: 0, maxWidth: "100%", boxSizing: "border-box" }}
                value={form.departure_time}
                onChange={(e) => setForm({ ...form, departure_time: e.target.value })}
              />
            )}
          </Field>
        </div>
        <Field label="Precisa de lanche?">
          <select
            className="input-base block min-w-0 w-full max-w-full text-[16px] sm:text-[12px]"
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
          disabled={saving || selectedEmployeeIds.length === 0}
          className="btn-primary min-h-10 w-full justify-center text-[12px] disabled:opacity-60 sm:w-auto"
        >
          {saving ? "Enviando…" : `Enviar para ${selectedEmployeeIds.length} colaborador(es)`}
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
      toast.success(
        res.count > 1
          ? `${res.count} colaboradores ${isReject ? "reprovados" : "aprovados"} em uma única decisão.`
          : isReject
            ? "Solicitação reprovada."
            : "Solicitação aprovada.",
      );
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
          <b>Ordem:</b> {row.order_number || "—"} · <b>Entrada:</b> {row.entry_time || "—"} · <b>Saída:</b>{" "}
          {row.departure_time} · <b>Lanche:</b> {row.needs_snack ? "Sim" : "Não"}
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
function formatOvertimeStatus(status: OvertimeRow["status"]) {
  return {
    pending: "Pendente",
    approved: "Aprovado",
    rejected: "Reprovado",
    cancelled: "Cancelado",
  }[status];
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
