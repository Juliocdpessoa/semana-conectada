import {test} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
const server=fs.readFileSync(new URL("../src/lib/overtime.functions.ts",import.meta.url),"utf8");
const fragment=server.slice(server.indexOf("async function loadEditableOvertimeRequest"),server.indexOf("export const updateOvertimeRequest"));
const js=ts.transpileModule(fragment,{compilerOptions:{target:ts.ScriptTarget.ESNext,module:ts.ModuleKind.None}}).outputText;
const access=new Function(js+";return loadEditableOvertimeRequest")();
const info={worksiteId:"site",isMeasurementControl:true};
function db(row){const q={select(){return q},eq(){return q},async maybeSingle(){return {data:row}}};return {from(){return q}}}
test("measurement can edit others' requests but cannot delete them",async()=>{
 const row={source_type:"manual",requester_user_id:"other",status:"approved"};
 assert.ok((await access(db(row),info,"me","id",true)).request);
 assert.ok((await access(db(row),info,"me","id")).error);
 assert.ok((await access(db(null),info,"me","id",true)).error);
 assert.ok((await access(db({...row,source_type:"scale_change"}),info,"me","id",true)).error);
});
test("PT is optional for old callers and audit actor is explicit",()=>{
 assert.ok(server.includes("pt_number: z.string().trim().max(120).nullable().optional()"));
 assert.ok(server.includes("pt_updated_by: userId"));
 const edit=server.slice(server.indexOf("export const updateOvertimeRequest"),server.indexOf("export const deleteOvertimeRequest"));
 assert.ok(edit.includes("data.id, true"));assert.ok(edit.includes('.eq("version", data.expectedVersion)'));
 assert.ok(!edit.includes("status:"));assert.ok(!edit.includes("decided_by"));
});
