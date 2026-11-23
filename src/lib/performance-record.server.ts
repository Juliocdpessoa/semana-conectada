import {isPublicClientKey} from './access-relay';
import type {PerformanceSampleInput} from './performance-http';
export async function storePerformanceSample(data:PerformanceSampleInput,bearer:string|null,signal:AbortSignal,fetchImpl:typeof fetch=fetch){
 try{
  const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_PUBLISHABLE_KEY;
  if(!url||!isPublicClientKey(key)||!bearer?.startsWith('Bearer '))return {accepted:false};
  const target=new URL('/rest/v1/rpc/record_app_performance',url);
  if(target.protocol!=='https:'&&!['localhost','127.0.0.1','[::1]'].includes(target.hostname))return {accepted:false};
  // PostgREST verifies the JWT. This existing fixed RPC derives actor/site from
  // auth.uid() and enforces approval, password state, worksite and rate caps.
  const result=await fetchImpl(target,{method:'POST',headers:{apikey:key,authorization:bearer,'content-type':'application/json'},
   body:JSON.stringify({p_operation:data.operation,p_duration_ms:data.durationMs,p_success:data.success}),
   cache:'no-store',redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(2500)])});
  if(!result.ok){void result.body?.cancel().catch(()=>{});return {accepted:false};}
  return {accepted:await result.json()===true};
 }catch{return {accepted:false};}
}
