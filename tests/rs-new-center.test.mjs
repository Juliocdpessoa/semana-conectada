import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createAvailabilityCenter,
  availabilityWeekDates,
} from "../src/lib/new-availability-center.ts";
import { hasRsDisplayLoad } from "../src/lib/rs-center-display.ts";
import {
  calculateSpecialtyRealization,
  isRsMonitoringOnly,
} from "../src/lib/weekly-availability.ts";

const week = { code: "042-2026 Programação", start_date: "2026-10-13", end_date: "2026-10-16" };
const input = () => ({
  center: " cald_novo ",
  local: "rotina",
  specialty: "Caldeiraria",
  days: availabilityWeekDates(week).map((date) => ({ date, hours: 17.6 })),
});

test("zero capacity and zero programmed hides only the display, positive either keeps it", () => {
  assert.equal(hasRsDisplayLoad({ available: 0, programmed: 0 }), false);
  assert.equal(hasRsDisplayLoad({ available: 0, programmed: 8.8 }), true);
  assert.equal(hasRsDisplayLoad({ available: 8.8, programmed: 0 }), true);
});
test("new center includes only the selected week dates, normalizes code and local", () => {
  const existing = [];
  const rows = createAvailabilityCenter(existing, week, input());
  assert.equal(rows.length, 4);
  assert.equal(rows[0].date, "2026-10-13");
  assert.equal(rows[3].date, "2026-10-16");
  assert.ok(
    rows.every(
      (row) =>
        row.week === "042-2026" &&
        row.center === "CALD_NOVO" &&
        row.local === "ROTINA" &&
        row.specialty === "Caldeiraria",
    ),
  );
  assert.deepEqual(existing, []);
});
test("daily hours must be explicit, finite and nonnegative; zero is allowed", () => {
  for (const hours of [NaN, -1, Infinity]) {
    const value = input();
    value.days[0].hours = hours;
    assert.throws(() => createAvailabilityCenter([], week, value), /HH/);
  }
  const value = input();
  value.days[0].hours = 0;
  assert.equal(createAvailabilityCenter([], week, value)[0].hours, 0);
});
test("missing fields, missing dates and invalid local are blocked", () => {
  assert.throws(() => createAvailabilityCenter([], week, { ...input(), center: "" }), /preencha/);
  assert.throws(
    () => createAvailabilityCenter([], week, { ...input(), specialty: "" }),
    /preencha/,
  );
  assert.throws(() => createAvailabilityCenter([], week, { ...input(), local: "outro" }), /IARI/);
  assert.throws(
    () => createAvailabilityCenter([], week, { ...input(), days: input().days.slice(1) }),
    /todos os dias/,
  );
  assert.throws(() => availabilityWeekDates({ ...week, end_date: "2026-11-16" }), /até sete dias/);
});
test("existing rows cannot be overwritten and specialty must match across locations", () => {
  const rows = createAvailabilityCenter([], week, input());
  assert.throws(() => createAvailabilityCenter(rows, week, input()), /já tem disponibilidade/);
  assert.throws(
    () => createAvailabilityCenter(rows, week, { ...input(), local: "IARI", specialty: "Andaime" }),
    /outra especialidade/,
  );
  assert.equal(createAvailabilityCenter(rows, week, { ...input(), local: "IARI" }).length, 4);
});
test("new eligible center participates via existing RS calculation; exclusions remain enforced", () => {
  const rows = createAvailabilityCenter([], week, input());
  const result = calculateSpecialtyRealization(
    rows,
    [
      {
        center: "CALD_NOVO",
        local: "ROTINA",
        programmed: 70.4,
        completed: 70.4,
        completedForRs: 70.4,
        immediate: 0,
      },
    ],
    true,
  );
  assert.equal(result.rows[0].rs, 100);
  assert.equal(isRsMonitoringOnly("Alpinismo", "ALP_NOVO"), true);
  assert.equal(isRsMonitoringOnly("Caldeiraria", "INSPPINT"), true);
});
test("new-center form uses existing versioned save and closed-week guard", () => {
  const source = readFileSync(
    new URL("../src/components/weekly-availability-editor.tsx", import.meta.url),
    "utf8",
  );
  assert.ok(source.includes("Novo centro de trabalho"));
  assert.ok(source.includes("createAvailabilityCenter(converted, week"));
  assert.ok(source.includes("if (readOnly || saving) return"));
  assert.ok(source.includes('rpc("save_weekly_rs_availability"'));
  assert.ok(source.includes("p_expected_version: document?.version ?? 0"));
});
