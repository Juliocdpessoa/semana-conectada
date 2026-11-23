// Browser transport for the access flow and the Atividades page reads.
// Installed access-gate requests start on the restricted same-origin relay.
// Operational reads retain the bounded direct/relay routing preference.
// The transport itself
// never retries: one network attempt per call. A non-idempotent call (password
// sign-in, refresh, logout) whose outcome was ambiguous is never sent again with
// the same credentials; repeats get a local "not repeated" answer instead.
import { ACCESS_RELAY_PREFIX, matchAccessOperation, type AccessOperationKind } from "./access-transport-policy";
import { fetchReadWithDeadline } from './read-fetch-deadline';

export const ACCESS_ROUTE_HINT_KEY = "nexo:access-route:v1";
export const ACCESS_ROUTE_HINT_TTL_MS = 6 * 60 * 60 * 1000;
export const ACCESS_OUTCOME_HEADER = "x-nexo-access-outcome";
const HUNG_CONNECTION_MS = 7000;
// Routing history is not an authentication grant. A previously necessary relay
// remains the safer first destination for a rotating token after an idle period.
const REFRESH_ROUTE_HISTORY_MS = 30 * 24 * 60 * 60 * 1000;

/** How long an identical non-idempotent call stays blocked after an ambiguous outcome. */
export const NOT_REPEATED_TTL_MS: Partial<Record<AccessOperationKind, number>> = {
  "auth-password": 60_000,
  "auth-logout": 60_000,
  // A refresh token that may already have been rotated must not be sent again in
  // this page: re-sending it later could trigger the server's reuse protection.
  "auth-refresh": 12 * 60 * 60 * 1000,
};

type HintStorage = Pick<Storage, "getItem" | "setItem">;

export type AccessRouteHint = {
  useRelay(): boolean;
  markDirectFailed(): void;
  hasRelayHistory?(): boolean;
  markRelaySuccess?(): void;
};

export function createAccessRouteHint(
  storage: HintStorage | null,
  now: () => number = Date.now,
  ttlMs = ACCESS_ROUTE_HINT_TTL_MS,
): AccessRouteHint {
  let until = 0;
  function knownUntil() {
    try {
      const stored = Number(storage?.getItem(ACCESS_ROUTE_HINT_KEY) ?? 0);
      if (Number.isFinite(stored) && stored > 0 && stored <= now() + ttlMs && stored > now() - REFRESH_ROUTE_HISTORY_MS)
        until = Math.max(until, stored);
    } catch { /* storage blocked: memory only */ }
    return until;
  }
  function extend() {
    until = now() + ttlMs;
    try { storage?.setItem(ACCESS_ROUTE_HINT_KEY, String(until)); } catch { /* memory only */ }
  }
  return {
    useRelay() {
      return knownUntil() > now();
    },
    markDirectFailed: extend,
    markRelaySuccess: extend,
    hasRelayHistory: () => knownUntil() > 0 && knownUntil() > now() - REFRESH_ROUTE_HISTORY_MS,
  };
}

/** In-memory, per-page record of non-idempotent calls with an ambiguous outcome (hashed keys only). */
export type AmbiguityGuard = { blocked(key: string): boolean; mark(key: string, ttlMs: number): void };

export function createAmbiguityGuard(now: () => number = Date.now, maxEntries = 64): AmbiguityGuard {
  const entries = new Map<string, number>();
  return {
    blocked(key) {
      const until = entries.get(key);
      if (until === undefined) return false;
      if (until > now()) return true;
      entries.delete(key);
      return false;
    },
    mark(key, ttlMs) {
      entries.delete(key);
      entries.set(key, now() + ttlMs);
      while (entries.size > maxEntries) entries.delete(entries.keys().next().value!);
    },
  };
}

async function requestKey(kind: AccessOperationKind, init: RequestInit | undefined): Promise<string> {
  const auth = new Headers(init?.headers).get("authorization") ?? "";
  const body = typeof init?.body === "string" ? init.body : "";
  const raw = `${kind}\n${auth}\n${body}`;
  try {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return raw; // memory only, never logged or stored
  }
}

function notRepeatedResponse(): Response {
  // 503 keeps the SDK from deleting the session (it treats it as transient)
  // while no request leaves the browser.
  return new Response(
    JSON.stringify({ code: "nexo_access_not_repeated", message: "nexo_access_not_repeated" }),
    {
      status: 503,
      headers: { "content-type": "application/json", "cache-control": "no-store", [ACCESS_OUTCOME_HEADER]: "not-repeated" },
    },
  );
}

