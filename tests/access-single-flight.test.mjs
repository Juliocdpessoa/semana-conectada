import test from 'node:test';
import assert from 'node:assert/strict';
import {singleFlight} from '../src/lib/access-single-flight.ts';
import {accessStep} from '../src/lib/access-diagnostics.ts';

test('route timeout does not discard a still-pending SDK operation on retry', async () => {
  let finish, calls=0;
  const read=singleFlight(()=>{calls++;return new Promise(resolve=>{finish=resolve;});});
  await assert.rejects(accessStep('session',read,Date.now()+1000,10),e=>e.category==='timeout');
  const retry=accessStep('session',read,Date.now()+1000,500);
  finish({data:'recovered'});
  assert.equal((await retry).data,'recovered');
  assert.equal(calls,1);
});
test('session errors do not start a second SDK refresh/backoff cycle', async () => {
  let calls=0;
  await assert.rejects(accessStep('session',async()=>{calls++;return {error:{status:503}};},Date.now()+1000),e=>e.category==='server'&&e.attempts===1);
  assert.equal(calls,1);
});

test('concurrent route retries join one pending SDK operation', async () => {
  let finish, calls=0;
  const read=singleFlight(()=>{calls++;return new Promise(resolve=>{finish=resolve;});});
  const a=read(), b=read();
  assert.equal(a,b);
  await Promise.resolve();
  assert.equal(calls,1);
  finish({data:'first'});
  assert.deepEqual(await a,{data:'first'});
  const c=read();
  await Promise.resolve();
  assert.equal(calls,2);
  finish({data:'fresh'});
  assert.deepEqual(await c,{data:'fresh'});
});
test('failed SDK operation is not cached as a session or grant', async () => {
  let calls=0;
  const read=singleFlight(async()=>{if(++calls===1)throw new Error('offline');return null;});
  await assert.rejects(read(),/offline/);
  assert.equal(await read(),null);
  assert.equal(calls,2);
});
