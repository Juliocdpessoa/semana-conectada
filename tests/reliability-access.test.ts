import {test,expect} from 'bun:test';
import {createIdentityFetch} from '../src/lib/identity-fetch';
import {assertPasswordGate} from '../src/lib/password-gate-policy';
import {diagnosticHttp} from '../src/lib/diagnostic-http';
import {sendDiagnostic} from '../src/lib/diagnostic-send';
import {accessDiagnosticSchema} from '../src/lib/access-diagnostic-schema';
const event=()=>({id:crypto.randomUUID(),clientId:crypto.randomUUID(),stage:'session',category:'timeout',route:'activities',build:'access-diag-20261120-v2',attempts:1,elapsedMs:8000,frames:[],occurredAt:new Date().toISOString(),release:'a'.repeat(40),visibility:'visible',online:true});
test('network errors never authorize or instruct password reset',()=>{
 expect(()=>assertPasswordGate(null,{message:'offline'})).toThrow('não é necessário resetar');
 expect(()=>assertPasswordGate({allowed:true},{status:503})).toThrow();
 expect(()=>assertPasswordGate({required:true,allowed:false},null)).toThrow('precisa ser redefinida');
 expect(()=>assertPasswordGate({allowed:false},null)).toThrow();
 expect(()=>assertPasswordGate({},null)).toThrow();
 expect(()=>assertPasswordGate({allowed:true,required:false},null)).not.toThrow();
});
test('identity transport aborts a hung auth request without retry or service credentials',async()=>{
 let calls=0;
 const base=(async(_u:any,i:any)=>{calls++;expect(i.headers.get('apikey')).toBe('sb_publishable_public');expect(i.headers.get('authorization')).toBe('Bearer caller');
  return new Promise((_r,reject)=>i.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true}));}) as typeof fetch;
 const f=createIdentityFetch(base,'sb_publishable_public',undefined,15);
 await expect(f('https://backend.invalid/auth/v1/user',{headers:{authorization:'Bearer caller'}})).rejects.toThrow();expect(calls).toBe(1);
});
test('request and handler cancellations reach caller-scoped reads',async()=>{
 const request=new AbortController(),handler=new AbortController();
 let signal:AbortSignal;
 const f=createIdentityFetch((async(_u:any,i:any)=>{signal=i.signal;return new Response('{}');}) as typeof fetch,'public-key',request.signal);
 await f('https://backend.invalid/rest/v1/profiles',{signal:handler.signal});handler.abort();expect(signal!.aborted).toBe(true);
 const f2=createIdentityFetch((async(_u:any,i:any)=>{signal=i.signal;return new Response('{}');}) as typeof fetch,'public-key',request.signal);
 await f2('https://backend.invalid/rest/v1/profiles');request.abort();expect(signal!.aborted).toBe(true);
});
test('independent diagnostic send uses one fixed HTTP call, no credentials/session lookup',async()=>{
 let calls=0;
 const result=await sendDiagnostic(event(),undefined,new AbortController().signal,(async(u:any,i:any)=>{
  calls++;expect(u).toBe('/api/public/nexo-diagnostics');expect(i.credentials).toBe('omit');expect(i.headers.has('authorization')).toBe(false);return new Response('{"accepted":true}');
 }) as typeof fetch);
 expect(result.accepted).toBe(true);expect(calls).toBe(1);
});
test('collector accepts safe metadata before login, no actor supplied by client',async()=>{
 const data=event();let calls=0;
 const req=new Request('https://nexo.invalid/api/public/nexo-diagnostics',{method:'POST',headers:{origin:'https://nexo.invalid','content-type':'application/json'},body:JSON.stringify(data)});
 const res=await diagnosticHttp(req,async(e,b)=>{calls++;expect(e.occurredAt).toBe(data.occurredAt);expect(b).toBeNull();return {accepted:true};});
 expect(res.status).toBe(200);expect(res.headers.get('cache-control')).toBe('no-store');expect(calls).toBe(1);
 expect(accessDiagnosticSchema.safeParse({...data,actorId:crypto.randomUUID()}).success).toBe(false);
 expect(accessDiagnosticSchema.safeParse({...data,token:'SECRET'}).success).toBe(false);
 expect(accessDiagnosticSchema.safeParse({...data,release:'SECRET URL'}).success).toBe(false);
});
test('collector rejects cross-origin, oversized, invalid requests without recording',async()=>{
 let calls=0;const store=async()=>{calls++;return {accepted:true};};
 for(const [headers,body,status] of [
  [{'content-type':'application/json',origin:'https://evil.invalid'},JSON.stringify(event()),403],
  [{'content-type':'text/plain'},'{}',415],
  [{'content-type':'application/json'},'x'.repeat(9000),413],
  [{'content-type':'application/json'},'{bad',400],
 ] as const){const r=await diagnosticHttp(new Request('https://nexo.invalid/api/public/nexo-diagnostics',{method:'POST',headers,body}),store);expect(r.status).toBe(status);}
 expect(calls).toBe(0);
});
test('collector cancels a stalled body; aborted requests never record a row',async()=>{
 const controller=new AbortController();let cancelled=false,calls=0;
 const body=new ReadableStream({cancel(){cancelled=true;}});
 const req=new Request('https://nexo.invalid/api/public/nexo-diagnostics',{method:'POST',headers:{'content-type':'application/json'},body,signal:controller.signal,duplex:'half'} as any);
 setTimeout(()=>controller.abort(),10);
 const r=await diagnosticHttp(req,async()=>{calls++;return {accepted:true};});
 expect(r.status).toBe(408);expect(cancelled).toBe(true);expect(calls).toBe(0);
});
test('new collector and gate do not rewrite generated auth or create an open proxy',async()=>{
 const {readFileSync}=await import('node:fs');
 const middleware=readFileSync(new URL('../src/lib/identity-auth.ts',import.meta.url),'utf8');
 expect(middleware).toContain('getClaims(token)');expect(middleware).toContain('isPublicClientKey(key)');expect(middleware).not.toContain('SERVICE_ROLE');
 const collector=readFileSync(new URL('../src/lib/access-diagnostic-record.server.ts',import.meta.url),'utf8');
 expect(collector).toContain('getUser(bearer.slice(7))');expect(collector).toContain('p_actor:actorId');expect(collector).not.toContain('data.actorId');
 const browser=readFileSync(new URL('../src/lib/diagnostic-send.ts',import.meta.url),'utf8');
 expect(browser).not.toContain('supabase.auth');expect(browser).not.toContain('SERVICE_ROLE');
});
