import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  calculateSpecialtyRealization,
  isRsMonitoringOnly,
} from "../src/lib/weekly-availability.ts";

test("HIDROJAT and HIDROJATO excluded exactly, including normalized case", () => {
  for (const code of ["HIDROJAT", "HIDROJATO", " hidrojat "])
    assert.equal(isRsMonitoringOnly("Mecânica", code), true);
  assert.equal(isRsMonitoringOnly("Mecânica", "HIDROJAT2"), false);
});
test("HIDROJAT does not enter any RS numerator, reference, programmed or occupation", () => {
  const av = [
    {
      center: "CALD",
      date: "2026-10-19",
      week: "043-2026",
      specialty: "Caldeiraria",
      local: "ROTINA",
      hours: 100,
    },
  ];
  const centers = [
    {
      center: "CALD",
      local: "ROTINA",
      programmed: 100,
      completed: 100,
      completedForRs: 100,
      immediate: 0,
    },
  ];
  const baseline = calculateSpecialtyRealization(av, centers, true);
  const result = calculateSpecialtyRealization(
    [...av, { ...av[0], center: "HIDROJAT", hours: 999 }],
    [
      ...centers,
      {
        ...centers[0],
        center: "HIDROJAT",
        programmed: 900,
        completed: 800,
        completedForRs: 700,
        immediate: 100,
      },
    ],
    true,
  );
  assert.deepEqual(result.totals, baseline.totals);
  assert.deepEqual(result.result, baseline.result);
  assert.equal(result.rows.find((row) => row.centers.includes("HIDROJAT")).includedInRs, false);
  assert.deepEqual(
    calculateSpecialtyRealization(av, [...centers, { ...centers[0], center: "HIDROJAT" }], true)
      .unmapped,
    [],
  );
});
test("migration systems share exclusion and only update future capture rules", () => {
  const sql = readFileSync(
    new URL("../supabase/migrations/20261024120000_rs_exclude_hidrojat.sql", import.meta.url),
    "utf8",
  );
  const drizzle = readFileSync(
    new URL("../drizzle/migrations/0023_rs_exclude_hidrojat.sql", import.meta.url),
    "utf8",
  );
  assert.equal(sql.replace(/\r\n/g, "\n"), drizzle.replace(/\r\n/g, "\n"));
  assert.ok(sql.includes("rs-hh-2026-10-24-v2"));
  assert.ok(sql.includes("capture_weekly_rs_closure(uuid,text)"));
  assert.doesNotMatch(sql, /UPDATE\s+public\.weekly_rs_closures/i);
});
