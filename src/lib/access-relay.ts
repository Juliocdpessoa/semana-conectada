// Same-origin relay for the access flow and the Atividades page reads.
// Fixed upstream from the environment, strict allowlist, minimal headers, no
// cookies, no shared state, never logs secrets. One upstream attempt per request.
import { ACCESS_RELAY_PREFIX, accessBodyAllowed, matchAccessOperation } from "./access-transport-policy";

export type AccessRelayConfig = {
  upstreamUrl: string | undefined;
  publishableKey: string | undefined;
  fetchImpl?: typeof fetch;
  /** Overrides the per-operation timeout (tests). */
  timeoutMs?: number;
  /** Overrides the per-operation response cap (tests). */
  maxResponseBytes?: number;
};

/** Header telling the browser that a non-idempotent call may or may not have taken effect. */
export const ACCESS_OUTCOME_HEADER = "x-nexo-access-outcome";
const NO_STORE = "no-store";

function relayError(status: number, code: string, ambiguous = false): Response {
  const headers = new Headers({
    "content-type": "application/json",
    "cache-control": NO_STORE,
    "x-content-type-options": "nosniff",
    "x-nexo-access": "relay",
  });
  if (ambiguous) headers.set(ACCESS_OUTCOME_HEADER, "ambiguous");
  return new Response(JSON.stringify({ code, message: code }), { status, headers });
}

