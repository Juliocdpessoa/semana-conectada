import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sapImportSchema,sapImportUnconfirmedMessage} from '../src/lib/sap-import-policy.ts';
const row={source_row_number:2,order_number:'2031647610',confirmation:'99999999',operation:'0440',suboperation:null,planning_code:null,work_center:null,description:null,actual_start_date:'2026-11-23',actual_end_date:null,system_status:'CONF',normal_duration:8.8,planned_work:17.6,actual_work:17.6,user_status:null,operational_area:null};
const input=()=>({requestId:crypto.randomUUID(),weekId:crypto.randomUUID(),fileName:'SAP.xlsx',rows:[row]});
test('fixed SAP input preserves official columns, nullable values and signed corrections',()=>{
 assert.equal(sapImportSchema.safeParse(input()).success,true);
 assert.equal(sapImportSchema.safeParse({...input(),rows:[{...row,actual_work:-1}]}).success,true);
 for(const extra of [{actorId:crypto.randomUUID()},{rpc:'arbitrary_write'},{url:'https://evil.invalid'}])assert.equal(sapImportSchema.safeParse({...input(),...extra}).success,false);
 assert.equal(sapImportSchema.safeParse({...input(),rows:[{...row,confirmation:''}]}).success,false);
 assert.equal(sapImportSchema.safeParse({...input(),rows:[]}).success,false);
 assert.equal(sapImportSchema.safeParse({...input(),rows:Array.from({length:5001},()=>row)}).success,false);
});
test('SAP import is a fixed caller-authenticated server operation, never generic service relay',()=>{
 const source=readFileSync(new URL('../src/lib/sap-import.functions.ts',import.meta.url),'utf8');
 assert.match(source,/middleware\(\[requireSupabaseAuth\]\)/);
 assert.match(source,/context\.supabase/);assert.match(source,/rpc\('import_sap_confirmations_once'/);
 assert.doesNotMatch(source,/supabaseAdmin|SERVICE_ROLE|for\s*\(|retry:/);
});
test('UI retains same request on failure and binds preview to its week',()=>{
 const source=readFileSync(new URL('../src/routes/_authenticated/atividades.tsx',import.meta.url),'utf8');
 const confirm=source.slice(source.indexOf('async function confirmSapImport()'),source.indexOf('async function downloadPtImportTemplate()'));
 assert.match(confirm,/requestId:sapImportPreview.requestId/);assert.match(confirm,/weekId: sapImportPreview.weekId/);
 assert.match(confirm,/activeWeek.data.id!==sapImportPreview.weekId/);
 assert.doesNotMatch(confirm,/rpc\("import_sap_confirmations"|crypto.randomUUID/);
 assert.doesNotMatch(confirm.slice(confirm.indexOf('} catch')),/setSapImportPreview\(null\)/);
 assert.match(sapImportUnconfirmedMessage(),/mesma tentativa.*duplicação/);
});
test('receipt wrapper preserves canonical importer and checks permission before replay',()=>{
 const sql=readFileSync(new URL('../supabase/migrations/20261123160000_sap_import_receipts.sql',import.meta.url),'utf8');
 assert.match(sql,/actor_id,request_id/);assert.match(sql,/pg_try_advisory_xact_lock/);assert.match(sql,/sha256/);
 assert.match(sql,/password_access_allowed\(\)/);assert.match(sql,/can_access_worksite\(actor,site\)/);
 assert.match(sql,/answer:=public.import_sap_confirmations\(p_week_id,p_source_file_name,p_rows\)/);
 assert.doesNotMatch(sql,/CREATE OR REPLACE FUNCTION public.import_sap_confirmations\(/);
 assert.ok(sql.indexOf('can_access_sap(actor)')<sql.indexOf('SELECT * INTO saved'));
 assert.match(sql,/REVOKE ALL ON public.sap_confirmation_import_receipts FROM PUBLIC,anon,authenticated/);
 assert.doesNotMatch(sql,/40001/);
});
