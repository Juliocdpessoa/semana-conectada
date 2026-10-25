import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
test("one top-level Operational Management item replaces Panel and standalone Planning", () => {
  const layout = read("src/routes/_authenticated/route.tsx");
  assert.ok(layout.includes('label: "Gestão Operacional"'));
  assert.ok(!layout.includes('to: "/planejamento"'));
  assert.ok(!layout.includes('label: "Painel"'));
  assert.ok(layout.includes("show: !overtimeOnly"));
});
test("Imports lives in the management tabs, lazy loads, and respects planning/admin access", () => {
  const panel = read("src/routes/_authenticated/painel.tsx");
  assert.ok(panel.includes('lazy(() => import("@/components/operational-imports"))'));
  assert.ok(panel.includes('view === "importacoes" && canAccessRs'));
  assert.ok(panel.includes('requestedView === "importacoes"'));
  assert.ok(panel.includes('role === "planning" || role === "admin"'));
  assert.ok(panel.includes('onChange("importacoes")'));
  assert.ok(panel.includes("Importações"));
});
test("old bookmarks redirect with the existing permission gate; module rechecks access", () => {
  const old = read("src/routes/_authenticated/planejamento.tsx"),
    module = read("src/components/operational-imports.tsx");
  for (const term of [
    'role === "planning" || role === "admin"',
    "/painel?view=importacoes",
    "replace: true",
  ])
    assert.ok(old.includes(term), term);
  assert.ok(module.includes("props.session.roles.some"));
  assert.ok(module.includes("Sem permissão para importações"));
  assert.ok(module.includes("{tabs}"));
  for (const term of [
    "ImportModal",
    "Ativar como operacional",
    "downloadWeeklyTemplate",
    "rsProgramImportError",
    "createdWeekId",
    "manageSapClosure",
  ])
    assert.ok(module.includes(term), term);
});
test("management tabs remain reachable with no active operational week", () => {
  const panel = read("src/routes/_authenticated/painel.tsx");
  const empty = panel.slice(
    panel.indexOf("if (!activeWeek.data)"),
    panel.indexOf("if (!activeWeek.data)") + 650,
  );
  assert.ok(empty.includes("{tabs}"));
  assert.ok(empty.includes("aba Importações"));
});
