import test from 'node:test';
import assert from 'node:assert/strict';
import { createRealtimeFallback } from '../src/lib/realtime-fallback.ts';
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture(refresh = async () => {}, random = () => 0) {
  let now = 0, id = 0, visible = true; const jobs = new Map(); const flags = [];
  const controller = createRealtimeFallback({ refresh, canRefresh: () => visible, random,
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
  await f.advance(59_999); assert.equal(calls, 0);
  await f.advance(1); assert.equal(calls, 1);
  f.controller.status('SUBSCRIBED'); await f.advance(600_000);
  assert.equal(calls, 1); assert.equal(f.jobs.size, 0); f.controller.dispose();
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
  f.controller.status('CHANNEL_ERROR'); await f.advance(60_000);
  f.controller.resume(); f.controller.resume(); await f.advance(300_000);
  assert.equal(calls, 1); assert.equal(f.jobs.size, 0);
  f.controller.dispose(); finish(); await flush();
  assert.equal(f.jobs.size, 0); f.controller.resume(); assert.equal(calls, 1);
  let errors = 0; const broken = fixture(async () => { errors++; throw Error('offline'); });
  await broken.advance(120_000); assert.equal(errors, 2); broken.controller.dispose();
});
test('affected browsers are staggered rather than all querying at the same instant', () => {
  const a = fixture(undefined, () => 0), b = fixture(undefined, () => .75);
  assert.equal([...a.jobs.values()][0].at, 60_000);
  assert.equal([...b.jobs.values()][0].at, 75_000);
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
