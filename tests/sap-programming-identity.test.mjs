import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
const sql = readFileSync(
  "supabase/migrations/20261025120000_fix_sap_programming_identity.sql",
  "utf8",
);
const source = readFileSync("src/routes/_authenticated/atividades.tsx", "utf8");
const code = source.slice(
  source.indexOf("function normalizeSapCode("),
  source.indexOf("function activitySapKey("),
);
const normalize = new Function(stripTypeScriptTypes(code) + ";return normalizeSapCode;")();
test("confirmation, operation and suboperation normalize leading zero and numeric suffixes", () => {
  for (const [a, b] of [
    ["0140398614", "140398614"],
    ["0142649080", "142649080"],
    ["0440", "440"],
    ["0470", "470"],
    ["0010", "10"],
    [" 0140398614.0 ", "140398614"],
    ["0010,0", "10"],
  ])
    assert.equal(normalize(a), normalize(b));
  assert.equal(normalize(null), "");
  assert.equal(normalize("0000"), "");
});
test("parent is not a wildcard for suboperations and explicit confirmation cannot fall back to another", () => {
  assert.match(sql, /s\.suboperation_key IS NOT DISTINCT FROM a\.activity_suboperation/);
  assert.match(
    sql,
    /a\.activity_confirmation IS NULL OR s\.confirmation_key=a\.activity_confirmation/,
  );
  assert.doesNotMatch(sql, /a\.activity_suboperation IS NULL OR/);
});
test("all linked SAP rows are excluded, not just one ranked candidate", () => {
  assert.match(sql, /SELECT DISTINCT sap_row_id FROM matched WHERE sap_row_id IS NOT NULL/);
  assert.match(sql, /AND NOT EXISTS \(SELECT 1 FROM linked_sap/);
});
test("outside detail and overview share the same calculation and access restrictions", () => {
  const detail = sql.slice(
    sql.indexOf("CREATE OR REPLACE FUNCTION public.get_sap_outside_schedule"),
  );
  assert.match(detail, /public\.get_sap_confirmation_overview\(p_week_id\)/);
  assert.match(detail, /FROM PUBLIC,anon/);
  assert.match(sql, /public\.can_access_worksite\(auth\.uid\(\),w\.worksite_id\)/);
});
test("daily HH allocation compares normalized confirmations without changing dates or raw values", () => {
  assert.match(
    source,
    /normalizeSapCode\(activityConfirmation\(activity\)\) === normalizeSapCode\(sapRow\.confirmation\)/,
  );
  assert.match(source, /withinExecutionPeriod/);
  assert.doesNotMatch(sql, /UPDATE public\.|DELETE FROM public\.|INSERT INTO public\./);
});
