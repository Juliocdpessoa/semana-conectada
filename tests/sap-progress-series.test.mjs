import test from "node:test";
import assert from "node:assert/strict";
import { sapProgressSeries } from "../src/lib/sap-progress-series.ts";
const progress = {
  hasSource: true,
  invalidHours: 0,
  planned: 105.6,
  earned: 70.4,
  days: [
    { date: "2026-10-19", planned: 35.2, earned: 35.2 },
    { date: "2026-10-20", planned: 35.2, earned: 17.6 },
    { date: "2026-10-21", planned: 35.2, earned: 17.6 },
  ],
};
test("daily HH bars reconcile with accumulated SAP percentages, not operational statuses", () => {
  const rows = sapProgressSeries("2026-10-19", "2026-10-21", progress);
  assert.equal(rows.length, 3);
  assert.equal(rows[1].dailyEarned, 17.6);
  assert.equal(rows[1].dailyRemaining, 17.6);
  assert.equal(rows[0].dailyRemaining, 0);
  assert.ok(Math.abs(rows.at(-1).planned - 100) < 1e-8);
  assert.ok(Math.abs(rows.at(-1).earned - (70.4 / 105.6) * 100) < 1e-8);
});
test("no SAP and invalid planned hours never become zero measured bars", () => {
  for (const partial of [{ hasSource: false }, { invalidHours: 1 }]) {
    const rows = sapProgressSeries("2026-10-19", "2026-10-21", { ...progress, ...partial });
    assert.equal(rows[0].dailyPlanned, 35.2);
    assert.equal(rows[0].dailyEarned, null);
    assert.equal(rows[0].dailyRemaining, null);
    assert.equal(rows[0].earned, null);
  }
});
