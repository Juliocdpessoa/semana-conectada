import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
test("employee deletion retains identity and histories, permission and worksite guards", () => {
  const source = read("src/lib/overtime.functions.ts");
  const handler = source.slice(
    source.indexOf("export const deleteEmployee ="),
    source.indexOf("const decideSchema"),
  );
  assert.doesNotMatch(handler, /\.delete\(/);
  assert.match(handler, /is_active: false/);
  assert.match(handler, /deleted_at: new Date/);
  assert.match(handler, /updated_by_user_id: userId/);
  assert.match(handler, /info.approvalStatus/);
  assert.match(handler, /info.isAdmin \|\| info.isManager \|\| info.isLogistics/);
  assert.match(handler, /\.eq\("worksite_id", info.worksiteId\)/);
  assert.match(source, /is_active: true,\s*deleted_at: null/);
});
test("management hides removed employees but does not hide historical requests", () => {
  const view = read("src/routes/_authenticated/hora-extra.tsx");
  assert.match(view, /\.select\(EMPLOYEE_SELECT\)\s*\.is\("deleted_at", null\)/);
  assert.match(view, /Histórico preservado/);
  const management = view.slice(view.indexOf("function EmployeeManagement("), view.indexOf("function EditEmployeeModal("));
  assert.doesNotMatch(management, /Excluir definitivamente/);
  const sql = read("supabase/migrations/20261030150000_employee_logical_delete.sql");
  assert.match(sql, /deleted_at IS NULL OR NOT is_active/);
  assert.doesNotMatch(sql, /\b(DELETE FROM|DROP|CASCADE)\b/);
});
