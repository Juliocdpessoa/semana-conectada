import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import { hasConfinedSpacePbs } from "../src/lib/confined-space.ts";
test("print includes only confined space, without a PBS column", async () => {
 const source=fs.readFileSync(new URL("../src/routes/_authenticated/atividades.tsx",import.meta.url),"utf8");
 const start=source.indexOf('      const ExcelJS = (await import("exceljs")).default;');
 const end=source.indexOf("      const buffer = await workbook.xlsx.writeBuffer();",start);
 assert.ok(start>0 && end>start);
 let code=source.slice(start,end).replace('const ExcelJS = (await import("exceljs")).default;',"");
 // Remove the few TypeScript-only assertions in the print generator.
 code=code.replaceAll(" as const","").replaceAll(" as any","").replaceAll(" as BlobPart","").replaceAll("!]","]");
 const sheet={rows:new Map(),columns:new Map(),pageSetup:{},mergeCells(){},getCell(){return {};},
 getRow(n){if(!this.rows.has(n))this.rows.set(n,{cells:new Map(),getCell(c){if(!this.cells.has(c))this.cells.set(c,{});return this.cells.get(c);}});return this.rows.get(n);},
 getColumn(n){if(!this.columns.has(n))this.columns.set(n,{});return this.columns.get(n);},
 addRow(values){this.getRow(10+this.rowsAdded++).values=values;},rowsAdded:0};
 const ExcelJS={Workbook:class{addWorksheet(){return sheet;}}};
 const fixtures=[{pbs:"13,16,22",planning_data:{},source_row_number:1},{pbs:"116",planning_data:{},source_row_number:2}];
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 const run=new AsyncFunction("ExcelJS","filtered","activeWeek","gerLabel","planningValue","effectivePtColor","PT_COLOR_LABELS","hasConfinedSpacePbs",code);
 await run(ExcelJS,fixtures,{data:{start_date:"2026-11-09",end_date:"2026-11-13",code:"046"}},()=>"", (r,f)=>r[f]??"",()=>null,{},hasConfinedSpacePbs);
 assert.equal(sheet.getRow(9).values.length,22);
 assert.equal(sheet.getRow(9).values.at(-1),"Espaço confinado");
 assert.equal(sheet.getRow(9).values.includes("PBS"),false);
 assert.equal(sheet.getRow(10).values.at(-1),"Sim");
 assert.equal(sheet.getRow(11).values.at(-1),"Não");
 assert.equal(sheet.pageSetup.printArea,"A1:V11");
 assert.equal(sheet.columns.size,22);
});
