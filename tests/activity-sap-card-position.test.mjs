import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../src/routes/_authenticated/atividades.tsx',import.meta.url),'utf8');
test('completion card is in SAP section, not the operational KPI section',()=>{
  const operational=source.slice(source.indexOf('{/* KPIs */}'),source.indexOf('aria-label="Indicadores SAP"'));
  assert.doesNotMatch(operational,/label="Conclusão SAP · HH"/);
  const sap=source.slice(source.indexOf('aria-label="Indicadores SAP"'),source.indexOf('{/* Toolbar */}'));
  assert.match(sap,/Conferência SAP/);
  assert.match(sap,/label="Conclusão SAP · HH"/);
  assert.match(sap,/value=\{completionLabel\}/);
  assert.match(sap,/xl:grid-cols-9/);
  assert.match(sap,/<\/>(?:\s*\})?(?:\s*\))?(?:\s*\})?\s*<KpiCard\s+label="Conclusão SAP · HH"/);
  assert.equal(source.match(/label="Conclusão SAP · HH"/g).length,1);
});
