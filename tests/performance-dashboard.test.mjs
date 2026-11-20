import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const sql = read("supabase/migrations/20261120170000_app_performance_dashboard.sql");
test("dashboard is gated in SQL, scopes local admins and never returns SQL or actor details", () => {
  assert.match(sql, /public\.password_access_allowed\(\)/);
  assert.match(sql, /NOT public\.is_approved\(actor\)/);
  assert.match(sql, /public\.has_role\(actor,'admin'\)/);
  assert.match(sql, /global_scope OR worksite_id=site/g);
  assert.match(sql, /CASE WHEN global_scope THEN/);
  assert.doesNotMatch(sql, /SELECT\s+query\b|jsonb_build_object\('actor|email|pt_number/i);
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION public\.get_app_performance_dashboard\(integer\) FROM PUBLIC,anon/,
  );
});
test("telemetry writes only bounded metadata, never business rows", () => {
  assert.match(sql, /pg_try_advisory_xact_lock/);
  assert.match(sql, /interval '1 minute'\)>=200/);
  assert.match(sql, /LIMIT 200/);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.doesNotMatch(
    sql,
    /(?:INSERT INTO|UPDATE|DELETE FROM) public\.(activities|profiles|user_roles|worksites)\b/,
  );
  const client = read("src/lib/performance-client.ts");
  assert.match(client, /controller\.abort\(\), 3000/);
  assert.doesNotMatch(client, /localStorage|sessionStorage|p_filters|pt_number|\.retry\(/);
  assert.match(read("src/routes/_authenticated/atividades.tsx"), /size === pageSize && !signal\?\.aborted/);
  const functions = read("src/lib/performance.functions.ts");
  assert.match(functions, /middleware\(\[requireSupabaseAuth\]\)/);
  assert.doesNotMatch(functions, /supabaseAdmin|client\.server/);
});
test("UI does not label absent samples as availability and handles failed refreshes", () => {
  const ui = read("src/components/performance-dashboard.tsx");
  assert.match(ui, /query\.isError/);
  assert.match(ui, /Sem amostras/);
  assert.match(ui, /zero não\s+comprova disponibilidade/);
  assert.match(
    read("src/routes/_authenticated/admin/desempenho.tsx"),
    /refetchIntervalInBackground: false/,
  );
  assert.match(ui, /timeZone: ["']America\/Sao_Paulo["']/);
});
