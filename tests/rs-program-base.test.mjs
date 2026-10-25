import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import {
  parseRsProgramGrid,
  chooseOperationalSheet,
  RS_PROGRAM_COLUMNS,
  rsProgramCenter,
} from "../src/lib/rs-program-base.ts";

const header = [...RS_PROGRAM_COLUMNS];
function row(overrides = {}) {
  const fields = {
    Confirmação: 123,
    Ordem: 202123,
    Operação: "0010",
    CenTrabOperação: "FUNILEIR0293",
    Trabalho: 88,
    Número: 2,
    "Duração normal": 44,
    "1ª data início": "11/03/2026",
    "1ª data fim": "01/01/2027",
    ...overrides,
  };
  return header.map((key) => fields[key] ?? null);
}
test("original weekly Trabalho is used once, dates never prorate and source columns are preserved", () => {
  const [result] = parseRsProgramGrid([header, row()]);
  assert.equal(result.work, 88);
  assert.equal(result.center, "FUNILEIR");
  assert.equal(result.operation, "10");
  assert.equal(result.source_data["Número"], 2);
  assert.equal(result.source_data["1ª data fim"], "01/01/2027");
  assert.equal(Object.keys(result.source_data).length, 22);
});
test("comma decimals, zero, empty rows and numeric IDs are handled strictly", () => {
  assert.equal(parseRsProgramGrid([header, row({ Trabalho: "17,6" })])[0].work, 17.6);
  assert.equal(parseRsProgramGrid([header, row({ Trabalho: 0 }), []])[0].work, 0);
  for (const value of [null, "", -1, "1e3", Infinity])
    assert.throws(() => parseRsProgramGrid([header, row({ Trabalho: value })]));
  assert.throws(() => parseRsProgramGrid([header, row({ Confirmação: "1e3" })]));
});
test("duplicate confirmations, missing/duplicate required headers and empty SAP tabs are rejected", () => {
  assert.throws(
    () => parseRsProgramGrid([header, row(), row({ Confirmação: "000123" })]),
    /duplicada/,
  );
  assert.throws(() => parseRsProgramGrid([header]), /1 e 5.000/);
  assert.throws(
    () => parseRsProgramGrid([header.map((key) => (key === "Trabalho" ? "Outro" : key)), row()]),
    /Trabalho/,
  );
  assert.throws(() => parseRsProgramGrid([[...header, "Trabalho"], row()]), /duplicada/);
});
test("operational sheet is selected by name, never by SAP tab position", () => {
  assert.equal(
    chooseOperationalSheet(["Programação SAP", "Dados", "Acompanhamento"]),
    "Acompanhamento",
  );
  assert.equal(chooseOperationalSheet(["Dados", "Planilha1", "Programação SAP"]), "Planilha1");
  assert.throws(() => chooseOperationalSheet(["Programação SAP", "Dados"]));
  assert.throws(() => chooseOperationalSheet(["Outra", "Segunda", "Dados"]));
  assert.equal(rsProgramCenter("hidrojat"), "HIDROJAT");
});
test("migration parity, access, source history, confirmation cap and archive rules", () => {
  const sql = fs.readFileSync(
    new URL("../supabase/migrations/20261024160000_rs_official_program_base.sql", import.meta.url),
    "utf8",
  );
  assert.equal(
    sql,
    fs.readFileSync(
      new URL("../drizzle/migrations/0024_rs_official_program_base.sql", import.meta.url),
      "utf8",
    ),
  );
  for (const term of [
    "ENABLE ROW LEVEL SECURITY",
    "can_access_sap(auth.uid())",
    "can_access_worksite(auth.uid(),w.worksite_id)",
    "sap_closure_status='closed'",
    "p_expected_version",
    "rs_program_history_immutable",
    "'program_basis_history'",
    "p.confirmation=s.confirmation_key",
    "least(1::numeric",
  ])
    assert.ok(sql.includes(term), term);
  assert.ok(!/UPDATE public.activities|DELETE FROM public.activities/i.test(sql));
  const template = fs.readFileSync(
    new URL("../src/routes/_authenticated/planejamento.tsx", import.meta.url),
    "utf8",
  );
  assert.ok(template.includes("aoa_to_sheet([[...RS_PROGRAM_COLUMNS]])"));
  assert.ok(template.includes("book_append_sheet(wb, programacaoSap, RS_PROGRAM_SHEET)"));
});
