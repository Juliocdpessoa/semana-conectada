type Options = {
 refresh:()=>Promise<unknown>; hasChanges?:()=>Promise<boolean>; canRefresh:()=>boolean;
 onFallback?:(active:boolean)=>void;
 setTimer?:(callback:()=>void,delay:number)=>ReturnType<typeof setTimeout>;
 clearTimer?:(timer:ReturnType<typeof setTimeout>)=>void; random?:()=>number; now?:()=>number;
};
/** Only probes a failed/unfinished channel. Full reads happen on change or
 * periodic reconciliation; SDK reconnect/auth remain the source of channel state. */
export function createRealtimeFallback(options:Options){
 const setTimer=options.setTimer??setTimeout,clearTimer=options.clearTimer??clearTimeout;
 const now=options.now??Date.now,jitter=(n:number)=>Math.floor((options.random??Math.random)()*n);
 let timer:ReturnType<typeof setTimeout>|undefined,healthy=false,disposed=false,running=false,disconnected=false;
 let lastStarted:number|undefined,lastFull:number|undefined,failures=0,pendingForce=false;
 const cancel=()=>{if(timer!==undefined)clearTimer(timer);timer=undefined;};
 function schedule(delay?:number){
  if(disposed||healthy||timer!==undefined||running)return;
  const regular=failures?Math.min(60000,15000*2**Math.min(failures-1,2))+jitter(5000):(options.hasChanges?10000+jitter(5000):20000+jitter(10000));
  timer=setTimer(()=>{timer=undefined;void run(false);},delay??regular);
 }
 async function run(force:boolean){
  if(disposed)return;
  if(running){if(force)pendingForce=true;return;}
  if(!options.canRefresh()){schedule(60000);return;}
  running=true;lastStarted=now();if(!healthy)options.onFallback?.(true);
  try{
   const changed=options.hasChanges?await options.hasChanges():true;
   if(disposed||!options.canRefresh())return;
   // Even when many tasks change, bound heavy fallback reads per visible tab.
   if(force||lastFull===undefined||(changed&&now()-lastFull>=20000)||now()-lastFull>=60000){await options.refresh();lastFull=now();}
   failures=0;
  }catch{failures++;}finally{
   running=false;
   if(pendingForce&&!disposed){pendingForce=false;void run(true);}else schedule();
  }
 }
 schedule(5000+jitter(3000));
 return {
  status(status:string){
   if(disposed)return;
   if(status==='SUBSCRIBED'){
    healthy=true;cancel();options.onFallback?.(false);
    if(disconnected){disconnected=false;void run(true);}
   }else if(['CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(status)){
    healthy=false;disconnected=true;options.onFallback?.(true);schedule(5000+jitter(3000));
   }
  },
  resume(){
   if(disposed||running||!options.canRefresh())return;
   if(lastStarted!==undefined&&now()-lastStarted<15000)return;
   cancel();void run(true);
  },
  dispose(){disposed=true;pendingForce=false;cancel();},
 };
}
