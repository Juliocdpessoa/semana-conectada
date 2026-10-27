import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
const source = readFileSync(new URL("../src/components/weekly-realization-panel.tsx", import.meta.url), "utf8");
test("evolution appears after the RS table and before memory and simulator", () => {
  const content = source.slice(source.indexOf("function RsContent("));
  assert.ok(content.indexOf('title="Realização Semanal (RS)"') < content.indexOf("{afterResults}"));
  assert.ok(content.indexOf("{afterResults}") < content.indexOf('title="Memória de cálculo"'));
  assert.ok(content.indexOf('title="Memória de cálculo"') < content.indexOf("Simulador de uma especialidade"));
  assert.equal((source.match(/<RsWeeklyEvolution\b/g) ?? []).length, 1);
  assert.equal((source.match(/afterResults=\{evolutionPanel\}/g) ?? []).length, 2);
  assert.equal((source.match(/afterResults=\{afterResults\}/g) ?? []).length, 2);
});