function upstreamOrigin(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** True only for a public client key; elevated keys must never reach this transport. */
export function isPublicClientKey(key: string | undefined): key is string {
  if (!key || key.length > 2048 || /\s/.test(key)) return false;
  if (key.startsWith("sb_secret_")) return false;
  if (key.startsWith("sb_publishable_")) return true;
  const parts = key.split(".");
  if (parts.length !== 3) return false;
  try {
    const json = atob(parts[1]!.replace(/-/g, "+").replace(/_/g, "/"));
    const payload = JSON.parse(json) as { role?: unknown };
    return payload.role === "anon";
  } catch {
    return false;
  }
}

const ABORTED = Symbol("aborted");

/** Reads a stream up to `limit` bytes; stops (and cancels) as soon as `signal` aborts. */
async function readCapped(
  stream: ReadableStream<Uint8Array> | null,
  limit: number,
  signal: AbortSignal,
): Promise<string | null | typeof ABORTED> {
  if (!stream) return "";
  if (signal.aborted) {
    await stream.cancel().catch(() => {});
    return ABORTED;
  }
  const reader = stream.getReader();
  const aborted = new Promise<typeof ABORTED>((resolve) =>
    signal.addEventListener("abort", () => resolve(ABORTED), { once: true }),
  );
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const next = await Promise.race([reader.read(), aborted]);
    if (next === ABORTED) {
      void reader.cancel().catch(() => {});
      return ABORTED;
    }
    if (next.done) break;
    size += next.value.byteLength;
    if (size > limit) {
      void reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(next.value);
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    all.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

const BEARER = /^Bearer ([A-Za-z0-9_\-.]{10,4096})$/;
const PASS_HEADERS = ["content-type", "content-range", "x-supabase-api-version", "retry-after"];

export async function relayAccessRequest(request: Request, config: AccessRelayConfig): Promise<Response> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(ACCESS_RELAY_PREFIX + "/")) return relayError(404, "nexo_access_not_allowed");
  const path = url.pathname.slice(ACCESS_RELAY_PREFIX.length);
  const op = matchAccessOperation(request.method, path, url.search);
  if (!op) return relayError(404, "nexo_access_not_allowed");

  const origin = upstreamOrigin(config.upstreamUrl);
  const key = config.publishableKey;
  if (!origin || !isPublicClientKey(key)) return relayError(503, "nexo_access_unavailable");
  const target = new URL(path + url.search, origin);
  if (target.origin !== origin) return relayError(404, "nexo_access_not_allowed");

  // One controller and one deadline for the whole request: reading the client
  // body, the upstream call and reading the upstream body.
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, config.timeoutMs ?? op.timeoutMs);
  const onClientAbort = () => controller.abort();
  if (request.signal?.aborted) controller.abort();
  else request.signal?.addEventListener("abort", onClientAbort, { once: true });
  const notSent = () =>
    timedOut ? relayError(408, "nexo_access_request_timeout") : relayError(499, "nexo_access_client_closed");

  let sent = false;
  try {
    let body = "";
    if (op.method === "POST") {
      const declared = Number(request.headers.get("content-length") ?? "0");
      if (!Number.isFinite(declared) || declared > op.maxBodyBytes) return relayError(413, "nexo_access_body_too_large");
      const read = await readCapped(request.body, op.maxBodyBytes, controller.signal);
      if (read === ABORTED) return notSent();
      if (read === null) return relayError(413, "nexo_access_body_too_large");
      body = read;
      if (body !== "" && !(request.headers.get("content-type") ?? "").startsWith("application/json"))
        return relayError(415, "nexo_access_unsupported_body");
    } else if (request.body) {
      const read = await readCapped(request.body, 1, controller.signal);
      if (read === ABORTED) return notSent();
      if (read !== "") return relayError(400, "nexo_access_invalid_body");
    }
    if (!accessBodyAllowed(op.kind, body, op.target)) return relayError(400, "nexo_access_invalid_body");

    // Minimal, rebuilt header set. Cookies and client-supplied keys are never forwarded.
    const headers = new Headers({ apikey: key });
    const bearer = BEARER.exec(request.headers.get("authorization") ?? "")?.[1];
    const tokenGrant = op.kind === "auth-password" || op.kind === "auth-refresh";
    if (bearer && bearer !== key && !tokenGrant) headers.set("authorization", `Bearer ${bearer}`);
    if (body !== "") headers.set("content-type", "application/json");
    const apiVersion = request.headers.get("x-supabase-api-version");
    if (apiVersion && /^\d{4}-\d{2}-\d{2}$/.test(apiVersion)) headers.set("x-supabase-api-version", apiVersion);
    if (path.startsWith("/rest/v1/")) {
      headers.set(op.method === "GET" ? "accept-profile" : "content-profile", "public");
      const accept = request.headers.get("accept");
      if (accept === "application/json" || accept === "application/vnd.pgrst.object+json") headers.set("accept", accept);
      // Same count/pagination semantics as the direct call; nothing else from Prefer.
      if (op.allowCount && request.headers.get("prefer") === "count=exact") headers.set("prefer", "count=exact");
    }
    const clientInfo = request.headers.get("x-client-info");
    if (clientInfo && /^[\x20-\x7e]{1,200}$/.test(clientInfo)) headers.set("x-client-info", clientInfo);

    // Never start an upstream call for a request that is already aborted or timed out.
    if (controller.signal.aborted) return notSent();
    sent = true;
    const upstream = await (config.fetchImpl ?? fetch)(target.toString(), {
      method: op.method,
      headers,
      body: op.method === "POST" && body !== "" ? body : undefined,
      redirect: "manual",
      signal: controller.signal,
      cache: "no-store",
    });
    if (upstream.status >= 300 && upstream.status < 400) {
      await upstream.body?.cancel().catch(() => {});
      return relayError(502, "nexo_access_unexpected_redirect", !op.idempotent);
    }
    const text = await readCapped(upstream.body, config.maxResponseBytes ?? op.maxResponseBytes, controller.signal);
    if (text === ABORTED) {
      console.warn("[nexo-access] upstream", op.kind, timedOut ? "timeout" : "client-closed");
      return timedOut
        ? relayError(504, "nexo_access_upstream_timeout", !op.idempotent)
        : relayError(499, "nexo_access_client_closed", !op.idempotent);
    }
    if (text === null) return relayError(502, "nexo_access_response_too_large", !op.idempotent);
    const out = new Headers({ "cache-control": NO_STORE, "x-content-type-options": "nosniff", "x-nexo-access": "relay" });
    for (const name of PASS_HEADERS) {
      const value = upstream.headers.get(name);
      if (value) out.set(name, value);
    }
    // A server-side failure on a write leaves its effect unknown.
    if (!op.idempotent && upstream.status >= 500) out.set(ACCESS_OUTCOME_HEADER, "ambiguous");
    // Real upstream status/body are preserved (invalid credentials and 429 stay what they are).
    // Fetch forbids a body even when it is an empty string for these statuses.
    // In particular GoTrue logout may legitimately answer 204.
    const noBody = [204, 205, 304].includes(upstream.status);
    return new Response(noBody ? null : text, { status: upstream.status, headers: out });
  } catch {
    if (!sent) return controller.signal.aborted ? notSent() : relayError(400, "nexo_access_invalid_body");
    // Outcome unknown: the client must not treat it as success, and writes are flagged.
    console.warn("[nexo-access] upstream", op.kind, timedOut ? "timeout" : "unreachable");
    return timedOut
      ? relayError(504, "nexo_access_upstream_timeout", !op.idempotent)
      : relayError(502, "nexo_access_upstream_unreachable", !op.idempotent);
  } finally {
    clearTimeout(timer);
    request.signal?.removeEventListener("abort", onClientAbort);
  }
}
