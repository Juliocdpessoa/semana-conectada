import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Bus, CalendarDays, Download, Plus, Search, Trash2, Pencil, Users, UserX } from "lucide-react";
import { PageHeader, Panel, KpiCard, EmptyState, Modal, Field } from "@/components/ui-kit";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import type { SessionInfo } from "./route";
import {
  listScheduledTransport,
  createScheduledTransport,
  updateScheduledTransport,
  cancelScheduledTransport,
  listEmployeeDaysOff,
  createEmployeeDayOff,
  updateEmployeeDayOff,
  deleteEmployeeDayOff,
} from "@/lib/scheduled-transport.functions";
import type { EmployeeDayOffRow } from "@/lib/scheduled-transport.functions";
import {
  SCHEDULED_TRANSPORT_EXPORT_HEADERS,
  SCHEDULED_TRANSPORT_EXPORT_WIDTHS,
  LOGISTICS_SCHEDULED_TRANSPORT_EXPORT_HEADERS,
  LOGISTICS_SCHEDULED_TRANSPORT_EXPORT_WIDTHS,
  consolidateScheduledTransport,
  mapScheduledTransportExportRow,
  mapLogisticsScheduledTransportExportRow,
  formatScheduledStatus,
  datesInRange,
  WEEKDAY_LABELS,
  WEEKDAY_SHORT,
} from "@/lib/transport-export";
import type { ScheduledTransportRow, ScheduledTransportBatch } from "@/lib/transport-export";
import { formatDate, filterEmployees, sanitizeEmployeeRow } from "@/lib/overtime.functions";
import type { EmployeeRow } from "@/lib/overtime.functions";

const ALLOWED_ROLES = ["admin", "manager", "logistics"];

