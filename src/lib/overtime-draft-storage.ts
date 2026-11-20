// No unscoped legacy draft is restored: its owner/worksite cannot be verified.
export const overtimeDraftKey = (userId: string, worksiteId: string) =>
  `nexo:overtime-request-draft:v2:${userId}:${worksiteId}`;
export function readOvertimeDraft(key: string): string | null {
  try { const raw = sessionStorage.getItem(key); return raw && raw.length <= 100_000 ? raw : null; } catch { return null; }
}
export function restoreOvertimeForm<T extends Record<string, unknown>>(stored: unknown, defaults: T): T {
  const next = { ...defaults };
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return next;
  const source = stored as Record<string, unknown>;
  for (const key of Object.keys(defaults) as (keyof T & string)[]) {
    const value = source[key];
    if ((typeof defaults[key] === "string" && typeof value === "string" && value.length <= 2000) ||
        (typeof defaults[key] === "boolean" && typeof value === "boolean") ||
        (defaults[key] === null && (value === null || (typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value)))))
      next[key] = value as T[typeof key];
  }
  const date = next["overtime_date"];
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(date + "T12:00:00Z")) || new Date(date + "T12:00:00Z").toISOString().slice(0, 10) !== date)
    next["overtime_date" as keyof T] = defaults["overtime_date"] as T[keyof T];
  return next;
}
export function persistOvertimeDraft(key: string, value: unknown): boolean {
  try { sessionStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}
export function removeOvertimeDraft(key: string): void {
  try { sessionStorage.removeItem(key); } catch { /* Successful submission must still complete. */ }
}
