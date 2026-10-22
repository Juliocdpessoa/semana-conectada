import assert from "node:assert/strict";
import { test } from "node:test";
import {
  summarizeActivityCapacity as summarize,
  increasedCapacityOverloads as increases,
  capacityWarningText,
  capacityOverloadList,
} from "../src/lib/activity-capacity.ts";
const row = (change = {}) => ({
  center: "CALD",
  date: "2026-10-22",
  programmed: 105.6,
  available: 88,
  excess: 17.6,
  tasks: 3,
  invalidHours: 0,
  ...change,
});
const data = (...rows) => ({ hasAvailability: true, updatedAt: null, rows });
test("surplus on another day/center never compensates overload", () => {
  const result = summarize(
    data(
      row(),
      row({ date: "2026-10-23", programmed: 0, excess: 0 }),
      row({ center: "PINT", programmed: 0, excess: 0 }),
    ),
  );
  assert.equal(result.excess, 17.6);
  assert.equal(result.overloaded.length, 1);
});
test("center/date multiselect scopes the daily aggregates and clearing restores all", () => {
  const source = data(row(), row({ center: "ALP_PINT", date: "2026-10-23", excess: 10 }));
  assert.equal(summarize(source, [" alp_pint "], ["2026-10-23"]).excess, 10);
  assert.equal(summarize(source).excess, 27.6);
  assert.equal(summarize(source, ["CALD"], ["2026-10-23"]).rows.length, 0);
});
test("missing availability/HH/date is unknown, explicit zero availability is a valid overload", () => {
  const result = summarize(
    data(
      row({ available: null, excess: null }),
      row({ date: null, excess: null }),
      row({ center: "PINT", invalidHours: 1, excess: null }),
      row({ center: "ZERO", available: 0, excess: 105.6 }),
    ),
  );
  assert.equal(result.unknown.length, 3);
  assert.equal(result.excess, 105.6);
});
test("saved moves alert on new/increased overload, not reductions or unchanged PT fields", () => {
  assert.equal(increases(data(row({ programmed: 80, excess: 0 })), data(row())).length, 1);
  assert.equal(increases(data(row()), data(row())).length, 0);
  assert.equal(increases(data(row()), data(row({ programmed: 90, excess: 2 }))).length, 0);
  assert.equal(increases(data(), data(row())).length, 1);
  assert.equal(increases(data(), data(row({ available: null, excess: null }))).length, 0);
});
test("bulk movement reports each overloaded group once and uses Brazilian hours/date", () => {
  const result = increases(data(), data(row(), row({ center: "PINT" })));
  assert.equal(result.length, 2);
  assert.match(capacityWarningText(result[0]), /22\/10\/2026: 17,6 HH/);
});

test("hover list matches card filters and totals, sorted by center then day without mutating input", () => {
  const source = data(
    row({ center: "PINT" }),
    row({ center: "ANDA", date: "2026-10-23", excess: 5 }),
    row({ center: "ANDA", excess: 10 }),
    row({ center: "ZERO", excess: 0 }),
    row({ center: "UNKNOWN", excess: null, available: null }),
  );
  const selected = summarize(source, [], ["2026-10-22"]);
  const list = capacityOverloadList(selected.rows);
  assert.deepEqual(
    list.map((r) => r.center),
    ["ANDA", "PINT"],
  );
  assert.equal(
    list.reduce((sum, r) => sum + r.excess, 0),
    selected.excess,
  );
  assert.equal(source.rows[0].center, "PINT");
  assert.deepEqual(
    capacityOverloadList(summarize(source, ["ANDA"]).rows).map((r) => r.date),
    ["2026-10-22", "2026-10-23"],
  );
  assert.equal(capacityOverloadList(summarize(source, ["ZERO"]).rows).length, 0);
});
