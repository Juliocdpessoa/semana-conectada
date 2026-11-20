import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { overtimeDraftKey, readOvertimeDraft, restoreOvertimeForm, persistOvertimeDraft, removeOvertimeDraft } from '../src/lib/overtime-draft-storage.ts';
test('draft ownership is scoped by BOTH user and worksite; legacy unowned data is not restored', () => {
  const previous = globalThis.sessionStorage; const values = new Map([['nexo:overtime-request-draft', 'legacy']]);
  try {
    globalThis.sessionStorage = { getItem: key => values.get(key) ?? null, setItem: (key,value) => values.set(key,value), removeItem: key => values.delete(key) };
    assert.equal(persistOvertimeDraft(overtimeDraftKey('a','site1'), { text: 'draft' }), true);
    assert.equal(readOvertimeDraft(overtimeDraftKey('b','site1')), null);
    assert.equal(readOvertimeDraft(overtimeDraftKey('a','site2')), null);
    assert.deepEqual(JSON.parse(readOvertimeDraft(overtimeDraftKey('a','site1'))), { text: 'draft' });
    removeOvertimeDraft(overtimeDraftKey('a','site1'));
    assert.equal(readOvertimeDraft(overtimeDraftKey('a','site1')), null);
    assert.equal(values.get('nexo:overtime-request-draft'), 'legacy');
  } finally { if(previous===undefined)delete globalThis.sessionStorage;else globalThis.sessionStorage=previous; }
});
test('storage denied/full cannot crash editing or prevent a successful submission from completing', () => {
  const previous = globalThis.sessionStorage;
  try {
    globalThis.sessionStorage = { getItem(){throw Error('Denied');},setItem(){throw Error('Full');},removeItem(){throw Error('Denied');} };
    assert.equal(readOvertimeDraft('test'), null);
    assert.equal(persistOvertimeDraft('test', {}), false);
    assert.doesNotThrow(() => removeOvertimeDraft('test'));
  } finally { if(previous===undefined)delete globalThis.sessionStorage;else globalThis.sessionStorage=previous; }
});
test('corrupted draft fields do not break the form or inject unknown keys', () => {
  const defaults={overtime_date:'2026-11-20',service_description:'',needs_snack:false,activity_id:null};
  const result=restoreOvertimeForm({overtime_date:'2026-02-31',service_description:'unfinished',needs_snack:'yes',activity_id:4,password:'unwanted'}, defaults);
  assert.deepEqual(result,{...defaults,service_description:'unfinished'});
  assert.deepEqual(restoreOvertimeForm({overtime_date:4},defaults),defaults);
  assert.deepEqual(restoreOvertimeForm(null,defaults),defaults);
});
test('the real overtime form uses scoped draft/cache keys and cancellable worksite employee reads', () => {
  const source=readFileSync(new URL('../src/routes/_authenticated/hora-extra.tsx',import.meta.url),'utf8');
  const loader=source.slice(source.indexOf('async function loadEmployees'),source.indexOf('type Period'));
  assert.match(loader,/\.eq\("worksite_id", worksiteId\)/);
  assert.match(loader,/\.order\("full_name"\)\s*\.order\("id"\)/);
  assert.match(loader,/\.abortSignal\(signal\)/);
  const form=source.slice(source.indexOf('function NewRequestModal'));
  assert.match(form,/overtimeDraftKey\(session.userId, session.worksiteId\)/);
  assert.match(form,/restoreOvertimeForm\(parsed.form, current\)/);
  assert.match(form,/overtime_date: toIsoDate\(new Date\(\)\)/);
  assert.doesNotMatch(form,/sessionStorage\.(setItem|getItem|removeItem)/);
});
