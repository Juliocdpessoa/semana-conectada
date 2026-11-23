import type {AccessDiagnosticInput} from './access-diagnostic-schema';
import {createClient} from '@supabase/supabase-js';
import {createIdentityFetch} from './identity-fetch';
import {isPublicClientKey} from './access-relay';
export async function storeAccessDiagnostic(data:AccessDiagnosticInput,bearer:string|null,signal?:AbortSignal){
 try{
  const {supabaseAdmin}=await import('@/integrations/supabase/client.server');
  let actorId:string|null=null;
  const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_PUBLISHABLE_KEY;
  if(url&&isPublicClientKey(key)&&bearer?.startsWith('Bearer ')&&bearer.length<=16400){
   try{
    const caller=createClient(url,key,{global:{fetch:createIdentityFetch(fetch,key,signal,1500)},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
    const verified=await caller.auth.getUser(bearer.slice(7));
    if(!verified.error)actorId=verified.data.user?.id??null;
   }catch{/* Identity is optional; never accept an actor ID declared by a client. */}
  }
  const db=supabaseAdmin as any;
  const {data:accepted,error}=await db.rpc(data.stage==='realtime'?'record_app_realtime_diagnostic':'record_app_access_diagnostic',{
   p_id:data.id,p_client_id:data.clientId,p_stage:data.stage,p_category:data.category,p_route:data.route,p_build:data.build,
   p_attempts:data.attempts,p_elapsed_ms:data.elapsedMs,p_frames:data.frames,p_actor:actorId,...(data.stage==='realtime'?{p_reason:data.reason??'unknown'}:{}),
  }).abortSignal(AbortSignal.any([AbortSignal.timeout(2500),...(signal?[signal]:[])]));
  if(error||accepted!==true)return {accepted:false};
  // Client clock/release are untrusted metadata, not identity or receipt time.
  const occurred=data.occurredAt?Date.parse(data.occurredAt):NaN,now=Date.now();
  if(data.occurredAt||data.release)await db.from('app_access_diagnostics').update({
   client_occurred_at:Number.isFinite(occurred)&&occurred>=now-2*86400000&&occurred<=now+300000?new Date(occurred).toISOString():null,
   app_release:data.release??null,tab_visibility:data.visibility??null,client_online:data.online??null,
   realtime_close_code:data.stage==='realtime'?data.closeCode??null:null,
  }).eq('id',data.id).eq('client_id',data.clientId).is('app_release',null).abortSignal(AbortSignal.timeout(1000));
  return {accepted:true};
 }catch{return {accepted:false};}
}
