/** Reads may retry once, but never retry invalid access, rate limits or conflicts. */
export function retryReadQuery(failureCount: number, error: unknown): boolean {
  if (failureCount >= 1) return false;
  const e = error as { status?: number; code?: string } | null;
  const status = Number(e?.status);
  if (status >= 400 && status < 500) return false;
  if (e?.code && (/^(PT|PGRST|22|23|42)/.test(e.code) ||
      ["invalid_credentials", "bad_jwt", "over_request_rate_limit"].includes(e.code))) return false;
  return true;
}

/** Supabase returns at most one page by default. Consume every ordered page. */
export async function readAllPages<T>(
  read: (offset: number, size: number) => Promise<T[]>,
  signal?: AbortSignal,
  size = 1000,
): Promise<T[]> {
  if (!Number.isInteger(size) || size < 1) throw new RangeError("Invalid page size");
  const rows: T[] = [];
  for (let offset = 0; ; offset += size) {
    signal?.throwIfAborted();
    const page = await read(offset, size);
    signal?.throwIfAborted();
    rows.push(...page);
    if (page.length < size) return rows;
  }
}
