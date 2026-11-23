import { test, expect, spyOn } from "bun:test";
const {createClient}=await import(process.env.NEXO_TEST_LOCKED_SDK==='1'
 ? '../.audit-tmp/realtime-runtime/node_modules/@supabase/supabase-js/dist/index.mjs'
 : '@supabase/supabase-js');
import { matchAccessOperation, accessBodyAllowed, ACCESS_RELAY_PREFIX } from "../src/lib/access-transport-policy";
import { relayAccessRequest, isPublicClientKey } from "../src/lib/access-relay";
import { createAccessFetch, createAccessRouteHint, createAmbiguityGuard, NOT_REPEATED_TTL_MS, ACCESS_ROUTE_HINT_KEY } from "../src/lib/access-transport";
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
test("production access routing starts on the fixed relay, without a direct failure or token replay", async () => {
  const calls: string[] = [];
  const f=createAccessFetch((async (u:any) => {calls.push(String(u));return json({});}) as typeof fetch,
    {supabaseUrl: UP,relayOrigin: APP,hint:createAccessRouteHint(memStorage()),preferAccessRelay:true});
  await f(`${UP}/auth/v1/token?grant_type=refresh_token`,{method:'POST',body:JSON.stringify({refresh_token:'synthetic'})});
  await f(`${UP}/auth/v1/user`);
  await f(`${UP}/rest/v1/profiles?select=full_name&id=eq.${UID}`);
  expect(calls.length).toBe(3);
  expect(calls.every(u=>u.startsWith(`${APP}${ACCESS_RELAY_PREFIX}/`))).toBe(true);
  await f(`${UP}/rest/v1/activities?id=eq.${UID}`,{method:'PATCH',body:'{}'});
  expect(calls[3]).toBe(`${UP}/rest/v1/activities?id=eq.${UID}`);
  await f(`${UP}/rest/v1/rpc/get_activities_page`,{method:'POST',body:'{}'});
  expect(calls[4]).toBe(`${UP}/rest/v1/rpc/get_activities_page`);
});
test("hung SDK refresh aborts once and an ambiguous token is never sent again", async () => {
  let calls=0;
  const f=createAccessFetch((async (_u:any,i:any) => {calls++;return new Promise((_resolve,reject)=>{
    i.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true});
  });}) as typeof fetch,
    {supabaseUrl: UP,relayOrigin: APP,hint:createAccessRouteHint(memStorage()),preferAccessRelay:true,authTimeoutMs:20});
  const init={method:'POST',body:JSON.stringify({refresh_token:'synthetic-timeout'})};
  await expect(f(`${UP}/auth/v1/token?grant_type=refresh_token`,init)).rejects.toThrow();
  const blocked=await f(`${UP}/auth/v1/token?grant_type=refresh_token`,init);
  expect(blocked.status).toBe(503);
  expect(calls).toBe(1);
});
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
  expect(b.calls[1]!.init.signal?.aborted).toBe(false);
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

test("long or idle sessions choose the known relay BEFORE sending a rotating token", async () => {
  let now = 1_000_000;
  const storage = memStorage();
  createAccessRouteHint(storage, () => now).markDirectFailed();
  now += 6 * 60 * 60 * 1000 + 1;
  const hint = createAccessRouteHint(storage, () => now); // simulate a reload after expiry
  expect(hint.useRelay()).toBe(false);
  const calls: string[] = [];
  const f = createAccessFetch((async u => { calls.push(String(u)); return json({ ok: true }); }) as typeof fetch,
    { supabaseUrl: UP, relayOrigin: APP, hint, now: () => now });
  await f(`${UP}/auth/v1/token?grant_type=refresh_token`, { method: "POST", body: JSON.stringify({ refresh_token: "r1" }) });
  expect(calls).toEqual([`${APP}${ACCESS_RELAY_PREFIX}/auth/v1/token?grant_type=refresh_token`]);
  expect(hint.useRelay()).toBe(true); // a successful relay keeps active sessions on the working route
});

test("successful relay use renews the route preference; unrelated clients keep their direct route", async () => {
  let now = 1_000_000; const storage = memStorage();
  const hint = createAccessRouteHint(storage, () => now); hint.markDirectFailed();
  now += 5 * 60 * 60 * 1000;
  const calls: string[] = [];
  const base = (async u => { calls.push(String(u)); return json({}); }) as typeof fetch;
  await createAccessFetch(base, { supabaseUrl: UP, relayOrigin: APP, hint, now: () => now })(`${UP}/auth/v1/user`);
  now += 2 * 60 * 60 * 1000;
  expect(createAccessRouteHint(storage, () => now).useRelay()).toBe(true);
  const freshHint = createAccessRouteHint(memStorage(), () => now);
  await createAccessFetch(base, { supabaseUrl: UP, relayOrigin: APP, hint: freshHint })(`${UP}/auth/v1/token?grant_type=refresh_token`, { method: "POST", body: JSON.stringify({ refresh_token: "another-user" }) });
  expect(calls[1]).toBe(`${UP}/auth/v1/token?grant_type=refresh_token`);
});

