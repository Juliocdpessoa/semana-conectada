/** Only for allowlisted reads. Cancels headers/body, never retries a request. */
export async function fetchReadWithDeadline(
 base:typeof fetch,input:RequestInfo|URL,init:RequestInit|undefined,
 timeoutMs:number,maxBytes:number,
):Promise<Response>{
 const controller=new AbortController();
 const caller=init?.signal;
 const forward=()=>controller.abort(caller?.reason);
 if(caller?.aborted)forward();else caller?.addEventListener('abort',forward,{once:true});
 const timer=setTimeout(()=>controller.abort(new DOMException('Read deadline exceeded','TimeoutError')),timeoutMs);
 let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
 let onAbort:()=>void=()=>{};
 const aborted=new Promise<never>((_,reject)=>{
  onAbort=()=>{reject(controller.signal.reason);void reader?.cancel().catch(()=>{});};
  controller.signal.addEventListener('abort',onAbort,{once:true});
 });
 try{
  controller.signal.throwIfAborted();
  const response=await Promise.race([base(input,{...init,signal:controller.signal}),aborted]);
  if(!response.body)return response;
  reader=response.body.getReader();
  const chunks:Uint8Array[]=[];let size=0;
  for(;;){
   const part=await Promise.race([reader.read(),aborted]);
   controller.signal.throwIfAborted();
   if(part.done)break;
   size+=part.value.byteLength;
   if(size>maxBytes){controller.abort(new DOMException('Read response exceeds limit','QuotaExceededError'));throw controller.signal.reason;}
   chunks.push(part.value);
  }
  const bytes=new Uint8Array(size);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  // Preserve status and auth/error headers. The body is the already-decoded
  // fetch body, so wire-encoding and wire-length headers no longer apply.
  const headers=new Headers(response.headers);headers.delete('content-encoding');headers.delete('content-length');
  return new Response(bytes,{status:response.status,statusText:response.statusText,headers});
 }finally{
  clearTimeout(timer);caller?.removeEventListener('abort',forward);
  controller.signal.removeEventListener('abort',onAbort);
 }
}
