// Repete chamadas ao servidor quando a conexão oscila (ex.: "Failed to fetch").
export function isNetworkError(err: unknown): boolean {
  if (!err) return false;
  const e = err as { name?: string; message?: string; status?: number };
  const msg = String(e.message ?? "").toLowerCase();
  return (
    e.name === "AuthRetryableFetchError" ||
    e.status === 0 ||
    msg.includes("failed to fetch") ||
    msg.includes("load failed") ||
    msg.includes("networkerror") ||
    msg.includes("network request failed") ||
    msg.includes("fetch failed")
  );
}

export const NETWORK_ERROR_MESSAGE =
  "Sem conexão com o servidor no momento. Aguarde alguns segundos e tente novamente.";

/** Executa `fn` novamente enquanto o erro retornado for de rede. */
export async function withNetworkRetry<T extends { error?: unknown }>(
  fn: () => Promise<T>,
  attempts = 4,
  baseDelayMs = 600,
): Promise<T> {
  let result: T | undefined;
  for (let i = 0; i < attempts; i += 1) {
    try {
      result = await fn();
      if (!isNetworkError(result.error)) return result;
    } catch (err) {
      if (!isNetworkError(err) || i === attempts - 1) throw err;
    }
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, baseDelayMs * (i + 1)));
  }
  return result as T;
}
