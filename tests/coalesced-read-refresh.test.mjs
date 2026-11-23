import test from 'node:test';
import assert from 'node:assert/strict';
import {QueryClient,QueryObserver} from '@tanstack/query-core';
import {readFileSync} from 'node:fs';
import {createCoalescedReadRefresh} from '../src/lib/coalesced-read-refresh.ts';
const tick=()=>new Promise(r=>setImmediate(r));
test('continuous wiring scopes all reads to worksite/user and preserves drafts and subscriptions',()=>{
 const source=readFileSync(new URL('../src/components/continuous-activities.tsx',import.meta.url),'utf8');
 const effect=source.slice(source.indexOf('if(importsOnly)return;'),source.indexOf('async function save()'));
 assert.match(effect,/createCoalescedReadRefresh/);assert.match(effect,/\[key,session.worksiteId,session.userId\]/);
 assert.match(effect,/cancelRefetch:false,throwOnError:true/);assert.match(effect,/reconciler.dispose\(\)/);
 assert.match(effect,/worksite_id=eq/);assert.doesNotMatch(effect,/setDraft|save_continuous|\.refreshSession\(|\.setAuth\(/);
});
test('an older in-flight query is joined then refreshed to the new server state',async()=>{
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
 const key=['continuous-activities','site','user'];let version=1,calls=0,finish;
 client.setQueryData(key,0);
 const observer=new QueryObserver(client,{queryKey:key,staleTime:Infinity,queryFn:()=>{
  const captured=version;calls++;
  if(calls===1)return new Promise(resolve=>{finish=()=>resolve(captured);});
  return captured;
 }});
 const stop=observer.subscribe(()=>{});const before=observer.refetch();await tick();version=2;
 const refresh=createCoalescedReadRefresh({canRead:()=>true,hasPending:()=>client.isFetching({queryKey:key})>0,
  read:()=>client.refetchQueries({queryKey:key,type:'active'},{cancelRefetch:false,throwOnError:true})});
 const next=refresh.request();await tick();finish();await Promise.all([before,next]);
 assert.equal(client.getQueryData(key),2);assert.equal(calls,2);
 refresh.dispose();stop();client.clear();
});
test('many events coalesce into one catch-up, without overlapping reads',async()=>{
 let calls=0,active=0,max=0;const finish=[];
 const r=createCoalescedReadRefresh({canRead:()=>true,hasPending:()=>false,read:()=>{
  calls++;active++;max=Math.max(max,active);return new Promise(resolve=>finish.push(()=>{active--;resolve();}));
 }});
 const pending=r.request();await tick();for(let i=0;i<20;i++)r.request();
 assert.equal(calls,1);finish[0]();await tick();assert.equal(calls,2);finish[1]();await pending;
 assert.equal(max,1);r.dispose();
});
test('hidden/offline or disposed screens never start catch-up reads',async()=>{
 for(const dispose of [true,false]){
  let visible=true,calls=0,finish;
  const r=createCoalescedReadRefresh({canRead:()=>visible,hasPending:()=>true,read:()=>{calls++;return new Promise(resolve=>finish=resolve);}});
  const pending=r.request();await tick();if(dispose)r.dispose();else visible=false;
  finish();await pending;await r.request();assert.equal(calls,1);r.dispose();
 }
});
test('read errors propagate; a later request can recover without retrying writes',async()=>{
 let calls=0;
 const r=createCoalescedReadRefresh({canRead:()=>true,hasPending:()=>false,read:async()=>{calls++;if(calls===1)throw Error('read unavailable');}});
 await assert.rejects(r.request(),/unavailable/);assert.equal(calls,1);await r.request();assert.equal(calls,2);r.dispose();
});
test('continuous events get at most two immediate passes then one deferred catch-up',async()=>{
 let calls=0,next,cleared=0;
 const r=createCoalescedReadRefresh({canRead:()=>true,hasPending:()=>true,read:async()=>{calls++;},
  setTimer:(fn,ms)=>{assert.equal(ms,2000);next=fn;return 1;},clearTimer:()=>{cleared++;}});
 await r.request();assert.equal(calls,2);assert.equal(typeof next,'function');r.dispose();assert.equal(cleared,1);
 next();await tick();assert.equal(calls,2);
});
