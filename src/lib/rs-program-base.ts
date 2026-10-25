import { availabilityKey } from "./weekly-availability.ts";
import { parseServiceHours } from "./weekly-realization.ts";

export const RS_PROGRAM_SHEET = "Programação SAP";
export const RS_PROGRAM_COLUMNS = [
  "Sala",
  "Nota",
  "Confirmação",
  "Ordem",
  "Operação",
  "Suboperação",
  "1ª data início",
  "1ª hora início",
  "1ª data fim",
  "1ª hora fim",
  "Grupo planej.",
  "Área operacion.",
  "CenTrabOperação",
  "TxtDesc.Oper.",
  "Localização",
  "Número",
  "Duração normal",
  "Trabalho",
  "Trabalho real",
  "Cód.plan.ordem",
  "Pto.descarga",
  "StatUsuárOper.",
] as const;
export type RsProgramRow = {
  confirmation: string;
  order_number: string;
  operation: string;
  suboperation: string;
  center: string;
  work: number;
  source_row_number: number;
  source_data: Record<string, string | number | boolean | null>;
};
export type RsProgramBasis = {
  kind: "official" | "operational";
  version?: number;
  source_file_name?: string;
  sheet_name?: string;
  row_count?: number;
  total_work?: number;
  updated_at?: string;
  updated_by_name?: string;
};
export const rsProgramCenter = (value: string) =>
  availabilityKey(value) === "FUNILEIR0293" ? "FUNILEIR" : availabilityKey(value);
export const rsProgramId = (value: unknown) =>
  String(value ?? "")
    .trim()
    .replace(/[,.]0+$/, "")
    .replace(/^0+(?=\d)/, "");

/** Dates are retained as source evidence, never used to assign or prorate weekly HH. */
export function parseRsProgramGrid(grid: unknown[][]): RsProgramRow[] {
  if (!grid.length) throw new Error("A aba Programação SAP está vazia.");
  const headers = grid[0].map((value) => String(value ?? "").trim());
  const required = ["Confirmação", "Ordem", "Operação", "CenTrabOperação", "Trabalho"];
  const indexes = new Map(headers.map((header, index) => [availabilityKey(header), index]));
  for (const label of required) {
    if (!indexes.has(availabilityKey(label)))
      throw new Error(`Programação SAP: coluna ${label} não encontrada.`);
    if (headers.filter((header) => availabilityKey(header) === availabilityKey(label)).length !== 1)
      throw new Error(`Programação SAP: coluna ${label} duplicada.`);
  }
  const confirmations = new Set<string>();
  const rows: RsProgramRow[] = [];
  for (let i = 1; i < grid.length; i++) {
    const row = grid[i];
    if (!row.some((value) => value !== null && value !== undefined && String(value).trim() !== ""))
      continue;
    const read = (label: string) => row[indexes.get(availabilityKey(label)) ?? -1];
    const confirmation = rsProgramId(read("Confirmação")),
      order_number = rsProgramId(read("Ordem")),
      operation = rsProgramId(read("Operação"));
    const center = rsProgramCenter(String(read("CenTrabOperação") ?? ""));
    const raw = read("Trabalho"),
      work = typeof raw === "number" ? raw : parseServiceHours(String(raw ?? ""));
    if (
      ![confirmation, order_number, operation].every((value) => /^\d+$/.test(value)) ||
      !center ||
      center.length > 160 ||
      work === null ||
      !Number.isFinite(work) ||
      work < 0 ||
      work >= 1e9
    )
      throw new Error(
        `Programação SAP, linha ${i + 1}: confira confirmação, ordem, operação, centro e Trabalho. HH em branco não é zero.`,
      );
    if (confirmations.has(confirmation))
      throw new Error(
        `Programação SAP, linha ${i + 1}: confirmação ${confirmation} duplicada. Envie uma linha com o HH completo por confirmação.`,
      );
    confirmations.add(confirmation);
    const source_data = Object.fromEntries(
      headers.map((header, index) => [
        header || `col_${index}`,
        row[index] === null || row[index] === undefined
          ? null
          : typeof row[index] === "number" || typeof row[index] === "boolean"
            ? (row[index] as number | boolean)
            : String(row[index]),
      ]),
    );
    rows.push({
      confirmation,
      order_number,
      operation,
      suboperation: rsProgramId(read("Suboperação")),
      center,
      work,
      source_row_number: i + 1,
      source_data,
    });
  }
  if (!rows.length || rows.length > 5000)
    throw new Error("Programação SAP: informe entre 1 e 5.000 confirmações.");
  return rows;
}

export function chooseOperationalSheet(names: string[]) {
  const named = names.find((name) => availabilityKey(name) === "ACOMPANHAMENTO");
  if (named) return named;
  const candidates = names.filter(
    (name) =>
      ![availabilityKey(RS_PROGRAM_SHEET), "DADOS", "DISPONIBILIDADE", "OCUPACAO"].includes(
        availabilityKey(name),
      ),
  );
  if (candidates.length !== 1)
    throw new Error(
      "Identifique a aba operacional como Acompanhamento. A aba Programação SAP é exclusiva do RS.",
    );
  return candidates[0];
}
