import test from "node:test";
import assert from "node:assert/strict";
import {visiblePlanningValue,confirmedPlanningSnapshot} from "../src/lib/activity-planning-patch.ts";
const old={id:"a",version:1,pbs:null,pt_number:null,pt_color:null,release_type:"PT",scheduled_date:null,planning_data:{LIBRA:"OLD",description:"unchanged"}};
const saved={...old,version:2,pt_number:"22.221.178",pt_color:"yellow",planning_data:{LIBRA:"NEW"}};
test("PT and colour never regress after successful save when draft is cleared",()=>{
 for(const field of ["pt_number","pt_color"]){
 const expected=saved[field];
 assert.equal(visiblePlanningValue(old,undefined,field,{[field]:expected}),expected);
 assert.equal(visiblePlanningValue(old,saved,field,{}),expected);
 assert.equal(visiblePlanningValue({...old},saved,field,{}),expected);
 assert.equal(visiblePlanningValue(saved,saved,field,{}),expected);
 }
});
test("delayed old list response cannot undo confirmed clear or colour removal",()=>{
 const cleared={...saved,version:3,pt_number:null,pt_color:null};
 assert.equal(visiblePlanningValue(saved,cleared,"pt_number"),"");
 assert.equal(visiblePlanningValue(saved,cleared,"pt_color"),"");
});
test("newer remote edits win, including another user's clear",()=>{
 const remote={...saved,version:3,pt_number:"REMOTE",pt_color:null};
 assert.equal(visiblePlanningValue(remote,saved,"pt_number"),"REMOTE");
 assert.equal(visiblePlanningValue(remote,saved,"pt_color"),"");
 assert.equal(confirmedPlanningSnapshot(remote,saved),remote);
});
test("typing during a pending save stays visible without reviving saved drafts",()=>{
 assert.equal(visiblePlanningValue(old,saved,"pt_number",{pt_number:"NEXT"}),"NEXT");
 assert.equal(visiblePlanningValue(old,saved,"pt_number",{}),saved.pt_number);
});
test("LIBRA follows the same monotonic rendering and unrelated task cannot leak",()=>{
 assert.equal(visiblePlanningValue(old,saved,"libra"),"NEW");
 assert.equal(visiblePlanningValue({...old,id:"another"},saved,"libra"),"OLD");
});
