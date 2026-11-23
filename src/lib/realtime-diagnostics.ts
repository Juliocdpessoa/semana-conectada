export const REALTIME_REASONS = ['transport','timeout','authorization','jwt','quota','replication','closed','unknown'] as const;
export type RealtimeReason = typeof REALTIME_REASONS[number];
/** Only protocol/application close codes; never persist a server's free-text reason. */
export function isRealtimeCloseCode(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1000 && value <= 4999;
}
export function realtimeCloseCode(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  try {
    const e = error as {code?:unknown;cause?:{code?:unknown};message?:unknown};
    if (isRealtimeCloseCode(e.code)) return e.code;
    if (isRealtimeCloseCode(e.cause?.code)) return e.cause.code;
    // The pinned SDK also normalizes native CloseEvent into this exact prefix.
    const match = typeof e.message === 'string' ? /^socket closed: (\d{4})(?:\s|$)/.exec(e.message) : null;
    const code = match ? Number(match[1]) : undefined;
    return isRealtimeCloseCode(code) ? code : undefined;
  } catch { return undefined; }
}
export function isRealtimeReason(value: unknown): value is RealtimeReason {
  return typeof value === 'string' && REALTIME_REASONS.includes(value as RealtimeReason);
}
export function classifyRealtimeFailure(status: string, error: unknown) {
  const message=String((error as {message?:unknown}|null)?.message??'').replace(/[_-]/g,' ').replace(/([a-z])([A-Z])/g,'$1 $2');
  if (/jwt|token.*expir|expired.*token/i.test(message)) return {reason:'jwt',category:'auth'} as const;
  if (/unauthoriz|permission|forbidden|not allowed|row.level.security/i.test(message)) return {reason:'authorization',category:'auth'} as const;
  if (/quota|too many|tenant events|limit.*(connect|channel)|max.*(connect|channel)|(?:connect|channel|join|message).*rate limit reached/i.test(message)) return {reason:'quota',category:'server'} as const;
  if (/replication|wal|database.*(unavailable|error)/i.test(message)) return {reason:'replication',category:'server'} as const;
  if (status==='TIMED_OUT'||/timed?\s*out|timeout/i.test(message)) return {reason:'timeout',category:'timeout'} as const;
  if(status==='CLOSED')return {reason:'closed',category:'network'} as const;
  return {reason:'transport',category:'network'} as const;
}
/** At most two failures per page, at least five minutes apart. No raw errors,
 * URLs, channel names, payloads or credentials leave this classifier. */
export function createRealtimeDiagnostics(report:(failure:ReturnType<typeof classifyRealtimeFailure>&{elapsedMs:number;closeCode?:number})=>void, now=Date.now){
  const started=now();let remaining=2,last:number|undefined;
  return {status(status:string,error?:unknown){
    if(!['CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(status)||remaining<=0)return;
    if(last!==undefined&&now()-last<300_000)return;
    remaining--;last=now();
    try{const closeCode=realtimeCloseCode(error);report({...classifyRealtimeFailure(status,error),...(closeCode!==undefined?{closeCode}:{}),elapsedMs:Math.min(60_000,Math.max(0,now()-started))});}catch{/* Telemetry cannot affect collaboration. */}
  }};
}
