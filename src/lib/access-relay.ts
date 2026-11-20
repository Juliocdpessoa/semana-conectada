// Same-origin relay for the access flow. Fixed upstream from the environment,
// strict allowlist, minimal headers, no cookies, no shared state, never logs secrets.
import {
  ACCESS_RELAY_MAX_BODY_BYTES,
  ACCESS_RELAY_PREFIX,
  accessBodyAllowed,
  matchAccessOperation,
} from "./access-transport-policy";

export type AccessRelayConfig = {
  upstreamUrl: string | undefined;
  publishableKey: string | undefined;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxResponseBytes?: number;
};

const NO_STORE = "no-store";

function relayError(status: number, code: string, ambiguous = false): Response {
  const headers = new Headers({
    "content-type": "application/json",
    "cache-control": NO_STORE,
    "x-content-type-options": "nosniff",
    "x-nexo-access": "relay",
  });
  if (ambiguous) headers.set("x-nexo-access-outcome", "ambiguous");
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

async function readCapped(
  stream: ReadableStream<Uint8Array> | null,
  limit: number,
): Promise<string | null> {
  if (!stream) return "";
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
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

export async function relayAccessRequest(
  request: Request,
  config: AccessRelayConfig,
): Promise<Response> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(ACCESS_RELAY_PREFIX + "/"))
    return relayError(404, "nexo_access_not_allowed");
  const path = url.pathname.slice(ACCESS_RELAY_PREFIX.length);
  const op = matchAccessOperation(request.method, path, url.search);
  if (!op) return relayError(404, "nexo_access_not_allowed");

  const origin = upstreamOrigin(config.upstreamUrl);
  const key = config.publishableKey;
  if (!origin || !isPublicClientKey(key)) return relayError(503, "nexo_access_unavailable");

  let body = "";
  if (op.method === "POST") {
    const declared = Number(request.headers.get("content-length") ?? "0");
    if (!Number.isFinite(declared) || declared > ACCESS_RELAY_MAX_BODY_BYTES)
      return relayError(413, "nexo_access_body_too_large");
    const read = await readCapped(request.body, ACCESS_RELAY_MAX_BODY_BYTES);
    if (read === null) return relayError(413, "nexo_access_body_too_large");
    body = read;
    if (body !== "" && !(request.headers.get("content-type") ?? "").startsWith("application/json"))
      return relayError(415, "nexo_access_unsupported_body");
  } else if (request.body) {
    const read = await readCapped(request.body, 1);
    if (read !== "") return relayError(400, "nexo_access_invalid_body");
  }
  if (!accessBodyAllowed(op.kind, body)) return relayError(400, "nexo_access_invalid_body");

  // Minimal, rebuilt header set. Cookies and client-supplied keys are never forwarded.
  const headers = new Headers({ apikey: key });
  const bearer = BEARER.exec(request.headers.get("authorization") ?? "")?.[1];
  const tokenGrant = op.kind === "auth-password" || op.kind === "auth-refresh";
  if (bearer && bearer !== key && !tokenGrant) headers.set("authorization", `Bearer ${bearer}`);
  if (body !== "") headers.set("content-type", "application/json");
  const apiVersion = request.headers.get("x-supabase-api-version");
  if (apiVersion && /^\d{4}-\d{2}-\d{2}$/.test(apiVersion))
    headers.set("x-supabase-api-version", apiVersion);
  if (path.startsWith("/rest/v1/")) {
    headers.set(op.method === "GET" ? "accept-profile" : "content-profile", "public");
    const accept = request.headers.get("accept");
    if (accept === "application/json" || accept === "application/vnd.pgrst.object+json")
      headers.set("accept", accept);
  }
  const clientInfo = request.headers.get("x-client-info");
  if (clientInfo && /^[\x20-\x7e]{1,200}$/.test(clientInfo)) headers.set("x-client-info", clientInfo);

  const target = new URL(path + url.search, origin);
  if (target.origin !== origin) return relayError(404, "nexo_access_not_allowed");

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, config.timeoutMs ?? 10000);
  const onClientAbort = () => controller.abort();
  request.signal?.addEventListener("abort", onClientAbort, { once: true });

  try {
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
    const text = await readCapped(upstream.body, config.maxResponseBytes ?? 512 * 1024);
    if (text === null) return relayError(502, "nexo_access_response_too_large", !op.idempotent);
    const out = new Headers({
      "cache-control": NO_STORE,
      "x-content-type-options": "nosniff",
      "x-nexo-access": "relay",
    });
    for (const name of ["content-type", "content-range", "x-supabase-api-version"]) {
      const value = upstream.headers.get(name);
      if (value) out.set(name, value);
    }
    // Real upstream status/body are preserved (e.g. invalid credentials stays an error).
    return new Response(text, { status: upstream.status, headers: out });
  } catch {
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
