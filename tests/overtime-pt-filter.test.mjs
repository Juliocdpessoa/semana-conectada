import assert from "node:assert/strict";
import {test} from "node:test";
import fs from "node:fs";
import ts from "typescript";
import {z} from "zod";
const source=fs.readFileSync(new URL("../src/lib/overtime.functions.ts",import.meta.url),"utf8");
const schemaSource=source.slice(source.indexOf("const exportListSchema"),source.indexOf("const exportPageSchema"));
const fnSource=source.slice(source.indexOf("function applyOvertimeExportFilters"),source.indexOf("export const listOvertimeExportDates"));
const js=ts.transpileModule(schemaSource+fnSource,{compilerOptions:{target:ts.ScriptTarget.ESNext,module:ts.ModuleKind.None}}).outputText;
const {schema,apply}=new Function("z","isoDate",js+";return {schema:exportListSchema,apply:applyOvertimeExportFilters};")(z,z.string());
test("PT filter is optional and accepts full/partial PT or NA",()=>{
 assert.equal(schema.parse({}).ptSearch,"");
 for(const ptSearch of ["22.001.234","001","NA","N/A"])assert.equal(schema.parse({ptSearch}).ptSearch,ptSearch);
 for(const ptSearch of ["%","*","_"])assert.equal(schema.safeParse({ptSearch}).success,false);
});
test("server applies PT predicate with the other export filters",()=>{
 const calls=[];const q={gte(...x){calls.push(["gte",...x]);return this;},lte(...x){calls.push(["lte",...x]);return this;},eq(...x){calls.push(["eq",...x]);return this;},ilike(...x){calls.push(["ilike",...x]);return this;},or(...x){calls.push(["or",...x]);return this;}};
 apply(q,schema.parse({ptSearch:"22.001",dateFrom:"2026-11-10",entryTime:"17:18"}));
 assert.ok(calls.some(x=>JSON.stringify(x)===JSON.stringify(["ilike","pt_number","%22.001%"])));
 assert.ok(calls.some(x=>x[0]==="gte"));assert.ok(calls.some(x=>x[0]==="eq"));
 calls.length=0;apply(q,schema.parse({}));assert.equal(calls.some(x=>x[0]==="ilike"),false);
 calls.length=0;apply(q,schema.parse({ptMissing:true,ptSearch:"22"}));
 assert.ok(calls.some(x=>x[0]==="or" && x[1]==="pt_number.is.null,pt_number.eq."));
 assert.equal(calls.some(x=>x[0]==="ilike"),false);
});
test("all daily fetches and download receive PT and cache keys include it",()=>{
 const ui=fs.readFileSync(new URL("../src/routes/_authenticated/hora-extra.tsx",import.meta.url),"utf8");
 const d=ui.slice(ui.indexOf("  const loadOvertimeForExport ="),ui.indexOf("/* ---------- Transport view"));
 assert.equal(d.split('ptSearch: ptMissing ? "" : deferredPtSearch').length-1,3);
 assert.equal((d.match(/^      deferredPtSearch,/gm)||[]).length,3);
 assert.ok(ui.includes("border-red-200 bg-red-100"));assert.ok(ui.includes("border-green-300 bg-green-100"));
});
