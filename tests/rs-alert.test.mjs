import test from "node:test";
import assert from "node:assert/strict";
import { rsAlert } from "../src/lib/rs-alert.ts";
test("RS colors use contractual bands, including exactly 95 with negative factor", () => {
  assert.match(rsAlert(94.99).className, /red-/);
  assert.match(rsAlert(95).className, /amber-/);
  assert.match(rsAlert(95.01).className, /amber-/);
  assert.match(rsAlert(98).className, /amber-/);
  assert.match(rsAlert(98.01).className, /green-/);
  assert.match(rsAlert(100).className, /green-/);
  assert.match(rsAlert(100.01).className, /sky-/);
});
test("unavailable and monitoring values are neutral, not critical zero", () => {
  assert.match(rsAlert(null).label, /indisponível/);
  assert.match(rsAlert(90, false).label, /acompanhamento/);
  assert.match(rsAlert(NaN).label, /indisponível/);
  assert.match(rsAlert(0).className, /red-/);
});
