export type RealtimeHealthOperation = 'realtime_connect'|'realtime_disconnect'|'realtime_recovery';
export function createRealtimeHealth(report:(operation:RealtimeHealthOperation,durationMs:number,success:boolean)=>void,now=()=>performance.now()) {
 const started=now();let connected=false,everConnected=false,failedAt:number|undefined;
 const emit=(op:RealtimeHealthOperation,duration:number,success:boolean)=>{try{report(op,Math.min(86400000,Math.max(0,Math.round(duration))),success);}catch{/* No effect on collaboration. */}};
 return {status(status:string){
  if(status==='SUBSCRIBED'){
   if(connected)return;
   connected=true;
   if(failedAt!==undefined){emit('realtime_recovery',now()-failedAt,true);failedAt=undefined;}
   else if(!everConnected)emit('realtime_connect',now()-started,true);
   everConnected=true;
  }else if(['CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(status)){
   connected=false;
   if(failedAt===undefined){failedAt=now();emit('realtime_disconnect',0,false);}
  }
 }};
}
