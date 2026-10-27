import assert from "node:assert/strict";
import { test } from "node:test";
import {
  evolutionWindow,
  evolutionPoints,
  evolutionColor,
  evolutionLabel,
} from "../src/lib/rs-weekly-evolution.ts";
const week = (id) => ({
  id,
  code: `0${id}-2026 Programação`,
  label: `Semana ${id}`,
  start_date: "2026-10-01",
  end_date: "2026-10-05",
});
test("bounded chronological pages preserve input and reach older history", () => {
  const weeks = Array.from({ length: 26 }, (_, i) => ({
    id: String(i),
    start_date: new Date(Date.UTC(2026, 0, 5 + i * 7)).toISOString().slice(0, 10),
  }));
  const copy = [...weeks];
  assert.deepEqual(
    evolutionWindow(weeks).weeks.map((w) => +w.id),
    Array.from({ length: 12 }, (_, i) => i + 14),
  );
  assert.deepEqual(
    evolutionWindow(weeks, 2).weeks.map((w) => +w.id),
    [0, 1],
  );
  assert.equal(evolutionWindow(weeks, 100).page, 2);
  assert.deepEqual(weeks, copy);
  assert.deepEqual(evolutionWindow([]).weeks, []);
});
test("each week's governed result is preserved, including frozen and true zero", () => {
  const weeks = [week("a"), week("b"), week("c")];
  const reports = [
    { week: weeks[0], valid: true, isFrozen: true, calculation: { result: { rs: 98, factor: 0 } } },
    { week: weeks[1], valid: true, calculation: { result: { rs: 0, factor: -0.02 } } },
  ];
  const points = evolutionPoints(weeks, reports);
  assert.equal(points[0].rs, 98);
  assert.equal(points[0].frozen, true);
  assert.equal(points[1].rs, 0);
  assert.equal(points[2].rs, null);
});
test("invalid, absent and nonfinite results never become zero or a valid bar", () => {
  for (const report of [
    { valid: false, calculation: { result: { rs: 99 } }, issues: ["Sem carga SAP detalhada"] },
    { valid: true, calculation: { result: null } },
    { valid: true, calculation: { result: { rs: NaN } } },
  ]) {
    const point = evolutionPoints([week("a")], [{ week: week("a"), ...report }])[0];
    assert.equal(point.rs, null);
    assert.ok(point.issues.length);
  }
});
test("colors use the existing contractual factor without recapping RS", () => {
  assert.equal(evolutionColor(-0.02), "#dc2626");
  assert.equal(evolutionColor(-0.01), "#d97706");
  assert.equal(evolutionColor(0), "#16a34a");
  assert.equal(evolutionColor(0.01), "#0284c7");
  const [point] = evolutionPoints(
    [week("a")],
    [{ week: week("a"), valid: true, calculation: { result: { rs: 103, factor: 0.01 } } }],
  );
  assert.equal(point.rs, 103);
});
test("axis labels retain week and year without long programming suffix", () => {
  assert.equal(evolutionLabel(week("43")), "S43 · 26");
  assert.equal(evolutionLabel({ ...week("a"), code: "Especial" }), "Especial");
});
