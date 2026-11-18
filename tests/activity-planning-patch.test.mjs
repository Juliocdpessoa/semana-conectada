import test from "node:test";
import assert from "node:assert/strict";
import {buildPlanningPatch,clearSavedPlanningDraft} from "../src/lib/activity-planning-patch.ts";
const row={id:"fixture",version:7,pbs:"13",pt_number:"22.526.522",pt_color:"yellow",release_type:"PT",scheduled_date:"2026-11-19",planning_data:{LIBRA:"A"}};
test("leaving an unchanged field produces no patch",()=>{assert.deepEqual(buildPlanningPatch(row,{pt_number:row.pt_number}).fields,[]);});
test("changing colour cannot resend stale PT",()=>{const p=buildPlanningPatch(row,{pt_color:"red"});assert.deepEqual(p.fields,["pt_color"]);assert.deepEqual(p.expectedValues,{pt_color:"yellow"});});
test("editing PT retains its original value for concurrency check",()=>{const p=buildPlanningPatch(row,{pt_number:"22.535.986"});assert.deepEqual(p.fields,["pt_number"]);assert.deepEqual(p.expectedValues,{pt_number:"22.526.522"});});
test("success clears only matching saved draft and retains newer typing",()=>{const p=buildPlanningPatch(row,{pt_number:"22.535.986"});assert.deepEqual(clearSavedPlanningDraft({fixture:{pt_number:"22.535.986",libra:"B"}},[p]),{fixture:{libra:"B"}});assert.deepEqual(clearSavedPlanningDraft({fixture:{pt_number:"NEW"}},[p]),{fixture:{pt_number:"NEW"}});});
test("bulk blanking is explicit, and unedited columns remain excluded",()=>{const p=buildPlanningPatch(row,{libra:"",scheduled_date:"2026-11-20"});assert.deepEqual(p.fields,["libra","scheduled_date"]);assert.equal(p.libra,null);assert.equal(p.fields.includes("pt_number"),false);});
