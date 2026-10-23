import assert from "node:assert/strict";
import { test } from "node:test";
import {
  calculateSpecialtyRealization as calc,
  parseAvailabilityGrid,
  validateAvailability,
  availabilityDate,
  prepareAvailabilityReuse,
} from "../src/lib/weekly-availability.ts";

const week = { code: "041-2026 Programação", start_date: "2026-10-05", end_date: "2026-10-09" };
const row = (change = {}) => ({
  center: "CALD",
  date: "2026-10-05",
  hours: 100,
  week: "041-2026",
  local: "ROTINA",
  specialty: "Caldeiraria",
  ...change,
});
const center = (change = {}) => ({
  center: "CALD",
  programmed: 100,
  completed: 80,
  immediate: 0,
  ...change,
});

test("cap is weekly, not daily; available already includes EEP", () => {
  const result = calc(
    [row({ hours: 8.8 }), row({ date: "2026-10-06", hours: 8.8 })],
    [center({ programmed: 17.6, completed: 15 })],
    true,
  );
  assert.equal(result.totals.considered, 15);
  assert.equal(result.totals.available, 17.6);
  assert.equal(result.result.rs, (15 / 17.6) * 100);
});
test("combine centers and locations before capping the same specialty", () => {
  const result = calc(
    [row({ hours: 50 }), row({ center: "CALD2", local: "IARI", hours: 50 })],
    [
      center({ programmed: 60, completed: 100 }),
      center({ center: "CALD2", programmed: 40, completed: 0 }),
    ],
    true,
  );
  assert.equal(result.rows.length, 1);
  assert.equal(result.totals.considered, 100);
  assert.equal(result.result.rs, 100);
});
test("surplus cannot compensate another specialty; overall is availability-weighted", () => {
  const result = calc(
    [row(), row({ center: "PINT", specialty: "Pintura", hours: 300 })],
    [center({ completed: 150 }), center({ center: "PINT", programmed: 300, completed: 150 })],
    true,
  );
  assert.equal(result.totals.considered, 250);
  assert.equal(result.totals.excess, 50);
  assert.equal(result.result.rs, 62.5); // Not 75% (simple mean of 100% and 50%).
});
test("programmed SAP and immediate SAP share the same cap", () => {
  const result = calc([row()], [center({ completed: 80, immediate: 50 })], true);
  assert.equal(result.totals.completed, 80);
  assert.equal(result.totals.immediate, 50);
  assert.equal(result.totals.considered, 100);
  assert.equal(result.totals.excess, 30);
  assert.equal(result.result.factor, 0);
});
test("occupation caps independently for each specialty and for the aggregate", () => {
  const result = calc(
    [row(), row({ center: "PINT", specialty: "Pintura" })],
    [
      center({ programmed: 200, completed: 100 }),
      center({ center: "PINT", programmed: 50, completed: 50 }),
    ],
    true,
  );
  assert.equal(result.rows.find((r) => r.specialty === "Caldeiraria").occupation, 1);
  assert.equal(result.rows.find((r) => r.specialty === "Caldeiraria").rs, 100);
  assert.equal(result.rows.find((r) => r.specialty === "Pintura").occupation, 0.5);
  assert.equal(result.result.occupation, 1);
  assert.equal(result.result.rs, 75);
  assert.equal(result.result.programmedConsidered, 200);
  assert.equal(result.totals.programmed, 250);
});

test("zero availability is explicit; missing availability or SAP is not zero", () => {
  assert.equal(calc([], [center()], true).result, null);
  assert.equal(calc([row()], [center()], false).result, null);
  assert.equal(calc([row({ hours: 0 })], [center()], true).result, null);
  const result = calc(
    [row({ hours: 0 }), row({ center: "PINT", specialty: "Pintura" })],
    [center(), center({ center: "PINT", completed: 50 })],
    true,
  );
  assert.equal(result.totals.considered, 50);
  assert.equal(result.rows.find((r) => r.specialty === "Caldeiraria").rs, null);
  assert.equal(result.result.rs, 50);
});
test("week 42 Andaime ROTINA uses 2252.8 considered TP, restoring 100 percent RS", () => {
  const result = calc(
    [row({ hours: 2252.8, specialty: "Andaime" })],
    [center({ programmed: 2517.6, completed: 2258.4 })],
    true,
  );
  assert.equal(result.rows[0].programmed, 2517.6);
  assert.equal(result.rows[0].programmedConsidered, 2252.8);
  assert.equal(result.rows[0].considered, 2252.8);
  assert.equal(result.rows[0].occupation, 1);
  assert.equal(result.rows[0].rs, 100);
  assert.equal(result.result.programmedConsidered, 2252.8);
  assert.equal(result.result.rs, 100);
});

