import assert from "node:assert/strict";
import { test } from "node:test";
import { canResetPassword, newPasswordSchema } from "../src/lib/password-reset.ts";
const local={id:"actor",email:"admin@example.com",approval_status:"approved",roles:["viewer"],memberships:[{worksite_id:"A",is_worksite_admin:true}]};
const target={id:"target",email:"person@example.com",approval_status:"approved",roles:["operation"],memberships:[{worksite_id:"A",is_worksite_admin:false}]};
test("local admin resets approved account in same worksite",()=>assert.equal(canResetPassword(local,target,"A"),true));
test("viewer cannot reset",()=>assert.equal(canResetPassword({...local,memberships:[]},target,"A"),false));
test("planning cannot reset",()=>assert.equal(canResetPassword({...local,roles:["planning"],memberships:[]},target,"A"),false));
test("cross-worksite and multi-worksite targets are protected",()=>{
 assert.equal(canResetPassword(local,{...target,memberships:[{worksite_id:"B",is_worksite_admin:false}]},"A"),false);
 assert.equal(canResetPassword(local,{...target,memberships:[...target.memberships,{worksite_id:"B",is_worksite_admin:false}]},"A"),false);
});
test("local admin cannot take over global admin",()=>assert.equal(canResetPassword(local,{...target,roles:["admin"]},"A"),false));
test("global admin can reset across worksites",()=>assert.equal(canResetPassword({...local,email:"julio.pessoa@normatel.com.br"},{...target,memberships:[]},"A"),true));
test("self reset and blocked/pending profiles denied",()=>{
 assert.equal(canResetPassword(local,{...target,id:local.id},"A"),false);
 assert.equal(canResetPassword(local,{...target,approval_status:"blocked"},"A"),false);
 assert.equal(canResetPassword({...local,approval_status:"pending"},target,"A"),false);
});
test("personal password must have at least 8 characters",()=>{
 assert.equal(newPasswordSchema.safeParse("123456").success,false);
 assert.equal(newPasswordSchema.safeParse("chosen-personal-password").success,true);
 assert.equal(newPasswordSchema.safeParse("x".repeat(73)).success,false);
});
