import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pendingOperationalLabel,pendingJustification} from '../src/lib/rs-center-pending.ts';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261026150000_rs_center_pending_tasks.sql');
const view=read('src/components/rs-center-pending-tasks.tsx');
const parent=read('src/components/weekly-realization-panel.tsx');
test('executed with no SAP is not labeled as non-execution',()=>{
 assert.equal(pendingOperationalLabel('EXECUTADO'),'Executada, sem apropriação SAP');
 assert.equal(pendingOperationalLabel('NÃO EXECUTADO'),'NÃO EXECUTADO');
 assert.equal(pendingOperationalLabel(''),'Sem apontamento');
});
test('no operational reason is invented',()=>{
 for(const v of [null,undefined,'','  '])assert.equal(pendingJustification(v),'Sem justificativa registrada');
 assert.equal(pendingJustification(' 12 - SERVIÇO CANCELADO '),'12 - SERVIÇO CANCELADO');
});
test('official RS uses whole-week normalized confirmation and excludes positive partial SAP',()=>{
 assert.match(sql,/r\.has_confirmation AND r\.actual_work>0/);
 assert.match(sql,/SELECT \* FROM evidence e WHERE CASE WHEN e\.official THEN NOT EXISTS/);
 assert.match(sql,/c\.confirmation=public\.normalize_sap_identifier/);
 assert.doesNotMatch(sql,/actual_work\s*>=|actual_work\s*=\s*planned/);
});
test('frozen evidence and source SAP stay in the same selected closure',()=>{
 assert.match(sql,/i\.closure_id=s\.closure_id AND i\.kind='sap'/);
 assert.match(sql,/p\.closure_id IS NOT NULL THEN p\.payload->>'justification_by'/);
 assert.match(sql,/p\.closure_id IS NULL AND nullif/);
 assert.match(sql,/Fechamento não corresponde à semana/);
});
test('API is bounded, authenticated, worksite scoped and read-only',()=>{
 assert.match(sql,/public\.can_access_sap\(auth\.uid\(\)\)/);
 assert.match(sql,/public\.can_access_worksite\(auth\.uid\(\),w\.worksite_id\)/);
 assert.match(sql,/NOT BETWEEN 1 AND 12/);assert.match(sql,/NOT BETWEEN 1 AND 100/);
 assert.match(sql,/Semana duplicada/);
 assert.doesNotMatch(sql,/\b(INSERT INTO|UPDATE public\.|DELETE FROM|ALTER TABLE)\b/);
});
test('details mount only after a center click, respect context and do not restore removed panels',()=>{
 assert.match(parent,/selectedCenter === center\.center &&/);
 assert.match(parent,/colSpan=\{11\}/);
 assert.match(parent,/pendingSources/);assert.match(parent,/item\.isFrozen/);
 assert.match(parent,/item\.closure\?\.id/);
 assert.doesNotMatch(parent,/<WeeklyRsEvidence/);
 assert.match(view,/missingSapWeeks/);assert.match(view,/Sem carga SAP em/);
 assert.match(view,/p_offset: page \* 50/);
 assert.match(view,/justification_by/);assert.match(view,/row\.observation/);
});
