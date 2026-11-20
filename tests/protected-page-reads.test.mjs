import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const server=read('src/lib/protected-page-reads.functions.ts');
test('fixed server reads keep caller RLS, password gate, approval and no write proxy',()=>{
 assert.doesNotMatch(server,/supabaseAdmin|client\.server|\.from\(data\.|\.(insert|update|delete|upsert)\(/);
 const names=[...server.matchAll(/export const (\w+) = createServerFn/g)].map(m=>m[1]);
 assert.equal(names.length,6);
 assert.equal((server.match(/middleware\(\[requireSupabaseAuth\]\)/g)??[]).length,6);
 assert.match(server,/context\.supabase/);
 assert.match(server,/data\.approval_status !== 'approved'/);
 assert.match(server,/canReadDirectory/);
 assert.match(server,/\.eq\('worksite_id',actor\.worksite_id\)/);
});
test('page reads validate inputs, paginate with stable ordering and reject failed subqueries',()=>{
 assert.match(server,/z\.string\(\)\.uuid\(\)/);
 assert.match(server,/readAllPages/);
 assert.match(server,/\.order\('user_id'\)\.order\('worksite_id'\)/);
 for(const part of ['if (error) throw','roles.error || membership.error','if(history.error)','if(activities.error)','if(result.error)']) assert.ok(server.includes(part),part);
 assert.match(server,/AbortSignal\.timeout/);
 assert.match(server,/limit\(200\)/);
 assert.match(server,/limit\(20\)/);
});
test('admin and history never fetch lists directly or silently display errors as empty lists',()=>{
 const admin=read('src/routes/_authenticated/admin/usuarios.tsx');
 const history=read('src/routes/_authenticated/historico.tsx');
 for(const source of [admin,history]){
  assert.doesNotMatch(source,/supabase\.from|\(supabase as any\)\.from/);
  assert.match(source,/isError/);
  assert.match(source,/Tentar novamente/);
  assert.match(source,/session\.userId,\s*session\.worksiteId/);
 }
 assert.match(admin,/getAdminDirectory/);
 assert.match(history,/getAuditHistory/);
});
