import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const components=['weekly-realization-panel','weekly-rs-archive','weekly-rs-evidence','availability-capacity','weekly-availability-editor','rs-center-pending-tasks','rs-center-immediate-tasks','rs-weekly-evolution','sap-progress-curve','availability-history-details','weekly-sap-load-history'];
test('RS, HH, evidence, curve, archives and SAP load history no longer depend on direct browser database calls',()=>{
 for(const name of components){
  const source=read('src/components/'+name+'.tsx');
  assert.match(source,/rsTransport as supabase/,name);
  assert.doesNotMatch(source,/integrations\/supabase\/client/,name);
  assert.doesNotMatch(source,/supabase(?: as any\))?\s*\.from\(/,name);
 }
});
test('all RS server handlers retain caller JWT/password gate, approval and database RLS',()=>{
 const source=read('src/lib/rs-transport.functions.ts');
 assert.doesNotMatch(source,/supabaseAdmin|client\.server|SERVICE_ROLE|\.rpc\(input\./);
 assert.equal((source.match(/middleware\(\[requireSupabaseAuth\]\)/g)??[]).length,4);
 assert.match(source,/context\.supabase/);
 assert.match(source,/requireApproved\(db, context\.userId\)/);
 assert.match(source,/rsRequestSchema\.parse/);
 assert.match(source,/\.eq\("version", data\.version\)/);
 assert.doesNotMatch(source,/for\s*\(|while\s*\(|retry/i);
});
test('journey read failure is visible and cannot appear as zero measured people',()=>{
 const source=read('src/components/availability-capacity.tsx');
 assert.match(source,/loadError&&<p role="alert"/);
 assert.match(source,/metric==="people"&&!loaded\?"—"/);
 assert.match(source,/saveJourney\(week\.id,version,days\)/);
});
