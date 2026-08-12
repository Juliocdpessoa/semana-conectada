import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Bus, CalendarDays, Download, Plus, Search, Trash2, Pencil, Users, Utensils } from "lucide-react";
import { PageHeader, Panel, KpiCard, EmptyState, Modal, Field } from "@/components/ui-kit";
import { cn } from "@/lib/utils";
import type { SessionInfo } from "./route";
import {
  listScheduledTransport,
  createScheduledTransport,
  updateScheduledTransport,
  cancelScheduledTransport,
} from "@/lib/scheduled-transport.functions";
import {
  SCHEDULED_TRANSPORT_EXPORT_HEADERS,
  SCHEDULED_TRANSPORT_EXPORT_WIDTHS,
  consolidateScheduledTransport,
  mapScheduledTransportExportRow,
  formatScheduledStatus,
  datesInRange,
  WEEKDAY_LABELS,
  WEEKDAY_SHORT,
} from "@/lib/transport-export";
import type { ScheduledTransportRow, ScheduledTransportBatch } from "@/lib/transport-export";
import { formatDate, filterEmployees, sanitizeEmployeeRow } from "@/lib/overtime.functions";
import type { EmployeeRow } from "@/lib/overtime.functions";

const ALLOWED_ROLES = ["admin", "manager", "logistics", "planning"];