test("confirmation cap applies before specialty cap and keeps actual SAP visible", () => {
  const result = calc(
    [row({ hours: 100 })],
    [center({ programmed: 17.6, completed: 35.2, completedForRs: 17.6 })],
    true,
  );
  assert.equal(result.totals.completed, 35.2);
  assert.equal(result.totals.completedForRs, 17.6);
  assert.equal(result.totals.considered, 17.6);
  assert.equal(result.totals.excess, 17.6);
  assert.equal(result.result.rs, 17.6);
});

test("confirmation over-appropriation cannot compensate missing hours on another task", () => {
  const result = calc(
    [row()],
    [center({ programmed: 100, completed: 100, completedForRs: 60, immediate: 10 })],
    true,
  );
  assert.equal(result.totals.considered, 70);
  assert.equal(result.result.rs, 70);
});

test("unmapped centers block the general result, no silent lost hours", () => {
  const result = calc([row()], [center(), center({ center: "SOLD" })], true);
  assert.deepEqual(result.unmapped, ["SOLD"]);
  assert.equal(result.result, null);
});
test("normalizes accents, case and spacing without guessing center prefixes", () => {
  const result = calc(
    [
      row({ center: "  cald  ", specialty: "Serviços  Gerais" }),
      row({ center: "CALD2", specialty: "SERVICOS GERAIS" }),
    ],
    [center({ center: "cald", completed: 100 })],
    true,
  );
  assert.equal(result.rows.length, 1);
  assert.equal(result.result.rs, 50);
});
test("duplicates, conflicting mappings, invalid hours/dates/week rejected", () => {
  assert.ok(validateAvailability([row(), row()], week).some((e) => e.includes("duplicados")));
  assert.ok(
    validateAvailability([row(), row({ date: "2026-10-06", specialty: "Soldagem" })], week).some(
      (e) => e.includes("diferentes"),
    ),
  );
  for (const change of [
    { hours: NaN },
    { hours: -1 },
    { hours: Infinity },
    { date: "2026-10-10" },
    { date: "2026-02-31" },
    { week: "042-2026" },
    { center: "" },
    { specialty: "" },
  ]) {
    assert.ok(validateAvailability([row(change)], week).length > 0);
  }
  assert.deepEqual(validateAvailability([row({ hours: 0 })], week), []);
});
test("Excel grid accepts exact supplied headers including ESPECIALIDAE typo, numeric hours and pt-BR", () => {
  const header = [
    "CENTRO DE TRABALHO",
    "DATA",
    "HH DIÁRIO DISPONIVEL",
    "SEMANA",
    "LOCAL",
    "ESPECIALIDAE",
  ];
  const result = parseAvailabilityGrid(
    [
      header,
      ["CALD", "05/10/2026", "35,2", "041-2026", "ROTINA", "Caldeiraria"],
      ["CALD", "06/10/2026", 17.6, "041-2026", "ROTINA", "Caldeiraria"],
    ],
    week,
  );
  assert.equal(result[0].hours, 35.2);
  assert.equal(result[1].hours, 17.6);
  assert.equal(result[0].date, "2026-10-05");
  assert.throws(
    () =>
      parseAvailabilityGrid(
        [header, ["CALD", "05/10/2026", "", "041-2026", "ROTINA", "Caldeiraria"]],
        week,
      ),
    /inválido/,
  );
});
test("Excel serial dates independent of local timezone", () => {
  assert.equal(availabilityDate(46300), "2026-10-05");
  assert.equal(availabilityDate("5/10/2026"), "2026-10-05");
});
test("exact 95 has factor -0.01 after specialty caps", () => {
  const result = calc([row()], [center({ completed: 95 })], true);
  assert.equal(result.result.at95, true);
  assert.equal(result.result.factor, -0.01);
});

test("Alpinismo stays visible but is removed from every RS numerator and denominator", () => {
  for (const specialty of ["Alpinista", "Alpinismo", "ALPINISTAS"]) {
    const result = calc(
      [row(), row({ center: "ALP", specialty, hours: 1000 })],
      [
        center({ completed: 50 }),
        center({ center: "ALP", programmed: 2000, completed: 2000, immediate: 500 }),
      ],
      true,
    );
    assert.equal(result.rows.length, 2);
    assert.equal(result.monitoring.length, 1);
    assert.equal(result.totals.available, 100);
    assert.equal(result.totals.programmed, 100);
    assert.equal(result.totals.completed, 50);
    assert.equal(result.totals.immediate, 0);
    assert.equal(result.result.rs, 50);
    assert.equal(result.result.occupation, 1);
  }
});

