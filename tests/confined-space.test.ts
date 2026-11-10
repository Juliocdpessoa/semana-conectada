import assert from "node:assert/strict";
import { test } from "node:test";
import { hasConfinedSpacePbs, readConfinedSpaceFilter } from "../src/lib/confined-space.ts";
test("PBS 16 including existing list formats",()=>{for(const v of ["16","13,16,20,22","13-16","13.16","16(3","13,30,16(3"," 16 "]) assert.equal(hasConfinedSpacePbs(v),true,v);});
test("numeric substrings and empty PBS do not match",()=>{for(const v of [null,undefined,"","116","160","13,116,22","2163"]) assert.equal(hasConfinedSpacePbs(v),false,String(v));});
test("stored filters are backwards compatible",()=>{assert.equal(readConfinedSpaceFilter(undefined),"all"); assert.equal(readConfinedSpaceFilter("invalid"),"all");assert.equal(readConfinedSpaceFilter("yes"),"yes");assert.equal(readConfinedSpaceFilter("no"),"no");});
