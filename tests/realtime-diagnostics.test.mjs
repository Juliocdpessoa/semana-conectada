import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {classifyRealtimeFailure,createRealtimeDiagnostics} from '../src/lib/realtime-diagnostics.ts';
import {AccessLoadError,DIAGNOSTIC_BUILD,safeQueuedDiagnostic} from '../src/lib/access-diagnostics.ts';
test('realtime errors become fixed categories without retaining raw secrets or payloads',()=>{
 for(const [message,reason,category] of [
  ['JWT expired secret=TOKEN','jwt','auth'],['Unauthorized private_url','authorization','auth'],
  ['Too many connections','quota','server'],['too_many_channels','quota','server'],['ChannelRateLimitReached','quota','server'],['tenant_events','quota','server'],['Replication error','replication','server'],
  ['socket timeout','timeout','timeout'],['Failed to fetch URL?apikey=SECRET','transport','network']]){
  const result=classifyRealtimeFailure('CHANNEL_ERROR',{message});
  assert.deepEqual(result,{reason,category});
  assert.doesNotMatch(JSON.stringify(result),/TOKEN|SECRET|private_url/);
 }
});
test('reports never affect the connection and are capped at two per page with five-minute spacing',()=>{
 let now=1000;const records=[];const d=createRealtimeDiagnostics(r=>records.push(r),()=>now);
 d.status('SUBSCRIBED');assert.equal(records.length,0);
 for(let i=0;i<100;i++)d.status('CHANNEL_ERROR',new Error('private failure'));
 assert.equal(records.length,1);now+=300_000;d.status('TIMED_OUT');
 now+=300_000;d.status('CHANNEL_ERROR');assert.equal(records.length,2);
 assert.doesNotThrow(()=>createRealtimeDiagnostics(()=>{throw Error('telemetry failed');}).status('CLOSED'));
});
test('new queue accepts fixed realtime reasons and remains compatible with old unsent diagnostics',()=>{
 const item={id:crypto.randomUUID(),clientId:crypto.randomUUID(),stage:'realtime',category:'network',route:'activities',build:DIAGNOSTIC_BUILD,attempts:1,elapsedMs:4,frames:[],queuedAt:Date.now(),reason:'transport'};
 assert.equal(safeQueuedDiagnostic(item),true);
 assert.equal(safeQueuedDiagnostic({...item,reason:'TOKEN=private'}),false);
 const legacy={...item,stage:'identity',build:'access-diag-20261119-v1'};delete legacy.reason;
 assert.equal(safeQueuedDiagnostic(legacy),true);
 const error=new AccessLoadError('realtime','network',1,10,'transport');
 assert.equal(error.reason,'transport');assert.equal(error.stage,'realtime');
});
test('diagnostic identity is refreshed even when token changes do not reload the app',()=>{
 const source=readFileSync(new URL('../src/routes/__root.tsx',import.meta.url),'utf8');
 const update=source.indexOf('setAccessDiagnosticIdentity(session.access_token)');
 assert.ok(update>0 && update<source.indexOf('if (action === "none") return'));
});