function errorName(error: unknown) {
  return (error as { name?: string } | null)?.name;
}

function isConnectionFailure(error: unknown, signal: AbortSignal | null | undefined, elapsed: number) {
  if (errorName(error) === "AbortError" || signal?.aborted) return elapsed >= HUNG_CONNECTION_MS;
  return errorName(error) === "TypeError";
}

export function createAccessFetch(
  base: typeof fetch,
  options: {
    supabaseUrl: string;
    relayOrigin: string;
    hint: AccessRouteHint;
    guard?: AmbiguityGuard;
    now?: () => number;
    /** Access gate uses the existing fixed-origin relay before consuming a token. */
    preferAccessRelay?: boolean;
    /** Bounds SDK auth fetches, which do not receive the route's abort signal. */
    authTimeoutMs?: number;
    /** Test override; production uses the operation's existing read budget. */
    readTimeoutMs?: number;
  },
): typeof fetch {
  const supabaseOrigin = new URL(options.supabaseUrl).origin;
  const now = options.now ?? Date.now;
  const guard = options.guard ?? createAmbiguityGuard(now);
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
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

    const ttl = op.idempotent ? undefined : NOT_REPEATED_TTL_MS[op.kind];
    const key = ttl ? await requestKey(op.kind, init) : "";
    if (ttl && guard.blocked(key)) return notRepeatedResponse();

    const accessGate = op.kind.startsWith("auth-") || op.kind === "read-gate" || op.kind === "rpc-password-state";
    const relayPreferred = options.hint.useRelay() ||
      (op.kind === "auth-refresh" && options.hint.hasRelayHistory?.() === true);
    const viaRelay = (options.preferAccessRelay === true && accessGate) || relayPreferred;
    const started = now();
    const authController = op.kind.startsWith("auth-") ? new AbortController() : undefined;
    const forwardAbort = () => authController?.abort();
    if (init?.signal?.aborted) forwardAbort();
    else init?.signal?.addEventListener("abort", forwardAbort, { once: true });
    const authTimer = authController ? setTimeout(() => authController.abort(), options.authTimeoutMs ?? 12_000) : undefined;
    const requestInit = authController ? { ...init, signal: authController.signal } : init;
    const operationalRead=op.kind==='rpc-read'||op.kind==='read-data';
    const requestFetch:typeof fetch=operationalRead
      ? (url,readInit)=>fetchReadWithDeadline(base,url,readInit,options.readTimeoutMs??(op.timeoutMs+5000),op.maxResponseBytes)
      : base;
    try {
      const response = viaRelay
        ? await requestFetch(`${options.relayOrigin}${ACCESS_RELAY_PREFIX}${url.pathname}${url.search}`, {
            ...requestInit,
            credentials: "omit",
            cache: "no-store",
            redirect: "error",
          })
        : await requestFetch(input, requestInit);
      if (ttl && (response.status >= 500 || response.headers.get(ACCESS_OUTCOME_HEADER) === "ambiguous"))
        guard.mark(key, ttl);
      // A fixed gate route alone is not evidence operational direct reads fail.
      // Do not move every healthy client's large activity queries onto the relay.
      if (viaRelay && response.ok && relayPreferred) options.hint.markRelaySuccess?.();
      return response;
    } catch (error) {
      if (!viaRelay && !init?.signal?.aborted && (isConnectionFailure(error, requestInit?.signal, now() - started)||
          (operationalRead&&errorName(error)==='TimeoutError'))) options.hint.markDirectFailed();
      // Failed to fetch can also mean the response was lost after processing.
      // A rotating refresh token must NEVER be replayed on that assumption.
      // Password grants retain the existing bounded login retry; they do not
      // consume a refresh token or repeat an application data mutation.
      const directRefused = !viaRelay && errorName(error) === "TypeError" && op.kind === "auth-password";
      if (ttl && !directRefused) guard.mark(key, ttl);
      throw error; // never retried here; the caller decides with its own bounded policy
    } finally {
      if (authTimer) clearTimeout(authTimer);
      init?.signal?.removeEventListener("abort", forwardAbort);
    }
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
    preferAccessRelay: true,
  });
  installed = true;
}