test("old or tampered routing history does not pin future sessions to a relay forever", () => {
  let now = 1_000_000; const storage = memStorage();
  const hint = createAccessRouteHint(storage, () => now); hint.markDirectFailed();
  now += 32 * 24 * 60 * 60 * 1000;
  expect(hint.hasRelayHistory?.()).toBe(false);
  storage.setItem(ACCESS_ROUTE_HINT_KEY, String(now + 10 ** 12));
  const tampered = createAccessRouteHint(storage, () => now);
  expect(tampered.useRelay()).toBe(false);
  expect(tampered.hasRelayHistory?.()).toBe(false);
});

// ---------- end to end with the real SDK ----------
test("operational list reads are scoped, authenticated and preserve both date bounds", async () => {
  const ws = "00000000-0000-0000-0000-000000000002";
  const up = fakeUpstream(c => {
    expect(new Headers(c.init.headers).get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(new URL(c.url).searchParams.get("worksite_id")).toBe(`eq.${ws}`);
    return json([]);
  });
  const q = `?select=id%2Cstatus&worksite_id=eq.${ws}&requester_user_id=eq.${UID}&order=created_at.desc%2Cid.desc&offset=0&limit=1000&overtime_date=gte.2026-11-01&overtime_date=lte.2026-11-30`;
  expect(matchAccessOperation("GET", "/rest/v1/overtime_requests", q)?.kind).toBe("read-data");
  const response = await relay(new Request(`${APP}${ACCESS_RELAY_PREFIX}/rest/v1/overtime_requests${q}`, { headers: {authorization:`Bearer ${TOKEN}`} }), up.f);
  expect(response.status).toBe(200);
  expect(new URL(up.calls[0]!.url).searchParams.getAll("overtime_date")).toEqual(["gte.2026-11-01","lte.2026-11-30"]);
  const employees = `?select=id%2Cfull_name&worksite_id=eq.${ws}&is_active=eq.true&deleted_at=is.null&order=full_name.asc&offset=0&limit=1000`;
  expect((await relay(new Request(`${APP}${ACCESS_RELAY_PREFIX}/rest/v1/employees${employees}`, {headers:{authorization:`Bearer ${TOKEN}`}}), up.f)).status).toBe(200);
  const before = up.calls.length;
  expect((await relay(new Request(`${APP}${ACCESS_RELAY_PREFIX}/rest/v1/employees${employees}`), up.f)).status).toBe(401);
  expect(up.calls.length).toBe(before);
  expect(matchAccessOperation("GET", "/rest/v1/employees", "?select=*")).toBeNull();
  expect(matchAccessOperation("PATCH", "/rest/v1/employees", employees)).toBeNull();
  expect(matchAccessOperation("GET", "/rest/v1/overtime_requests", q+"&overtime_date=gte.2026-11-02")).toBeNull();
  expect(matchAccessOperation("GET", "/rest/v1/overtime_requests", q.replace("lte.2026-11-30","gte.2026-11-30"))).toBeNull();
});

function sdkThroughRelay(upstream: (c: Call) => Response | Promise<Response>, directWorks = false, relayExtra: object = {}, preferAccessRelay=false) {
  const up = fakeUpstream(upstream);
  const browserCalls: string[] = [];
  const browserInits: RequestInit[] = [];
  const base = (async (u: any, i: any = {}) => {
    const url = String(u); browserCalls.push(url); browserInits.push(i);
    if (url.startsWith(APP)) return relay(new Request(url, i), up.f, relayExtra);
    if (!directWorks) throw new TypeError("Failed to fetch");
    return upstream({ url, init: i });
  }) as typeof fetch;
  const store = new Map<string, string>();
  const hint = createAccessRouteHint(memStorage());
  const f = createAccessFetch(base, { supabaseUrl: UP, relayOrigin: APP, hint, preferAccessRelay });
  const sb = createClient(UP, KEY, { global: { fetch: f }, auth: { storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v), removeItem: (k) => void store.delete(k) }, autoRefreshToken: false, persistSession: true } });
  return { sb, up, browserCalls, browserInits, store, f, hint };
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

// ======================================================================
// Atividades page reads (RPBC weekly page and Fiocruz continuous page)
// ======================================================================
const WEEK = "62004f20-e1dd-4d9b-b8c4-f93fdd2f04fa";
const WS = "52504243-0000-4000-8000-000000000001";

