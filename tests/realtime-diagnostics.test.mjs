import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {classifyRealtimeFailure,createRealtimeDiagnostics,realtimeCloseCode} from '../src/lib/realtime-diagnostics.ts';
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

test('numeric close codes survive SDK normalization without free text or secrets',()=>{
 for(const code of [1000,1006,1008,1012,4001,4999]) {
  assert.equal(realtimeCloseCode({code,reason:'SECRET'}),code);
  assert.equal(realtimeCloseCode(new Error(`socket closed: ${code} (SECRET)`,{cause:{code,reason:'SECRET'}})),code);
  assert.equal(realtimeCloseCode(new Error(`socket closed: ${code} (SECRET)`)),code);
 }
 for(const code of ['1006',999,5000,NaN,1006.1,Infinity,null])assert.equal(realtimeCloseCode({code}),undefined);
 assert.equal(realtimeCloseCode(new Error('private token 1006')),undefined);
 assert.equal(realtimeCloseCode({get code(){throw Error('secret');}}),undefined);
 const records=[];createRealtimeDiagnostics(r=>records.push(r)).status('CHANNEL_ERROR',new Error('socket closed: 1006 (TOKEN)',{cause:{code:1006,url:'SECRET'}}));
 assert.equal(records[0].closeCode,1006);
 assert.doesNotMatch(JSON.stringify(records),/TOKEN|SECRET|cause|url/);
});

test('queued codes are bounded, optional, and realtime-only',()=>{
 const item={id:crypto.randomUUID(),clientId:crypto.randomUUID(),stage:'realtime',category:'network',route:'activities',build:DIAGNOSTIC_BUILD,attempts:1,elapsedMs:4,frames:[],queuedAt:Date.now()};
 assert.equal(safeQueuedDiagnostic({...item,closeCode:1006}),true);
 for(const code of ['1006',999,5000,1006.1])assert.equal(safeQueuedDiagnostic({...item,closeCode:code}),false);
 assert.equal(safeQueuedDiagnostic({...item,stage:'identity',closeCode:1006}),false);
 assert.equal(new AccessLoadError('identity','network',1,0,undefined,1006).closeCode,undefined);
 assert.equal(new AccessLoadError('realtime','network',1,0,'transport',1006).closeCode,1006);
});
