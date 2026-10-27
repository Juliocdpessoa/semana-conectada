export type RsPendingSource = { week_id: string; closure_id: string | null };
export function pendingHours(value: unknown): number | null {
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) return null;
  const hours = Number(value);
  return Number.isFinite(hours) && hours >= 0 ? hours : null;
}
export function pendingPageHours(rows: { planned_hh?: unknown }[]): number | null {
  let total = 0;
  for (const row of rows) {
    const value = pendingHours(row.planned_hh);
    if (value === null) return null;
    total += value;
  }
  return total;
}
export function pendingOperationalLabel(status: string) {
  return status.trim().toLocaleUpperCase("pt-BR") === "EXECUTADO"
    ? "Executada, sem apropriação SAP"
    : status || "Sem apontamento";
}
export function pendingJustification(value: string | null | undefined) {
  return value?.trim() || "Sem justificativa registrada";
}
