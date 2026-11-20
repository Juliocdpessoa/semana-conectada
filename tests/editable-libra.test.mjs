import assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
import { buildPlanningPatch } from "../src/lib/activity-planning-patch.ts";
test("LIBRA joins the same grid, bulk payload, modal and natural timeline",()=>{
 const v=read("src/routes/_authenticated/atividades.tsx");
 assert.match(v,/"release_type", "libra", "scheduled_date"/);
 assert.match(v,/buildPlanningPatch\(confirmedPlanningSnapshot/);
 const patch=buildPlanningPatch({id:"a",version:3,pbs:null,pt_number:"22535986",pt_color:null,release_type:null,scheduled_date:null,planning_data:{LIBRA:"old"}},{libra:"new"});
 assert.deepEqual(patch.fields,["libra"]);
 assert.deepEqual(patch.expectedValues,{libra:"old"});
 assert.equal(patch.libra,"new");
 assert.match(v,/libra: "LIBRA"/);
 assert.equal(patch.expectedVersion,3);
 assert.match(v,/const \[pbs, ptNumber, releaseType, libra, scheduledDate\]/);
 assert.match(v,/canEditPlanningFields \|\|/);
 assert.doesNotMatch(v,/fmtPlan\(r.planning_data, "LIBRA"\) \?\? "—"/);
});
test("server validates LIBRA and passes its optional value to the scoped RPC",()=>{
 const v=read("src/lib/activities.functions.ts");
 assert.match(v,/libra: z.string\(\).trim\(\).max\(120\).nullable\(\).optional\(\)/);
 assert.match(v,/const isOperation = !canEditPlanning/);
 assert.match(v,/Object.fromEntries\(row.fields.map\(field => \[field,values\[field\]\]\)\)/);
 assert.match(v,/"patch_activity_planning_fields"/);
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
