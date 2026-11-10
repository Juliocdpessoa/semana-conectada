import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import ts from "typescript";
const source=fs.readFileSync(new URL("../src/components/activity-capacity-card.tsx",import.meta.url),"utf8");
const chunk=source.slice(source.indexOf('const CAPACITY_NOTICE_EVENT'),source.indexOf('function CapacityNotice()')).replace('export function','function');
const js=ts.transpileModule(chunk,{compilerOptions:{target:ts.ScriptTarget.ESNext,module:ts.ModuleKind.None}}).outputText;
function setup(window=new EventTarget()) {
 const notifications=[];
 window.addEventListener("nexo:activity-capacity-notice",event=>notifications.push(event.detail));
 return {notifications,notify:new Function("window","CustomEvent",js+";return notifyActivityCapacity;")(window,CustomEvent)};
}
test("preserves every capacity warning, without truncation",()=>{
 const {notify,notifications}=setup(); const warnings=["A","B","C","D"];
 notify({capacityWarnings:warnings}); assert.deepEqual(notifications,[warnings]);
});
test("capacity check failure is acknowledged in the same notice",()=>{
 const {notify,notifications}=setup(); notify({capacityWarnings:["Overload"],capacityCheckFailed:true});
 assert.equal(notifications.length,1); assert.equal(notifications[0].length,2);
 assert.match(notifications[0][1],/conferir a capacidade/);
});
test("normal save does not open an unnecessary notice",()=>{
 const {notify,notifications}=setup(); notify({}); assert.equal(notifications.length,0);
});
test("server invocation is safe",()=>{
 const notify=new Function("window","CustomEvent",js+";return notifyActivityCapacity;")(undefined,CustomEvent);
 assert.doesNotThrow(()=>notify({capacityWarnings:["A"]}));
});
