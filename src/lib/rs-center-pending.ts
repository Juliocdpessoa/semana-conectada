export type RsPendingSource = { week_id: string; closure_id: string | null };
export function pendingOperationalLabel(status: string) {
  return status.trim().toLocaleUpperCase("pt-BR") === "EXECUTADO"
    ? "Executada, sem apropriação SAP"
    : status || "Sem apontamento";
}
export function pendingJustification(value: string | null | undefined) {
  return value?.trim() || "Sem justificativa registrada";
}