export const Route = createFileRoute("/_authenticated/transporte-programado")({
  beforeLoad: ({ context }) => {
    const s = (context as { session: SessionInfo }).session;
    if (!s.roles.some((role) => ALLOWED_ROLES.includes(role))) throw redirect({ to: "/atividades" });
  },
  head: () => ({
    meta: [
      { title: "Mudança de Escala | NEXO" },
      {
        name: "description",
        content: "Solicitação de mudança de escala de trabalho para equipes de manutenção.",
      },
      { property: "og:title", content: "Mudança de Escala | NEXO" },
      {
        property: "og:description",
        content: "Solicitação de mudança de escala de trabalho para equipes de manutenção.",
      },
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
  status: "scheduled",
  transport: "all",
  entryTime: "",
  departureTime: "",
};

function localIsoDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function ScheduledTransportPage() {
  const { session } = Route.useRouteContext() as { session: SessionInfo };
  const isLogistics = session.roles.includes("logistics");
  const queryClient = useQueryClient();
  const load = useServerFn(listScheduledTransport);
  const cancelFn = useServerFn(cancelScheduledTransport);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [newOpen, setNewOpen] = useState(false);
  const [showDaysOff, setShowDaysOff] = useState(false);
  const [editing, setEditing] = useState<ScheduledTransportRow | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const query = useQuery({
    queryKey: ["scheduled-transport", filters, page],
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const result = await load({
        data: {
          start_date: filters.startDate || undefined,
          end_date: filters.endDate || undefined,
          search: filters.search || undefined,
          job_title: filters.jobTitle || undefined,
          status: filters.status,
          transport: filters.transport,
          entry_time: filters.entryTime || undefined,
          departure_time: filters.departureTime || undefined,
          page,
          page_size: 30,
          mode: "page",
        },
      });
      if (!result.ok) throw new Error(result.error);
      return result;
    },
  });

  const employeesQuery = useQuery({
    queryKey: ["active-employees"],
    enabled: newOpen || showDaysOff,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const all: EmployeeRow[] = [];
      const pageSize = 1000;
      for (let from = 0; ; from += pageSize) {
        const { data, error } = await (supabase as any)
          .from("employees")
          .select(
            "id,badge,employee_id,admission_date,full_name,job_title,address,neighborhood,city,phone,message_contact,transport_line,is_active",
          )
          .eq("is_active", true)
          .order("full_name")
          .range(from, from + pageSize - 1);
        if (error) throw error;
        const pageRows = (data ?? []) as EmployeeRow[];
        all.push(...pageRows);
        if (pageRows.length < pageSize) break;
      }
      return all.map(sanitizeEmployeeRow);
    },
  });

  const rows = (query.data?.rows ?? []) as ScheduledTransportRow[];
  const employees = employeesQuery.data ?? [];

  const jobTitles = (query.data?.options?.jobTitles ?? []) as string[];
  const availableDates = useMemo(() => (query.data?.options?.dates ?? []) as string[], [query.data?.options?.dates]);
  const availableEndDates = useMemo(
    () => availableDates.filter((date) => !filters.startDate || date >= filters.startDate),
    [availableDates, filters.startDate],
  );
  const availableEntryTimes = (query.data?.options?.entryTimes ?? []) as string[];
  const availableDepartureTimes = useMemo(
    () =>
      [
        ...new Set(
          ((query.data?.options?.departurePairs ?? []) as { entry: string; departure: string }[])
            .filter((row) => !filters.entryTime || row.entry === filters.entryTime)
            .map((row) => row.departure)
            .filter(Boolean),
        ),
      ].sort(),
    [query.data?.options?.departurePairs, filters.entryTime],
  );
  const pageSize = 30;
  const totalRows = query.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(totalRows / pageSize));
  const currentPage = Math.min(page, pageCount);
  const paginatedRows = rows;

  useEffect(() => setPage(1), [filters]);

  const kpis = query.data?.kpis ?? { employees: 0, transport: 0, noTransport: 0, cancelled: 0 };

  async function exportExcel() {
    try {
      const exportResult = await load({
        data: {
          start_date: filters.startDate || undefined,
          end_date: filters.endDate || undefined,
          search: filters.search || undefined,
          job_title: filters.jobTitle || undefined,
          status: filters.status,
          transport: filters.transport,
          entry_time: filters.entryTime || undefined,
          departure_time: filters.departureTime || undefined,
          page: 1,
          page_size: 30,
          mode: "export",
        },
      });
      if (!exportResult.ok) throw new Error(exportResult.error);
      const exportBatches = new Map(
        ((exportResult.batches ?? []) as ScheduledTransportBatch[]).map((batch) => [batch.id, batch]),
      );
      const consolidated = consolidateScheduledTransport(
        (exportResult.rows ?? []) as ScheduledTransportRow[],
        exportBatches,
      );
      if (consolidated.length === 0) {
        toast.error("Não há mudanças de escala para exportar com os filtros atuais.");
        return;
      }
      const ExcelJS = (await import("exceljs")).default;
      const workbook = new ExcelJS.Workbook();
      workbook.creator = "NEXO";
      workbook.created = new Date();
      const worksheet = workbook.addWorksheet("Mudanças de escala", {
        views: [{ state: "frozen", ySplit: 1, showGridLines: false }],
      });
      const headers = isLogistics ? LOGISTICS_SCHEDULED_TRANSPORT_EXPORT_HEADERS : SCHEDULED_TRANSPORT_EXPORT_HEADERS;
      const widths = isLogistics ? LOGISTICS_SCHEDULED_TRANSPORT_EXPORT_WIDTHS : SCHEDULED_TRANSPORT_EXPORT_WIDTHS;
      const exportRows = isLogistics
        ? consolidated.map(mapLogisticsScheduledTransportExportRow)
        : consolidated.map(mapScheduledTransportExportRow);
      worksheet.addTable({
        name: "TabelaMudancasEscala",
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
        columns: headers.map((name) => ({ name, filterButton: true })),
        rows: exportRows,
      });
      widths.forEach((width, index) => {
        worksheet.getColumn(index + 1).width = width;
      });
      worksheet.getRow(1).height = 26;
      worksheet.getRow(1).alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      for (let rowNumber = 2; rowNumber <= exportRows.length + 1; rowNumber += 1) {
        for (let column = 1; column <= headers.length; column += 1) {
          worksheet.getRow(rowNumber).getCell(column).alignment = {
            vertical: "top",
            wrapText: true,
          };
        }
      }
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer as BlobPart], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "mudancas-de-escala.xlsx";
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
    if (!confirm(`Cancelar ${ids.length} mudança(s) de escala?`)) return;
    try {
      const result = await cancelFn({ data: { ids } });
      if (!result.ok) return toast.error(result.error);
      if (result.count === 0)
        return toast.error("As mudanças de escala selecionadas já foram alteradas ou canceladas.");
      toast.success(result.count + " mudança(s) de escala cancelada(s).");
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ["scheduled-transport"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível cancelar as mudanças de escala.");
    }
  }

  async function cancelOne(row: ScheduledTransportRow) {
    if (!confirm(`Cancelar a mudança de escala de ${row.employee_name} em ${formatDate(row.transport_date)}?`)) return;
    try {
      const result = await cancelFn({ data: { ids: [row.id] } });
      if (!result.ok) return toast.error(result.error);
      if (result.count === 0) return toast.error("A mudança de escala já foi alterada ou cancelada.");
      toast.success("Mudança de escala cancelada.");
      queryClient.invalidateQueries({ queryKey: ["scheduled-transport"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível cancelar a mudança de escala.");
    }
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
    <main className="mx-auto w-full max-w-none overflow-x-hidden px-3 py-4 sm:px-6 sm:py-6">
      <PageHeader
        title={showDaysOff ? "Controle de Folgas" : "Mudança de Escala"}
        description={
          showDaysOff
            ? "Registro e acompanhamento manual das folgas concedidas aos colaboradores."
            : "Solicitação de mudança de escala de trabalho por dia ou período."
        }
        actions={
          !showDaysOff ? (
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={exportExcel} className="btn-primary min-h-9 text-[12px]">
                <Download className="h-4 w-4" /> Exportar para Excel
              </button>
              <button type="button" onClick={() => setNewOpen(true)} className="btn-primary min-h-9 text-[12px]">
                <Plus className="h-4 w-4" /> Nova Mudança de Escala
              </button>
            </div>
          ) : undefined
        }
      />

      <div className="mb-3 flex w-full max-w-full overflow-x-auto rounded-md border border-border bg-card p-1 text-[12px] sm:inline-flex sm:w-auto">
        <TabBtn active={!showDaysOff} onClick={() => setShowDaysOff(false)}>
          Mudança de Escala
        </TabBtn>
        <TabBtn active={showDaysOff} onClick={() => setShowDaysOff(true)}>
          Controle de Folgas
        </TabBtn>
      </div>

      {showDaysOff && (
        <div className="mt-4">
          <DaysOffControl
            employees={employees}
            employeesLoading={employeesQuery.isLoading}
            employeesError={employeesQuery.isError}
          />
        </div>
      )}

      {!showDaysOff && (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard label="Colaboradores programados" value={kpis.employees} icon={<Users className="h-4 w-4" />} />
            <KpiCard label="Com transporte" value={kpis.transport} icon={<Bus className="h-4 w-4" />} />
            <KpiCard label="Sem transporte" value={kpis.noTransport} icon={<Users className="h-4 w-4" />} />
            <KpiCard label="Colaboradores cancelados" value={kpis.cancelled} icon={<UserX className="h-4 w-4" />} />
          </div>

          <div className="mt-4">
            <Panel
              title="Mudanças de escala"
              description="A exportação respeita exatamente os filtros ativos."
              padded={false}
            >
              <div className="grid min-w-0 grid-cols-1 gap-2 border-b border-border p-3 sm:grid-cols-2 lg:grid-cols-4 [&>*]:min-w-0">
                <Field label="Pesquisa rápida">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <input
                      value={filters.search}
                      onChange={(event) => setFilters((f) => ({ ...f, search: event.target.value }))}
                      placeholder="Nome, chapa, ID ou função…"
                      className="input-base w-full pl-7 text-[16px] sm:text-[12px]"
                    />
                  </div>
                </Field>
                <Field label="Data inicial">
                  <select
                    value={filters.startDate}
                    onChange={(event) =>
                      setFilters((f) => ({
                        ...f,
                        startDate: event.target.value,
                        endDate: "",
                        entryTime: "",
                        departureTime: "",
                      }))
                    }
                    className="input-base block w-full min-w-0 max-w-full text-[16px] sm:text-[12px]"
                  >
                    <option value="">Todas</option>
                    {availableDates.map((date) => (
                      <option key={date} value={date}>
                        {formatDate(date)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Data final">
                  <select
                    value={filters.endDate}
                    onChange={(event) =>
                      setFilters((f) => ({
                        ...f,
                        endDate: event.target.value,
                        entryTime: "",
                        departureTime: "",
                      }))
                    }
                    className="input-base block w-full min-w-0 max-w-full text-[16px] sm:text-[12px]"
                  >
                    <option value="">Todas</option>
                    {availableEndDates.map((date) => (
                      <option key={date} value={date}>
                        {formatDate(date)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Função">
                  <select
                    value={filters.jobTitle}
                    onChange={(event) => setFilters((f) => ({ ...f, jobTitle: event.target.value }))}
                    className="input-base block w-full min-w-0 max-w-full text-[16px] sm:text-[12px]"
                  >
                    <option value="">Todas</option>
                    {jobTitles.map((title) => (
                      <option key={title} value={title}>
                        {title}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Status">
                  <select
                    value={filters.status}
                    onChange={(event) => setFilters((f) => ({ ...f, status: event.target.value as Filters["status"] }))}
                    className="input-base block w-full min-w-0 max-w-full text-[16px] sm:text-[12px]"
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
                      setFilters((f) => ({
                        ...f,
                        transport: event.target.value as Filters["transport"],
                      }))
                    }
                    className="input-base block w-full min-w-0 max-w-full text-[16px] sm:text-[12px]"
                  >
                    <option value="all">Todos</option>
                    <option value="yes">Sim</option>
                    <option value="no">Não</option>
                  </select>
                </Field>
                <div className="grid min-w-0 grid-cols-2 gap-2 [&>*]:min-w-0">
                  <Field label="Entrada">
                    <select
                      value={filters.entryTime}
                      onChange={(event) =>
                        setFilters((f) => ({
                          ...f,
                          entryTime: event.target.value,
                          departureTime: "",
                        }))
                      }
                      className="input-base block w-full min-w-0 max-w-full text-[16px] sm:text-[12px]"
                    >
                      <option value="">Todos</option>
                      {availableEntryTimes.map((time) => (
                        <option key={time} value={time}>
                          {time.replace(/^0/, "")}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Saída">
                    <select
                      value={filters.departureTime}
                      onChange={(event) => setFilters((f) => ({ ...f, departureTime: event.target.value }))}
                      className="input-base block w-full min-w-0 max-w-full text-[16px] sm:text-[12px]"
                    >
                      <option value="">Todos</option>
                      {availableDepartureTimes.map((time) => (
                        <option key={time} value={time}>
                          {time.replace(/^0/, "")}
                        </option>
                      ))}
                    </select>
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
                    <Trash2 className="h-4 w-4" /> Cancelar mudanças selecionadas ({selected.size})
                  </button>
                  <span className="ml-auto text-[11px] text-muted-foreground">
                    {totalRows} registro(s) encontrado(s)
                  </span>
                </div>
              </div>

              {query.isLoading ? (
                <div className="p-6 text-[12px] text-muted-foreground">Carregando mudanças de escala…</div>
              ) : query.isError ? (
                <div className="p-6 text-[12px] text-destructive">{(query.error as Error).message}</div>
              ) : totalRows === 0 ? (
                <div className="p-6">
                  <EmptyState icon={<Bus className="h-4 w-4" />} title="Nenhuma mudança de escala encontrada" />
                </div>
              ) : (
                <>
                  <div className="grid gap-3 p-3 md:hidden">
                    {paginatedRows.map((row) => (
                      <article
                        key={row.id}
                        className="rounded-lg border border-border bg-card p-3 text-[12px] shadow-sm"
                      >
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
                          Chapa {row.employee_registration || "—"} · {row.employee_role}
                        </div>
                        <div className="mt-2 flex gap-2">
                          {row.status === "scheduled" && (
                            <>
                              <button
                                type="button"
                                onClick={() => setEditing(row)}
                                className="btn-secondary min-h-8 text-[11px]"
                              >
                                <Pencil className="h-3.5 w-3.5" /> Editar
                              </button>
                              <button
                                type="button"
                                onClick={() => cancelOne(row)}
                                className="btn-secondary min-h-8 text-[11px]"
                              >
                                <Trash2 className="h-3.5 w-3.5" /> Cancelar
                              </button>
                            </>
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
                          <th className="px-2 py-2">Transporte</th>
                          <th className="px-2 py-2">Ordem</th>
                          <th className="px-2 py-2">Serviço</th>
                          <th className="px-2 py-2">Solicitante</th>
                          <th className="px-2 py-2">Status</th>
                          <th className="px-2 py-2">Ação</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paginatedRows.map((row) => (
                          <tr
                            key={row.id}
                            className={cn("border-t border-border", row.status === "cancelled" && "opacity-60")}
                          >
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
                            <td className="px-2 py-1.5">{row.needs_transport ? "Sim" : "Não"}</td>
                            <td className="px-2 py-1.5">{row.order_number || "—"}</td>
                            <td className="max-w-[280px] truncate px-2 py-1.5" title={row.service_description || ""}>
                              {row.service_description || "—"}
                            </td>
                            <td className="px-2 py-1.5">{row.requester_name || row.requester_email}</td>
                            <td className="px-2 py-1.5">{formatScheduledStatus(row.status)}</td>
                            <td className="whitespace-nowrap px-2 py-1.5">
                              {row.status === "scheduled" && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => setEditing(row)}
                                    className="rounded p-1 hover:bg-muted"
                                    title="Editar"
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    title="Cancelar"
                                    onClick={() => cancelOne(row)}
                                    className="rounded p-1 hover:bg-muted"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {totalRows > pageSize && (
                    <div className="flex flex-col gap-2 border-t border-border bg-muted/20 px-3 py-3 text-[12px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                      <span>
                        Página {currentPage} de {pageCount} · {totalRows} registro(s) · até {pageSize} por página
                      </span>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setPage((value) => Math.max(1, value - 1))}
                          disabled={currentPage === 1}
                          className="btn-secondary min-h-9 px-3 text-[12px] disabled:opacity-50"
                        >
                          Anterior
                        </button>
                        <button
                          type="button"
                          onClick={() => setPage((value) => Math.min(pageCount, value + 1))}
                          disabled={currentPage === pageCount}
                          className="btn-secondary min-h-9 px-3 text-[12px] disabled:opacity-50"
                        >
                          Próxima
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </Panel>
          </div>

          {newOpen && employeesQuery.isLoading && (
            <Modal title="Nova mudança de escala" onClose={() => setNewOpen(false)} footer={null}>
              <div className="py-8 text-center text-sm text-muted-foreground">Carregando colaboradores...</div>
            </Modal>
          )}

          {newOpen && employeesQuery.isError && (
            <Modal title="Nova mudança de escala" onClose={() => setNewOpen(false)} footer={null}>
              <div className="py-8 text-center text-sm text-destructive">
                Não foi possível carregar os colaboradores.
              </div>
            </Modal>
          )}

          {newOpen && employeesQuery.isSuccess && (
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
        </>
      )}
    </main>
  );
}

/* ---------- Nova programação ---------- */

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
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

function DaysOffControl({
  employees,
  employeesLoading,
  employeesError,
}: {
  employees: EmployeeRow[];
  employeesLoading: boolean;
  employeesError: boolean;
}) {
  const queryClient = useQueryClient();
  const load = useServerFn(listEmployeeDaysOff);
  const remove = useServerFn(deleteEmployeeDayOff);
  const [search, setSearch] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<EmployeeDayOffRow | null>(null);
  const rowsQuery = useQuery({
    queryKey: ["employee-days-off"],
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const result = await load({ data: {} });
      if (!result.ok) throw new Error(result.error);
      return result.rows as EmployeeDayOffRow[];
    },
  });
  const rows = useMemo(() => rowsQuery.data ?? [], [rowsQuery.data]);
  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("pt-BR");
    return rows.filter((row) => {
      if (startDate && row.day_off_date < startDate) return false;
      if (endDate && row.day_off_date > endDate) return false;
      if (
        term &&
        ![row.employee_name, row.employee_registration ?? "", row.employee_role ?? "", row.observation ?? ""].some(
          (value) => value.toLocaleLowerCase("pt-BR").includes(term),
        )
      ) {
        return false;
      }
      return true;
    });
  }, [rows, search, startDate, endDate]);
  const today = localIsoDate();
  const month = today.slice(0, 7);
  const cards = useMemo(
    () => ({
      collaborators: new Set(filtered.map((row) => row.employee_master_id)).size,
      month: filtered.filter((row) => row.day_off_date.startsWith(month)).length,
      today: filtered.filter((row) => row.day_off_date === today).length,
      upcoming: filtered.filter((row) => row.day_off_date > today).length,
    }),
    [filtered, month, today],
  );
  const pageSize = 30;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const paginated = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  useEffect(() => setPage(1), [search, startDate, endDate]);

  async function deleteRow(row: EmployeeDayOffRow) {
    if (!confirm(`Excluir a folga de ${row.employee_name} em ${formatDate(row.day_off_date)}?`)) return;
    const result = await remove({ data: { id: row.id, version: row.version } });
    if (!result.ok) return toast.error(result.error);
    toast.success("Folga excluída.");
    queryClient.invalidateQueries({ queryKey: ["employee-days-off"] });
  }

  async function exportDaysOff() {
    if (filtered.length === 0) {
      toast.error("Não há folgas para exportar com os filtros atuais.");
      return;
    }
    try {
      const ExcelJS = (await import("exceljs")).default;
      const workbook = new ExcelJS.Workbook();
      workbook.creator = "NEXO";
      workbook.created = new Date();
      const worksheet = workbook.addWorksheet("Controle de folgas", {
        views: [{ state: "frozen", ySplit: 1, showGridLines: false }],
        pageSetup: {
          orientation: "landscape",
          fitToPage: true,
          fitToWidth: 1,
          fitToHeight: 0,
          paperSize: 9,
        },
      });
      const headers = [
        "Matrícula",
        "Colaborador",
        "Função",
        "Data da folga",
        "Observação",
        "Responsável",
        "Registrado em",
      ];
      const widths = [14, 34, 28, 16, 48, 30, 20];
      const values = filtered.map((row) => [
        row.employee_registration ?? "",
        row.employee_name,
        row.employee_role ?? "",
        formatDate(row.day_off_date),
        row.observation ?? "",
        row.created_by_name || row.created_by_email,
        new Date(row.created_at).toLocaleString("pt-BR"),
      ]);
      worksheet.addTable({
        name: "TabelaControleFolgas",
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
        columns: headers.map((name) => ({ name, filterButton: true })),
        rows: values,
      });
      widths.forEach((width, index) => {
        worksheet.getColumn(index + 1).width = width;
      });
      worksheet.getRow(1).height = 26;
      worksheet.getRow(1).alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      for (let rowNumber = 2; rowNumber <= values.length + 1; rowNumber += 1) {
        for (let column = 1; column <= headers.length; column += 1) {
          worksheet.getRow(rowNumber).getCell(column).alignment = {
            vertical: "top",
            wrapText: true,
          };
        }
      }
      worksheet.pageSetup.printArea = `A1:G${values.length + 1}`;
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer as BlobPart], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "controle-de-folgas.xlsx";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast.success(filtered.length + " folga(s) exportada(s).");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível gerar a planilha.");
    }
  }

  return (
    <>
      <Panel
        title="Controle de folgas"
        description="Registro manual das folgas concedidas aos colaboradores."
        padded={false}
      >
        <div className="flex flex-col gap-3 border-b border-border p-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 sm:grid-cols-3">
            <Field label="Buscar colaborador">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Nome, matrícula ou função…"
                  className="input-base w-full pl-7 text-[16px] sm:text-[12px]"
                />
              </div>
            </Field>
            <Field label="Data inicial">
              <input
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
                className="input-base text-[16px] sm:text-[12px]"
              />
            </Field>
            <Field label="Data final">
              <input
                type="date"
                value={endDate}
                min={startDate || undefined}
                onChange={(event) => setEndDate(event.target.value)}
                className="input-base text-[16px] sm:text-[12px]"
              />
            </Field>
          </div>
          <div className="flex flex-wrap gap-2">
            {(search || startDate || endDate) && (
              <button
                type="button"
                onClick={() => {
                  setSearch("");
                  setStartDate("");
                  setEndDate("");
                }}
                className="btn-secondary min-h-9 text-[12px]"
              >
                Limpar filtros
              </button>
            )}
            <button type="button" onClick={exportDaysOff} className="btn-secondary min-h-9 text-[12px]">
              <Download className="h-4 w-4" /> Exportar
            </button>
            <button type="button" onClick={() => setCreating(true)} className="btn-primary min-h-9 text-[12px]">
              <Plus className="h-4 w-4" /> Registrar folga
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 p-3 lg:grid-cols-4">
          <KpiCard
            label="Colaboradores que folgaram"
            value={cards.collaborators}
            icon={<Users className="h-4 w-4" />}
          />
          <KpiCard label="Folgas no mês" value={cards.month} icon={<CalendarDays className="h-4 w-4" />} />
          <KpiCard label="Folgas hoje" value={cards.today} icon={<CalendarDays className="h-4 w-4" />} />
          <KpiCard label="Próximas folgas" value={cards.upcoming} icon={<CalendarDays className="h-4 w-4" />} />
        </div>

        {rowsQuery.isLoading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Carregando folgas...</div>
        ) : rowsQuery.isError ? (
          <div className="p-8 text-center text-sm text-destructive">Não foi possível carregar as folgas.</div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<CalendarDays className="h-5 w-5" />}
            title="Nenhuma folga encontrada"
            description="Registre uma folga ou ajuste os filtros."
          />
        ) : (
          <>
            <div className="space-y-2 p-3 md:hidden">
              {paginated.map((row) => (
                <article key={row.id} className="rounded-lg border border-border bg-card p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold text-foreground">{row.employee_name}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {row.employee_registration || "Sem matrícula"} · {row.employee_role || "Sem função"}
                      </div>
                    </div>
                    <div className="font-mono text-[12px] font-semibold text-primary">
                      {formatDate(row.day_off_date)}
                    </div>
                  </div>
                  {row.observation && <p className="mt-2 text-[12px] text-muted-foreground">{row.observation}</p>}
                  <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-2">
                    <span className="text-[10px] text-muted-foreground">
                      Lançado por {row.created_by_name || row.created_by_email}
                    </span>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => setEditing(row)}
                        className="btn-ghost min-h-8 px-2 text-[11px]"
                      >
                        <Pencil className="h-3.5 w-3.5" /> Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteRow(row)}
                        className="btn-ghost min-h-8 px-2 text-[11px] text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Excluir
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[1080px] text-[12px]">
                <thead className="bg-muted/50 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-2 py-2">Data da folga</th>
                    <th className="px-2 py-2">Matrícula</th>
                    <th className="px-2 py-2">Colaborador</th>
                    <th className="px-2 py-2">Função</th>
                    <th className="px-2 py-2">Observação</th>
                    <th className="px-2 py-2">Responsável pelo lançamento</th>
                    <th className="px-2 py-2">Registrado em</th>
                    <th className="px-2 py-2 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {paginated.map((row) => (
                    <tr key={row.id} className="border-t border-border">
                      <td className="whitespace-nowrap px-2 py-1.5 font-medium">{formatDate(row.day_off_date)}</td>
                      <td className="whitespace-nowrap px-2 py-1.5">{row.employee_registration || "—"}</td>
                      <td className="px-2 py-1.5">{row.employee_name}</td>
                      <td className="px-2 py-1.5">{row.employee_role || "—"}</td>
                      <td className="max-w-[280px] truncate px-2 py-1.5" title={row.observation || ""}>
                        {row.observation || "—"}
                      </td>
                      <td className="px-2 py-1.5">{row.created_by_name || row.created_by_email}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-muted-foreground">
                        {new Date(row.created_at).toLocaleString("pt-BR")}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right">
                        <button
                          type="button"
                          onClick={() => setEditing(row)}
                          className="rounded p-1 hover:bg-muted"
                          title="Editar"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteRow(row)}
                          className="rounded p-1 text-destructive hover:bg-muted"
                          title="Excluir"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filtered.length > pageSize && (
              <div className="flex flex-col gap-2 border-t border-border bg-muted/20 px-3 py-3 text-[12px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                <span>
                  Página {currentPage} de {pageCount} · {filtered.length} registro(s)
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setPage((value) => Math.max(1, value - 1))}
                    disabled={currentPage === 1}
                    className="btn-secondary min-h-9 px-3 text-[12px] disabled:opacity-50"
                  >
                    Anterior
                  </button>
                  <button
                    type="button"
                    onClick={() => setPage((value) => Math.min(pageCount, value + 1))}
                    disabled={currentPage === pageCount}
                    className="btn-secondary min-h-9 px-3 text-[12px] disabled:opacity-50"
                  >
                    Próxima
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </Panel>

      {(creating || editing) && (
        <DayOffFormModal
          employees={employees}
          employeesLoading={employeesLoading}
          employeesError={employeesError}
          row={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            queryClient.invalidateQueries({ queryKey: ["employee-days-off"] });
          }}
        />
      )}
    </>
  );
}

function DayOffFormModal({
  employees,
  employeesLoading,
  employeesError,
  row,
  onClose,
  onSaved,
}: {
  employees: EmployeeRow[];
  employeesLoading: boolean;
  employeesError: boolean;
  row: EmployeeDayOffRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const create = useServerFn(createEmployeeDayOff);
  const update = useServerFn(updateEmployeeDayOff);
  const [employeeIds, setEmployeeIds] = useState<Set<string>>(() => new Set(row ? [row.employee_master_id] : []));
  const [employeeSearch, setEmployeeSearch] = useState(row?.employee_name ?? "");
  const [dayOffDate, setDayOffDate] = useState(row?.day_off_date ?? localIsoDate());
  const [observation, setObservation] = useState(row?.observation ?? "");
  const [saving, setSaving] = useState(false);
  const visibleEmployees = useMemo(
    () => filterEmployees(employees, employeeSearch).slice(0, 100),
    [employees, employeeSearch],
  );
  const selectedEmployees = useMemo(
    () => employees.filter((employee) => employeeIds.has(employee.id)),
    [employees, employeeIds],
  );

  function toggleEmployee(employee: EmployeeRow) {
    if (row) {
      setEmployeeIds(new Set([employee.id]));
      setEmployeeSearch(employee.full_name);
      return;
    }
    setEmployeeIds((previous) => {
      const next = new Set(previous);
      if (next.has(employee.id)) next.delete(employee.id);
      else next.add(employee.id);
      return next;
    });
  }

  async function save() {
    if (employeeIds.size === 0) return toast.error("Selecione pelo menos um colaborador.");
    if (!dayOffDate) return toast.error("Informe a data da folga.");
    setSaving(true);
    try {
      const observationValue = observation.trim() || null;
      if (row) {
        const employeeId = [...employeeIds][0];
        const result = await update({
          data: {
            employee_id: employeeId,
            day_off_date: dayOffDate,
            observation: observationValue,
            id: row.id,
            version: row.version,
          },
        });
        if (!result.ok) return toast.error(result.error);
        toast.success("Folga atualizada.");
        onSaved();
        return;
      }

      let createdCount = 0;
      const errors: string[] = [];
      for (const employeeId of employeeIds) {
        const result = await create({
          data: {
            employee_id: employeeId,
            day_off_date: dayOffDate,
            observation: observationValue,
          },
        });
        if (result.ok) createdCount += 1;
        else errors.push(result.error);
      }

      if (createdCount === 0) {
        return toast.error(errors[0] || "Não foi possível registrar as folgas.");
      }
      toast.success(
        `${createdCount} folga(s) registrada(s)${errors.length ? ` · ${errors.length} não incluída(s)` : ""}.`,
      );
      if (errors.length) {
        toast.warning("Alguns colaboradores já possuíam folga nessa data ou não puderam ser incluídos.");
      }
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar a folga.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={row ? "Editar folga" : "Registrar folgas"} onClose={onClose}>
      <div className="space-y-4">
        <Field
          label={row ? "Buscar colaborador" : "Buscar e selecionar colaboradores"}
          hint={row ? undefined : "Você pode selecionar vários colaboradores antes de registrar."}
        >
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={employeeSearch}
              onChange={(event) => {
                setEmployeeSearch(event.target.value);
                if (row && event.target.value !== row.employee_name) setEmployeeIds(new Set());
              }}
              placeholder="Digite nome, matrícula ou função…"
              className="input-base w-full pl-7 text-[16px] sm:text-[12px]"
              autoComplete="off"
            />
          </div>
        </Field>

        {!row && (
          <div className="flex min-h-9 items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2">
            <span className="text-[12px] font-medium text-foreground">
              {employeeIds.size} colaborador(es) selecionado(s)
            </span>
            {employeeIds.size > 0 && (
              <button
                type="button"
                onClick={() => setEmployeeIds(new Set())}
                className="text-[11px] font-semibold text-primary hover:underline"
              >
                Limpar seleção
              </button>
            )}
          </div>
        )}

        {!row && selectedEmployees.length > 0 && (
          <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto rounded-lg border border-border p-2">
            {selectedEmployees.map((employee) => (
              <button
                key={employee.id}
                type="button"
                onClick={() => toggleEmployee(employee)}
                className="rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary hover:bg-primary/20"
                title="Clique para remover"
              >
                {employee.full_name} ×
              </button>
            ))}
          </div>
        )}

        <div className="max-h-48 overflow-y-auto rounded-lg border border-border">
          {employeesLoading ? (
            <div className="p-4 text-center text-[12px] text-muted-foreground">Carregando colaboradores...</div>
          ) : employeesError ? (
            <div className="p-4 text-center text-[12px] text-destructive">
              Não foi possível carregar os colaboradores.
            </div>
          ) : visibleEmployees.length === 0 ? (
            <div className="p-4 text-center text-[12px] text-muted-foreground">Nenhum colaborador encontrado.</div>
          ) : (
            visibleEmployees.map((employee) => {
              const selected = employeeIds.has(employee.id);
              return (
                <button
                  key={employee.id}
                  type="button"
                  onClick={() => toggleEmployee(employee)}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 border-b border-border px-3 py-2 text-left last:border-b-0 hover:bg-muted",
                    selected && "bg-primary/10",
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[12px] font-medium">{employee.full_name}</span>
                    <span className="block truncate text-[10px] text-muted-foreground">
                      {employee.badge} · {employee.job_title}
                    </span>
                  </span>
                  {selected && <span className="text-[11px] font-semibold text-primary">Selecionado</span>}
                </button>
              );
            })
          )}
        </div>
        <Field label="Data da folga">
          <input
            type="date"
            value={dayOffDate}
            onChange={(event) => setDayOffDate(event.target.value)}
            className="input-base w-full text-[16px] sm:text-[12px]"
          />
        </Field>
        <Field label="Observação (opcional)">
          <textarea
            value={observation}
            onChange={(event) => setObservation(event.target.value)}
            maxLength={1000}
            rows={4}
            className="input-base w-full resize-y text-[16px] sm:text-[12px]"
            placeholder="Informações complementares sobre a folga…"
          />
        </Field>
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <button type="button" onClick={onClose} className="btn-secondary" disabled={saving}>
            Cancelar
          </button>
          <button
            type="button"
            onClick={save}
            className="btn-primary"
            disabled={saving || employeeIds.size === 0 || !dayOffDate}
          >
            {saving ? "Salvando..." : row ? "Salvar alterações" : `Registrar ${employeeIds.size} folga(s)`}
          </button>
        </div>
      </div>
    </Modal>
  );
}

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
  const todayIso = localIsoDate();
  const [startDate, setStartDate] = useState(todayIso);
  const [endDate, setEndDate] = useState("");
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [entryTime, setEntryTime] = useState("");
  const [departureTime, setDepartureTime] = useState("");
  const [transportIds, setTransportIds] = useState<Set<string>>(new Set());
  const [orderNumber, setOrderNumber] = useState("");
  const [service, setService] = useState("");
  const [observation, setObservation] = useState("");
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);

  const visible = useMemo(() => filterEmployees(employees, search).slice(0, 200), [employees, search]);
  const effectiveEndDate = endDate || startDate;
  const dates = useMemo(
    () =>
      startDate && effectiveEndDate && startDate <= effectiveEndDate
        ? datesInRange(startDate, effectiveEndDate, weekdays)
        : [],
    [startDate, effectiveEndDate, weekdays],
  );

  const selectedEmployees = useMemo(() => employees.filter((employee) => ids.has(employee.id)), [employees, ids]);
  const transportCount = useMemo(
    () => selectedEmployees.filter((employee) => transportIds.has(employee.id)).length,
    [selectedEmployees, transportIds],
  );

  function toggleEmployee(id: string) {
    setIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setTransportIds((previous) => {
      if (!previous.has(id)) return previous;
      const next = new Set(previous);
      next.delete(id);
      return next;
    });
  }

  function toggleTransport(id: string) {
    setTransportIds((previous) => {
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
          end_date: effectiveEndDate,
          weekdays,
          entry_time: entryTime,
          departure_time: departureTime,
          needs_snack: false,
          needs_transport: transportIds.size > 0,
          transport_employee_ids: [...ids].filter((id) => transportIds.has(id)),
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
        `${result.count} registro(s) criado(s)` +
          (result.skipped ? ` · ${result.skipped} duplicado(s) ignorado(s)` : ""),
      );
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao salvar a mudança de escala.");
    } finally {
      setSaving(false);
    }
  }

  const canPreview = ids.size > 0 && dates.length > 0 && entryTime && departureTime;

  return (
    <Modal title="Nova Mudança de Escala" onClose={onClose} size="lg">
      {!preview ? (
        <div className="space-y-4">
          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 [&>*]:min-w-0">
            <DateSelectField label="Data inicial" value={startDate} onChange={setStartDate} />
            <Field label="Data final (opcional)" hint="Deixe em branco para programar somente a data inicial.">
              <input
                type="date"
                value={endDate}
                min={startDate}
                onChange={(event) => setEndDate(event.target.value)}
                className="input-base block w-full min-w-0 max-w-full text-[16px] sm:text-[12px]"
              />
            </Field>
            <TimeSelectField
              label="Horário de entrada"
              value={entryTime}
              onChange={setEntryTime}
              options={ENTRY_TIME_OPTIONS}
              required
            />
            <TimeSelectField
              label="Horário de saída"
              value={departureTime}
              onChange={setDepartureTime}
              options={DEPARTURE_TIME_OPTIONS}
              required
              hint="Pode ser no dia seguinte."
            />
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

          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 [&>*]:min-w-0">
            <Field label="Ordem (opcional)">
              <input
                value={orderNumber}
                onChange={(event) => setOrderNumber(event.target.value)}
                className="input-base block w-full min-w-0 max-w-full text-[16px] sm:text-[12px]"
              />
            </Field>
            <Field label="Serviço/atividade (opcional)">
              <input
                value={service}
                onChange={(event) => setService(event.target.value)}
                className="input-base block w-full min-w-0 max-w-full text-[16px] sm:text-[12px]"
              />
            </Field>
            <Field label="Observação (opcional)">
              <textarea
                value={observation}
                onChange={(event) => setObservation(event.target.value)}
                rows={2}
                className="input-base block w-full min-w-0 max-w-full text-[16px] sm:text-[12px]"
              />
            </Field>
          </div>

          <Field
            label={`Colaboradores (${ids.size} selecionado(s))`}
            hint="Marque “Transporte” individualmente para quem precisa de condução."
          >
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
                    className="flex cursor-pointer items-start gap-2 border-b border-border px-2 py-2 text-[12px] last:border-b-0 hover:bg-muted/50"
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                      checked={ids.has(employee.id)}
                      onChange={() => toggleEmployee(employee.id)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{employee.full_name}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        Chapa {employee.badge || "—"} · ID {employee.employee_id || "—"} · {employee.job_title}
                      </span>
                    </span>
                  </label>
                ))
              )}
            </div>

            {selectedEmployees.length > 0 && (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {selectedEmployees.map((employee) => (
                  <div
                    key={employee.id}
                    className="flex min-w-0 items-start justify-between gap-2 rounded border border-primary/20 bg-primary/5 p-2 text-[12px]"
                  >
                    <span className="min-w-0">
                      <b className="block truncate">{employee.full_name}</b>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {employee.badge || "—"} · {employee.job_title}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-primary"
                          checked={transportIds.has(employee.id)}
                          onChange={() => toggleTransport(employee.id)}
                        />
                        Transporte
                      </label>
                      <button
                        type="button"
                        onClick={() => toggleEmployee(employee.id)}
                        className="text-[11px] text-muted-foreground hover:text-destructive"
                      >
                        Remover
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            )}
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
              <strong>{endDate ? "Período" : "Data"}:</strong> {formatDate(startDate)}
              {endDate ? ` a ${formatDate(effectiveEndDate)}` : ""}
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
              <strong>Entrada:</strong> {entryTime} · <strong>Saída:</strong> {departureTime}
            </div>
            <div>
              <strong>Com transporte:</strong> {transportCount} de {ids.size} colaborador(es)
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
              {saving ? "Salvando…" : "Confirmar Mudança de Escala"}
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
          needs_snack: row.needs_snack,
          needs_transport: needsTransport,
          order_number: orderNumber || null,
          service_description: service || null,
          observation: observation || null,
          version: row.version,
        },
      });
      if (!result.ok) return toast.error(result.error);
      toast.success(
        result.count +
          " registro(s) atualizado(s)." +
          (result.conflicts ? ` ${result.conflicts} conflito(s) foram preservados e não sobrescritos.` : ""),
      );
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Editar mudança de escala · ${row.employee_name}`} onClose={onClose}>
      <div className="space-y-3">
        <div className="text-[12px] text-muted-foreground">Data: {formatDate(row.transport_date)}</div>
        {row.batch_id && (
          <Field label="Abrangência">
            <select
              value={scope}
              onChange={(event) => setScope(event.target.value as "single" | "future")}
              className="input-base block w-full min-w-0 max-w-full text-[16px] sm:text-[12px]"
            >
              <option value="single">Editar somente este registro</option>
              <option value="future">Editar registros futuros deste grupo</option>
            </select>
          </Field>
        )}
        <div className="grid min-w-0 grid-cols-2 gap-3 [&>*]:min-w-0">
          <TimeSelectField
            label="Entrada"
            value={entryTime}
            onChange={setEntryTime}
            options={ENTRY_TIME_OPTIONS}
            required
          />
          <TimeSelectField
            label="Saída"
            value={departureTime}
            onChange={setDepartureTime}
            options={DEPARTURE_TIME_OPTIONS}
            required
          />
          <Field label="Transporte">
            <select
              value={needsTransport ? "yes" : "no"}
              onChange={(event) => setNeedsTransport(event.target.value === "yes")}
              className="input-base block w-full min-w-0 max-w-full text-[16px] sm:text-[12px]"
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
            className="input-base block w-full min-w-0 max-w-full text-[16px] sm:text-[12px]"
          />
        </Field>
        <Field label="Serviço">
          <input
            value={service}
            onChange={(event) => setService(event.target.value)}
            className="input-base block w-full min-w-0 max-w-full text-[16px] sm:text-[12px]"
          />
        </Field>
        <Field label="Observação">
          <textarea
            value={observation}
            onChange={(event) => setObservation(event.target.value)}
            rows={2}
            className="input-base block w-full min-w-0 max-w-full text-[16px] sm:text-[12px]"
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

/* ---------- Campo de horário (select + outro) ---------- */
const ENTRY_TIME_OPTIONS = ["07:30", "17:30", "18:30", "06:00", "06:30"] as const;
const DEPARTURE_TIME_OPTIONS = ["17:18", "03:18", "04:18", "05:00", "07:00"] as const;

function TimeSelectField({
  label,
  value,
  onChange,
  options,
  required,
  hint,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  options: readonly string[];
  required?: boolean;
  hint?: string;
}) {
  const [custom, setCustom] = useState(value ? !options.includes(value) : false);

  return (
    <Field label={label} required={required} hint={hint}>
      <select
        value={custom ? "__other__" : value}
        onChange={(event) => {
          const isOther = event.target.value === "__other__";
          setCustom(isOther);
          onChange(isOther ? "" : event.target.value);
        }}
        className="input-base block w-full min-w-0 max-w-full text-[16px] sm:text-[12px]"
        style={{ boxSizing: "border-box" }}
      >
        <option value="">{required ? "Selecione" : "Sem horário"}</option>
        {options.map((time) => (
          <option key={time} value={time}>
            {time.replace(/^0/, "")}
          </option>
        ))}
        <option value="__other__">Outro horário</option>
      </select>
      {custom && (
        <input
          type="time"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="input-base mt-2 block w-full min-w-0 max-w-full text-[16px] sm:text-[12px]"
          style={{ boxSizing: "border-box" }}
        />
      )}
    </Field>
  );
}

/* ---------- Campo de data (dia / mês / ano) ---------- */
const MONTH_OPTIONS: [string, string][] = [
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

function DateSelectField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
}) {
  const today = new Date();
  const fallback = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const [year, month, day] = (value || fallback).split("-");
  const years = Array.from({ length: 4 }, (_, index) => String(today.getFullYear() - 1 + index));
  const days = Array.from({ length: new Date(Number(year), Number(month), 0).getDate() }, (_, index) =>
    String(index + 1).padStart(2, "0"),
  );

  function setPart(part: "day" | "month" | "year", next: string) {
    let y = year;
    let m = month;
    let d = day;
    if (part === "year") y = next;
    if (part === "month") m = next;
    if (part === "day") d = next;
    const lastDay = new Date(Number(y), Number(m), 0).getDate();
    d = String(Math.min(Number(d), lastDay)).padStart(2, "0");
    onChange(`${y}-${m}-${d}`);
  }

  const selectClass = "input-base block w-full min-w-0 max-w-full text-[16px] sm:text-[12px]";

  return (
    <Field label={label} required>
      <div className="grid min-w-0 max-w-full grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)_minmax(0,1fr)] gap-2">
        <select
          aria-label={`Dia — ${label}`}
          className={selectClass}
          value={day}
          onChange={(e) => setPart("day", e.target.value)}
        >
          {days.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <select
          aria-label={`Mês — ${label}`}
          className={selectClass}
          value={month}
          onChange={(e) => setPart("month", e.target.value)}
        >
          {MONTH_OPTIONS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <select
          aria-label={`Ano — ${label}`}
          className={selectClass}
          value={year}
          onChange={(e) => setPart("year", e.target.value)}
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>
    </Field>
  );
}
