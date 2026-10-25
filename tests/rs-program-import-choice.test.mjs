import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { z } from "zod";
import { rsProgramImportError } from "../src/lib/rs-program-base.ts";
const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const server = read("src/lib/week-import.functions.ts");
const prefix = server.slice(
  server.indexOf("function normalizeReleaseType"),
  server.indexOf("async function loadPlanningContext"),
);
const schema = new Function(
  "z",
  "rsProgramImportError",
  stripTypeScriptTypes(prefix) + "; return importSchema;",
)(z, rsProgramImportError);
const rows = [
  {
    confirmation: "123",
    order_number: "202123",
    operation: "10",
    suboperation: "",
    center: "SOLD",
    work: 88,
    source_row_number: 2,
    source_data: { Trabalho: 88 },
  },
];
const payload = {
  code: "045-2026",
  label: "Semana 45",
  start_date: "2026-11-02",
  end_date: "2026-11-06",
  rows: [{ source_key: "task1", planning_data: {} }],
};
test("a new weekly import requires an explicit RS decision, in client and server", () => {
  assert.ok(rsProgramImportError("", rows));
  assert.equal(schema.safeParse(payload).success, false);
  assert.equal(
    schema.safeParse({ ...payload, rs_base_action: "update", rs_program: rows }).success,
    true,
  );
  assert.equal(schema.safeParse({ ...payload, rs_base_action: "skip" }).success, true);
});
test("yes requires a valid SAP basis; missing/empty/duplicate confirmation is refused", () => {
  assert.ok(rsProgramImportError("update", undefined));
  assert.ok(rsProgramImportError("update", rows, "Coluna Trabalho ausente"));
  assert.ok(rsProgramImportError("update", [...rows, { ...rows[0], confirmation: "000123" }]));
  assert.equal(schema.safeParse({ ...payload, rs_base_action: "update" }).success, false);
  assert.equal(
    schema.safeParse({ ...payload, rs_base_action: "update", rs_program: [] }).success,
    false,
  );
  assert.equal(
    schema.safeParse({ ...payload, rs_base_action: "update", rs_program: [...rows, ...rows] })
      .success,
    false,
  );
});
test("no imports only operational tasks; basis rows cannot accidentally accompany skip", () => {
  assert.equal(rsProgramImportError("skip", undefined, "Invalid SAP tab"), null);
  assert.equal(schema.safeParse({ ...payload, rs_base_action: "skip" }).success, true);
  assert.equal(
    schema.safeParse({ ...payload, rs_base_action: "skip", rs_program: rows }).success,
    false,
  );
});
test("weekly import resets the decision for each file and retries only basis after partial success", () => {
  const ui = read("src/routes/_authenticated/planejamento.tsx");
  for (const text of [
    "Esta importação também atualiza a base oficial do RS?",
    'setRsAction("")',
    "rsProgramError",
    "generation !== readGeneration.current",
    "p_week_id: createdWeekId",
    "rs_base_action: rsAction",
    'rsAction === "update" ? parsed.rsProgram : undefined',
    "setCreatedWeekId(res.weekId)",
  ])
    assert.ok(ui.includes(text), text);
  const branch = ui.slice(
    ui.indexOf("if (createdWeekId) {"),
    ui.indexOf("const payload = parsed.rows.map"),
  );
  assert.ok(branch.includes("save_weekly_rs_program_base"));
  assert.ok(branch.includes("onDone()"));
  assert.ok(branch.includes("return;"));
  assert.ok(!branch.includes("await call("));
});
test("RS screen no longer mounts source metadata/import controls or availability shortcut", () => {
  const panel = read("src/components/weekly-realization-panel.tsx");
  for (const removed of [
    "RsProgramBaseControl",
    "Base programada RS:",
    "Disponibilidade: versão",
    "Editar disponibilidade e ver histórico",
  ])
    assert.ok(!panel.includes(removed), removed);
  assert.ok(panel.includes("<AvailabilityHistoryDetails"));
  assert.ok(panel.includes("<RsWeekSelector"));
});
