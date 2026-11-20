import {createServerFn} from "@tanstack/react-start";
import {getRequest} from "@tanstack/react-start/server";
import {z} from "zod";
import {REALTIME_REASONS} from './realtime-diagnostics';
const schema=z.object({
 id:z.string().uuid(),clientId:z.string().uuid(),
 stage:z.enum(["session","identity","password","profile","roles","worksite","membership","runtime","realtime"]),
 reason:z.enum(REALTIME_REASONS).optional(),
 category:z.enum(["network","timeout","auth","server","missing","runtime"]),
 route:z.enum(["login","password","home","activities","other"]),
 build:z.enum(["access-diag-20261119-v1","access-diag-20261120-v2"]),attempts:z.number().int().min(1).max(2),
 elapsedMs:z.number().int().min(0).max(60000),
 frames:z.array(z.string().max(150).regex(/^\/assets\/[a-zA-Z0-9_.-]+\.js:\d+:\d+$/)).max(4)
}).strict();
export const recordAccessDiagnostic=createServerFn({method:"POST"})
 .validator((data:unknown)=>schema.parse(data))
 .handler(async({data})=>{
  try{
   const {supabaseAdmin}=await import("@/integrations/supabase/client.server");
   let actorId:string|null=null;
   // Identity is optional before login, and never accepted from the client payload.
   const bearer=getRequest()?.headers.get("authorization");
   if(bearer?.startsWith("Bearer ")){
    let timer:ReturnType<typeof setTimeout>|undefined;
    try{
     const user=await Promise.race([supabaseAdmin.auth.getUser(bearer.slice(7)),new Promise<null>(resolve=>{timer=setTimeout(()=>resolve(null),2000);})]);
     if(user&&!user.error)actorId=user.data.user?.id??null;
    }finally{if(timer)clearTimeout(timer);}
   }
   const {data:accepted,error}=await (supabaseAdmin as any).rpc(data.stage==='realtime'?'record_app_realtime_diagnostic':"record_app_access_diagnostic",{
    p_id:data.id,p_client_id:data.clientId,p_stage:data.stage,p_category:data.category,p_route:data.route,
    p_build:data.build,p_attempts:data.attempts,p_elapsed_ms:data.elapsedMs,p_frames:data.frames,p_actor:actorId,
    ...(data.stage==='realtime'?{p_reason:data.reason??'unknown'}:{})
   });
   return {accepted:!error&&accepted===true};
  }catch{return {accepted:false};}
 });
