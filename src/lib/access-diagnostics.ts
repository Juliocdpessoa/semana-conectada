export const ACCESS_STAGES=["session","identity","password","profile","roles","worksite","membership","runtime"] as const;
export type AccessStage=typeof ACCESS_STAGES[number];
export type DiagnosticCategory="network"|"timeout"|"auth"|"server"|"missing"|"runtime";
export const DIAGNOSTIC_BUILD="access-diag-20261119-v1";
export function diagnosticCategory(error:unknown):DiagnosticCategory{
 const e=error as {name?:string;message?:string;status?:number;code?:string}|null;
 if(e?.name==="AccessTimeout")return "timeout";
 if(e?.status===401||e?.status===403||["invalid_credentials","refresh_token_not_found","refresh_token_already_used","bad_jwt","session_not_found"].includes(e?.code??""))return "auth";
 if((e?.status??0)>=500)return "server";
 if(e?.status===0||/failed to fetch|networkerror|load failed|network request failed|fetch failed/i.test(e?.message??""))return "network";
 return "runtime";
}
export class AccessLoadError extends Error{
 readonly reportId=crypto.randomUUID();
 readonly stage:AccessStage; readonly category:DiagnosticCategory; readonly attempts:number; readonly elapsedMs:number;
 constructor(stage:AccessStage,category:DiagnosticCategory,attempts:number,elapsedMs:number){
 super("Não foi possível concluir a verificação de acesso.");this.name="AccessLoadError";
 this.stage=stage;this.category=category;this.attempts=attempts;this.elapsedMs=elapsedMs;
 }
}
export async function accessStep<T extends {error?:unknown}>(stage:AccessStage,fn:(signal:AbortSignal)=>PromiseLike<T>,deadline:number,timeoutMs=8000):Promise<T>{
 const start=Date.now();let attempts=0;
 for(let i=0;i<2;i++){
  attempts++;
  const left=Math.min(timeoutMs,deadline-Date.now());
  if(left<=0)throw new AccessLoadError(stage,"timeout",attempts,Date.now()-start);
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  try{
   const result=await Promise.race([Promise.resolve().then(()=>fn(controller.signal)),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject({name:"AccessTimeout"});},left);})]);
   if(!result.error)return result;
   throw result.error;
  }catch(error){
   const category=diagnosticCategory(error);
   if(i===0&&(category==="network"||category==="server")&&deadline-Date.now()>700){
    await new Promise(resolve=>setTimeout(resolve,400));continue;
   }
   throw new AccessLoadError(stage,category,attempts,Date.now()-start);
  }finally{if(timer)clearTimeout(timer);}
 }
 throw new AccessLoadError(stage,"runtime",attempts,Date.now()-start);
}
export function diagnosticRoute(path:string){return path==="/auth"?"login":path==="/redefinir-senha"?"password":path==="/"?"home":path.startsWith("/atividades")?"activities":"other";}
export function diagnosticFrames(error:unknown):string[]{
 const stack=error instanceof Error?(error.stack??"").split("\n").slice(1).join("\n"):"";
 return [...new Set(stack.match(/\/assets\/[a-zA-Z0-9_.-]+\.js:\d+:\d+/g)??[])].slice(0,4);
}
export function accessErrorMessage(error:unknown){
 if(!(error instanceof AccessLoadError))return "O NEXO não conseguiu carregar esta tela. Tente novamente; seus dados salvos não foram apagados.";
 if(error.category==="network")return "Não foi possível estabelecer comunicação com o servidor. Tente novamente. Sua sessão não foi apagada.";
 if(error.category==="timeout")return "A comunicação com o servidor não foi concluída a tempo. Tente novamente. Sua sessão não foi apagada.";
 if(error.category==="auth")return "Não foi possível validar o acesso. Tente novamente ou abra a tela de entrada.";
 return "Não foi possível concluir a verificação de acesso. Tente novamente; seus dados salvos não foram apagados.";
}

export function safeQueuedDiagnostic(value:unknown):boolean{
 if(!value||typeof value!=="object")return false;
 const v=value as Record<string,unknown>;const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
 return typeof v.id==="string"&&uuid.test(v.id)&&typeof v.clientId==="string"&&uuid.test(v.clientId)
 &&ACCESS_STAGES.includes(v.stage as AccessStage)&&["network","timeout","auth","server","missing","runtime"].includes(v.category as string)
 &&["login","password","home","activities","other"].includes(v.route as string)&&v.build===DIAGNOSTIC_BUILD
 &&Number.isInteger(v.attempts)&&Number(v.attempts)>=1&&Number(v.attempts)<=2
 &&Number.isInteger(v.elapsedMs)&&Number(v.elapsedMs)>=0&&Number(v.elapsedMs)<=60000
 &&typeof v.queuedAt==="number"&&Number.isFinite(v.queuedAt)
 &&Array.isArray(v.frames)&&v.frames.length<=4&&v.frames.every(f=>typeof f==="string"&&f.length<=150&&/^\/assets\/[a-zA-Z0-9_.-]+\.js:\d+:\d+$/.test(f));
}
