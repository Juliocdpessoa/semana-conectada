import assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
test("LIBRA joins the same grid, bulk payload, modal and natural timeline",()=>{
 const v=read("src/routes/_authenticated/atividades.tsx");
 assert.match(v,/"release_type", "libra", "scheduled_date"/);
 assert.match(v,/libra: planningValue\(row, "libra"\)/);
 assert.match(v,/libra: current.libra \|\| null/);
 assert.match(v,/libra: "LIBRA"/);
 assert.match(v,/expectedVersion: rows\[index\].version/);
 assert.match(v,/const \[pbs, ptNumber, releaseType, libra, scheduledDate\]/);
 assert.match(v,/canEditPlanningFields \|\|/);
 assert.doesNotMatch(v,/fmtPlan\(r.planning_data, "LIBRA"\) \?\? "—"/);
});
test("server validates LIBRA and operation cannot change it",()=>{
 const v=read("src/lib/activities.functions.ts");
 assert.match(v,/libra: z.string\(\).trim\(\).max\(120\).nullable\(\).optional\(\)/);
 assert.match(v,/requested.libra !== undefined/);
 assert.match(v,/row.libra !== undefined \? \{ libra: row.libra \}/);
});
test("SQL reuses locking/versioning and existing audit triggers, preserves omitted fields",()=>{
 const sql=read("supabase/migrations/20261030180000_editable_activity_libra.sql");
 assert.match(sql,/FOR UPDATE OF a/);assert.match(sql,/a.version IS DISTINCT FROM x.expected_version/);
 assert.match(sql,/Somente Planejamento e Administrador podem editar LIBRA/);
 assert.match(sql,/public.can_access_worksite/);
 assert.match(sql,/r \? 'libra'/);assert.match(sql,/ELSE '\{\}'::jsonb END/);
 assert.match(sql,/jsonb_build_object\('libra',nullif\(btrim\(OLD.planning_data->>'LIBRA'\)/);
 assert.match(sql,/jsonb_build_object\('libra',nullif\(btrim\(NEW.planning_data->>'LIBRA'\)/);
 assert.equal((sql.match(/INSERT INTO public.activity_history/g)||[]).length,1);
});