test("data allowlist accepts the exact reads captured from the Atividades page", () => {
  const ok: [string, string, string, string][] = [
    ["GET", "/rest/v1/activity_page_configs", `?select=*&worksite_id=eq.${WS}`, "read-data"],
    ["GET", "/rest/v1/weeks", "?select=id,code,label,start_date,end_date,is_active,lifecycle_status,sap_closure_status,sap_closure_deadline&order=start_date.desc&limit=6", "read-data"],
    ["GET", "/rest/v1/weeks", "?select=id,code&order=start_date.desc&lifecycle_status=in.(operational,preparation)", "read-data"],
    ["GET", "/rest/v1/weeks", "?select=*&is_active=eq.true", "read-data"],
    ["GET", "/rest/v1/weeks", `?select=*&id=eq.${WEEK}`, "read-data"],
    ["GET", "/rest/v1/sap_confirmation_imports", `?select=id,source_file_name,row_count&week_id=eq.${WEEK}&order=imported_at.desc&limit=1`, "read-data"],
    ["GET", "/rest/v1/sap_confirmation_rows", `?select=source_row_number,order_number&import_id=eq.${UID}&order=source_row_number.asc`, "read-data"],
    ["GET", "/rest/v1/activity_history", `?select=id,changed_at,changed_by_name&activity_id=eq.${UID}&order=changed_at.desc&limit=50`, "read-data"],
    ["GET", "/rest/v1/activities", `?select=id,order_number&week_id=eq.${WEEK}&is_immediate=eq.true&order=scheduled_date.asc,order_number.asc`, "read-data"],
    ["GET", "/rest/v1/continuous_activities", `?select=*&worksite_id=eq.${WS}&or=(data->>os.ilike.%25abc%25,data->>ss.ilike.%25abc%25)&data->>status=in.("Em andamento",Aberta)&data->>requested_date=gte.2026-01-01&data->>requested_date=lte.2026-02-01&order=updated_at.desc,id.asc&offset=50&limit=50`, "read-data"],
    ["GET", "/rest/v1/continuous_activity_history", `?select=*&worksite_id=eq.${WS}&record_id=eq.${UID}&order=changed_at.desc&limit=100`, "read-data"],
    ["POST", "/rest/v1/rpc/get_activities_page", "", "rpc-read"],
    ["POST", "/rest/v1/rpc/get_sap_confirmation_overview", "", "rpc-read"],
    ["POST", "/rest/v1/rpc/get_sap_outside_schedule", "", "rpc-read"],
    ["POST", "/rest/v1/rpc/get_activity_daily_capacity", "", "rpc-read"],
    ["POST", "/rest/v1/rpc/continuous_activity_facets", "", "rpc-read"],
    ["POST", "/rest/v1/rpc/continuous_activity_status_counts", "", "rpc-read"],
  ];
  for (const [m, p, q, kind] of ok) {
    const op = matchAccessOperation(m, p, q);
    expect({ p, kind: op?.kind, idempotent: op?.idempotent }).toEqual({ p, kind, idempotent: true });
  }
  expect(matchAccessOperation("GET", "/rest/v1/continuous_activities", `?select=*&worksite_id=eq.${WS}`)?.allowCount).toBe(true);
  expect(matchAccessOperation("GET", "/rest/v1/weeks", "?select=*")?.allowCount).toBe(false);
});

test("data allowlist still rejects writes, imports, admin RPCs, embeddings and loose reads", () => {
  const bad: [string, string, string][] = [
    ["PATCH", "/rest/v1/activities", `?id=eq.${UID}`],
    ["POST", "/rest/v1/activities", ""],
    ["DELETE", "/rest/v1/activity_history", `?activity_id=eq.${UID}`],
    ["PATCH", "/rest/v1/weeks", `?id=eq.${WEEK}`],
    ["POST", "/rest/v1/sap_confirmation_rows", ""],
    ["GET", "/rest/v1/activities", `?select=*&week_id=eq.${WEEK}`], // full week table read is not needed
    ["GET", "/rest/v1/activities", `?select=*,weeks(*)&week_id=eq.${WEEK}&is_immediate=eq.true`],
    ["GET", "/rest/v1/weeks", "?select=*,activities(*)"],
    ["GET", "/rest/v1/weeks", "?select=id:code"],
    ["GET", "/rest/v1/activity_history", "?select=*"],
    ["GET", "/rest/v1/sap_confirmation_rows", "?select=*"],
    ["GET", "/rest/v1/continuous_activities", `?select=*&worksite_id=eq.${WS}&data->>x=neq.1`],
    ["GET", "/rest/v1/continuous_activities", `?select=*&worksite_id=eq.${WS}&or=(id.not.is.null)`],
    ["GET", "/rest/v1/continuous_activities", `?select=*&worksite_id=eq.${WS}&data->>a=gte.2026-01-01&data->>a=lte.2026-01-02&data->>a=gte.2026-01-03`],
    ["GET", "/rest/v1/employees", "?select=*"],
    ["GET", "/rest/v1/overtime_requests", "?select=*"],
    ["POST", "/rest/v1/rpc/import_sap_confirmations", ""],
    ["POST", "/rest/v1/rpc/save_continuous_activity", ""],
    ["POST", "/rest/v1/rpc/import_continuous_activities", ""],
    ["POST", "/rest/v1/rpc/save_activity_page_config", ""],
    ["POST", "/rest/v1/rpc/bulk_update_activity_reports_v2", ""],
    ["POST", "/rest/v1/rpc/get_activities_page", "?select=rows"],
    ["GET", "/rest/v1/rpc/get_activities_page", ""],
  ];
  for (const [m, p, q] of bad) expect({ m, p, q, op: matchAccessOperation(m, p, q) }).toEqual({ m, p, q, op: null });
});

