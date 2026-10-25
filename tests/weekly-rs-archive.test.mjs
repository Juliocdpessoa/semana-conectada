import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const read = (path) =>
  readFileSync(new URL("../" + path, import.meta.url), "utf8").replaceAll("\r\n", "\n");
const sql = read("supabase/migrations/20261023150000_weekly_rs_archive.sql");
test("both migration systems carry the same archive definition", () => {
  assert.equal(sql.trim(), read("drizzle/migrations/0022_weekly_rs_archive.sql").trim());
});
test("archive retains sources and prohibits changes to official versions", () => {
  assert.match(sql, /UNIQUE\(week_id,version\)/);
  for (const table of [
    "weekly_rs_closures",
    "weekly_rs_closure_scopes",
    "weekly_rs_closure_items",
    "sap_confirmation_rows",
    "sap_confirmation_imports",
  ]) {
    assert.ok(sql.includes(`BEFORE UPDATE OR DELETE ON public.${table}`), table);
  }
  assert.doesNotMatch(sql, /DELETE FROM|TRUNCATE /i);
  assert.match(sql, /FOR UPDATE/);
  assert.match(sql, /FOREACH scope IN ARRAY ARRAY\['ALL','IARI','ROTINA'\]/);
});
test("all historical endpoints enforce SAP and worksite access", () => {
  for (const name of [
    "get_weekly_rs_report",
    "list_weekly_rs_closures",
    "get_weekly_rs_closure_items",
    "get_weekly_rs_closure_pending",
    "list_weekly_sap_loads",
    "get_weekly_sap_load_rows",
  ]) {
    const body = sql.split(`FUNCTION public.${name}(`)[1].split("END $$;")[0];
    assert.match(body, /can_access_sap\(auth.uid\(\)\)/);
    assert.match(body, /can_access_worksite\(auth.uid\(\),/);
    assert.ok(sql.includes(`GRANT EXECUTE ON FUNCTION public.${name}(`));
  }
});
test("archive includes original programming, SAP, audit, availability and evidence", () => {
  for (const kind of [
    "activity",
    "activity_history",
    "sap",
    "sap_import",
    "availability",
    "availability_history",
  ])
    assert.ok(sql.includes(`cid,'${kind}'`), kind);
  assert.match(sql, /archived_evidence/);
  assert.match(sql, /weekly_rs_closure_pending[\s\S]*weekly_rs_closure_items/);
});
test("client reads frozen calculation and does not recompute official versions", () => {
  const panel = read("src/components/weekly-realization-panel.tsx");
  assert.match(panel, /data.isFrozen && data.frozenCalculation\s*\? data.frozenCalculation/);
  assert.match(panel, /data.isFrozen(?:\s*\|\|\s*data.consolidated)?\s*\? calculation.result/);
  assert.match(panel, /p_version: version/);
  assert.match(panel, /\.limit\(600\)/);
  const history = read("src/components/weekly-sap-load-history.tsx");
  assert.match(history, /enabled: open/);
  assert.match(history, /p_limit: 10/);
  assert.match(history, /p_limit: 500/);
});
test("Excel expands availability rows instead of packing full tables into one cell", () => {
  const archive = read("src/components/weekly-rs-archive.tsx");
  assert.match(archive, /const \{ rows, \.\.\.metadata \} = record/);
  assert.match(archive, /Memória/);
  assert.match(archive, /JSON.stringify\(\{ closure, scopes, records \}/);
});
test("new imports no longer require destructive four-week cleanup", () => {
  const imports = read("src/lib/week-import.functions.ts");
  assert.doesNotMatch(imports, /weeksCount|limite de 4 semanas/);
  assert.match(imports, /weekly_rs_closures/);
  assert.match(read("src/components/operational-imports.tsx"), /\.limit\(6\)/);
});
test("archive offers deadline extension with explicit timezone and refreshes operational views", () => {
  const archive = read("src/components/weekly-rs-archive.tsx");
  assert.match(archive, /extend_sap_week_deadline/);
  assert.match(archive, /p_deadline: new Date\(deadline\).toISOString\(\)/);
  assert.match(archive, /new Date\(deadline\).getTime\(\) <= Date.now\(\)/);
  assert.match(archive, /Prorrogar prazo/);
  assert.match(archive, /America\/Sao_Paulo/);
  assert.match(archive, /queryKey: \["sap-confirmation-overview"\]/);
});
test("historical exports use frozen week metadata and expose task fields as columns", () => {
  const archive = read("src/components/weekly-rs-archive.tsx");
  assert.match(archive, /closure.week_info\?\.code/);
  assert.match(archive, /week: closure.week_info/);
  assert.doesNotMatch(archive, /week: data.week/);
  assert.match(archive, /fields\("Programação · ", planning_data\)/);
  assert.match(archive, /fields\("Conferência · ", archived_evidence\)/);
});
