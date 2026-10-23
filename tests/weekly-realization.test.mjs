import assert from "node:assert/strict";
import { test } from "node:test";
import {
  calculateWeeklyRealization as calc,
  parseServiceHours,
  serviceHoursInput,
} from "../src/lib/weekly-realization.ts";

const inputs = { programmed: 4708, completed: 4500, immediate: 0, reference: 4708, eep: 0 };
test("contract example: 4500 / 4708 = 95.58%, OM 100%, factor -0.01", () => {
  const result = calc(inputs);
  assert.equal(result.occupation, 1);
  assert.equal(result.rs.toFixed(2), "95.58");
  assert.equal(result.factor, -0.01);
});
test("exactly 95 percent has factor -0.01", () => {
  const result = calc({ ...inputs, completed: 4472.6 });
  assert.equal(result.at95, true);
  assert.equal(result.factor, -0.01);
});
test("each contractual band including 98 and 100 uses unrounded RS", () => {
  const cases = [
    [94.9999, -0.02],
    [95, -0.01],
    [95.0001, -0.01],
    [97.9999, -0.01],
    [98, 0],
    [98.0001, 0],
    [100, 0],
    [100.0001, 0.01],
  ];
  for (const [percent, factor] of cases) {
    assert.equal(
      calc({ programmed: 100, completed: percent, immediate: 0, reference: 100, eep: 0 }).factor,
      factor,
    );
  }
});
test("immediate hours contribute once; EEP increases the reference", () => {
  const result = calc({
    programmed: 4000,
    completed: 4500,
    immediate: 100,
    reference: 4708,
    eep: 292,
  });
  assert.equal(result.occupation, 0.8);
  assert.equal(result.rs, 92);
  assert.equal(result.totalCompleted, 4600);
});
test("the same capped programmed hours participate in OM and the RS divisor", () => {
  const result = calc({
    programmed: 6000,
    completed: 5000,
    immediate: 500,
    reference: 4708,
    eep: 0,
  });
  assert.equal(result.occupation, 1);
  assert.equal(result.programmedConsidered, 4708);
  assert.equal(result.rs, (5500 / 4708) * 100);
  assert.equal(result.factor, 0.01);
});

test("factor boundaries use the same capped TP in OM and RS", () => {
  for (const [completed, factor] of [
    [949.999, -0.02],
    [950, -0.01],
    [950.001, -0.01],
  ]) {
    assert.equal(
      calc({ programmed: 1200, completed, immediate: 0, reference: 1000, eep: 0 }).factor,
      factor,
    );
  }
});
test("zero realized hours are a measured zero, not missing", () => {
  assert.equal(calc({ ...inputs, completed: 0 }).rs, 0);
});
test("invalid inputs and absent denominators never generate a percentage", () => {
  for (const change of [
    { programmed: 0 },
    { reference: 0 },
    { completed: -1 },
    { immediate: NaN },
    { eep: Infinity },
  ]) {
    assert.equal(calc({ ...inputs, ...change }), null);
  }
});
test("HS input accepts comma or decimal point; blank does not become zero", () => {
  assert.equal(parseServiceHours("4,5"), 4.5);
  assert.equal(parseServiceHours("4.5"), 4.5);
  assert.equal(parseServiceHours("0"), 0);
  assert.equal(parseServiceHours("4.708"), 4708);
  assert.equal(parseServiceHours("1.234,56"), 1234.56);
  assert.equal(parseServiceHours("0.123"), 0.123);
  for (const invalid of ["", " ", "-1", "1.23,56", "NaN", "Infinity", "abc"])
    assert.equal(parseServiceHours(invalid), null);
});

test("saved decimals reload without being interpreted as thousands", () => {
  for (const value of [0, 0.123, 1.234, 4708, 4708.12, 0.00000001]) {
    assert.equal(parseServiceHours(serviceHoursInput(value)), value);
  }
});
