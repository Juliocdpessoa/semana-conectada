import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = readFileSync(new URL('../src/lib/lovable-error-reporting.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
const { reportLovableError } = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));
test('broken optional telemetry cannot crash the recovery screen or prevent the next reporter', () => {
  const previous = globalThis.window;
  let second = 0;
  try {
    globalThis.window = {
      location: { pathname: '/atividades' },
      __lovableEvents: { captureException() { throw new Error('Optional hook unavailable'); } },
      __lovableReportRuntimeError() { second++; throw new Error('Optional hook unavailable'); },
    };
    assert.doesNotThrow(() => reportLovableError(new Error('test')));
    assert.equal(second, 1);
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
});
