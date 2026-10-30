import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const page=readFileSync('src/routes/_authenticated/atividades.tsx','utf8');
const sql=readFileSync('supabase/migrations/20261026120000_operation_activity_read_view.sql','utf8');
const permissions=page.slice(page.indexOf('  const effectiveRoles ='),page.indexOf('  const isDateEditAdmin ='));
const derive=new Function('session',stripTypeScriptTypes(permissions)+';return {canViewSap,canImportSap,canViewPlanningActivityData,canEditPlanningFields,canUpdateActivities,isOperationOnly};');
const access=(roles)=>derive({roles});
test('Operation and Planning see the same Activities data',()=>{
 for(const role of ['operation','planning','admin']){
  assert.equal(access([role]).canViewSap,true);
  assert.equal(access([role]).canViewPlanningActivityData,true);
 }
});
test('Operation retains restricted writes and cannot import SAP',()=>{
 const a=access(['operation']);
 assert.equal(a.canImportSap,false);assert.equal(a.canEditPlanningFields,false);
 assert.equal(a.canUpdateActivities,true);assert.equal(a.isOperationOnly,true);
 assert.match(page,/allowedStatuses=\{isOperationOnly \? OPERATION_WORKFLOW_STATUSES : undefined\}/);
 assert.match(page,/isOperationOnly && \(field === "pt_number" \|\| field === "libra"\)/);
});
test('Planning/Admin writes remain authorized, Consulta/Leader SAP access remains unchanged',()=>{
 for(const role of ['planning','admin'])assert.equal(access([role]).canImportSap,true);
 for(const role of ['consultation','leader','manager'])assert.equal(access([role]).canViewSap,false);
 assert.equal(access(['operation','consultation']).canImportSap,false);
});
test('Import handler and preview modal require write permission, not visibility',()=>{
 assert.match(page,/async function prepareSapImport\(file: File\) \{\s*if \(!canImportSap\) return;/);
 assert.match(page,/if \(!canImportSap \|\| !activeWeek\.data/);
 assert.match(page,/canImportSap && sapImportPreview && activeWeek\.data/);
});
test('Location is visible on desktop and mobile without granting editing',()=>{
 assert.equal((page.match(/canViewPlanningActivityData && \(/g)||[]).length,3);
 assert.match(page,/editable=\{canEditPlanningFields \|\| isOperationOnly\}/);
 assert.match(page,/const canEditPlanningDate = canEditPlanningFields && !dateEditLocked/);
});
test('Read-only SQL preserves original write authority and worksite checks',()=>{
 assert.match(sql,/public\.is_approved\(_user_id\) AND public\.has_role\(_user_id,'operation'\)/);
 assert.doesNotMatch(sql,/CREATE OR REPLACE FUNCTION public\.(can_access_sap|import_sap_confirmations|save_weekly_rs)/);
 assert.equal((sql.match(/FOR SELECT TO authenticated USING/g)||[]).length,2);
 assert.match(sql,/can_access_worksite\(auth\.uid\(\),worksite_id\)/);
 assert.doesNotMatch(sql,/FOR (UPDATE|INSERT|ALL)|GRANT (UPDATE|INSERT|DELETE)/);
});
