import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { pendingHours, pendingPageHours } from "../src/lib/rs-center-pending.ts";
test("HH preserves genuine zero and never turns missing or invalid into zero", () => {
  assert.equal(pendingHours(17.6), 17.6);
  assert.equal(pendingHours("35.2"), 35.2);
  assert.equal(pendingHours(0), 0);
  for (const value of [null, undefined, "", " ", NaN, Infinity, -1, false, "x"])
    assert.equal(pendingHours(value), null);
  assert.equal(
    pendingPageHours([{ planned_hh: 17.6 }, { planned_hh: "35.2" }]),
    52.800000000000004,
  );
  assert.equal(pendingPageHours([{ planned_hh: null }]), null);
});
test("total is calculated before pagination and UI distinguishes page subtotal", () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
  const sql = read("../supabase/migrations/20261027150000_rs_pending_hours.sql");
  assert.match(sql, /hours_summary AS \([\s\S]*FROM pending\s*\), page AS/);
  assert.match(sql, /'totalPlannedHh'/);
  assert.match(sql, /CASE WHEN missing=0 THEN/);
  const view = read("../src/components/rs-center-pending-tasks.tsx");
  assert.match(view, /hours\(row.planned_hh\)/);
  assert.match(view, /Subtotal desta página/);
  assert.match(view, /hours\(query.data.totalPlannedHh\)/);
  assert.match(view, /todas as páginas/);
});
