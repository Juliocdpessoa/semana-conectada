import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/components/weekly-realization-panel.tsx", import.meta.url), "utf8");

test("RS restores only the year preference scoped to user and worksite", () => {
  assert.ok(source.includes("nexo:weekly-rs:year:${userId}:${worksiteId}"));
  assert.ok(source.includes("localStorage.getItem(yearStorageKey)"));
  assert.ok(source.includes("localStorage.setItem(yearStorageKey, e.target.value)"));
  assert.ok(source.includes("localStorage.removeItem(yearStorageKey)"));
  assert.ok(source.includes("}, [yearStorageKey])"));
  assert.equal((source.match(/localStorage\.setItem\(/g) ?? []).length, 1);
});
