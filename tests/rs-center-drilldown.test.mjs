import test from "node:test";
import assert from "node:assert/strict";
import { calculateCenterRealization } from "../src/lib/weekly-availability.ts";
test("center drilldown respects specialty, local and independent weekly caps", () => {
  const rows = [
    { center: "CALD_A", specialty: "Caldeiraria", local: "ROTINA", hours: 100 },
    { center: "CALD_A", specialty: "Caldeiraria", local: "IARI", hours: 50 },
    { center: "CALD_B", specialty: "Caldeiraria", local: "ROTINA", hours: 200 },
    { center: "AND_A", specialty: "Andaime", local: "ROTINA", hours: 300 },
  ];
  const centers = [
    {
      center: "CALD_A",
      local: "ROTINA",
      programmed: 120,
      completed: 200,
      completedForRs: 120,
      immediate: 0,
    },
    {
      center: "CALD_A",
      local: "IARI",
      programmed: 30,
      completed: 10,
      completedForRs: 10,
      immediate: 0,
    },
    {
      center: "CALD_B",
      local: "ROTINA",
      programmed: 200,
      completed: 50,
      completedForRs: 50,
      immediate: 0,
    },
  ];
  const result = calculateCenterRealization(rows, centers, true, "Caldeiraria", true, "ROTINA");
  assert.equal(result.length, 2);
  assert.equal(result[0].available, 100);
  assert.equal(result[0].occupation, 1);
  assert.equal(result[0].rs, 100);
  assert.equal(result[1].rs, 25);
  assert.equal(calculateCenterRealization(rows, centers, false, "Caldeiraria", true)[0].rs, null);
});
test("excluded centers remain monitoring-only in drilldown", () => {
  const rows = [{ center: "INSPPINT", specialty: "Pintura", local: "ROTINA", hours: 100 }];
  assert.equal(calculateCenterRealization(rows, [], true, "Pintura", true).length, 0);
  assert.equal(calculateCenterRealization(rows, [], true, "Pintura", false)[0].includedInRs, false);
});
