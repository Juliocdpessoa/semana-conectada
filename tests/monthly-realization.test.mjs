import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import { consolidateMonthlyRs, rsWeekOverlapsMonth } from "../src/lib/monthly-realization.ts";
function week(id, available, considered, extra = {}) {
  const row = {
    specialty: "Soldagem",
    centers: ["SOLD"],
    includedInRs: true,
    available,
    programmed: available,
    programmedConsidered: available,
    completed: considered,
    completedForRs: considered,
    immediate: 0,
    considered,
    excess: 0,
    occupation: 1,
    rs: (considered / available) * 100,
  };
  return {
    week: { id, code: id, label: id, start_date: "2026-10-01", end_date: "2026-10-05" },
    valid: true,
    isFrozen: false,
    closure: null,
    basis: null,
    source: { source_file_name: "SAP.xlsx", imported_at: "2026-10-01" },
    issues: [],
    calculation: {
      result: { rs: row.rs, programmedConsidered: available },
      totals: { available, considered },
      rows: [row],
      centerRows: [{ ...row, center: "SOLD" }],
    },
    ...extra,
  };
}
test("monthly RS weights weekly hours; never averages weekly percentages", () => {
  const result = consolidateMonthlyRs([week("a", 100, 100), week("b", 900, 450)]);
  assert.ok(Math.abs(result.result.rs - 55) < 1e-10);
  assert.notEqual(result.result.rs, 75);
  assert.equal(result.totals.considered, 550);
  assert.equal(result.totals.available, 1000);
});
test("weekly capped credit is preserved: excess cannot compensate another week", () => {
  const a = week("a", 100, 100);
  a.calculation.rows[0].completed = 150;
  a.calculation.rows[0].completedForRs = 150;
  a.calculation.rows[0].excess = 50;
  const result = consolidateMonthlyRs([a, week("b", 100, 50)]);
  assert.equal(result.result.rs, 75);
  assert.equal(result.totals.completedForRs, 200);
  assert.equal(result.totals.considered, 150);
});
test("weekly capped occupation is summed, never recomputed from gross monthly programming", () => {
  const a = week("a", 100, 100),
    b = week("b", 100, 50);
  a.calculation.rows[0].programmed = 200;
  b.calculation.rows[0].programmed = 50;
  b.calculation.rows[0].programmedConsidered = 50;
  b.calculation.result.programmedConsidered = 50;
  const result = consolidateMonthlyRs([a, b]);
  assert.equal(result.result.occupation, 0.75);
  assert.equal(result.result.rs, 75);
});
test("general occupation preserves the weekly GENERAL TP, not the specialty TP sum", () => {
  const a = week("a", 100, 50);
  a.calculation.rows[0].programmedConsidered = 50;
  assert.equal(consolidateMonthlyRs([a]).result.occupation, 1);
  assert.equal(consolidateMonthlyRs([a]).rows[0].occupation, 0.5);
});
test("monitoring-only rows do not enter any monthly total; zero centers and specialty changes retain identity", () => {
  const a = week("a", 100, 100);
  a.calculation.rows.push({
    ...a.calculation.rows[0],
    specialty: "Alpinismo",
    includedInRs: false,
    available: 1000,
    considered: 999,
  });
  const result = consolidateMonthlyRs([a]);
  assert.equal(result.totals.available, 100);
  assert.equal(result.rows.length, 2);
  assert.equal(result.result.rs, 100);
});
test("missing SAP/invalid week blocks every monthly RS and factor, not a measured zero", () => {
  const b = week("b", 100, 0, { valid: false, issues: ["Sem SAP"] });
  b.calculation.result = null;
  const result = consolidateMonthlyRs([week("a", 100, 100), b]);
  assert.equal(result.complete, false);
  assert.equal(result.result, null);
  assert.ok(result.rows.every((row) => row.rs === null));
  assert.equal(consolidateMonthlyRs([]).result, null);
});
test("duplicate weeks and invalid HH are refused; true zero credit is valid", () => {
  assert.throws(
    () => consolidateMonthlyRs([week("a", 100, 100), week("a", 100, 100)]),
    /duplicada/,
  );
  const invalid = week("a", 100, 0);
  invalid.calculation.rows[0].considered = NaN;
  assert.throws(() => consolidateMonthlyRs([invalid]), /inválido/);
  assert.equal(consolidateMonthlyRs([week("a", 100, 0)]).result.rs, 0);
});
test("95 and 98 boundaries use monthly numerator and denominator", () => {
  assert.equal(consolidateMonthlyRs([week("a", 100, 95)]).result.factor, -0.01);
  assert.equal(consolidateMonthlyRs([week("a", 100, 98)]).result.factor, 0);
});
test("month chooser includes weeks crossing the year/month; selection means full week", () => {
  const crossing = { start_date: "2026-09-28", end_date: "2026-10-02" };
  assert.equal(rsWeekOverlapsMonth(crossing, "2026", "10"), true);
  assert.equal(rsWeekOverlapsMonth(crossing, "2026", "09"), true);
  assert.equal(rsWeekOverlapsMonth(crossing, "2026", "11"), false);
  assert.equal(
    rsWeekOverlapsMonth({ start_date: "2026-12-28", end_date: "2027-01-01" }, "2027", "01"),
    true,
  );
});
test("read-only backend protects worksite, duplicate selection and frozen sources", () => {
  const sql = fs.readFileSync(
    new URL("../supabase/migrations/20261025010000_monthly_rs_selection.sql", import.meta.url),
    "utf8",
  );
  assert.equal(
    sql,
    fs.readFileSync(
      new URL("../drizzle/migrations/0025_monthly_rs_selection.sql", import.meta.url),
      "utf8",
    ),
  );
  for (const term of [
    "can_access_sap(auth.uid())",
    "can_access_worksite(auth.uid(),p_worksite_id)",
    "count(DISTINCT x)",
    "worksite_id=p_worksite_id",
    "get_weekly_rs_report",
    "frozenCalculation",
    "'valid',jsonb_array_length(issues)=0",
  ])
    assert.ok(sql.includes(term), term);
  assert.ok(!/INSERT INTO|UPDATE public|DELETE FROM/i.test(sql));
  const ui = fs.readFileSync(
    new URL("../src/components/weekly-realization-panel.tsx", import.meta.url),
    "utf8",
  );
  assert.ok(ui.includes("enabled: settled === signature"));
  assert.ok(ui.includes('p_week_ids: settled.split("|")'));
  assert.ok(ui.includes("!complete"));
  assert.ok(ui.includes("<RsWeekSelector"));
});
