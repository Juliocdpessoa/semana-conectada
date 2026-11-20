import { test, expect } from 'bun:test';
import { assembleDirectory, canReadDirectory } from '../src/lib/admin-directory-policy';
test('requires approval even for administrative identities',()=>{
 expect(canReadDirectory(false,true,['admin'],true)).toBe(false);
 expect(canReadDirectory(true,false,[],false)).toBe(false);
 expect(canReadDirectory(true,false,['operation'],false)).toBe(false);
 expect(canReadDirectory(true,false,['admin'],false)).toBe(true);
 expect(canReadDirectory(true,false,[],true)).toBe(true);
 expect(canReadDirectory(true,true,[],false)).toBe(true);
});
const profiles=['a','b','c'].map(id=>({id,email:`${id}@example.invalid`,full_name:id,approval_status:'approved'}));
const memberships=[{user_id:'a',worksite_id:'one',is_worksite_admin:false},{user_id:'a',worksite_id:'two',is_worksite_admin:true},{user_id:'b',worksite_id:'two',is_worksite_admin:false}];
const roles=[{user_id:'a',role:'planning'},{user_id:'b',role:'operation'}];
test('local directory includes only the selected site and hides other memberships',()=>{
 const rows=assembleDirectory(profiles,roles,memberships,[],false,'one');
 expect(rows.map(row=>row.id)).toEqual(['a']);
 expect(rows[0].memberships).toEqual([memberships[0]]);
 expect(rows[0].roles).toEqual(['planning']);
});
test('global directory preserves all authorized profiles including pending memberships',()=>{
 const rows=assembleDirectory(profiles,roles,memberships,[],true,'one');
 expect(rows.map(row=>row.id)).toEqual(['a','b','c']);
 expect(rows[0].memberships.length).toBe(2);
 expect(rows[2].roles).toEqual([]);
});
test('no membership never becomes a local directory and no extra profile fields leak',()=>{
 expect(assembleDirectory(profiles,roles,[],[],false,'one')).toEqual([]);
 const rows=assembleDirectory([{...profiles[0],unexpected:'not returned'} as any],[],[],[],true,'one');
 expect('unexpected' in rows[0]).toBe(false);
});