test("RPC read bodies must have the exact argument shape", () => {
  const page = { p_week_id: WEEK, p_filters: { statuses: [] }, p_page: 0, p_page_size: 500 };
  expect(accessBodyAllowed("rpc-read", JSON.stringify(page), "get_activities_page")).toBe(true);
  expect(accessBodyAllowed("rpc-read", JSON.stringify({ ...page, p_page_size: 5001 }), "get_activities_page")).toBe(false);
  expect(accessBodyAllowed("rpc-read", JSON.stringify({ ...page, extra: 1 }), "get_activities_page")).toBe(false);
  expect(accessBodyAllowed("rpc-read", JSON.stringify({ ...page, p_week_id: "x" }), "get_activities_page")).toBe(false);
  expect(accessBodyAllowed("rpc-read", JSON.stringify({ p_week_id: WEEK }), "get_sap_outside_schedule")).toBe(true);
  expect(accessBodyAllowed("rpc-read", JSON.stringify({ p_week_id: WEEK, p_user: UID }), "get_sap_outside_schedule")).toBe(false);
  expect(accessBodyAllowed("rpc-read", JSON.stringify({ p_worksite: WS, p_search: "", p_filters: {}, p_from: null, p_to: "2026-01-01" }), "continuous_activity_facets")).toBe(true);
  expect(accessBodyAllowed("rpc-read", JSON.stringify({ p_week_id: WEEK }), "import_sap_confirmations")).toBe(false);
  expect(accessBodyAllowed("read-data", "{}")).toBe(false);
});

test("relay forwards Prefer count=exact only for the paginated continuous list and returns content-range", async () => {
  const up = fakeUpstream(() => json([{ id: 1 }], 200, { "content-range": "0-49/321" }));
  const q = `?select=*&worksite_id=eq.${WS}&order=updated_at.desc,id.asc&offset=0&limit=50`;
  const res = await relay(new Request(`${APP}${ACCESS_RELAY_PREFIX}/rest/v1/continuous_activities${q}`, { headers: { authorization: `Bearer ${TOKEN}`, prefer: "count=exact" } }), up.f);
  expect(res.headers.get("content-range")).toBe("0-49/321");
  expect(new Headers(up.calls[0]!.init.headers).get("prefer")).toBe("count=exact");
  await relay(new Request(`${APP}${ACCESS_RELAY_PREFIX}/rest/v1/weeks?select=*&is_active=eq.true`, { headers: { prefer: "count=exact" } }), up.f);
  await relay(new Request(`${APP}${ACCESS_RELAY_PREFIX}/rest/v1/continuous_activities${q}`, { headers: { prefer: "count=exact,return=representation" } }), up.f);
  expect(new Headers(up.calls[1]!.init.headers).get("prefer")).toBeNull();
  expect(new Headers(up.calls[2]!.init.headers).get("prefer")).toBeNull();
});

