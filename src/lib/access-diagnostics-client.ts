import {recordAccessDiagnostic} from "./access-diagnostics.functions";
import {AccessLoadError,diagnosticCategory,diagnosticFrames,diagnosticRoute,DIAGNOSTIC_BUILD,safeQueuedDiagnostic} from "./access-diagnostics";
import type { AccessStage } from './access-diagnostics';
import type { RealtimeReason } from './realtime-diagnostics';
type Item={id:string;clientId:string;stage:AccessStage;reason?:RealtimeReason;category:"network"|"timeout"|"auth"|"server"|"missing"|"runtime";route:"login"|"password"|"home"|"activities"|"other";build:typeof DIAGNOSTIC_BUILD|'access-diag-20261119-v1';attempts:number;elapsedMs:number;frames:string[];queuedAt:number};
let identityToken:string|undefined;
export function setAccessDiagnosticIdentity(token:string|undefined){identityToken=token;}
const ids=new WeakMap<object,string>();const memory=new Map<string,Item>();const reportAuth=new Map<string,string>();
const storageKey="nexo:access-diagnostics:v1";let running=false;let clientId:string|undefined;let lastFlush=0;let retriesRemaining=2;let retryTimer:ReturnType<typeof setTimeout>|undefined;
function scheduleRetry(){if(memory.size&&retriesRemaining>0&&!retryTimer){retriesRemaining--;retryTimer=setTimeout(()=>{retryTimer=undefined;void flushCentralDiagnostics();},Math.max(1000,10000-(Date.now()-lastFlush)));}}
function browserId(){
 if(clientId)return clientId;
 try{const old=sessionStorage.getItem(storageKey+":client");if(old&&/^[0-9a-f-]{36}$/.test(old))return clientId=old;
 clientId=crypto.randomUUID();sessionStorage.setItem(storageKey+":client",clientId);return clientId;}catch{return clientId=crypto.randomUUID();}
}
function persist(){try{sessionStorage.setItem(storageKey,JSON.stringify([...memory.values()].slice(-5)));}catch{}}
export function reportCentralDiagnostic(error:unknown,path:string){
 if(typeof window==="undefined")return null;
 let id=error instanceof AccessLoadError?error.reportId:typeof error==="object"&&error?ids.get(error):undefined;
 if(!id){id=crypto.randomUUID();if(typeof error==="object"&&error)ids.set(error,id);}
 if(memory.has(id))return id;
 if(identityToken)reportAuth.set(id,identityToken);
 const access=error instanceof AccessLoadError?error:null;
 memory.set(id,{id,clientId:browserId(),stage:access?.stage??"runtime",category:access?.category??diagnosticCategory(error),
 route:diagnosticRoute(path),build:DIAGNOSTIC_BUILD,attempts:Math.min(2,Math.max(1,access?.attempts??1)),
 elapsedMs:Math.min(60000,Math.max(0,Math.round(access?.elapsedMs??0))),frames:diagnosticFrames(error),queuedAt:Date.now(),...(access?.reason?{reason:access.reason}:{})});
 while(memory.size>5){const oldest=memory.keys().next().value!;memory.delete(oldest);reportAuth.delete(oldest);}
 persist();retriesRemaining=2;void flushCentralDiagnostics();return id;
}
export async function flushCentralDiagnostics(){
 if(typeof window==="undefined"||running||!memory.size)return;
 if(Date.now()-lastFlush<10000){scheduleRetry();return;}
 running=true;lastFlush=Date.now();
 try{
  for(const [id,item] of [...memory]){
   if(Date.now()-item.queuedAt>86400000){memory.delete(id);reportAuth.delete(id);continue;}
   const data={id:item.id,clientId:item.clientId,stage:item.stage,category:item.category,route:item.route,build:item.build,attempts:item.attempts,elapsedMs:item.elapsedMs,frames:item.frames,...(item.reason?{reason:item.reason}:{})};let timer:ReturnType<typeof setTimeout>|undefined;
   try{
    const result=await Promise.race([recordAccessDiagnostic({data,headers:reportAuth.has(id)?{Authorization:"Bearer "+reportAuth.get(id)}:undefined}),new Promise<null>(resolve=>{timer=setTimeout(()=>resolve(null),6000);})]);
    if(result?.accepted){memory.delete(id);reportAuth.delete(id);}else break;
   }catch{break;}finally{if(timer)clearTimeout(timer);}
  }
 }finally{persist();running=false;scheduleRetry();}
}
export function startCentralDiagnostics(){
 try{const queued=JSON.parse(sessionStorage.getItem(storageKey)??"[]");if(Array.isArray(queued))for(const item of queued.slice(-5))
 if(safeQueuedDiagnostic(item)&&Date.now()-item.queuedAt<86400000)memory.set(item.id,item);}catch{}
 void flushCentralDiagnostics();
 const online=()=>void flushCentralDiagnostics();window.addEventListener("online",online);
 return ()=>window.removeEventListener("online",online);
}
