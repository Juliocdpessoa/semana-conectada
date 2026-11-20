export const REALTIME_REASONS = ['transport','timeout','authorization','jwt','quota','replication','closed','unknown'] as const;
export type RealtimeReason = typeof REALTIME_REASONS[number];
export function isRealtimeReason(value: unknown): value is RealtimeReason {
  return typeof value === 'string' && REALTIME_REASONS.includes(value as RealtimeReason);
}
export function classifyRealtimeFailure(status: string, error: unknown) {
  const message=String((error as {message?:unknown}|null)?.message??'');
  if (/jwt|token.*expir|expired.*token/i.test(message)) return {reason:'jwt',category:'auth'} as const;
  if (/unauthoriz|permission|forbidden|not allowed|row.level.security/i.test(message)) return {reason:'authorization',category:'auth'} as const;
  if (/quota|too many|limit.*(connect|channel)|max.*(connect|channel)/i.test(message)) return {reason:'quota',category:'server'} as const;
  if (/replication|wal|database.*(unavailable|error)/i.test(message)) return {reason:'replication',category:'server'} as const;
  if (status==='TIMED_OUT'||/timed?\s*out|timeout/i.test(message)) return {reason:'timeout',category:'timeout'} as const;
  if(status==='CLOSED')return {reason:'closed',category:'network'} as const;
  return {reason:'transport',category:'network'} as const;
}
/** At most two failures per page, at least five minutes apart. No raw errors,
 * URLs, channel names, payloads or credentials leave this classifier. */
export function createRealtimeDiagnostics(report:(failure:ReturnType<typeof classifyRealtimeFailure>&{elapsedMs:number})=>void, now=Date.now){
  const started=now();let remaining=2,last:number|undefined;
  return {status(status:string,error?:unknown){
    if(!['CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(status)||remaining<=0)return;
    if(last!==undefined&&now()-last<300_000)return;
    remaining--;last=now();
    try{report({...classifyRealtimeFailure(status,error),elapsedMs:Math.min(60_000,Math.max(0,now()-started))});}catch{/* Telemetry cannot affect collaboration. */}
  }};
}
