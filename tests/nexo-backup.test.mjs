import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const sql = readFileSync("supabase/migrations/20261025020000_automatic_local_backup.sql", "utf8");
const receiver = readFileSync("scripts/nexo-backup/Receive-NexoBackup.ps1", "utf8");
test("snapshot is atomic with successful official-basis history, including retries", () => {
  assert.match(sql, /AFTER INSERT ON public.weekly_rs_program_base_history/);
  assert.match(sql, /One statement snapshot across every table/);
  assert.match(sql, /UNIQUE\(week_id,basis_version\)/);
  assert.doesNotMatch(
    sql,
    /DELETE FROM public\.(activities|weeks|sap_confirmation_rows|weekly_rs_closures)\b/,
  );
});
test("private worksite-scoped delivery excludes auth data and validates receiver identity", () => {
  for (const table of ["devices", "chunks", "jobs", "job_chunks"])
    assert.match(sql, new RegExp(`nexo_backup_${table} ENABLE ROW LEVEL SECURITY`));
  assert.match(sql, /j.worksite_id=d.worksite_id/);
  assert.match(sql, /revoked_at IS NULL/);
  assert.match(sql, /digest\(convert_to\(p_token,'UTF8'\),'sha256'\)/);
  assert.doesNotMatch(receiver, /SERVICE_ROLE|CHAVE_SAP/);
});
test("ack follows persisted archive checksum verification; old ZIPs are not overwritten", () => {
  assert.ok(
    receiver.indexOf("Assert-Archive $target") < receiver.indexOf("Invoke-Rpc 'nexo_backup_ack'"),
  );
  assert.match(receiver, /\[IO.File\]::Move\(\$partial,\$target\)/);
  assert.match(receiver, /if \(-not \(Test-Path -LiteralPath \$target\)\)/);
  assert.match(receiver, /Local\\NEXO-SAP-RS-Backup/);
  assert.match(receiver, /ConvertTo-SecureString/);
});
