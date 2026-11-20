// Browser transport for the access flow. Requests start on the direct backend
// address; after a direct connection failure on an allowlisted access request,
// this browser uses the restricted same-origin relay for those requests for a
// limited time. The transport itself never retries: one network attempt per call.
import { ACCESS_RELAY_PREFIX, matchAccessOperation } from "./access-transport-policy";

export const ACCESS_ROUTE_HINT_KEY = "nexo:access-route:v1";
export const ACCESS_ROUTE_HINT_TTL_MS = 6 * 60 * 60 * 1000;
const HUNG_CONNECTION_MS = 7000;

type HintStorage = Pick<Storage, "getItem" | "setItem">;

export type AccessRouteHint = { useRelay(): boolean; markDirectFailed(): void };

export function createAccessRouteHint(
  storage: HintStorage | null,
  now: () => number = Date.now,
  ttlMs = ACCESS_ROUTE_HINT_TTL_MS,
): AccessRouteHint {
  let until = 0;
  return {
    useRelay() {
      if (until > now()) return true;
      try {
        const stored = Number(storage?.getItem(ACCESS_ROUTE_HINT_KEY) ?? 0);
        if (Number.isFinite(stored) && stored > now() && stored <= now() + ttlMs) {
          until = stored;
          return true;
        }
      } catch {
        /* storage blocked: memory only */
      }
      return false;
    },
    markDirectFailed() {
      until = now() + ttlMs;
      try {
        storage?.setItem(ACCESS_ROUTE_HINT_KEY, String(until));
      } catch {
        /* storage blocked: memory only */
      }
    },
  };
}

function isConnectionFailure(error: unknown, signal: AbortSignal | null | undefined, elapsed: number) {
  const name = (error as { name?: string } | null)?.name;
  if (name === "AbortError" || signal?.aborted) return elapsed >= HUNG_CONNECTION_MS;
  return name === "TypeError";
}

export function createAccessFetch(
  base: typeof fetch,
  options: { supabaseUrl: string; relayOrigin: string; hint: AccessRouteHint; now?: () => number },
): typeof fetch {
  const supabaseOrigin = new URL(options.supabaseUrl).origin;
  const now = options.now ?? Date.now;
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input !== "string" && !(input instanceof URL)) return base(input, init);
    let url: URL;
    try {
      url = new URL(String(input));
    } catch {
      return base(input, init);
    }
    if (url.origin !== supabaseOrigin) return base(input, init);
    const op = matchAccessOperation(init?.method ?? "GET", url.pathname, url.search);
    if (!op) return base(input, init);

    if (options.hint.useRelay()) {
      return base(`${options.relayOrigin}${ACCESS_RELAY_PREFIX}${url.pathname}${url.search}`, {
        ...init,
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
      });
    }
    const started = now();
    return base(input, init).catch((error: unknown) => {
      if (isConnectionFailure(error, init?.signal, now() - started)) options.hint.markDirectFailed();
      throw error; // never retried here; the caller decides with its own bounded policy
    });
  }) as typeof fetch;
}

let installed = false;
export function installAccessTransport() {
  if (installed || typeof window === "undefined") return;
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  if (!supabaseUrl) return;
  let storage: HintStorage | null = null;
  try {
    storage = window.localStorage;
  } catch {
    storage = null;
  }
  const base = window.fetch.bind(window);
  window.fetch = createAccessFetch(base, {
    supabaseUrl,
    relayOrigin: window.location.origin,
    hint: createAccessRouteHint(storage),
  });
  installed = true;
}
