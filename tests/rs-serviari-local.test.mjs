import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { validateAvailability } from "../src/lib/weekly-availability.ts";
const week = { code: "040-2026", start_date: "2026-09-28", end_date: "2026-10-02" };
const row = {
  center: "SERVIARI",
  date: "2026-09-28",
  hours: 61.6,
  week: "040-2026",
  local: "IARI",
  specialty: "Serv. Gerais",
};
test("SERVIARI availability can only be saved under IARI; other centers unchanged", () => {
  assert.deepEqual(validateAvailability([row], week), []);
  assert.ok(
    validateAvailability([{ ...row, local: "ROTINA" }], week).some((error) =>
      error.includes("SERVIARI pertence sempre a IARI"),
    ),
  );
  assert.deepEqual(
    validateAvailability([{ ...row, center: "SERVENTE", local: "ROTINA" }], week),
    [],
  );
  assert.deepEqual(
    validateAvailability([{ ...row, center: " serviari ", local: "iari" }], week),
    [],
  );
});
test("local correction covers evidence, fallback and official SAP without changing stored sources", () => {
  const sql = readFileSync(
    new URL("../supabase/migrations/20261027180000_rs_serviari_iari.sql", import.meta.url),
    "utf8",
  );
  assert.match(sql, /rs_program_center\(p_center\)='SERVIARI' THEN 'IARI'/);
  for (const signature of [
    "weekly_rs_activity_evidence(uuid)",
    "get_weekly_rs_analysis(uuid,text)",
    "get_weekly_rs_official_analysis(uuid,text)",
    "save_weekly_rs_availability(uuid,jsonb,integer,text)",
  ])
    assert.ok(sql.includes(signature));
  assert.match(sql, /public.rs_center_local\(s.work_center/);
  assert.match(sql, /public.rs_center_local\(s.center/);
  assert.match(sql, /public.rs_center_local\(r->>'center'/);
  assert.match(sql, /rs-hh-2026-10-27-v4/);
  assert.doesNotMatch(sql, /\b(INSERT INTO|UPDATE public\.|DELETE FROM|ALTER TABLE)\b/);
  assert.match(sql, /IF position\(patch.old_text IN definition\)=0/);
});
