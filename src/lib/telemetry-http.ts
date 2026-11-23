// Internal parser for fixed telemetry endpoints, not an arbitrary RPC/URL relay.
export async function telemetryPost<T>(request:Request,options:{maxBytes:number;requireBearer?:boolean;schema:{safeParse(value:unknown):{success:true;data:T}|{success:false}}},store:(data:T,bearer:string|null,signal:AbortSignal)=>Promise<{accepted:boolean}>){
 const headers={'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'};
 const reply=(status:number,accepted=false)=>new Response(JSON.stringify({accepted}),{status,headers});
 if(request.method!=='POST')return reply(405);
 if(request.headers.get('origin')&&request.headers.get('origin')!==new URL(request.url).origin)return reply(403);
 const bearer=request.headers.get('authorization');
 if(options.requireBearer&&(!bearer?.startsWith('Bearer ')||bearer.length>16400||bearer.slice(7).split('.').length!==3))return reply(401);
 if(!/^application\/json(?:;|$)/i.test(request.headers.get('content-type')??''))return reply(415);
 if(Number(request.headers.get('content-length')??0)>options.maxBytes)return reply(413);
 const reader=request.body?.getReader();if(!reader)return reply(400);
 const signal=AbortSignal.any([request.signal,AbortSignal.timeout(2000)]);
 const cancelled=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',cancelled,{once:true});
 try{
  if(signal.aborted){cancelled();return reply(408);}
  let size=0;const chunks:Uint8Array[]=[];
  for(;;){const r=await reader.read();if(signal.aborted)return reply(408);if(r.done)break;size+=r.value.byteLength;if(size>options.maxBytes){void reader.cancel().catch(()=>{});return reply(413);}chunks.push(r.value);}
  const body=new Uint8Array(size);let offset=0;for(const c of chunks){body.set(c,offset);offset+=c.length;}
  const parsed=options.schema.safeParse(JSON.parse(new TextDecoder().decode(body)));
  if(!parsed.success)return reply(400);
  const result=await store(parsed.data,bearer,request.signal);
  return reply(result.accepted?200:503,result.accepted);
 }catch{return reply(400);}finally{signal.removeEventListener('abort',cancelled);}
}
