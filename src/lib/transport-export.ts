/**
 * Helpers compartilhados de exportação de transporte.
 * Hora Extra continua usando TRANSPORT_EXPORT_HEADERS de overtime.functions.ts (comportamento inalterado).
 * Transporte Programado usa as constantes abaixo, com consolidação por período.
 */
import { formatDate } from "@/lib/overtime.functions";

export type ScheduledTransportRow = {
  id: string;
  batch_id: string | null;
  requester_user_id: string | null;
  requester_name: string;
  requester_email: string;
  employee_master_id: string;
  employee_external_id: string | null;
  employee_registration: string | null;
  employee_name: string;
  employee_role: string;
  employee_address: string | null;
  employee_neighborhood: string | null;
  employee_city: string | null;
  employee_phone: string | null;
  employee_message_contact: string | null;
  employee_transport_line: string | null;
  transport_date: string;
  entry_time: string;
  departure_time: string;
  needs_snack: boolean;
  needs_transport: boolean;
  order_number: string | null;
  service_description: string | null;
  observation: string | null;
  status: "scheduled" | "cancelled";
  cancelled_by_name: string | null;
  cancelled_at: string | null;
  updated_by_name: string | null;
  version: number;
  created_at: string;
  updated_at: string;
};

export type ScheduledTransportBatch = {
  id: string;
  start_date: string;
  end_date: string;
  weekdays: number[];
  created_by_name: string;
  created_at: string;
};

export const SCHEDULED_TRANSPORT_EXPORT_HEADERS = [
  "Data Inicial",
  "Data Final",
  "Chapa",
  "ID",
  "Nome",
  "Função",
  "Endereço completo",
  "Telefone",
  "Contato (recado)",
  "Linha",
  "Horário de entrada",
  "Horário de saída",
  "Ordem",
  "Serviço",
  "Solicitante",
  "Precisa de transporte",
  "Status",
] as const;

export const SCHEDULED_TRANSPORT_EXPORT_WIDTHS = [
  12, 12, 14, 14, 32, 24, 50, 20, 24, 16, 18, 18, 16, 48, 28, 20, 16,
] as const;

export const LOGISTICS_SCHEDULED_TRANSPORT_EXPORT_HEADERS = [
  "Data Inicial",
  "Data Final",
  "Chapa",
  "Nome",
  "Função",
  "Endereço completo",
  "Telefone",
  "Contato (recado)",
  "Horário de entrada",
  "Horário de saída",
] as const;

export const LOGISTICS_SCHEDULED_TRANSPORT_EXPORT_WIDTHS = [12, 12, 14, 32, 24, 50, 20, 24, 18, 18] as const;

export function formatScheduledStatus(status: ScheduledTransportRow["status"]) {
  return status === "cancelled" ? "Cancelado" : "Programado";
}

export function fullAddress(row: ScheduledTransportRow) {
  return [row.employee_address, row.employee_neighborhood, row.employee_city].filter(Boolean).join(" - ");
}

function dayNumber(iso: string) {
  return Math.floor(Date.parse(iso.slice(0, 10) + "T00:00:00Z") / 86400000);
}

function isoFromDayNumber(day: number) {
  return new Date(day * 86400000).toISOString().slice(0, 10);
}

export function weekdayOf(iso: string) {
  // 0 = domingo … 6 = sábado
  return new Date(iso.slice(0, 10) + "T00:00:00Z").getUTCDay();
}

export const WEEKDAY_LABELS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
export const WEEKDAY_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export function datesInRange(startIso: string, endIso: string, weekdays: number[]) {
  const out: string[] = [];
  const start = dayNumber(startIso);
  const end = dayNumber(endIso);
  for (let day = start; day <= end; day += 1) {
    const iso = isoFromDayNumber(day);
    if (weekdays.length === 0 || weekdays.includes(weekdayOf(iso))) out.push(iso);
  }
  return out;
}

export type ConsolidatedTransportGroup = {
  key: string;
  startDate: string;
  endDate: string;
  rows: ScheduledTransportRow[];
  sample: ScheduledTransportRow;
};

function groupKey(row: ScheduledTransportRow) {
  return [
    row.employee_master_id,
    row.entry_time,
    row.departure_time,
    row.needs_transport ? "1" : "0",
    row.needs_snack ? "1" : "0",
    row.order_number ?? "",
    row.service_description ?? "",
    row.status,
    row.batch_id ?? "",
  ].join("|");
}

/**
 * Consolida registros diários em períodos contínuos.
 * Dias não selecionados no lote original (ex.: sábado/domingo) não quebram o período.
 * Interrupções reais (dia cancelado/removido) geram períodos separados.
 */
export function consolidateScheduledTransport(
  rows: ScheduledTransportRow[],
  batches: Map<string, ScheduledTransportBatch>,
): ConsolidatedTransportGroup[] {
  const groups = new Map<string, ScheduledTransportRow[]>();
  for (const row of rows) {
    const key = groupKey(row);
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }

  const result: ConsolidatedTransportGroup[] = [];
  for (const [key, list] of groups) {
    const sorted = [...list].sort((a, b) => a.transport_date.localeCompare(b.transport_date));
    const batch = sorted[0].batch_id ? batches.get(sorted[0].batch_id) : undefined;
    const expectedWeekdays = batch?.weekdays?.length ? batch.weekdays : null;

    let run: ScheduledTransportRow[] = [sorted[0]];
    const flush = () => {
      result.push({
        key: key + "#" + run[0].transport_date,
        startDate: run[0].transport_date,
        endDate: run[run.length - 1].transport_date,
        rows: run,
        sample: run[0],
      });
    };
    for (let index = 1; index < sorted.length; index += 1) {
      const previous = sorted[index - 1];
      const current = sorted[index];
      let broken = false;
      for (let day = dayNumber(previous.transport_date) + 1; day < dayNumber(current.transport_date); day += 1) {
        const iso = isoFromDayNumber(day);
        // dia intermediário faltando: só quebra se ele fazia parte da programação original
        if (!expectedWeekdays || expectedWeekdays.includes(weekdayOf(iso))) {
          broken = true;
          break;
        }
      }
      if (broken) {
        flush();
        run = [current];
      } else {
        run.push(current);
      }
    }
    flush();
  }

  return result.sort(
    (a, b) => a.startDate.localeCompare(b.startDate) || a.sample.employee_name.localeCompare(b.sample.employee_name),
  );
}

export function mapScheduledTransportExportRow(group: ConsolidatedTransportGroup) {
  const row = group.sample;
  return [
    formatDate(group.startDate),
    formatDate(group.endDate),
    row.employee_registration || "",
    row.employee_external_id || "",
    row.employee_name,
    row.employee_role,
    fullAddress(row),
    row.employee_phone || "",
    row.employee_message_contact || "",
    row.employee_transport_line || "",
    row.entry_time,
    row.departure_time,
    row.order_number || "",
    row.service_description || "",
    row.requester_name || row.requester_email,
    row.needs_transport ? "Sim" : "Não",
    formatScheduledStatus(row.status),
  ];
}

export function mapLogisticsScheduledTransportExportRow(group: ConsolidatedTransportGroup) {
  const row = group.sample;
  return [
    formatDate(group.startDate),
    formatDate(group.endDate),
    row.employee_registration || "",
    row.employee_name,
    row.employee_role,
    fullAddress(row),
    row.employee_phone || "",
    row.employee_message_contact || "",
    row.entry_time,
    row.departure_time,
  ];
}
