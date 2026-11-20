import test from 'node:test';
import assert from 'node:assert/strict';
import { readAllPages, retryReadQuery } from '../src/lib/read-query-policy.ts';
import { authCacheAction } from '../src/lib/auth-cache-policy.ts';

test('SAP reads include rows beyond the first 1000 with stable page boundaries', async () => {
  const source = Array.from({ length: 2047 }, (_, id) => ({ id }));
  const calls = [];
  const rows = await readAllPages(async (offset, size) => {
    calls.push(offset); return source.slice(offset, offset + size);
  });
  assert.deepEqual(rows, source);
  assert.deepEqual(calls, [0, 1000, 2000]);
});
test('cancelling a week stops subsequent SAP pages and never returns partial success', async () => {
  const controller = new AbortController(); let calls = 0;
  await assert.rejects(readAllPages(async () => {
    calls++; controller.abort(); return [1, 2];
  }, controller.signal, 2), { name: 'AbortError' });
  assert.equal(calls, 1);
});
test('read retries are bounded and never repeat rate limits, denied access or business conflicts', () => {
  for (const error of [{ status: 401 }, { status: 403 }, { status: 429 }, { code: 'PT409' }, { code: 'PGRST301' }, { code: '42501' }])
    assert.equal(retryReadQuery(0, error), false);
  assert.equal(retryReadQuery(0, new TypeError('Failed to fetch')), true);
  assert.equal(retryReadQuery(1, { status: 503 }), false);
});
test('tab focus does not reload all queries; sign-out and identity changes clear cached data', () => {
  assert.equal(authCacheAction('INITIAL_SESSION', undefined, 'a'), 'none');
  assert.equal(authCacheAction('SIGNED_IN', 'a', 'a'), 'none');
  assert.equal(authCacheAction('TOKEN_REFRESHED', 'a', 'a'), 'none');
  assert.equal(authCacheAction('SIGNED_IN', 'a', 'b'), 'clear');
  assert.equal(authCacheAction('SIGNED_OUT', 'a', null), 'clear');
  assert.equal(authCacheAction('USER_UPDATED', 'a', 'a'), 'refresh');
});
