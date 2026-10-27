import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
test("RS hover targets specialty, center and total rows without changing badge colors", () => {
  const panel = read("../src/components/weekly-realization-panel.tsx");
  assert.equal((panel.match(/<tr className="[^"]*rs-hover-row/g) ?? []).length, 3);
  assert.match(read("../src/components/rs-center-pending-tasks.tsx"), /rs-hover-row row-zebra/);
  const css = read("../src/styles.css");
  assert.match(css, /\.rs-hover-row:is\(:hover, :focus-within\) > td \{/);
  assert.match(css, /box-shadow: inset 3px 0 0 var\(--primary\)/);
  assert.doesNotMatch(css, /\.rs-hover-row[^{}]*\*[^{]*\{/);
});
