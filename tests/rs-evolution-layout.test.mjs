import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
const source = readFileSync(new URL("../src/components/weekly-realization-panel.tsx", import.meta.url), "utf8");

test('navigation uses defined inline-flex buttons and equal responsive columns',()=>{
 const ui=readFileSync(new URL('../src/components/rs-weekly-evolution.tsx',import.meta.url),'utf8');
 assert.doesNotMatch(ui,/btn-outline/);
 assert.match(ui,/aria-label="Navegar pelas semanas do gráfico" className="grid w-full grid-cols-2 gap-2 sm:w-auto"/);
 assert.equal((ui.match(/className="btn-ghost h-9 min-w-28 whitespace-nowrap"/g)??[]).length,2);
 assert.match(ui,/disabled=\{window.page >= window.pages - 1\}/);
 assert.match(ui,/disabled=\{window.page === 0\}/);
});

test('evolution filters cascade locally, offer searchable multi selection and keep bounded loading',()=>{
 const ui=readFileSync(new URL('../src/components/rs-weekly-evolution.tsx',import.meta.url),'utf8');
 assert.match(ui,/evolutionCenters\(query.data \?\? \[\], specialty\)/);
 assert.match(ui,/setSpecialty\(event.target.value\);setCentersSelected\(\[\]\)/);
 assert.match(ui,/<ContinuousMultiFilter label="Centros de trabalho"/);
 assert.match(ui,/Limpar filtros do gráfico/);
 assert.match(ui,/queryKey: \["rs-weekly-evolution", userId, worksiteId, ids.join\("\|"\), local\]/);
 assert.match(ui,/staleTime: 300_000/);
});
test("evolution appears after the RS table and before memory and simulator", () => {
  const content = source.slice(source.indexOf("function RsContent("));
  assert.ok(content.indexOf('title="Realização Semanal (RS)"') < content.indexOf("{afterResults}"));
  assert.ok(content.indexOf("{afterResults}") < content.indexOf('title="Memória de cálculo"'));
  assert.ok(content.indexOf('title="Memória de cálculo"') < content.indexOf("Simulador de uma especialidade"));
  assert.equal((source.match(/<RsWeeklyEvolution\b/g) ?? []).length, 1);
  assert.equal((source.match(/afterResults=\{evolutionPanel\}/g) ?? []).length, 2);
  assert.equal((source.match(/afterResults=\{afterResults\}/g) ?? []).length, 2);
});
