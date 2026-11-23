import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchReadWithDeadline} from '../src/lib/read-fetch-deadline.ts';
test('read deadline aborts a pending header request without retry',async()=>{
 let calls=0,signal;
 await assert.rejects(fetchReadWithDeadline(async(_u,i)=>{calls++;signal=i.signal;return new Promise(()=>{});},'https://test',undefined,10,100),{name:'TimeoutError'});
 assert.equal(calls,1);assert.equal(signal.aborted,true);
});
test('read deadline includes stalled body and cancels the stream',async()=>{
 let cancelled=false;
 const response=new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array([1]));},cancel(){cancelled=true;}}));
 await assert.rejects(fetchReadWithDeadline(async()=>response,'https://test',undefined,15,100),{name:'TimeoutError'});
 assert.equal(cancelled,true);
});
test('caller abort is forwarded, including pre-aborted calls',async()=>{
 const caller=new AbortController();let upstream;
 const pending=fetchReadWithDeadline(async(_u,i)=>{upstream=i.signal;return new Promise(()=>{});},'https://test',{signal:caller.signal},1000,100);
 caller.abort();await assert.rejects(pending,{name:'AbortError'});assert.equal(upstream.aborted,true);
 let calls=0;await assert.rejects(fetchReadWithDeadline(async()=>{calls++;},'https://test',{signal:caller.signal},1000,100),{name:'AbortError'});assert.equal(calls,0);
});
test('status, auth headers and JSON are preserved without retries',async()=>{
 const r=await fetchReadWithDeadline(async()=>new Response('{"code":"denied"}',{status:403,headers:{'www-authenticate':'Bearer','content-type':'application/json'}}),'https://test',undefined,100,100);
 assert.equal(r.status,403);assert.equal(r.headers.get('www-authenticate'),'Bearer');assert.deepEqual(await r.json(),{code:'denied'});
 const empty=await fetchReadWithDeadline(async()=>new Response(null,{status:204}),'https://test',undefined,100,100);assert.equal(empty.status,204);
});
test('read cap cancels oversized bodies',async()=>{
 let cancelled=false;
 await assert.rejects(fetchReadWithDeadline(async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(12));},cancel(){cancelled=true;}})),'https://test',undefined,100,10),{name:'QuotaExceededError'});
 assert.equal(cancelled,true);
});