test("RPC read bodies the size of a real filtered page pass; oversized ones never reach upstream", async () => {
  const up = fakeUpstream(() => json({ rows: [] }));
  const sapStatusById = Object.fromEntries(Array.from({ length: 1500 }, (_, i) => [`${UID.slice(0, -4)}${String(i).padStart(4, "0")}`, "Confirmada"]));
  const body = JSON.stringify({ p_week_id: WEEK, p_filters: { sapStatusById }, p_page: 0, p_page_size: 50 });
  expect(body.length).toBeGreaterThan(70_000);
  const ok = await relay(new Request(`${APP}${ACCESS_RELAY_PREFIX}/rest/v1/rpc/get_activities_page`, { method: "POST", body, headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` } }), up.f);
  expect(ok.status).toBe(200);
  expect(new Headers(up.calls[0]!.init.headers).get("content-profile")).toBe("public");
  const huge = JSON.stringify({ p_week_id: WEEK, p_filters: { search: "x".repeat(300_000) }, p_page: 0, p_page_size: 50 });
  const bad = await relay(new Request(`${APP}${ACCESS_RELAY_PREFIX}/rest/v1/rpc/get_activities_page`, { method: "POST", body: huge, headers: { "content-type": "application/json" } }), up.f);
  expect(bad.status).toBe(413);
  expect(up.calls.length).toBe(1);
});

test("a large page response (~0.9 MB) is relayed whole for reads, still capped for gate reads", async () => {
  const big = JSON.stringify({ rows: Array.from({ length: 500 }, (_, i) => ({ id: i, description: "x".repeat(1700) })) });
  expect(big.length).toBeGreaterThan(850_000);
  const up = fakeUpstream(() => new Response(big, { headers: { "content-type": "application/json" } }));
  const res = await relay(new Request(`${APP}${ACCESS_RELAY_PREFIX}/rest/v1/rpc/get_activities_page`, { method: "POST", body: JSON.stringify({ p_week_id: WEEK, p_filters: {}, p_page: 0, p_page_size: 500 }), headers: { "content-type": "application/json" } }), up.f);
  expect((await res.text()).length).toBe(big.length);
  const gate = await relay(new Request(`${APP}${ACCESS_RELAY_PREFIX}/rest/v1/user_roles?select=role&user_id=eq.${UID}`), up.f);
  expect(gate.status).toBe(502);
  expect(gate.headers.get("x-nexo-access-outcome")).toBeNull(); // reads are never flagged
});

test("real SDK: the Atividades page reads work through the relay with the user's own token, same paging and count", async () => {
  const seen: string[] = [];
  const e = sdkThroughRelay((c) => {
    const u = new URL(c.url);
    seen.push(`${c.init.method} ${u.pathname}${u.search}`);
    if (new Headers(c.init.headers).get("authorization") !== `Bearer ${TOKEN}`) return json({ message: "no auth" }, 401);
    if (u.pathname.endsWith("/get_activities_page")) return json({ rows: [{ id: "a1" }], totalAll: 1 });
    if (u.pathname.endsWith("/weeks")) return json([{ id: WEEK, code: "047/2026" }]);
    if (u.pathname.endsWith("/activity_history")) return json([{ id: "h1" }]);
    if (u.pathname.endsWith("/continuous_activities")) return json([{ id: "c1" }], 200, { "content-range": "50-50/51" });
    return json([], 404);
  });
  // The user's own access token, as the SDK sends it after sign-in.
  const auth = { headers: { Authorization: `Bearer ${TOKEN}` } };
  const sb2 = createClient(UP, KEY, { global: { fetch: e.f, ...auth }, auth: { persistSession: false, autoRefreshToken: false } }) as any;
  // first call fails direct and switches this browser to the relay
  expect((await sb2.rpc("get_activities_page", { p_week_id: WEEK, p_filters: {}, p_page: 0, p_page_size: 500 })).error).toBeTruthy();
  expect((await sb2.rpc("get_activities_page", { p_week_id: WEEK, p_filters: {}, p_page: 0, p_page_size: 500 })).data).toEqual({ rows: [{ id: "a1" }], totalAll: 1 });
  expect((await sb2.from("weeks").select("*").eq("id", WEEK).maybeSingle()).data).toEqual({ id: WEEK, code: "047/2026" });
  expect((await sb2.from("activity_history").select("id, changed_at, changed_by_name, changed_by_email, change_source, previous_values, new_values").eq("activity_id", UID).order("changed_at", { ascending: false }).limit(50)).data).toEqual([{ id: "h1" }]);
  const cont = await sb2.from("continuous_activities").select("*", { count: "exact" }).eq("worksite_id", WS).order("updated_at", { ascending: false }).order("id").range(50, 99);
  expect(cont.count).toBe(51);
  expect(seen).toContain(`GET /rest/v1/activity_history?select=id%2Cchanged_at%2Cchanged_by_name%2Cchanged_by_email%2Cchange_source%2Cprevious_values%2Cnew_values&activity_id=eq.${UID}&order=changed_at.desc&limit=50`);
  expect(seen).toContain(`GET /rest/v1/continuous_activities?select=*&worksite_id=eq.${WS}&order=updated_at.desc%2Cid.asc&offset=50&limit=50`);
});

// ======================================================================
// Ambiguous outcomes: no repetition of non-idempotent calls
// ======================================================================
const STORAGE_KEY = "sb-ref123-auth-token";
test("logout preserves a legitimate 204 instead of manufacturing an ambiguous 502", async () => {
  const up = fakeUpstream(() => new Response(null, { status: 204 }));
  const res = await relay(new Request(`${APP}${ACCESS_RELAY_PREFIX}/auth/v1/logout?scope=global`, {
    method: "POST", headers: { authorization: `Bearer ${TOKEN}` },
  }), up.f);
  expect(res.status).toBe(204);
  expect(await res.text()).toBe("");
  expect(res.headers.get("x-nexo-access-outcome")).toBeNull();
  expect(up.calls.length).toBe(1);
});

test("a lost DIRECT refresh response is ambiguous too: never resend the rotating token", async () => {
  const b = browser(async () => { throw new TypeError("Failed to fetch"); });
  const init = { method: "POST", body: JSON.stringify({ refresh_token: "r1" }) };
  await expect(b.fetch(`${UP}/auth/v1/token?grant_type=refresh_token`, init)).rejects.toThrow();
  const again = await b.fetch(`${UP}/auth/v1/token?grant_type=refresh_token`, init);
  expect(again.status).toBe(503);
  expect(b.calls.length).toBe(1);
  expect(b.hint.useRelay()).toBe(true);
});

function expiredSession(refresh = "r1") {
  return JSON.stringify({ access_token: TOKEN, refresh_token: refresh, token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) - 60, user: { id: UID, aud: "authenticated" } });
}

test("real SDK refresh: an ambiguous relay result is sent upstream once, never rotated again, and the session is kept", async () => {
  let tokenCalls = 0;
  const e = sdkThroughRelay((c) => {
    if (new URL(c.url).pathname === "/auth/v1/token") { tokenCalls++; throw new TypeError("fetch failed"); } // upstream lost mid-request
    return json({}, 404);
  });
  e.hint.markDirectFailed();
  e.store.set(STORAGE_KEY, expiredSession());
  const { error } = await e.sb.auth.getSession(); // SDK refreshes and retries with backoff by itself
  expect(error?.name).toBe("AuthRetryableFetchError");
  expect(tokenCalls).toBe(1); // one relay call; every SDK retry stayed local
  expect(e.browserCalls.filter((u) => u.startsWith(APP)).length).toBe(1);
  expect(JSON.parse(e.store.get(STORAGE_KEY)!).refresh_token).toBe("r1"); // transient: session not deleted
  // Even a caller bypassing the SDK cooldown gets a local answer for the same token.
  const relayInit = e.browserInits[e.browserCalls.findIndex((u) => u.startsWith(APP))]!;
  const res = await e.f(`${UP}/auth/v1/token?grant_type=refresh_token`, relayInit);
  expect(res.status).toBe(503);
  expect(res.headers.get("x-nexo-access-outcome")).toBe("not-repeated");
  expect(tokenCalls).toBe(1);
  // A different refresh token (e.g. after a new sign-in) is not blocked.
  const other = await e.f(`${UP}/auth/v1/token?grant_type=refresh_token`, { ...relayInit, body: JSON.stringify({ refresh_token: "r2" }) });
  expect(other.status).toBe(502);
  expect(tokenCalls).toBe(2);
}, 45_000);

test("real SDK refresh: a definite answer is relayed once and saved normally", async () => {
  let tokenCalls = 0;
  const e = sdkThroughRelay((c) => {
    if (new URL(c.url).pathname === "/auth/v1/token") {
      tokenCalls++;
      return json({ access_token: TOKEN + "-new", refresh_token: "r2", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: UID, aud: "authenticated" } });
    }
    return json({}, 404);
  });
  e.hint.markDirectFailed();
  e.store.set(STORAGE_KEY, expiredSession());
  const { data } = await e.sb.auth.getSession();
  expect(data.session?.refresh_token).toBe("r2");
  expect(tokenCalls).toBe(1);
});

test("production routing: expired SDK session refreshes without any prior hint or direct request", async () => {
  let tokenCalls=0;
  const e=sdkThroughRelay(c=>{
    if(new URL(c.url).pathname==='/auth/v1/token') {
      tokenCalls++;
      return json({access_token:TOKEN+'-renewed',refresh_token:'r2',token_type:'bearer',expires_in:3600,user:{id:UID,aud:'authenticated'}});
    }
    return json({},404);
  },false,{},true);
  e.store.set(STORAGE_KEY,expiredSession());
  const {data,error}=await e.sb.auth.getSession();
  expect(error).toBeNull();
  expect(data.session?.refresh_token).toBe('r2');
  expect(tokenCalls).toBe(1);
  expect(e.browserCalls.every(u=>u.startsWith(APP))).toBe(true);
});

test("sign-in: accessStep's retry after an ambiguous relay result does not resend the password", async () => {
  const e = sdkThroughRelay(() => json({ message: "upstream error" }, 502));
  let err: unknown;
  try { await accessStep("identity", () => e.sb.auth.signInWithPassword({ email: "a@b.c", password: "ok" }), Date.now() + 5000); } catch (x) { err = x; }
  expect(err).toBeInstanceOf(AccessLoadError);
  expect((err as AccessLoadError).attempts).toBe(2);
  expect(e.up.calls.length).toBe(1); // second attempt answered locally
  expect((await e.sb.auth.getSession()).data.session).toBeNull();
});

test("transport marks ambiguity for relay failures and hung direct calls, not for a direct refusal", async () => {
  const body = JSON.stringify({ email: "a@b.c", password: "x" });
  const post = { method: "POST", body, headers: { authorization: `Bearer ${KEY}` } };
  // direct refusal (domain unreachable): not delivered, the next attempt is sent via the relay
  const b1 = browser(async (u) => { if (u.startsWith(UP)) throw new TypeError("Failed to fetch"); return json({ code: "invalid_credentials" }, 400); });
  await expect(b1.fetch(`${UP}/auth/v1/token?grant_type=password`, post)).rejects.toThrow();
  expect((await b1.fetch(`${UP}/auth/v1/token?grant_type=password`, post)).status).toBe(400);
  expect(b1.calls.length).toBe(2);
  // relay network failure: may have reached the server, never resent
  const b2 = browser(async () => { throw new TypeError("Failed to fetch"); });
  b2.hint.markDirectFailed();
  await expect(b2.fetch(`${UP}/auth/v1/token?grant_type=password`, post)).rejects.toThrow();
  expect((await b2.fetch(`${UP}/auth/v1/token?grant_type=password`, post)).status).toBe(503);
  expect(b2.calls.length).toBe(1);
  // hung direct call (aborted after the hung threshold): ambiguous
  let t = 0;
  const calls: string[] = [];
  const f3 = createAccessFetch((async (u: any) => { calls.push(String(u)); t += 8000; throw new DOMException("aborted", "AbortError"); }) as typeof fetch, { supabaseUrl: UP, relayOrigin: APP, hint: createAccessRouteHint(memStorage()), now: () => t });
  await expect(f3(`${UP}/auth/v1/logout?scope=global`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}` } })).rejects.toThrow();
  expect((await f3(`${UP}/auth/v1/logout?scope=global`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}` } })).status).toBe(503);
  expect(calls.length).toBe(1);
  // reads are idempotent: a relay failure does not block the next read
  const b4 = browser(async () => { throw new TypeError("Failed to fetch"); });
  b4.hint.markDirectFailed();
  await expect(b4.fetch(`${UP}/auth/v1/user`, {})).rejects.toThrow();
  await expect(b4.fetch(`${UP}/auth/v1/user`, {})).rejects.toThrow();
  expect(b4.calls.length).toBe(2);
});

test("password block expires; refresh block is per token", async () => {
  let t = 0;
  const g = createAmbiguityGuard(() => t);
  g.mark("k", NOT_REPEATED_TTL_MS["auth-password"]!);
  expect(g.blocked("k")).toBe(true);
  expect(g.blocked("other")).toBe(false);
  t += 60_001;
  expect(g.blocked("k")).toBe(false);
});

// ======================================================================
// SDK shapes: maybeSingle with spaces in select, real logout body
// ======================================================================
test("real SDK: maybeSingle with spaces in select is normalised and allowed; real logout body is accepted", async () => {
  const seen: Call[] = [];
  const e = sdkThroughRelay((c) => {
    seen.push(c);
    const u = new URL(c.url);
    if (u.pathname === "/auth/v1/token") return json({ access_token: TOKEN, refresh_token: "r1", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: UID, aud: "authenticated" } });
    if (u.pathname === "/auth/v1/logout") return new Response(null, { status: 204 });
    return json([{ email: "a@b.c", full_name: "A", approval_status: "approved", worksite_id: WS }]);
  });
  await accessStep("identity", () => e.sb.auth.signInWithPassword({ email: "a@b.c", password: "ok" }), Date.now() + 5000);
  const profile = await (e.sb as any).from("profiles").select("email, full_name, approval_status, worksite_id").eq("id", UID).maybeSingle();
  expect(profile.error).toBeNull();
  expect(profile.data.worksite_id).toBe(WS);
  const prof = seen.find((c) => c.url.includes("/profiles"))!;
  expect(new URL(prof.url).searchParams.get("select")).toBe("email,full_name,approval_status,worksite_id");
  const { error } = await e.sb.auth.signOut();
  expect(error).toBeNull();
  const logout = seen.find((c) => c.url.includes("/auth/v1/logout"))!;
  expect(new URL(logout.url).search).toBe("?scope=global");
  expect(logout.init.body).toBeUndefined();
  expect(new Headers(logout.init.headers).get("authorization")).toBe(`Bearer ${TOKEN}`);
  expect(e.store.size).toBe(0);
});

// ======================================================================
// Rate limits stay rate limits
// ======================================================================
test("HTTP 429 stays 429 with retry-after, is not retried and is never an invalid-password error", async () => {
  const up = fakeUpstream(() => json({ code: "over_request_rate_limit", message: "Request rate limit reached" }, 429, { "retry-after": "30" }));
  const res = await relay(new Request(`${APP}${ACCESS_RELAY_PREFIX}/auth/v1/token?grant_type=password`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "a@b.c", password: "x" }) }), up.f);
  expect(res.status).toBe(429);
  expect(res.headers.get("retry-after")).toBe("30");
  expect(res.headers.get("x-nexo-access-outcome")).toBeNull();

  const e = sdkThroughRelay(() => json({ code: "over_request_rate_limit", message: "Request rate limit reached" }, 429, { "retry-after": "30" }));
  let err: unknown;
  try { await accessStep("identity", () => e.sb.auth.signInWithPassword({ email: "a@b.c", password: "ok" }), Date.now() + 5000); } catch (x) { err = x; }
  // attempt 1 = direct refusal (switches to the relay), attempt 2 = 429: no further retry
  expect((err as AccessLoadError).attempts).toBe(2);
  expect((err as AccessLoadError).category).not.toBe("auth");
  expect(e.browserCalls.length).toBe(2);
  expect(e.up.calls.length).toBe(1);
  // once on the relay, a 429 ends the step on the first attempt
  let err2: unknown;
  try { await accessStep("identity", () => e.sb.auth.signInWithPassword({ email: "a@b.c", password: "ok" }), Date.now() + 5000); } catch (x) { err2 = x; }
  expect((err2 as AccessLoadError).attempts).toBe(1);
  expect(e.up.calls.length).toBe(2);
  const data = await relay(new Request(`${APP}${ACCESS_RELAY_PREFIX}/rest/v1/weeks?select=*&is_active=eq.true`), fakeUpstream(() => json({ message: "slow down" }, 429, { "retry-after": "5" })).f);
  expect([data.status, data.headers.get("retry-after")]).toEqual([429, "5"]);
});

// ======================================================================
// Abort and timeout before upstream
// ======================================================================
test("an already-aborted request never reaches upstream", async () => {
  const up = fakeUpstream(() => json({}));
  const ctrl = new AbortController(); ctrl.abort();
  const res = await relay(new Request(`${APP}${ACCESS_RELAY_PREFIX}/auth/v1/user`, { signal: ctrl.signal, headers: { authorization: `Bearer ${TOKEN}` } }), up.f);
  expect(res.status).toBe(499);
  const post = await relay(new Request(`${APP}${ACCESS_RELAY_PREFIX}/auth/v1/token?grant_type=password`, { method: "POST", signal: ctrl.signal, headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "a@b.c", password: "x" }) }), up.f);
  expect(post.status).toBe(499);
  expect(post.headers.get("x-nexo-access-outcome")).toBeNull();
  expect(up.calls.length).toBe(0);
});

test("the timeout also covers a slow request body: 408, upstream never called", async () => {
  const up = fakeUpstream(() => json({}));
  const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode('{"email":"a@b.c",')); /* never closes */ } });
  const req = new Request(`${APP}${ACCESS_RELAY_PREFIX}/auth/v1/token?grant_type=password`, { method: "POST", body: stream, headers: { "content-type": "application/json" }, duplex: "half" } as RequestInit);
  const started = Date.now();
  const res = await relay(req, up.f, { timeoutMs: 50 });
  expect(res.status).toBe(408);
  expect(Date.now() - started).toBeLessThan(2000);
  expect(up.calls.length).toBe(0);
});

test("the timeout covers a slow upstream body; writes come back ambiguous, reads do not", async () => {
  const slow = () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("{")); } }), { headers: { "content-type": "application/json" } });
  const w = await relay(new Request(`${APP}${ACCESS_RELAY_PREFIX}/auth/v1/token?grant_type=refresh_token`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ refresh_token: "abc123" }) }), fakeUpstream(slow).f, { timeoutMs: 50 });
  expect([w.status, w.headers.get("x-nexo-access-outcome")]).toEqual([504, "ambiguous"]);
  const r = await relay(new Request(`${APP}${ACCESS_RELAY_PREFIX}/rest/v1/weeks?select=*&is_active=eq.true`), fakeUpstream(slow).f, { timeoutMs: 50 });
  expect([r.status, r.headers.get("x-nexo-access-outcome")]).toEqual([504, null]);
});

test("upstream 5xx on a write is flagged ambiguous; on a read it is passed through untouched", async () => {
  const w = await relay(new Request(`${APP}${ACCESS_RELAY_PREFIX}/auth/v1/logout?scope=global`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}` } }), fakeUpstream(() => json({}, 500)).f);
  expect([w.status, w.headers.get("x-nexo-access-outcome")]).toEqual([500, "ambiguous"]);
  const r = await relay(new Request(`${APP}${ACCESS_RELAY_PREFIX}/auth/v1/user`, { headers: { authorization: `Bearer ${TOKEN}` } }), fakeUpstream(() => json({}, 500)).f);
  expect([r.status, r.headers.get("x-nexo-access-outcome")]).toEqual([500, null]);
});
