import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRealtimeFallback } from '../src/lib/realtime-fallback.ts';
const flush = () => new Promise(resolve => setImmediate(resolve));
test('the fallback remains connected but its technical status is not shown to end users', () => {
  const source=readFileSync(new URL('../src/routes/_authenticated/atividades.tsx',import.meta.url),'utf8');
  assert.doesNotMatch(source,/Conexão em tempo real indisponível|liveSyncFallback/);
  assert.match(source,/createRealtimeFallback\(\{/);
  assert.match(source,/fallback.status\(status\)/);
  assert.match(source,/diagnostics.status\(status,error\)/);
});
function fixture(refresh = async () => {}, random = () => 0, hasChanges, reconcileMs) {
  let now = 0, id = 0, visible = true; const jobs = new Map(); const flags = [];
  const controller = createRealtimeFallback({ refresh, hasChanges,reconcileMs, canRefresh: () => visible, random,
    now: () => now,
    onFallback: state => flags.push(state),
    setTimer: (fn, delay) => { const key = ++id; jobs.set(key, { at: now + delay, fn }); return key; },
    clearTimer: key => jobs.delete(key),
  });
  return { controller, jobs, flags, visible: value => { visible = value; },
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        const next = [...jobs].filter(([, job]) => job.at <= end).sort((a,b) => a[1].at-b[1].at)[0];
        if (!next) break;
        now = next[1].at; jobs.delete(next[0]); next[1].fn(); await flush();
      }
      now = end;
    },
  };
}
test('a channel that never connects falls back, but a healthy channel never polls', async () => {
  let calls = 0; const f = fixture(async () => { calls++; });
  await f.advance(4_999); assert.equal(calls, 0);
  await f.advance(1); assert.equal(calls, 1);
  f.controller.status('SUBSCRIBED'); await f.advance(600_000);
  assert.equal(calls, 1); assert.equal(f.jobs.size, 0); f.controller.dispose();
});

test('opt-in healthy reconciliation catches missed deletions, bounded and visible only',async()=>{
 let calls=0;const f=fixture(async()=>{calls++;},()=>0,undefined,60000);
 f.controller.status('SUBSCRIBED');await f.advance(59999);assert.equal(calls,0);
 await f.advance(1);assert.equal(calls,1);
 f.visible(false);await f.advance(120000);assert.equal(calls,1);
 f.visible(true);f.controller.resume();await flush();assert.equal(calls,2);
 f.controller.dispose();await f.advance(120000);assert.equal(calls,2);
});
test('losing a healthy channel replaces its minute reconciliation timer with prompt fallback',async()=>{
 let calls=0;const f=fixture(async()=>{calls++;},()=>0,undefined,60000);
 f.controller.status('SUBSCRIBED');await f.advance(20000);f.controller.status('CHANNEL_ERROR');
 await f.advance(4999);assert.equal(calls,0);await f.advance(1);assert.equal(calls,1);f.controller.dispose();
});
test('hidden/offline tabs skip work; coming back refreshes and reconnect stops polling', async () => {
  let calls = 0; const f = fixture(async () => { calls++; });
  f.controller.status('TIMED_OUT'); f.visible(false);
  await f.advance(180_000); assert.equal(calls, 0);
  f.visible(true); f.controller.resume(); await flush(); assert.equal(calls, 1);
  f.controller.status('SUBSCRIBED'); await flush(); assert.equal(calls, 2);
  await f.advance(180_000); assert.equal(calls, 2); f.controller.dispose();
});
test('slow or failed reads never overlap, and dispose prevents late work', async () => {
  let calls = 0, finish; const f = fixture(() => { calls++; return new Promise(resolve => { finish = resolve; }); });
  f.controller.status('CHANNEL_ERROR'); await f.advance(5_000);
  f.controller.resume(); f.controller.resume(); await f.advance(300_000);
  assert.equal(calls, 1); assert.equal(f.jobs.size, 0);
  f.controller.dispose(); finish(); await flush();
  assert.equal(f.jobs.size, 0); f.controller.resume(); assert.equal(calls, 1);
  let errors = 0; const broken = fixture(async () => { errors++; throw Error('offline'); });
  await broken.advance(20_000); assert.equal(errors, 2); broken.controller.dispose();
});
test('affected browsers are staggered rather than all querying at the same instant', () => {
  const a = fixture(undefined, () => 0), b = fixture(undefined, () => .75);
  assert.equal([...a.jobs.values()][0].at, 5_000);
  assert.equal([...b.jobs.values()][0].at, 7_250);
  a.controller.dispose(); b.controller.dispose();
});
test('rapid visibility/online events do not repeatedly refetch the same active screen', async () => {
  let calls=0; const f=fixture(async()=>{calls++;});
  f.controller.status('SUBSCRIBED'); f.controller.resume(); await flush();
  for(let i=0;i<20;i++){f.controller.resume();await flush();}
  assert.equal(calls,1);
  await f.advance(15_000); f.controller.resume(); await flush();
  assert.equal(calls,2); f.controller.dispose();
});

test('unchanged revisions use lightweight probes, with periodic full reconciliation',async()=>{
 let reads=0,probes=0;const f=fixture(async()=>{reads++;},()=>0,async()=>{probes++;return false;});
 await f.advance(5000);assert.equal(reads,1);
 await f.advance(10000);assert.equal(reads,1);assert.equal(probes,2);
 await f.advance(50000);assert.equal(reads,2);assert.equal(probes,7);
 f.controller.status('SUBSCRIBED');const before=probes;await f.advance(100000);assert.equal(probes,before);f.controller.dispose();
});
test('continuous changes cannot amplify heavy reads above the fallback cooldown',async()=>{
 let reads=0;const f=fixture(async()=>{reads++;},()=>0,async()=>true);
 await f.advance(15000);assert.equal(reads,1);
 await f.advance(10000);assert.equal(reads,2);f.controller.dispose();
});
test('a reconnect during a read queues one catch-up without overlapping it',async()=>{
 let reads=0;const finish=[];const f=fixture(()=>{reads++;return new Promise(resolve=>finish.push(resolve));});
 f.controller.status('CHANNEL_ERROR');await f.advance(5000);assert.equal(reads,1);
 f.controller.status('SUBSCRIBED');await flush();assert.equal(reads,1);
 finish[0]();await flush();assert.equal(reads,2);
 finish[1]();await flush();assert.equal(f.jobs.size,0);f.controller.dispose();
});
test('disposing while a revision probe is pending cannot start a late heavy read',async()=>{
 let reads=0,finish;const f=fixture(async()=>{reads++;},()=>0,()=>new Promise(resolve=>finish=resolve));
 await f.advance(5000);f.controller.dispose();finish(true);await flush();assert.equal(reads,0);assert.equal(f.jobs.size,0);
});
