import { test, expect, spyOn } from "bun:test";
import { createClient } from "@supabase/supabase-js";
import { matchAccessOperation, accessBodyAllowed, ACCESS_RELAY_PREFIX } from "../src/lib/access-transport-policy";
import { relayAccessRequest, isPublicClientKey } from "../src/lib/access-relay";
import { createAccessFetch, createAccessRouteHint, ACCESS_ROUTE_HINT_KEY } from "../src/lib/access-transport";
import { accessStep, AccessLoadError } from "../src/lib/access-diagnostics";

const UP = "https://ref123.supabase.co";
const KEY = "sb_publishable_testkey";
const APP = "https://www.nexoprog.com.br";
const UID = "00000000-0000-0000-0000-000000000001";
const TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1MSJ9.signature-user-one";

function memStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
}
function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...extra } });
}
type Call = { url: string; init: RequestInit };
function fakeUpstream(respond: (c: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const f = (async (url: any, init: any = {}) => { const c = { url: String(url), init }; calls.push(c); return respond(c); }) as typeof fetch;
  return { f, calls };
}
const relay = (req: Request, f: typeof fetch, extra: object = {}) =>
  relayAccessRequest(req, { upstreamUrl: UP, publishableKey: KEY, fetchImpl: f, ...extra });

// ---------- allowlist ----------
test("allowlist accepts exactly the access-gate operations", () => {
  expect(matchAccessOperation("POST", "/auth/v1/token", "?grant_type=password")?.kind).toBe("auth-password");
  expect(matchAccessOperation("POST", "/auth/v1/token", "?grant_type=refresh_token")?.kind).toBe("auth-refresh");
  expect(matchAccessOperation("GET", "/auth/v1/user", "")?.kind).toBe("auth-user");
  expect(matchAccessOperation("POST", "/auth/v1/logout", "?scope=global")?.kind).toBe("auth-logout");
  expect(matchAccessOperation("POST", "/rest/v1/rpc/password_reset_state", "")?.kind).toBe("rpc-password-state");
  expect(matchAccessOperation("GET", "/rest/v1/profiles", `?select=email%2Cfull_name&id=eq.${UID}`)?.kind).toBe("read-gate");
  expect(matchAccessOperation("GET", "/rest/v1/user_roles", `?select=role&user_id=eq.${UID}`)?.kind).toBe("read-gate");
  expect(matchAccessOperation("GET", "/rest/v1/worksites", "?select=id%2Ccode%2Cname&is_active=eq.true&order=code.asc")?.kind).toBe("read-gate");
  expect(matchAccessOperation("GET", "/rest/v1/worksite_memberships", `?select=is_worksite_admin&user_id=eq.${UID}&worksite_id=eq.${UID}`)?.kind).toBe("read-gate");
});

test("allowlist rejects other tables, writes, functions, admin paths and query tricks", () => {
  const bad: [string, string, string][] = [
    ["GET", "/rest/v1/activities", "?select=id"],
    ["PATCH", "/rest/v1/activities", `?id=eq.${UID}`],
    ["PATCH", "/rest/v1/profiles", `?id=eq.${UID}`],
    ["DELETE", "/rest/v1/user_roles", `?user_id=eq.${UID}`],
    ["POST", "/rest/v1/user_roles", ""],
    ["POST", "/rest/v1/rpc/bulk_update_activity_reports_v2", ""],
    ["GET", "/rest/v1/profiles", "?select=*,user_roles(*)"],
    ["GET", "/rest/v1/profiles", "?select=email&id=neq.x"],
    ["GET", "/rest/v1/profiles", `?select=email&id=eq.${UID}&id=eq.${UID}`],
    ["GET", "/rest/v1/profiles", `?select=email&or=(id.eq.1)`],
    ["GET", "/rest/v1/profiles", `?id=eq.${UID}`],
    ["POST", "/auth/v1/token", "?grant_type=pkce"],
    ["POST", "/auth/v1/token", "?grant_type=password&redirect_to=x"],
    ["GET", "/auth/v1/user", "?x=1"],
    ["PUT", "/auth/v1/user", ""],
    ["GET", "/auth/v1/admin/users", ""],
    ["POST", "/auth/v1/signup", ""],
    ["GET", "/auth/v1/../admin/users", ""],
    ["GET", "/auth/v1/%2e%2e/admin/users", ""],
    ["GET", "/rest/v1//profiles", "?select=email"],
    ["GET", "/storage/v1/object/x", ""],
  ];
  for (const [m, p, q] of bad) expect(matchAccessOperation(m, p, q)).toBeNull();
});

test("request bodies are restricted per operation", () => {
  expect(accessBodyAllowed("auth-password", JSON.stringify({ email: "a@b.c", password: "x", gotrue_meta_security: {} }))).toBe(true);
  expect(accessBodyAllowed("auth-password", JSON.stringify({ email: "a@b.c", password: "x", data: { role: "admin" } }))).toBe(false);
  expect(accessBodyAllowed("auth-refresh", JSON.stringify({ refresh_token: "abc123" }))).toBe(true);
  expect(accessBodyAllowed("auth-refresh", JSON.stringify({ refresh_token: "abc", extra: 1 }))).toBe(false);
  expect(accessBodyAllowed("rpc-password-state", "{}")).toBe(true);
  expect(accessBodyAllowed("rpc-password-state", JSON.stringify({ p_user: UID }))).toBe(false);
  expect(accessBodyAllowed("read-gate", "x")).toBe(false);
});

// ---------- relay security ----------
test("relay sends only to the fixed upstream, rebuilds headers and drops cookies/keys", async () => {
  const up = fakeUpstream(() => json([{ role: "operation" }]));
  const req = new Request(`${APP}${ACCESS_RELAY_PREFIX}/rest/v1/user_roles?select=role&user_id=eq.${UID}`, {
    headers: {
      apikey: "sb_secret_attacker", authorization: `Bearer ${TOKEN}`, cookie: "session=abc",
      host: "evil.example", "x-forwarded-host": "evil.example", "accept-profile": "private", prefer: "tx=commit",
    },
  });
  const res = await relay(req, up.f);
  expect(res.status).toBe(200);
  expect(up.calls.length).toBe(1);
  expect(up.calls[0]!.url).toBe(`${UP}/rest/v1/user_roles?select=role&user_id=eq.${UID}`);
  const h = new Headers(up.calls[0]!.init.headers);
  expect(h.get("apikey")).toBe(KEY);
  expect(h.get("authorization")).toBe(`Bearer ${TOKEN}`);
  expect(h.get("cookie")).toBeNull();
  expect(h.get("accept-profile")).toBe("public");
  expect(h.get("prefer")).toBeNull();
  expect(up.calls[0]!.init.redirect).toBe("manual");
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(res.headers.get("set-cookie")).toBeNull();
});

test("relay refuses elevated keys and never calls upstream with them", async () => {
  const serviceJwt = `x.${btoa(JSON.stringify({ role: "service_role" }))}.y`;
  for (const k of ["sb_secret_abc", serviceJwt, "", undefined]) {
    const up = fakeUpstream(() => json({}));
    const res = await relayAccessRequest(new Request(`${APP}${ACCESS_RELAY_PREFIX}/auth/v1/user`), { upstreamUrl: UP, publishableKey: k, fetchImpl: up.f });
    expect(res.status).toBe(503);
    expect(up.calls.length).toBe(0);
  }
  expect(isPublicClientKey(KEY)).toBe(true);
  expect(isPublicClientKey(`x.${btoa(JSON.stringify({ role: "anon" }))}.y`)).toBe(true);
  expect(isPublicClientKey("http://upstream")).toBe(false);
});

test("relay rejects non-allowlisted requests and non-https upstreams without calling upstream", async () => {
  const up = fakeUpstream(() => json({}));
  expect((await relay(new Request(`${APP}${ACCESS_RELAY_PREFIX}/rest/v1/activities?select=id`), up.f)).status).toBe(404);
  expect((await relay(new Request(`${APP}${ACCESS_RELAY_PREFIX}/auth/v1/admin/users`), up.f)).status).toBe(404);
  expect((await relayAccessRequest(new Request(`${APP}${ACCESS_RELAY_PREFIX}/auth/v1/user`), { upstreamUrl: "http://evil.example", publishableKey: KEY, fetchImpl: up.f })).status).toBe(503);
  expect(up.calls.length).toBe(0);
});

test("relay enforces the body limit (declared and streamed)", async () => {
  const up = fakeUpstream(() => json({}));
  const big = JSON.stringify({ email: "a@b.c", password: "x".repeat(20000) });
  const declared = new Request(`${APP}${ACCESS_RELAY_PREFIX}/auth/v1/token?grant_type=password`, { method: "POST", body: big, headers: { "content-type": "application/json" } });
  expect((await relay(declared, up.f)).status).toBe(413);
  const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(big)); c.close(); } });
  const streamed = new Request(`${APP}${ACCESS_RELAY_PREFIX}/auth/v1/token?grant_type=password`, { method: "POST", body: stream, headers: { "content-type": "application/json" }, duplex: "half" } as RequestInit);
  expect((await relay(streamed, up.f)).status).toBe(413);
  expect(up.calls.length).toBe(0);
});

