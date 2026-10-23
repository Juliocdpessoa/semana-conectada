import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("SAP curve uses complete theme color values directly, compatible with OKLCH and hex", () => {
  const component = readFileSync(
    new URL("../src/components/sap-progress-curve.tsx", import.meta.url),
    "utf8",
  );
  const theme = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(theme, /--primary:\s*oklch\(/);
  assert.match(theme, /--primary:\s*#/);
  assert.doesNotMatch(component, /hsl\(var\(/);
  assert.match(component, /stroke="#2563EB"/);
  assert.match(component, /fill="#9CA3AF"/);
  assert.match(component, /fill="#2563EB"/);
  assert.match(component, /fill="#16A34A"/);
  assert.match(component, /stroke="var\(--muted-foreground\)"/);
  assert.match(component, /background: "var\(--card\)"/);
});
