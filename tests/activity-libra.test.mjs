import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
test("weekly model and import preserve optional LIBRA", () => {
  const source = read("../src/components/operational-imports.tsx");
  assert.match(source, /"Tipo de Liberação",\s*"LIBRA"/);
  assert.match(source, /obj.LIBRA = extractField\(obj, "LIBRA"\)/);
  assert.match(source, /planning_data: r/);
});
test("LIBRA is between release type and date with a fallback for old weeks", () => {
  const source = read("../src/routes/_authenticated/atividades.tsx");
  assert.match(source, /Tipo de Liberação<\/th>\s*<th[^>]*>LIBRA<\/th>\s*<th[^>]*>Data<\/th>/);
  assert.match(source, /field === "libra"/);
  assert.match(source, /String\(row.planning_data\?\.LIBRA \?\? ""\)/);
});
