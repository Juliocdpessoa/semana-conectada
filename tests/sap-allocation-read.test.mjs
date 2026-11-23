import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('auxiliary SAP query does not repeat full page facets, KPIs or progress',()=>{
 const page=read('src/routes/_authenticated/atividades.tsx');
 const part=page.slice(page.indexOf('const sapAllocationActivities'),page.indexOf('const sapHoursByActivity'));
 assert.match(part,/get_activity_sap_allocation_page/);assert.doesNotMatch(part,/"get_activities_page"/);
 assert.match(part,/abortSignal\(signal\)/);assert.match(part,/start \+= 2/);assert.match(part,/signal.throwIfAborted/);
 assert.match(part,/totalAll/);assert.match(part,/ActivitySapAllocationRow/);
});
test('projection retains all SAP-allocation inputs and original ordering under invoker RLS',()=>{
 const sql=read('supabase/migrations/20261123190000_sap_allocation_read_page.sql');
 assert.match(sql,/STABLE SECURITY INVOKER/);assert.match(sql,/can_view_activity_sap\(auth.uid\(\)\)/);
 assert.match(sql,/a.id,a.order_number,a.planning_data,a.scheduled_date,a.source_row_number/);
 assert.match(sql,/a.week_id=p_week_id/);assert.match(sql,/source_row_number NULLS LAST/);
 assert.match(sql,/least\(p_page_size,5000\)/);assert.match(sql,/FROM PUBLIC,anon/);
 assert.doesNotMatch(sql,/SECURITY DEFINER|activity_sap_earned|UPDATE |INSERT |DELETE |BYPASSRLS/);
});
