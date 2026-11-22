import {test,expect} from 'bun:test';
const {createClient}=await import(process.env.NEXO_TEST_LOCKED_SDK==='1'?'../.audit-tmp/realtime-runtime/node_modules/@supabase/supabase-js/dist/index.mjs':'@supabase/supabase-js');
test('production SDK forwards refreshed session tokens to realtime without an extra app refresh',async()=>{
 const client=createClient('https://example.invalid','sb_publishable_synthetic',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}}) as any;
 const calls:unknown[]=[];client.realtime.setAuth=async(token?:string)=>{calls.push(token);};
 // Internal SDK event bridge only: synthetic values, no sign-in or network.
 client._handleTokenChanged('TOKEN_REFRESHED','CLIENT','synthetic-one');
 client._handleTokenChanged('TOKEN_REFRESHED','CLIENT','synthetic-one');
 client._handleTokenChanged('TOKEN_REFRESHED','CLIENT','synthetic-two');
 expect(calls).toEqual(['synthetic-one','synthetic-two']);
 client._handleTokenChanged('SIGNED_OUT','CLIENT');expect(calls[2]).toBeUndefined();
 client.realtime.disconnect();
});
