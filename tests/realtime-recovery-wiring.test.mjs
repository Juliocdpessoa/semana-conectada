import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('recovery probe remains indexed, read-only and subject to caller RLS',()=>{
 const sql=read('supabase/migrations/20261121220000_realtime_recovery_health.sql');
 const probe=sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.get_activity_revision'),sql.indexOf('ALTER TABLE'));
 assert.match(sql,/activities\(worksite_id,week_id,updated_at DESC,id DESC\)/);
 assert.match(probe,/SECURITY INVOKER/);
 assert.match(probe,/LIMIT 1/);
 assert.doesNotMatch(probe,/SECURITY DEFINER|pt_number|planning_data|description/);
 const server=read('src/lib/realtime-recovery.functions.ts');
 assert.match(server,/requireSupabaseAuth/);assert.match(server,/context\.supabase/);
 assert.doesNotMatch(server,/supabaseAdmin|client\.server|\.update\(|\.insert\(/);
});
test('token events only schedule read recovery outside auth lock; SDK owns token refresh',()=>{
 const page=read('src/routes/_authenticated/atividades.tsx');
 const part=page.slice(page.indexOf('const readActivityRevision'),page.indexOf('const sapOverview'));
 assert.match(part,/hasChanges:/);assert.match(part,/health\.status\(status\)/);
 assert.match(part,/TOKEN_REFRESHED/);assert.match(part,/authTimer=setTimeout/);
 assert.doesNotMatch(part,/\.refreshSession\(|\.setAuth\(|\.signOut\(/);
 assert.match(part,/authWatch\.data\.subscription\.unsubscribe/);
 assert.match(part,/throwOnError:true/);
 assert.match(part,/pendingActivityRead/);
 assert.doesNotMatch(part,/setPlanningDrafts|\.update\(|savePlanningFields/);
});
test('connection events are limited, metadata-only and separated from activity latency',()=>{
 const client=read('src/lib/performance-client.ts');
 assert.match(client,/healthCount>=12/);
 assert.doesNotMatch(client,/localStorage|sessionStorage|pt_number|apikey/);
 const ui=read('src/components/performance-dashboard.tsx');
 assert.match(ui,/Recuperação da conexão em tempo real/);
 assert.match(ui,/healthMetrics/);assert.match(ui,/activityMetrics/);
 assert.doesNotMatch(ui,/Disponibilidade de 100%/);
});
