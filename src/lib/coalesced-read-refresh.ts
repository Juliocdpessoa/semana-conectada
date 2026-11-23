type Options={
 read:()=>Promise<unknown>;
 hasPending:()=>boolean;
 canRead:()=>boolean;
 setTimer?:typeof setTimeout;
 clearTimer?:typeof clearTimeout;
};
/** Join old reads, then catch up. Coalesce events, never cancel/replay writes. */
export function createCoalescedReadRefresh(options:Options){
 let disposed=false,dirty=false,running:Promise<void>|undefined;
 let timer:ReturnType<typeof setTimeout>|undefined;
 const setTimer=options.setTimer??setTimeout,clearTimer=options.clearTimer??clearTimeout;
 const allowed=()=>!disposed&&options.canRead();
 function request():Promise<void>{
  if(!allowed())return Promise.resolve();
  dirty=true;
  if(running)return running;
  if(timer!==undefined){clearTimer(timer);timer=undefined;}
  // Defer entry so synchronous requests share the same run.
  running=Promise.resolve().then(async()=>{
   for(let pass=0;pass<2&&dirty&&allowed();pass++){
    dirty=false;
    // An existing fetch may have captured state before this event.
    const pending=options.hasPending();
    await options.read();
    if(pending)dirty=true;
   }
  }).finally(()=>{
   running=undefined;
   if(dirty&&allowed())timer=setTimer(()=>{
    timer=undefined;void request().catch(()=>{});
   },2000);
  });
  return running;
 }
 return {request,dispose(){disposed=true;dirty=false;if(timer!==undefined)clearTimer(timer);timer=undefined;}};
}
