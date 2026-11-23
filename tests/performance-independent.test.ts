import {test,expect} from 'bun:test';
import {performanceHttp,performanceSampleSchema} from '../src/lib/performance-http';
import {sendPerformanceSample} from '../src/lib/performance-send';
import {storePerformanceSample} from '../src/lib/performance-record.server';
import {setAccessDiagnosticIdentity,currentTelemetryToken} from '../src/lib/access-diagnostics-client';
const event={operation:'activities_filter' as const,durationMs:350,success:true};
const req=(body:unknown,extra:Record<string,string>={})=>new Request('https://nexo.invalid/api/public/nexo-performance',{method:'POST',headers:{origin:'https://nexo.invalid','content-type':'application/json',authorization:'Bearer synthetic.jwt.signature',...extra},body:JSON.stringify(body)});
test('unauthenticated telemetry is rejected before storage; caller identity is never a body parameter',async()=>{
 let calls=0;const store=async()=>{calls++;return {accepted:true};};
 const missing=req(event);missing.headers.delete('authorization');expect((await performanceHttp(missing,store)).status).toBe(401);
 for(const extra of [{actorId:'someone'},{worksiteId:'another'},{rpc:'write_anything'},{url:'https://evil.invalid'}])expect((await performanceHttp(req({...event,...extra}),store)).status).toBe(400);
 expect(calls).toBe(0);
});
test('telemetry accepts only existing bounded operations, durations and boolean result',async()=>{
 let calls=0;const r=await performanceHttp(req(event),async(data,bearer)=>{calls++;expect(data).toEqual(event);expect(bearer).toBe('Bearer synthetic.jwt.signature');return {accepted:true};});
 expect(r.status).toBe(200);expect(r.headers.get('cache-control')).toBe('no-store');expect(calls).toBe(1);
 for(const data of [{...event,operation:'import_sap'},{...event,durationMs:-1},{...event,durationMs:86400001},{...event,success:'true'}])expect(performanceSampleSchema.safeParse(data).success).toBe(false);
 expect((await performanceHttp(req(event,{origin:'https://evil.invalid'}),async()=>({accepted:true}))).status).toBe(403);
});
test('new transport sends one fixed request without session lookup or credentials; logout skips sending',async()=>{
 let calls=0;const f=(async(url:any,init:any)=>{calls++;expect(url).toBe('/api/public/nexo-performance');expect(init.credentials).toBe('omit');expect(init.referrerPolicy).toBe('no-referrer');expect(init.headers.authorization).toBe('Bearer memory-token');expect(JSON.parse(init.body)).toEqual(event);return new Response('{"accepted":true}');}) as typeof fetch;
 setAccessDiagnosticIdentity('memory-token');expect((await sendPerformanceSample(event,currentTelemetryToken(),new AbortController().signal,f)).accepted).toBe(true);
 setAccessDiagnosticIdentity(undefined);expect((await sendPerformanceSample(event,currentTelemetryToken(),new AbortController().signal,f)).accepted).toBe(false);expect(calls).toBe(1);
});
test('server uses only the fixed caller-JWT RPC and public key; database rejections stay rejected',async()=>{
 const oldUrl=process.env.SUPABASE_URL,oldKey=process.env.SUPABASE_PUBLISHABLE_KEY;let calls=0;
 try{
  process.env.SUPABASE_URL='https://backend.invalid';process.env.SUPABASE_PUBLISHABLE_KEY='sb_publishable_test';
  const f=(async(url:any,init:any)=>{calls++;expect(String(url)).toBe('https://backend.invalid/rest/v1/rpc/record_app_performance');expect(init.headers.authorization).toBe('Bearer synthetic.jwt.signature');expect(init.headers.apikey).toBe('sb_publishable_test');expect(JSON.parse(init.body)).toEqual({p_operation:'activities_filter',p_duration_ms:350,p_success:true});return new Response(calls===1?'true':'false');}) as typeof fetch;
  expect((await storePerformanceSample(event,'Bearer synthetic.jwt.signature',new AbortController().signal,f)).accepted).toBe(true);
  expect((await storePerformanceSample(event,'Bearer synthetic.jwt.signature',new AbortController().signal,f)).accepted).toBe(false);
  process.env.SUPABASE_PUBLISHABLE_KEY='sb_secret_forbidden';expect((await storePerformanceSample(event,'Bearer synthetic.jwt.signature',new AbortController().signal,f)).accepted).toBe(false);expect(calls).toBe(2);
 }finally{if(oldUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=oldUrl;if(oldKey===undefined)delete process.env.SUPABASE_PUBLISHABLE_KEY;else process.env.SUPABASE_PUBLISHABLE_KEY=oldKey;}
});
test('rejected/failed sends are not retried and never refresh the session',async()=>{
 let calls=0;const f=(async()=>{calls++;throw new TypeError('network');}) as typeof fetch;
 await expect(sendPerformanceSample(event,'memory-token',new AbortController().signal,f)).rejects.toThrow();expect(calls).toBe(1);
 const {readFileSync}=await import('node:fs');const source=readFileSync(new URL('../src/lib/performance-send.ts',import.meta.url),'utf8');expect(source).not.toMatch(/getSession|refreshSession|localStorage|sessionStorage/);
});
