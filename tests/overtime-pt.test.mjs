import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import ts from "typescript";
import { canCompleteOvertimePt } from "../src/lib/overtime-pt.ts";
test("only manual pending or approved missing PT can be completed",()=>{
 for(const status of ["pending","approved"]) assert.equal(canCompleteOvertimePt({source_type:"manual",status,pt_number:null}),true);
 for(const status of ["cancelled","rejected"]) assert.equal(canCompleteOvertimePt({source_type:"manual",status}),false);
 assert.equal(canCompleteOvertimePt({source_type:"scale_change",status:"approved"}),false);
 assert.equal(canCompleteOvertimePt({source_type:"manual",status:"approved",pt_number:"NA"}),false);
 assert.equal(canCompleteOvertimePt({source_type:"manual",status:"approved",pt_number:"  "}),true);
});
test("daily Excel PT header, width and value are aligned",()=>{
 const source=fs.readFileSync(new URL("../src/lib/overtime.functions.ts",import.meta.url),"utf8");
 const a=source.slice(source.indexOf("export const REGULAR_OVERTIME_EXPORT_HEADERS"),source.indexOf("export const LOGISTICS_EXPORT_HEADERS")).replaceAll("export ","");
 const b=source.slice(source.indexOf("export function mapRegularOvertimeExportRow"),source.indexOf("export function mapLogisticsExportRow")).replaceAll("export ","");
 const js=ts.transpileModule(a+b,{compilerOptions:{target:ts.ScriptTarget.ESNext,module:ts.ModuleKind.None}}).outputText;
 const f=new Function("formatDate","formatOvertimeStatus",js+";return {headers:REGULAR_OVERTIME_EXPORT_HEADERS,widths:REGULAR_OVERTIME_EXPORT_WIDTHS,map:mapRegularOvertimeExportRow};")(String,String);
 const row={employee_name:"Fixture",employee_role:"Fixture",overtime_date:"2026-11-10",departure_time:"18:30",status:"approved",pt_number:"22.001",service_description:"Fixture",justification:"Fixture"};
 const values=f.map(row); const index=f.headers.indexOf("Nº PT");
 assert.ok(index>=0);assert.equal(values[index],"22.001");assert.equal(f.headers.length,f.widths.length);assert.equal(values.length,f.headers.length);
 assert.equal(f.map({...row,pt_number:null})[index],"");
});