test("local filter scopes both SAP and availability and All restores the original population", () => {
  const availability = [
    row({ local: "ROTINA" }),
    row({ center: "CALD_IARI", local: "IARI", hours: 300 }),
  ];
  const centers = [
    center({ local: "ROTINA", completed: 50 }),
    center({ center: "CALD_IARI", local: "IARI", programmed: 300, completed: 90 }),
  ];
  assert.equal(calc(availability, centers, true, "ROTINA").result.rs, 50);
  assert.equal(calc(availability, centers, true, "IARI").result.rs, 30);
  const restored = calc(availability, centers, true, "");
  assert.equal(restored.totals.available, 400);
  assert.equal(restored.totals.completed, 140);
  assert.equal(restored.result.rs, 35);
});

test("monitoring-only center with a different capacity local does not block a filtered RS", () => {
  const result = calc(
    [row({ local: "IARI" }), row({ center: "ALP", specialty: "Alpinista", local: "ROTINA" })],
    [
      center({ local: "IARI", completed: 50 }),
      center({ center: "ALP", local: "IARI", completed: 90 }),
    ],
    true,
    "IARI",
  );
  assert.equal(result.result.rs, 50);
  assert.deepEqual(result.unmapped, []);
  assert.equal(result.monitoring[0].completed, 90);
});

test("exact excluded centers never exclude eligible centers sharing the same specialty", () => {
  for (const code of ["INSPPINT", "TECNIEND", "TECNINSC", "HIDROJATO"]) {
    const result = calc(
      [row(), row({ center: ` ${code.toLowerCase()} `, hours: 1000 })],
      [
        center({ completed: 50 }),
        center({ center: code, programmed: 2000, completed: 1500, immediate: 100 }),
      ],
      true,
    );
    assert.equal(result.rows.length, 2);
    assert.equal(result.monitoring.length, 1);
    assert.equal(result.totals.available, 100);
    assert.equal(result.totals.programmed, 100);
    assert.equal(result.totals.completed, 50);
    assert.equal(result.totals.immediate, 0);
    assert.equal(result.result.rs, 50);
    assert.equal(result.result.occupation, 1);
  }
});

test("excluded center without availability remains monitoring and does not block RS", () => {
  const result = calc(
    [row()],
    [center({ completed: 50 }), center({ center: "HIDROJATO", programmed: 900, completed: 900 })],
    true,
  );
  assert.deepEqual(result.unmapped, []);
  assert.equal(result.monitoring.length, 1);
  assert.equal(result.result.rs, 50);
});

test("exclusion is exact, not a prefix; local filters and reset retain the same rule", () => {
  const availability = [
    row({ local: "IARI" }),
    row({ center: "INSPPINT", local: "ROTINA", hours: 500 }),
  ];
  const centers = [
    center({ local: "IARI", completed: 50 }),
    center({ center: "INSPPINT", local: "ROTINA", programmed: 600, completed: 600 }),
  ];
  assert.equal(calc(availability, centers, true, "IARI").result.rs, 50);
  assert.equal(calc(availability, centers, true).result.rs, 50);
  const other = calc(
    [row({ center: "INSPPINT2" })],
    [center({ center: "INSPPINT2", completed: 70 })],
    true,
  );
  assert.equal(other.result.rs, 70);
  assert.equal(other.monitoring.length, 0);
});

test("reuse preserves weekday capacities and does not invent a Monday after a short week", () => {
  const target = { code: "043-2026", start_date: "2026-10-19", end_date: "2026-10-23" };
  const source = [
    row({ date: "2026-10-13", hours: 35.2 }),
    row({ date: "2026-10-14", hours: 35.2 }),
    row({ date: "2026-10-15", hours: 35.2 }),
    row({ date: "2026-10-16", hours: 17.6 }),
  ];
  const result = prepareAvailabilityReuse(source, target);
  assert.equal(result.rows.length, 5);
  assert.equal(result.missing, 1);
  assert.ok(Number.isNaN(result.rows[0].hours));
  assert.equal(result.rows[1].hours, 35.2);
  assert.equal(result.rows[4].hours, 17.6);
  assert.equal(result.rows[4].week, "043-2026");
  assert.equal(source[0].date, "2026-10-13");
});
