import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const sql=readFileSync(new URL('../supabase/migrations/20261123140000_read_scope_initplans.sql',import.meta.url),'utf8');
test('read scope has no user-supplied identity, preserves the existing worksite check',()=>{
 assert.match(sql,/FUNCTION public\.nexo_read_worksite_scope\(\)/);
 assert.match(sql,/auth\.uid\(\) IS NOT NULL AND public\.can_access_worksite\(auth\.uid\(\),w\.id\)/);
 assert.match(sql,/LANGUAGE sql STABLE SECURITY DEFINER/);
 assert.match(sql,/SET search_path=public,pg_temp/);
 assert.match(sql,/REVOKE ALL ON FUNCTION.*FROM PUBLIC,anon/);
});
test('only three SELECT policies change, password gates and role lists are retained',()=>{
 assert.equal((sql.match(/ALTER POLICY/g)??[]).length,3);
 assert.match(sql,/SELECT public\.can_view_activity_sap\(auth\.uid\(\)\)/);
 assert.match(sql,/SELECT public\.can_access_sap\(auth\.uid\(\)\)/);
 assert.match(sql,/'admin','manager','leader','measurement_control','logistics'/);
 assert.doesNotMatch(sql,/ALTER TABLE|DROP POLICY|CREATE POLICY|FOR (?:INSERT|UPDATE|DELETE)|UPDATE public\.|DELETE FROM|GRANT SELECT|GRANT ALL/i);
});
