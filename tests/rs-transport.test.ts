import { test, expect } from "bun:test";
import { parseRsRpc, journeySaveSchema, RS_RPC_SCHEMAS } from "../src/lib/rs-transport-policy";
import { createRsRequest } from "../src/lib/rs-transport-request";
const id = "00000000-0000-4000-8000-000000000001";
test("rejects unknown operations, prototype keys, arbitrary SQL and extra write fields", () => {
  for (const op of ["delete_activities", "__proto__", "constructor", "select * from auth.users"])
    expect(() => parseRsRpc(op, {})).toThrow();
  expect(() =>
    parseRsRpc("get_weekly_realization", { p_week_id: id, service_role: true }),
  ).toThrow();
  expect(() =>
    parseRsRpc("close_sap_week", { p_week_id: id, p_reason: "motivo", actor_id: id }),
  ).toThrow();
});
test("accepts existing read shapes and enforces IDs, page sizes and source limits", () => {
  expect(
    parseRsRpc("get_weekly_rs_report", { p_week_id: id, p_local: null, p_version: null }),
  ).toEqual({ p_week_id: id, p_local: null, p_version: null });
  expect(() => parseRsRpc("get_weekly_rs_report", { p_week_id: "not-an-id" })).toThrow();
  expect(() =>
    parseRsRpc("get_weekly_sap_load_rows", { p_import_id: id, p_offset: 0, p_limit: 501 }),
  ).toThrow();
  expect(() =>
    parseRsRpc("get_rs_center_pending_tasks", {
      p_sources: [],
      p_center: "CALD",
      p_local: null,
      p_offset: 0,
      p_limit: 50,
    }),
  ).toThrow();
  expect(Object.keys(RS_RPC_SCHEMAS)).toHaveLength(18);
});
test("availability save preserves week, rows, filename and optimistic version", () => {
  const payload = {
    p_week_id: id,
    p_expected_version: 4,
    p_source_file_name: "capacidade.xlsx",
    p_rows: [
      {
        center: "CALD",
        date: "2026-11-20",
        hours: 17.6,
        week: "047-2026",
        local: "IARI",
        specialty: "CALD",
      },
    ],
  };
  expect(parseRsRpc("save_weekly_rs_availability", payload)).toEqual(payload);
  expect(() =>
    parseRsRpc("save_weekly_rs_availability", { ...payload, p_expected_version: -1 }),
  ).toThrow();
});
test("journey only accepts bounded daily hours and a version, not another actor", () => {
  expect(
    journeySaveSchema.parse({ weekId: id, version: 2, days: { "2026-11-20": 4.5 } }).version,
  ).toBe(2);
  expect(() =>
    journeySaveSchema.parse({ weekId: id, version: 2, days: { "2026-11-20": 25 } }),
  ).toThrow();
  expect(() =>
    journeySaveSchema.parse({ weekId: id, version: 2, days: {}, actor_id: id }),
  ).toThrow();
});
test("lazy transport forwards cancellation and executes once even if awaited twice", async () => {
  let calls = 0;
  const controller = new AbortController();
  const request = createRsRequest(async (signal) => {
    calls++;
    expect(signal).toBe(controller.signal);
    return { data: { version: 2 }, error: null };
  }).abortSignal(controller.signal);
  expect(calls).toBe(0);
  expect((await request).data.version).toBe(2);
  await request;
  expect(calls).toBe(1);
});
test("ambiguous saves never retry or falsely report success and redact raw failures", async () => {
  let calls = 0;
  const request = createRsRequest(async () => {
    calls++;
    throw Error("secret URL and token");
  }, true);
  const result = await request;
  await request;
  expect(calls).toBe(1);
  expect(result.data).toBeNull();
  expect(result.error?.message).toContain("Atualize");
  expect(result.error?.message).not.toContain("secret");
});
test("database optimistic conflicts remain explicit and are not auto-retried", async () => {
  let calls = 0;
  const conflict = {
    data: null,
    error: { message: "Outra alteração foi salva", code: "PT409", status: 409 },
  };
  const request = createRsRequest(async () => {
    calls++;
    return conflict;
  }, true);
  expect(await request).toEqual(conflict);
  await request;
  expect(calls).toBe(1);
});
