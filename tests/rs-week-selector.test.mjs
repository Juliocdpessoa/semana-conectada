import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const panel = readFileSync(
  new URL("../src/components/weekly-realization-panel.tsx", import.meta.url),
  "utf8",
);
const selector = readFileSync(
  new URL("../src/components/rs-week-selector.tsx", import.meta.url),
  "utf8",
);
test("one existing week selector drives both single and multi-week RS automatically", () => {
  assert.ok(panel.includes("<RsWeekSelector"));
  assert.ok(panel.includes("activeWeeks.length > 1"));
  assert.ok(panel.includes("<SelectedWeeksResults"));
  assert.ok(panel.includes("<WeeklyResults"));
  assert.doesNotMatch(
    panel,
    /MonthlyRealizationPanel|setPeriod|Mensal · selecionar semanas|Consolidar semanas/,
  );
  assert.ok(panel.includes("setTimeout(() => setSettled(signature), 300)"));
});
test("multi selection reuses the same RS cards, table, bars and frozen weekly calculations", () => {
  assert.ok(panel.includes("consolidateMonthlyRs(sources)"));
  assert.ok(panel.includes("consolidated: { weeks: sources, complete, calculation }"));
  assert.ok(panel.includes("data.consolidated.calculation.centerRows"));
  assert.ok(panel.includes("programmedConsidered === null"));
  assert.ok(panel.includes("Semanas sem dados") || panel.includes("semanas sem dados"));
});
test("chooser supports checkboxes, clear, single-week shortcut and bounded selection", () => {
  for (const term of [
    "PopoverContent",
    'type="checkbox"',
    "selected.length >= 12",
    "onChange([week.id])",
    "onChange([])",
    "cálculo automático",
  ])
    assert.ok(selector.includes(term), term);
});
