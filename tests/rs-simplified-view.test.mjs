import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const panel=readFileSync(new URL('../src/components/weekly-realization-panel.tsx',import.meta.url),'utf8');
test('RS no longer mounts monitoring cards or the three pending-evidence panels',()=>{
  assert.doesNotMatch(panel,/Fora do RS · somente acompanhamento/);
  assert.doesNotMatch(panel,/<WeeklyRsEvidence\b/);
  assert.doesNotMatch(panel,/<Panel title="Conferência da programação"/);
});
test('RS keeps specialty bars, calculation, frozen versions, drilldown and exclusions toggle',()=>{
  for(const retained of ['<RsSpecialtyBars','<WeeklyRsArchive','calculateSpecialtyRealization','calculateCenterRealization','frozenCalculation','setHideNonRs','Memória de cálculo']) assert.ok(panel.includes(retained),retained);
});
