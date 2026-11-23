import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=readFileSync(new URL('../src/lib/activities.functions.ts',import.meta.url),'utf8').replace(/\r\n/g,'\n');
const start=source.indexOf('.handler(',source.indexOf('export const setUserApproval'))+9;
const expression=source.slice(start).trim().slice(0,-2);
const compiled=ts.transpileModule('const handler='+expression+';return handler;',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
const handler=new Function('exports',compiled)({});
const input={targetUserId:'fixture',approvalStatus:'approved',roles:['leader']};
test('approval uses one fixed caller-scoped RPC, no service writes or impersonation',async()=>{
 let calls=0;
 const result=await handler({data:input,context:{supabase:{rpc(name,params){calls++;assert.equal(name,'set_nexo_user_approval');assert.deepEqual(params,{p_target_user_id:'fixture',p_approval_status:'approved',p_roles:['leader']});return {abortSignal:async signal=>{assert.ok(signal instanceof AbortSignal);return {data:{ok:true},error:null};}};}}}});
 assert.deepEqual(result,{ok:true});assert.equal(calls,1);
 assert.doesNotMatch(expression,/supabaseAdmin|\.from\(|\.insert\(|\.delete\(|\.update\(/);
});
test('approval without role changes sends null, never an empty replacement',async()=>{
 const data={targetUserId:'fixture',approvalStatus:'blocked'};
 await handler({data,context:{supabase:{rpc(_n,p){assert.equal(p.p_roles,null);return {abortSignal:async()=>({data:{ok:true},error:null})};}}}});
});
test('safe denials remain errors; ambiguous errors never become success or retries',async()=>{
 for(const code of ['PT403','PT400','57014']){
  let calls=0;const result=await handler({data:input,context:{supabase:{rpc(){calls++;return {abortSignal:async()=>({data:null,error:{code,message:'denied'}})};}}}});
  assert.equal(result.ok,false);assert.equal(calls,1);if(code==='57014')assert.match(result.error,/Atualize a lista/);else assert.equal(result.error,'denied');
 }
 const invalid=await handler({data:input,context:{supabase:{rpc(){return {abortSignal:async()=>({data:{},error:null})};}}}});assert.equal(invalid.ok,false);
 let calls=0;await assert.rejects(handler({data:input,context:{supabase:{rpc(){calls++;return {abortSignal:async()=>{throw Error('response lost');}};}}}}),/response lost/);assert.equal(calls,1);
});
test('transaction retains approval, password, worksite, role and execute guards',()=>{
 const sql=readFileSync(new URL('../supabase/migrations/20261123180000_atomic_user_approval.sql',import.meta.url),'utf8');
 assert.match(sql,/actor uuid:=auth.uid\(\)/);assert.match(sql,/password_access_allowed\(\)/);assert.match(sql,/is_global_admin\(actor\)/);
 assert.match(sql,/ORDER BY id FOR UPDATE/);assert.match(sql,/worksite_id=a.worksite_id/);assert.match(sql,/'admin'=ANY\(p_roles\)/);
 assert.match(sql,/REVOKE ALL[\s\S]*FROM PUBLIC,anon/);assert.match(sql,/GRANT EXECUTE[\s\S]*TO authenticated/);
 assert.doesNotMatch(sql,/40001|service_role|EXCEPTION WHEN/);
 assert.ok(sql.indexOf('UPDATE public.profiles')<sql.indexOf('DELETE FROM public.user_roles'));
 assert.ok(sql.indexOf('DELETE FROM public.user_roles')<sql.indexOf('INSERT INTO public.user_roles'));
});