test("wrong password stays an error with the real status, code and version header", async () => {
  const up = fakeUpstream(() => json({ code: "invalid_credentials", message: "Invalid login credentials" }, 400, { "x-supabase-api-version": "2024-01-01", "set-cookie": "x=1" }));
  const req = new Request(`${APP}${ACCESS_RELAY_PREFIX}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ email: "a@b.c", password: "wrong", gotrue_meta_security: {} }),
  });
  const res = await relay(req, up.f);
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ code: "invalid_credentials", message: "Invalid login credentials" });
  expect(res.headers.get("x-supabase-api-version")).toBe("2024-01-01");
  expect(res.headers.get("set-cookie")).toBeNull();
  expect(new Headers(up.calls[0]!.init.headers).get("authorization")).toBeNull();
});

test("timeout aborts the upstream once, flags writes as ambiguous and is not retried", async () => {
  let signal: AbortSignal | undefined;
  const up = fakeUpstream((c) => { signal = c.init.signal ?? undefined; return new Promise((_, rej) => signal!.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")))); });
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  const req = new Request(`${APP}${ACCESS_RELAY_PREFIX}/auth/v1/token?grant_type=refresh_token`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ refresh_token: "secretrefresh123" }) });
  const res = await relay(req, up.f, { timeoutMs: 20 });
  expect(res.status).toBe(504);
  expect(res.headers.get("x-nexo-access-outcome")).toBe("ambiguous");
  expect(signal?.aborted).toBe(true);
  expect(up.calls.length).toBe(1);
  expect(JSON.stringify(warn.mock.calls)).not.toContain("secretrefresh123");
  warn.mockRestore();
});

test("unreachable upstream returns 502 once; reads are not flagged ambiguous; nothing secret is logged", async () => {
  const up = fakeUpstream(() => { throw new TypeError("fetch failed"); });
  const logs = [spyOn(console, "warn").mockImplementation(() => {}), spyOn(console, "log").mockImplementation(() => {}), spyOn(console, "error").mockImplementation(() => {})];
  const res = await relay(new Request(`${APP}${ACCESS_RELAY_PREFIX}/auth/v1/user`, { headers: { authorization: `Bearer ${TOKEN}` } }), up.f);
  expect(res.status).toBe(502);
  expect(res.headers.get("x-nexo-access-outcome")).toBeNull();
  expect(up.calls.length).toBe(1);
  expect(JSON.stringify(logs.map((l) => l.mock.calls))).not.toContain(TOKEN);
  logs.forEach((l) => l.mockRestore());
});

test("upstream redirects are not followed", async () => {
  const up = fakeUpstream(() => new Response(null, { status: 302, headers: { location: "https://evil.example" } }));
  const res = await relay(new Request(`${APP}${ACCESS_RELAY_PREFIX}/auth/v1/user`, { headers: { authorization: `Bearer ${TOKEN}` } }), up.f);
  expect(res.status).toBe(502);
  expect(up.calls.length).toBe(1);
});

test("concurrent requests are isolated: each user only carries their own token", async () => {
  const up = fakeUpstream(async (c) => {
    await new Promise((r) => setTimeout(r, Math.random() * 10));
    return json({ token: new Headers(c.init.headers).get("authorization") });
  });
  const tokens = Array.from({ length: 20 }, (_, i) => `${TOKEN}-${i}`);
  const results = await Promise.all(tokens.map((t) => relay(new Request(`${APP}${ACCESS_RELAY_PREFIX}/auth/v1/user`, { headers: { authorization: `Bearer ${t}` } }), up.f).then((r) => r.json())));
  results.forEach((r: any, i) => expect(r.token).toBe(`Bearer ${tokens[i]}`));
  const anon = await relay(new Request(`${APP}${ACCESS_RELAY_PREFIX}/auth/v1/user`), up.f);
  expect((await anon.json() as any).token).toBeNull();
});

// ---------- browser transport ----------
function browser(direct: (url: string, init?: RequestInit) => Promise<Response>, storage = memStorage()) {
  const calls: Call[] = [];
  const base = (async (u: any, i: any) => { calls.push({ url: String(u), init: i }); return direct(String(u), i); }) as typeof fetch;
  const hint = createAccessRouteHint(storage);
  return { calls, storage, hint, fetch: createAccessFetch(base, { supabaseUrl: UP, relayOrigin: APP, hint }) };
}

test("other requests (including activity edits) always go direct and untouched", async () => {
  const b = browser(async () => json({}));
  b.hint.markDirectFailed();
  const init = { method: "PATCH", body: "{}", headers: { "if-match": "v1" } };
  await b.fetch(`${UP}/rest/v1/activities?id=eq.${UID}`, init);
  await b.fetch(`${UP}/rest/v1/rpc/bulk_update_activity_reports_v2`, { method: "POST", body: "{}" });
  await b.fetch(`${APP}/_serverFn/x`, { method: "POST" });
  expect(b.calls.map((c) => c.url)).toEqual([`${UP}/rest/v1/activities?id=eq.${UID}`, `${UP}/rest/v1/rpc/bulk_update_activity_reports_v2`, `${APP}/_serverFn/x`]);
  expect(b.calls[0]!.init).toBe(init);
});

test("a direct connection failure is rethrown once (no hidden retry) and switches later access calls to the relay", async () => {
  const b = browser(async (u) => { if (u.startsWith(UP)) throw new TypeError("Failed to fetch"); return json({ id: UID }); });
  const ctrl = new AbortController();
  await expect(b.fetch(`${UP}/auth/v1/user`, { headers: { authorization: `Bearer ${TOKEN}` } })).rejects.toThrow("Failed to fetch");
  expect(b.calls.length).toBe(1);
  expect(Number(b.storage.m.get(ACCESS_ROUTE_HINT_KEY))).toBeGreaterThan(Date.now());
  await b.fetch(`${UP}/auth/v1/user`, { headers: { authorization: `Bearer ${TOKEN}` }, signal: ctrl.signal });
  expect(b.calls.length).toBe(2);
  expect(b.calls[1]!.url).toBe(`${APP}${ACCESS_RELAY_PREFIX}/auth/v1/user`);
  expect(b.calls[1]!.init.credentials).toBe("omit");
  expect(b.calls[1]!.init.signal).toBe(ctrl.signal);
  expect(new Headers(b.calls[1]!.init.headers).get("authorization")).toBe(`Bearer ${TOKEN}`);
});

test("HTTP errors and quick caller aborts do not switch the route", async () => {
  const b = browser(async (u, i) => {
    if (i?.signal?.aborted) throw new DOMException("aborted", "AbortError");
    return json({ code: "invalid_credentials" }, 400);
  });
  await b.fetch(`${UP}/auth/v1/token?grant_type=password`, { method: "POST", body: "{}" });
  const ctrl = new AbortController(); ctrl.abort();
  await expect(b.fetch(`${UP}/auth/v1/user`, { signal: ctrl.signal })).rejects.toThrow();
  expect(b.hint.useRelay()).toBe(false);
});

test("route hint expires and survives a reload within its window", () => {
  let t = 1_000_000;
  const s = memStorage();
  createAccessRouteHint(s, () => t, 1000).markDirectFailed();
  expect(createAccessRouteHint(s, () => t, 1000).useRelay()).toBe(true);
  t += 1001;
  expect(createAccessRouteHint(s, () => t, 1000).useRelay()).toBe(false);
  s.setItem(ACCESS_ROUTE_HINT_KEY, String(t + 10 ** 12)); // tampered far-future value is ignored
  expect(createAccessRouteHint(s, () => t, 1000).useRelay()).toBe(false);
});

// ---------- end to end with the real SDK ----------
function sdkThroughRelay(upstream: (c: Call) => Response | Promise<Response>, directWorks = false) {
  const up = fakeUpstream(upstream);
  const browserCalls: string[] = [];
  const base = (async (u: any, i: any = {}) => {
    const url = String(u); browserCalls.push(url);
    if (url.startsWith(APP)) return relay(new Request(url, i), up.f);
    if (!directWorks) throw new TypeError("Failed to fetch");
    return upstream({ url, init: i });
  }) as typeof fetch;
  const store = new Map<string, string>();
  const f = createAccessFetch(base, { supabaseUrl: UP, relayOrigin: APP, hint: createAccessRouteHint(memStorage()) });
  const sb = createClient(UP, KEY, { global: { fetch: f }, auth: { storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v), removeItem: (k) => void store.delete(k) }, autoRefreshToken: false, persistSession: true } });
  return { sb, up, browserCalls, store };
}

test("sign-in through the gate's bounded retry: one direct failure, one relay call, wrong password stays wrong", async () => {
  const e = sdkThroughRelay(() => json({ code: "invalid_credentials", message: "Invalid login credentials" }, 400, { "x-supabase-api-version": "2024-01-01" }));
  let err: unknown;
  try { await accessStep("identity", () => e.sb.auth.signInWithPassword({ email: "a@b.c", password: "wrong" }), Date.now() + 5000); } catch (x) { err = x; }
  expect(err).toBeInstanceOf(AccessLoadError);
  expect((err as AccessLoadError).category).toBe("auth");
  expect(e.browserCalls.length).toBe(2);
  expect(e.up.calls.length).toBe(1);
  expect((await e.sb.auth.getSession()).data.session).toBeNull();
});

test("full access gate works through the relay with the user's own token", async () => {
  const e = sdkThroughRelay((c) => {
    const u = new URL(c.url);
    if (u.pathname === "/auth/v1/token") return json({ access_token: TOKEN, refresh_token: "r1", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: UID, aud: "authenticated" } });
    const auth = new Headers(c.init.headers).get("authorization");
    if (auth !== `Bearer ${TOKEN}`) return json({ message: "no auth" }, 401);
    if (u.pathname === "/auth/v1/user") return json({ id: UID, aud: "authenticated" });
    if (u.pathname.endsWith("password_reset_state")) return json({ allowed: true, required: false });
    return json([{ role: "operation" }]);
  });
  await accessStep("identity", () => e.sb.auth.signInWithPassword({ email: "a@b.c", password: "ok" }), Date.now() + 5000);
  expect((await e.sb.auth.getUser()).data.user?.id).toBe(UID);
  expect((await (e.sb as any).rpc("password_reset_state")).data).toEqual({ allowed: true, required: false });
  expect((await e.sb.from("user_roles" as any).select("role").eq("user_id", UID)).data).toEqual([{ role: "operation" }]);
  expect(e.browserCalls.slice(1).every((u) => u.startsWith(APP + ACCESS_RELAY_PREFIX))).toBe(true);
});

test("working clients never touch the relay", async () => {
  const e = sdkThroughRelay(() => json({ id: UID, aud: "authenticated" }), true);
  await e.sb.auth.getUser("jwt-of-user-abc");
  expect(e.browserCalls.every((u) => u.startsWith(UP))).toBe(true);
  expect(e.up.calls.length).toBe(0);
});
