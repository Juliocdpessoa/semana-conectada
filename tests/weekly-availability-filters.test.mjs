import assert from "node:assert/strict";
import { test } from "node:test";
import {
  filterAvailabilityDraft as filter,
  filteredAvailabilityHours as total,
} from "../src/lib/weekly-availability-filters.ts";
const rows = [
  { center: "CALD", date: "2026-10-19", hours: "17,6" },
  { center: "ANDA", date: "2026-10-19", hours: "8,8" },
  { center: "CALD", date: "2026-10-20", hours: "35,2" },
];
test("center/date multi-filters intersect; clearing restores all", () => {
  assert.deepEqual(
    filter(rows, [" cald "], ["2026-10-20"]).map(({ index }) => index),
    [2],
  );
  assert.equal(filter(rows, ["CALD", "ANDA"], ["2026-10-19"]).length, 2);
  assert.equal(filter(rows).length, 3);
  assert.equal(filter(rows, ["CAL"]).length, 0);
});
test("source indices survive filtering and pagination; edits/deletes do not target another row", () => {
  const source = Array.from({ length: 130 }, (_, i) => ({
    center: i % 2 ? "ANDA" : "CALD",
    date: "2026-10-19",
    hours: "8,8",
  }));
  const secondPage = filter(source, ["ANDA"]).slice(40, 80);
  assert.equal(secondPage[0].index, 81);
  const index = secondPage[0].index;
  const edited = source.map((row, i) => (i === index ? { ...row, hours: "17,6" } : row));
  assert.equal(edited.length, 130);
  assert.equal(edited[81].hours, "17,6");
  assert.equal(edited[40].hours, "8,8");
  assert.equal(edited.filter((_, i) => i !== index).length, 129);
  assert.equal(source[81].hours, "8,8");
});
test("filtered HH totals include all matching pages, with missing HH not converted to zero", () => {
  assert.equal(total(filter(rows, ["CALD"]).map(({ row }) => row)), 52.800000000000004);
  assert.equal(total([]), 0);
  assert.equal(total([{ hours: "" }]), null);
  assert.equal(total([{ hours: "erro" }]), null);
  assert.equal(total([{ hours: 0 }]), 0);
});
test("focused row stays available while changing its center/date, then leaves the filter on blur", () => {
  const edited = rows.map((row, i) => (i === 0 ? { ...row, center: "PINT" } : row));
  assert.deepEqual(
    filter(edited, ["CALD"], [], 0).map(({ index }) => index),
    [0, 2],
  );
  assert.deepEqual(
    filter(edited, ["CALD"]).map(({ index }) => index),
    [2],
  );
});