export const Route = createFileRoute("/_authenticated/transporte-programado")({
  beforeLoad: ({ context }) => {
    const s = (context as { session: SessionInfo }).session;
    if (!s.roles.some((role) => ALLOWED_ROLES.includes(role))) throw redirect({ to: "/atividades" });
  },
  head: () => ({
    meta: [
      { title: "Transporte Programado | NEXO" },
      { name: "description", content: "Programação de transporte por período para equipes de manutenção." },
      { property: "og:title", content: "Transporte Programado | NEXO" },
      { property: "og:description", content: "Programação de transporte por período para equipes de manutenção." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ScheduledTransportPage,
});

type Filters = {
  search: string;
  startDate: string;
  endDate: string;
  jobTitle: string;
  line: string;
  status: "all" | "scheduled" | "cancelled";
  transport: "all" | "yes" | "no";
  entryTime: string;
  departureTime: string;
};

const EMPTY_FILTERS: Filters = {
  search: "",
  startDate: "",
  endDate: "",
  jobTitle: "",
  line: "",
  status: "scheduled",
  transport: "all",
  entryTime: "",
  departureTime: "",
};

function ScheduledTransportPage() {
  const queryClient = useQueryClient();
  const load = useServerFn(listScheduledTransport);
  const cancelFn = useServerFn(cancelScheduledTransport);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [newOpen, setNewOpen] = useState(false);
  const [editing, setEditing] = useState<ScheduledTransportRow | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const query = useQuery({
    queryKey: ["scheduled-transport"],
    queryFn: async () => {
      const result = await load({ data: {} });
      if (!result.ok) throw new Error(result.error);
      return result;
    },
  });

  const rows = (query.data?.rows ?? []) as ScheduledTransportRow[];
  const batchesList = (query.data?.batches ?? []) as ScheduledTransportBatch[];
  const employees = ((query.data?.employees ?? []) as EmployeeRow[]).map(sanitizeEmployeeRow);
  const batches = useMemo(() => new Map(batchesList.map((batch) => [batch.id, batch])), [batchesList]);

  const jobTitles = useMemo(
    () => [...new Set(rows.map((row) => row.employee_role).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [rows],
  );
  const lines = useMemo(
    () =>
      [...new Set(rows.map((row) => row.employee_transport_line || "").filter(Boolean))].sort((a, b) =>
        a.localeCompare(b),
      ),
    [rows],
  );

  const filtered = useMemo(() => {
    const term = filters.search.trim().toLocaleLowerCase("pt-BR");
    return rows.filter((row) => {
      if (filters.status !== "all" && row.status !== filters.status) return false;
      if (filters.startDate && row.transport_date < filters.startDate) return false;
      if (filters.endDate && row.transport_date > filters.endDate) return false;
      if (filters.jobTitle && row.employee_role !== filters.jobTitle) return false;
      if (filters.line && (row.employee_transport_line || "") !== filters.line) return false;
      if (filters.transport === "yes" && !row.needs_transport) return false;
      if (filters.transport === "no" && row.needs_transport) return false;
      if (filters.entryTime && row.entry_time !== filters.entryTime) return false;
      if (filters.departureTime && row.departure_time !== filters.departureTime) return false;
      if (
        term &&
        ![
          row.employee_name,
          row.employee_registration ?? "",
          row.employee_external_id ?? "",
          row.employee_role,
          row.employee_transport_line ?? "",
          row.order_number ?? "",
          row.service_description ?? "",
          row.requester_name,
        ].some((value) => value.toLocaleLowerCase("pt-BR").includes(term))
      )
        return false;
      return true;
    });
  }, [rows, filters]);

  const kpis = useMemo(() => {
    const scheduled = filtered.filter((row) => row.status === "scheduled");
    return {
      total: filtered.length,
      scheduled: scheduled.length,
      cancelled: filtered.length - scheduled.length,
      transport: scheduled.filter((row) => row.needs_transport).length,
      snack: scheduled.filter((row) => row.needs_snack).length,
      employees: new Set(scheduled.map((row) => row.employee_master_id)).size,
    };
  }, [filtered]);

  const consolidated = useMemo(() => consolidateScheduledTransport(filtered, batches), [filtered, batches]);

  async function exportExcel() {
    if (consolidated.length === 0) {
      toast.error("Não há programações para exportar com os filtros atuais.");
      return;
    }
    try {
      const ExcelJS = (await import("exceljs")).default;
      const workbook = new ExcelJS.Workbook();
      workbook.creator = "NEXO";
      workbook.created = new Date();
      const worksheet = workbook.addWorksheet("Transporte programado", { views: [{ state: "frozen", ySplit: 1 }] });
      worksheet.addTable({
        name: "TabelaTransporteProgramado",
        ref: "A1",
        headerRow: true,
        totalsRow: false,
        style: {
          theme: "TableStyleMedium2",
          showFirstColumn: false,
          showLastColumn: false,
          showRowStripes: true,
          showColumnStripes: false,
        },
        columns: SCHEDULED_TRANSPORT_EXPORT_HEADERS.map((name) => ({ name, filterButton: true })),
        rows: consolidated.map(mapScheduledTransportExportRow),
      });
      SCHEDULED_TRANSPORT_EXPORT_WIDTHS.forEach((width, index) => {
        worksheet.getColumn(index + 1).width = width;
      });
      worksheet.getRow(1).height = 26;
      worksheet.getRow(1).alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber > 1) row.alignment = { vertical: "top", wrapText: true };
      });
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer as BlobPart], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "transporte-programado.xlsx";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast.success(consolidated.length + " linha(s) consolidada(s) exportada(s).");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível gerar a planilha.");
    }
  }

  async function cancelSelected() {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (!confirm(`Cancelar ${ids.length} programação(ões)?`)) return;
    const result = await cancelFn({ data: { ids } });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(result.count + " programação(ões) cancelada(s).");
    setSelected(new Set());
    queryClient.invalidateQueries({ queryKey: ["scheduled-transport"] });
  }

  function toggleSelected(id: string) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <main className="mx-auto max-w-[1600px] px-3 py-4 sm:px-6">
      <PageHeader
        title="Transporte Programado"
        description="Programação de transporte por dia ou período, independente de hora extra."
        actions={
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={exportExcel} className="btn-secondary min-h-9 text-[12px]">
              <Download className="h-4 w-4" /> Exportar Transporte
            </button>
            <button type="button" onClick={() => setNewOpen(true)} className="btn-primary min-h-9 text-[12px]">
              <Plus className="h-4 w-4" /> Nova Programação
            </button>
          </div>
        }
      />

      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard label="Registros" value={kpis.total} icon={<CalendarDays className="h-4 w-4" />} />
        <KpiCard label="Programados" value={kpis.scheduled} icon={<CalendarDays className="h-4 w-4" />} />
        <KpiCard label="Colaboradores" value={kpis.employees} icon={<Users className="h-4 w-4" />} />
        <KpiCard label="Com transporte" value={kpis.transport} icon={<Bus className="h-4 w-4" />} />
        <KpiCard label="Com lanche" value={kpis.snack} icon={<Utensils className="h-4 w-4" />} />
      </div>

      <div className="mt-4">
        <Panel title="Programações" description="A exportação respeita exatamente os filtros ativos." padded={false}>
          <div className="grid gap-2 border-b border-border p-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Pesquisa rápida">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={filters.search}
                  onChange={(event) => setFilters((f) => ({ ...f, search: event.target.value }))}
                  placeholder="Nome, chapa, ID, função, linha…"
                  className="input-base w-full pl-7 text-[16px] sm:text-[12px]"
                />
              </div>
            </Field>
            <Field label="Data inicial">
              <input
                type="date"
                value={filters.startDate}
                onChange={(event) => setFilters((f) => ({ ...f, startDate: event.target.value }))}
                className="input-base w-full text-[16px] sm:text-[12px]"
              />
            </Field>
            <Field label="Data final">
              <input
                type="date"
                value={filters.endDate}
                onChange={(event) => setFilters((f) => ({ ...f, endDate: event.target.value }))}
                className="input-base w-full text-[16px] sm:text-[12px]"
              />
            </Field>
            <Field label="Função">
              <select
                value={filters.jobTitle}
                onChange={(event) => setFilters((f) => ({ ...f, jobTitle: event.target.value }))}
                className="input-base w-full text-[16px] sm:text-[12px]"
              >
                <option value="">Todas</option>
                {jobTitles.map((title) => (
                  <option key={title} value={title}>
                    {title}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Linha">
              <select
                value={filters.line}
                onChange={(event) => setFilters((f) => ({ ...f, line: event.target.value }))}
                className="input-base w-full text-[16px] sm:text-[12px]"
              >
                <option value="">Todas</option>
                {lines.map((line) => (
                  <option key={line} value={line}>
                    {line}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Status">
              <select
                value={filters.status}
                onChange={(event) => setFilters((f) => ({ ...f, status: event.target.value as Filters["status"] }))}
                className="input-base w-full text-[16px] sm:text-[12px]"
              >
                <option value="scheduled">Programado</option>
                <option value="cancelled">Cancelado</option>
                <option value="all">Todos</option>
              </select>
            </Field>
            <Field label="Necessita transporte">
              <select
                value={filters.transport}
                onChange={(event) =>
                  setFilters((f) => ({ ...f, transport: event.target.value as Filters["transport"] }))
                }
                className="input-base w-full text-[16px] sm:text-[12px]"
              >
                <option value="all">Todos</option>
                <option value="yes">Sim</option>
                <option value="no">Não</option>
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Entrada">
                <input
                  type="time"
                  value={filters.entryTime}
                  onChange={(event) => setFilters((f) => ({ ...f, entryTime: event.target.value }))}
                  className="input-base w-full text-[16px] sm:text-[12px]"
                />
              </Field>
              <Field label="Saída">
                <input
                  type="time"
                  value={filters.departureTime}
                  onChange={(event) => setFilters((f) => ({ ...f, departureTime: event.target.value }))}
                  className="input-base w-full text-[16px] sm:text-[12px]"
                />
              </Field>
            </div>
            <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4">
              <button
                type="button"
                onClick={() => setFilters(EMPTY_FILTERS)}
                className="btn-secondary min-h-9 text-[12px]"
              >
                Limpar filtros
              </button>
              <button
                type="button"
                onClick={cancelSelected}
                disabled={selected.size === 0}
                className="btn-secondary min-h-9 text-[12px] disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" /> Cancelar selecionados ({selected.size})
              </button>
              <span className="ml-auto text-[11px] text-muted-foreground">
                {filtered.length} registro(s) · {consolidated.length} linha(s) na planilha
              </span>
            </div>
          </div>

          {query.isLoading ? (
            <div className="p-6 text-[12px] text-muted-foreground">Carregando programações…</div>
          ) : query.isError ? (
            <div className="p-6 text-[12px] text-destructive">{(query.error as Error).message}</div>
          ) : filtered.length === 0 ? (
            <div className="p-6">
              <EmptyState icon={<Bus className="h-4 w-4" />} title="Nenhuma programação encontrada" />
            </div>
          ) : (
            <>
              <div className="grid gap-3 p-3 md:hidden">
                {filtered.slice(0, 300).map((row) => (
                  <article key={row.id} className="rounded-lg border border-border bg-card p-3 text-[12px] shadow-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-semibold">{row.employee_name}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {formatDate(row.transport_date)} · {row.entry_time}–{row.departure_time}
                        </div>
                      </div>
                      <span className="text-[11px]">{formatScheduledStatus(row.status)}</span>
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      Chapa {row.employee_registration || "—"} · {row.employee_role} · Linha{" "}
                      {row.employee_transport_line || "—"}
                    </div>
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={() => setEditing(row)}
                        className="btn-secondary min-h-8 text-[11px]"
                      >
                        <Pencil className="h-3.5 w-3.5" /> Editar
                      </button>
                      {row.status === "scheduled" && (
                        <button
                          type="button"
                          onClick={async () => {
                            const result = await cancelFn({ data: { ids: [row.id] } });
                            if (!result.ok) return toast.error(result.error);
                            toast.success("Programação cancelada.");
                            queryClient.invalidateQueries({ queryKey: ["scheduled-transport"] });
                          }}
                          className="btn-secondary min-h-8 text-[11px]"
                        >
                          <Trash2 className="h-3.5 w-3.5" /> Cancelar
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </div>

              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[1200px] text-[12px]">
                  <thead className="bg-muted/50 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-2 py-2"></th>
                      <th className="px-2 py-2">Data</th>
                      <th className="px-2 py-2">Chapa</th>
                      <th className="px-2 py-2">ID</th>
                      <th className="px-2 py-2">Nome</th>
                      <th className="px-2 py-2">Função</th>
                      <th className="px-2 py-2">Entrada</th>
                      <th className="px-2 py-2">Saída</th>
                      <th className="px-2 py-2">Lanche</th>
                      <th className="px-2 py-2">Transporte</th>
                      <th className="px-2 py-2">Linha</th>
                      <th className="px-2 py-2">Ordem</th>
                      <th className="px-2 py-2">Serviço</th>
                      <th className="px-2 py-2">Solicitante</th>
                      <th className="px-2 py-2">Status</th>
                      <th className="px-2 py-2">Ação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.slice(0, 1000).map((row) => (
                      <tr key={row.id} className={cn("border-t border-border", row.status === "cancelled" && "opacity-60")}>
                        <td className="px-2 py-1.5">
                          <input
                            type="checkbox"
                            checked={selected.has(row.id)}
                            onChange={() => toggleSelected(row.id)}
                            disabled={row.status !== "scheduled"}
                          />
                        </td>
                        <td className="whitespace-nowrap px-2 py-1.5">{formatDate(row.transport_date)}</td>
                        <td className="px-2 py-1.5">{row.employee_registration || "—"}</td>
                        <td className="px-2 py-1.5">{row.employee_external_id || "—"}</td>
                        <td className="px-2 py-1.5">{row.employee_name}</td>
                        <td className="px-2 py-1.5">{row.employee_role}</td>
                        <td className="px-2 py-1.5">{row.entry_time}</td>
                        <td className="px-2 py-1.5">{row.departure_time}</td>
                        <td className="px-2 py-1.5">{row.needs_snack ? "Sim" : "Não"}</td>
                        <td className="px-2 py-1.5">{row.needs_transport ? "Sim" : "Não"}</td>
                        <td className="px-2 py-1.5">{row.employee_transport_line || "—"}</td>
                        <td className="px-2 py-1.5">{row.order_number || "—"}</td>
                        <td className="max-w-[280px] truncate px-2 py-1.5" title={row.service_description || ""}>
                          {row.service_description || "—"}
                        </td>
                        <td className="px-2 py-1.5">{row.requester_name || row.requester_email}</td>
                        <td className="px-2 py-1.5">{formatScheduledStatus(row.status)}</td>
                        <td className="whitespace-nowrap px-2 py-1.5">
                          <button
                            type="button"
                            onClick={() => setEditing(row)}
                            className="rounded p-1 hover:bg-muted"
                            title="Editar"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          {row.status === "scheduled" && (
                            <button
                              type="button"
                              title="Cancelar"
                              onClick={async () => {
                                const result = await cancelFn({ data: { ids: [row.id] } });
                                if (!result.ok) return toast.error(result.error);
                                toast.success("Programação cancelada.");
                                queryClient.invalidateQueries({ queryKey: ["scheduled-transport"] });
                              }}
                              className="rounded p-1 hover:bg-muted"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Panel>
      </div>

      {newOpen && (
        <NewScheduleModal
          employees={employees}
          onClose={() => setNewOpen(false)}
          onSaved={() => {
            setNewOpen(false);
            queryClient.invalidateQueries({ queryKey: ["scheduled-transport"] });
          }}
        />
      )}

      {editing && (
        <EditScheduleModal
          row={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            queryClient.invalidateQueries({ queryKey: ["scheduled-transport"] });
          }}
        />
      )}
    </main>
  );
}

/* ---------- Nova programação ---------- */
function NewScheduleModal({
  employees,
  onClose,
  onSaved,
}: {
  employees: EmployeeRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const create = useServerFn(createScheduledTransport);
  const [search, setSearch] = useState("");
  const [ids, setIds] = useState<Set<string>>(new Set());
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [entryTime, setEntryTime] = useState("");
  const [departureTime, setDepartureTime] = useState("");
  const [needsSnack, setNeedsSnack] = useState(false);
  const [needsTransport, setNeedsTransport] = useState(true);
  const [orderNumber, setOrderNumber] = useState("");
  const [service, setService] = useState("");
  const [observation, setObservation] = useState("");
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);

  const visible = useMemo(() => filterEmployees(employees, search).slice(0, 200), [employees, search]);
  const dates = useMemo(
    () => (startDate && endDate && startDate <= endDate ? datesInRange(startDate, endDate, weekdays) : []),
    [startDate, endDate, weekdays],
  );

  function toggleEmployee(id: string) {
    setIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit(skipDuplicates: boolean) {
    setSaving(true);
    try {
      const result = await create({
        data: {
          employee_ids: [...ids],
          start_date: startDate,
          end_date: endDate,
          weekdays,
          entry_time: entryTime,
          departure_time: departureTime,
          needs_snack: needsSnack,
          needs_transport: needsTransport,
          order_number: orderNumber || null,
          service_description: service || null,
          observation: observation || null,
          skip_duplicates: skipDuplicates,
        },
      });
      if (!result.ok) {
        if ("duplicates" in result && result.duplicates) {
          if (confirm(`${result.error}\n\nDeseja ignorar os duplicados e criar somente os novos registros?`)) {
            await submit(true);
            return;
          }
          toast.message("Operação cancelada.");
          return;
        }
        toast.error(result.error);
        return;
      }
      toast.success(
        `${result.count} registro(s) criado(s)` + (result.skipped ? ` · ${result.skipped} duplicado(s) ignorado(s)` : ""),
      );
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao salvar a programação.");
    } finally {
      setSaving(false);
    }
  }

  const canPreview = ids.size > 0 && dates.length > 0 && entryTime && departureTime;

  return (
    <Modal title="Nova Programação de Transporte" onClose={onClose} size="lg">
      {!preview ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Data inicial">
              <input
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
                className="input-base w-full text-[16px] sm:text-[12px]"
              />
            </Field>
            <Field label="Data final">
              <input
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
                className="input-base w-full text-[16px] sm:text-[12px]"
              />
            </Field>
            <Field label="Horário de entrada">
              <input
                type="time"
                value={entryTime}
                onChange={(event) => setEntryTime(event.target.value)}
                className="input-base w-full text-[16px] sm:text-[12px]"
              />
            </Field>
            <Field label="Horário de saída (pode ser no dia seguinte)">
              <input
                type="time"
                value={departureTime}
                onChange={(event) => setDepartureTime(event.target.value)}
                className="input-base w-full text-[16px] sm:text-[12px]"
              />
            </Field>
          </div>

          <Field label="Dias da semana">
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAY_LABELS.map((label, index) => {
                const active = weekdays.includes(index);
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() =>
                      setWeekdays((previous) =>
                        previous.includes(index)
                          ? previous.filter((day) => day !== index)
                          : [...previous, index].sort((a, b) => a - b),
                      )
                    }
                    className={cn(
                      "rounded-md border px-2.5 py-1.5 text-[12px]",
                      active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card",
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </Field>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Necessita lanche">
              <select
                value={needsSnack ? "yes" : "no"}
                onChange={(event) => setNeedsSnack(event.target.value === "yes")}
                className="input-base w-full text-[16px] sm:text-[12px]"
              >
                <option value="no">Não</option>
                <option value="yes">Sim</option>
              </select>
            </Field>
            <Field label="Necessita transporte">
              <select
                value={needsTransport ? "yes" : "no"}
                onChange={(event) => setNeedsTransport(event.target.value === "yes")}
                className="input-base w-full text-[16px] sm:text-[12px]"
              >
                <option value="yes">Sim</option>
                <option value="no">Não</option>
              </select>
            </Field>
            <Field label="Ordem (opcional)">
              <input
                value={orderNumber}
                onChange={(event) => setOrderNumber(event.target.value)}
                className="input-base w-full text-[16px] sm:text-[12px]"
              />
            </Field>
            <Field label="Serviço/atividade (opcional)">
              <input
                value={service}
                onChange={(event) => setService(event.target.value)}
                className="input-base w-full text-[16px] sm:text-[12px]"
              />
            </Field>
          </div>

          <Field label="Observação (opcional)">
            <textarea
              value={observation}
              onChange={(event) => setObservation(event.target.value)}
              rows={2}
              className="input-base w-full text-[16px] sm:text-[12px]"
            />
          </Field>

          <Field label={`Colaboradores (${ids.size} selecionado(s))`}>
            <div className="relative mb-2">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Nome, chapa, ID ou função"
                className="input-base w-full pl-7 text-[16px] sm:text-[12px]"
              />
            </div>
            <div className="max-h-64 overflow-y-auto rounded-md border border-border">
              {visible.length === 0 ? (
                <div className="p-3 text-[12px] text-muted-foreground">Nenhum colaborador encontrado.</div>
              ) : (
                visible.map((employee) => (
                  <label
                    key={employee.id}
                    className="flex cursor-pointer items-center gap-2 border-b border-border px-2 py-1.5 text-[12px] last:border-b-0 hover:bg-muted/50"
                  >
                    <input
                      type="checkbox"
                      checked={ids.has(employee.id)}
                      onChange={() => toggleEmployee(employee.id)}
                    />
                    <span className="font-medium">{employee.full_name}</span>
                    <span className="text-[11px] text-muted-foreground">
                      Chapa {employee.badge || "—"} · ID {employee.employee_id || "—"} · {employee.job_title}
                    </span>
                  </label>
                ))
              )}
            </div>
          </Field>

          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="btn-secondary min-h-9 text-[12px]">
              Cancelar
            </button>
            <button
              type="button"
              disabled={!canPreview}
              onClick={() => setPreview(true)}
              className="btn-primary min-h-9 text-[12px] disabled:opacity-50"
            >
              Pré-visualizar
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3 text-[13px]">
          <div className="rounded-md border border-border bg-muted/30 p-3">
            <div>
              <strong>Período:</strong> {formatDate(startDate)} a {formatDate(endDate)}
            </div>
            <div>
              <strong>Dias considerados:</strong> {weekdays.map((day) => WEEKDAY_SHORT[day]).join(", ")}
            </div>
            <div>
              <strong>Quantidade de dias:</strong> {dates.length}
            </div>
            <div>
              <strong>Colaboradores selecionados:</strong> {ids.size}
            </div>
            <div>
              <strong>Registros que serão criados:</strong> {ids.size * dates.length}
            </div>
            <div>
              <strong>Entrada:</strong> {entryTime} · <strong>Saída:</strong> {departureTime}
            </div>
            <div>
              <strong>Lanche:</strong> {needsSnack ? "Sim" : "Não"} · <strong>Transporte:</strong>{" "}
              {needsTransport ? "Sim" : "Não"}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setPreview(false)} className="btn-secondary min-h-9 text-[12px]">
              Voltar
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => submit(false)}
              className="btn-primary min-h-9 text-[12px] disabled:opacity-50"
            >
              {saving ? "Salvando…" : "Confirmar Programação"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ---------- Edição ---------- */
function EditScheduleModal({
  row,
  onClose,
  onSaved,
}: {
  row: ScheduledTransportRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const update = useServerFn(updateScheduledTransport);
  const [scope, setScope] = useState<"single" | "future">("single");
  const [entryTime, setEntryTime] = useState(row.entry_time);
  const [departureTime, setDepartureTime] = useState(row.departure_time);
  const [needsSnack, setNeedsSnack] = useState(row.needs_snack);
  const [needsTransport, setNeedsTransport] = useState(row.needs_transport);
  const [orderNumber, setOrderNumber] = useState(row.order_number ?? "");
  const [service, setService] = useState(row.service_description ?? "");
  const [observation, setObservation] = useState(row.observation ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const result = await update({
        data: {
          id: row.id,
          scope,
          entry_time: entryTime,
          departure_time: departureTime,
          needs_snack: needsSnack,
          needs_transport: needsTransport,
          order_number: orderNumber || null,
          service_description: service || null,
          observation: observation || null,
          version: row.version,
        },
      });
      if (!result.ok) return toast.error(result.error);
      toast.success(result.count + " registro(s) atualizado(s).");
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Editar programação · ${row.employee_name}`} onClose={onClose}>
      <div className="space-y-3">
        <div className="text-[12px] text-muted-foreground">Data: {formatDate(row.transport_date)}</div>
        {row.batch_id && (
          <Field label="Abrangência">
            <select
              value={scope}
              onChange={(event) => setScope(event.target.value as "single" | "future")}
              className="input-base w-full text-[16px] sm:text-[12px]"
            >
              <option value="single">Editar somente este registro</option>
              <option value="future">Editar registros futuros deste grupo</option>
            </select>
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Entrada">
            <input
              type="time"
              value={entryTime}
              onChange={(event) => setEntryTime(event.target.value)}
              className="input-base w-full text-[16px] sm:text-[12px]"
            />
          </Field>
          <Field label="Saída">
            <input
              type="time"
              value={departureTime}
              onChange={(event) => setDepartureTime(event.target.value)}
              className="input-base w-full text-[16px] sm:text-[12px]"
            />
          </Field>
          <Field label="Lanche">
            <select
              value={needsSnack ? "yes" : "no"}
              onChange={(event) => setNeedsSnack(event.target.value === "yes")}
              className="input-base w-full text-[16px] sm:text-[12px]"
            >
              <option value="no">Não</option>
              <option value="yes">Sim</option>
            </select>
          </Field>
          <Field label="Transporte">
            <select
              value={needsTransport ? "yes" : "no"}
              onChange={(event) => setNeedsTransport(event.target.value === "yes")}
              className="input-base w-full text-[16px] sm:text-[12px]"
            >
              <option value="yes">Sim</option>
              <option value="no">Não</option>
            </select>
          </Field>
        </div>
        <Field label="Ordem">
          <input
            value={orderNumber}
            onChange={(event) => setOrderNumber(event.target.value)}
            className="input-base w-full text-[16px] sm:text-[12px]"
          />
        </Field>
        <Field label="Serviço">
          <input
            value={service}
            onChange={(event) => setService(event.target.value)}
            className="input-base w-full text-[16px] sm:text-[12px]"
          />
        </Field>
        <Field label="Observação">
          <textarea
            value={observation}
            onChange={(event) => setObservation(event.target.value)}
            rows={2}
            className="input-base w-full text-[16px] sm:text-[12px]"
          />
        </Field>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary min-h-9 text-[12px]">
            Fechar
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="btn-primary min-h-9 text-[12px] disabled:opacity-50"
          >
            {saving ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
