import assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
test("operation can edit LIBRA in grid without unlocking other planning cells",()=>{
 const v=read("src/routes/_authenticated/atividades.tsx");
 assert.match(v,/isOperationOnly && \(field === "pt_number" \|\| field === "libra"\)/);
 const server=read("src/lib/activities.functions.ts");
 assert.doesNotMatch(server,/currentLibra|requested.libra !== undefined/);
 assert.match(server,/current.pbs/);assert.match(server,/current.scheduled_date/);
 assert.match(server,/data.rows.length !== 1/);
});
test("operation SQL changes only PT and LIBRA and adds it to its natural audit",()=>{
 const sql=read("supabase/migrations/20261030190000_operation_edit_libra.sql");
 assert.doesNotMatch(sql,/Somente Planejamento e Administrador podem editar LIBRA/);
 assert.match(sql,/IF is_operation AND NOT is_full_access/);
 assert.match(sql,/x\(id uuid, pt_number text, pt_color text, libra text\)/);
 assert.match(sql,/operation_user THEN NEW.planning_data:=coalesce\(OLD.planning_data/);
 assert.match(sql,/operation_user AND old_business->'libra' IS DISTINCT FROM new_business->'libra'/);
 assert.match(sql,/pt_fields_changed:=[^;]*old_business->'libra' IS DISTINCT FROM new_business->'libra'/);
 assert.match(sql,/a.version IS DISTINCT FROM x.expected_version/);
 assert.match(sql,/public.can_access_worksite/);
});
