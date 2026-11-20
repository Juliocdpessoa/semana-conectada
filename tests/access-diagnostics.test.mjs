import test from "node:test";
import assert from "node:assert/strict";
import {accessStep,AccessLoadError,diagnosticCategory,diagnosticFrames,diagnosticRoute,safeQueuedDiagnostic,DIAGNOSTIC_BUILD} from "../src/lib/access-diagnostics.ts";
test("successful validation is preserved",async()=>{const r=await accessStep("identity",async()=>({data:"ok",error:null}),Date.now()+1000);assert.equal(r.data,"ok");});
test("failed security check never becomes allowed and auth failures are not retried",async()=>{let calls=0;await assert.rejects(accessStep("password",async()=>{calls++;return {error:{status:403,message:"private"}}},Date.now()+1000),e=>e instanceof AccessLoadError&&e.stage==="password"&&e.category==="auth");assert.equal(calls,1);});
test("hung read aborts and returns a support code within its deadline",async()=>{let signal;const before=Date.now();await assert.rejects(accessStep("profile",s=>{signal=s;return new Promise(()=>{});},Date.now()+1000,20),e=>e instanceof AccessLoadError&&e.category==="timeout"&&!!e.reportId);assert.equal(signal.aborted,true);assert.ok(Date.now()-before<500);});
test("network retries are bounded at two",async()=>{let calls=0;await assert.rejects(accessStep("identity",async()=>{calls++;return {error:{message:"Failed to fetch"}}},Date.now()+3000),e=>e instanceof AccessLoadError&&e.attempts===2);assert.equal(calls,2);});
test("exhausted overall budget does not start another request",async()=>{let calls=0;await assert.rejects(accessStep("roles",async()=>{calls++;return {error:null}},Date.now()-1),e=>e.category==="timeout");assert.equal(calls,0);});
test("telemetry discards messages, queries and arbitrary URLs",()=>{
 const e=new Error("password=SECRET bearer=TOKEN /assets/secret.js:1:1");e.stack+="\n at render (https://nexoprog.com.br/assets/index-Abc123.js:12:4)\n at https://outside.invalid/path?token=SECRET";
 assert.deepEqual(diagnosticFrames(e),["/assets/index-Abc123.js:12:4"]);assert.equal(diagnosticRoute("/atividades?token=SECRET"),"activities");
 assert.equal(diagnosticCategory({status:503}),"server");
});
test("restored queue cannot forward free-text errors or secret URLs",()=>{
 const item={id:crypto.randomUUID(),clientId:crypto.randomUUID(),stage:"profile",category:"network",route:"activities",build:DIAGNOSTIC_BUILD,attempts:1,elapsedMs:1,frames:[],queuedAt:Date.now()};
 assert.equal(safeQueuedDiagnostic(item),true);
 assert.equal(safeQueuedDiagnostic({...item,stage:"password=SECRET"}),false);
 assert.equal(safeQueuedDiagnostic({...item,frames:["https://host/?token=SECRET"]}),false);
});
