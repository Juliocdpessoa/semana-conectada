import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as jsx from 'react/jsx-runtime';
import ts from 'typescript';
const source = readFileSync(new URL('../src/components/ui-kit.tsx', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
} });
const exported = {};
new Function('require', 'exports', outputText)(name => {
  if (name === 'react/jsx-runtime') return jsx;
  if (name === '@/lib/utils') return { cn: (...values) => values.filter(Boolean).join(' ') };
  throw Error('Unexpected dependency ' + name);
}, exported);
function find(node, predicate) {
  if (!node || typeof node !== 'object') return null;
  if (predicate(node)) return node;
  const children = [].concat(node.props?.children ?? []);
  for (const child of children) { const result = find(child, predicate); if (result) return result; }
  return null;
}
test('protected forms cannot close on backdrop; explicit close remains available and does not submit', () => {
  let closed = 0;
  const tree = exported.Modal({ title: 'Form', onClose: () => closed++, closeOnBackdropClick: false, children: 'draft' });
  assert.equal(tree.props.onClick, undefined); assert.equal(closed, 0);
  const close = find(tree, node => node.type === 'button' && node.props['aria-label'] === 'Fechar');
  assert.equal(close.props.type, 'button'); close.props.onClick(); assert.equal(closed, 1);
});
test('regular dialogs retain their default backdrop close and inside clicks stop propagation', () => {
  let closed = 0, stopped = false;
  const tree = exported.Modal({ title: 'Normal', onClose: () => closed++, children: 'content' });
  tree.props.onClick(); assert.equal(closed, 1);
  tree.props.children.props.onClick({ stopPropagation() { stopped = true; } });
  assert.equal(stopped, true); assert.equal(closed, 1);
});
