import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source=fs.readFileSync(new URL('../src/lib/activities.functions.ts',import.meta.url),'utf8').replace(/\r\n/g,'\n');
const start=source.indexOf('.handler(',source.indexOf('export const updateActivity'))+9;
const end=source.indexOf('\n\nconst bulkSchema',start);
assert.ok(start>=9&&end>start);
const expression=source.slice(start,end).trim().slice(0,-2);
const compiled=ts.transpileModule('const handler = '+expression+'; return handler;', {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
const handler=new Function('exports','REQUIRES_JUSTIFICATION','OPERATION_WORKFLOW_STATUSES','PLANNING_WORKFLOW_STATUSES','activityUpdateScope',compiled)({},new Set(),new Set(),new Set(),()=> 'full');
async function run(error,throws=false){
 let reads=0,writes=0;
 const db={from(table){const q={select(){return q},eq(){return q},maybeSingle(){return q},then(resolve,reject){
  const answer=table==='user_roles'?{data:[{role:'leader'}],error:null}:
   ++reads===1?{data:{id:'fixture',week_id:'week',is_immediate:false,status:'Sem apontamento'},error:null}:
   {data:null,error:{message:'readback unavailable'}};
  return Promise.resolve(answer).then(resolve,reject);
 }};return q;},async rpc(){writes++;if(throws)throw Error('response lost');return {data:1,error};}};
 const call=()=>handler({data:{activityId:'fixture',expectedVersion:1,status:'EXECUTADO',justification:null,observation:null,immediateActivityIds:[]},context:{supabase:db,userId:'fixture-user'}});
 if(throws){await assert.rejects(call(),/response lost/);return {reads,writes};}
 return {result:await call(),reads,writes};
}
test('a committed report succeeds without a fallible separate readback or invented snapshot',async()=>{
 const r=await run(null);assert.deepEqual(r.result,{ok:true});assert.equal(r.reads,1);assert.equal(r.writes,1);
});
test('RPC rejection is still a rejection, never a successful save',async()=>{
 const r=await run({code:'PT403',message:'Access denied'});assert.deepEqual(r.result,{ok:false,error:'Access denied'});assert.equal(r.writes,1);
});
test('an explicit conflict retains its existing current-row path',async()=>{
 const r=await run({code:'PT409',message:'Recarregue a tarefa'});assert.equal(r.result.ok,false);assert.equal(r.result.conflict,true);assert.equal(r.reads,2);assert.equal(r.writes,1);
});
test('lost write responses are not retried or converted to success',async()=>{
 const r=await run(null,true);assert.equal(r.writes,1);assert.equal(r.reads,1);
});
