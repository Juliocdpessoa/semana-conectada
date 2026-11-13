import {test} from "node:test";
import assert from "node:assert/strict";
import {calculateSpecialtyRealization,calculateCenterRealization} from "../src/lib/weekly-availability.ts";
test("specialty alone caps capacity: both user examples and excess",()=>{
 for(const [available,expected] of [[50,100],[100,100],[40,80]]){
 const rows=["CALD","CALD_IARI"].map(center=>({center,date:"2026-11-13",hours:available,week:"046-2026",local:"ROTINA",specialty:"Caldeiraria"}));
 const centers=[{center:"CALD",programmed:100,completed:25,completedForRs:25,immediate:0},{center:"CALD_IARI",programmed:100,completed:75,completedForRs:75,immediate:0}];
 const result=calculateSpecialtyRealization(rows,centers,true);
 assert.equal(result.rows[0].considered,expected);
 const detail=calculateCenterRealization(rows,centers,true,"Caldeiraria",true);
 assert.equal(detail.reduce((t,r)=>t+r.considered,0),100);
 assert.equal(detail.find(r=>r.center==="CALD_IARI").considered,75);
 }
});
