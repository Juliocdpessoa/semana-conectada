/** Presentation-only triage. Never infer a recovery by subtracting unrelated samples. */
type Snapshot = {
 groups: {stage:string;category:string;realtime_reason:string|null;total:number}[];
 metrics: {operation:string;samples:number;failures:number}[];
 database: {lockWaits:number;slowRequests:number;activeSlots:number;totalSlots:number}|null;
};
export function occurrenceTriage(row:{stage:string;category:string;realtime_reason:string|null}) {
 if(row.stage!=='realtime')return {kind:'attention',label:'Verificar acesso/aplicativo'} as const;
 if(['jwt','authorization','quota','replication'].includes(row.realtime_reason??''))
  return {kind:'attention',label:'Verificar serviço/autorização'} as const;
 return {kind:'unknown',label:'Impacto não confirmado'} as const;
}
export function performanceTriage(data:Snapshot){
 const readFailures=data.metrics.filter(r=>['activities_list','activities_filter'].includes(r.operation)).reduce((n,r)=>n+r.failures,0);
 const attentionDiagnostics=data.groups.filter(r=>occurrenceTriage(r).kind==='attention').reduce((n,r)=>n+r.total,0);
 const unconfirmedRealtime=data.groups.filter(r=>occurrenceTriage(r).kind==='unknown').reduce((n,r)=>n+r.total,0);
 const recoveries=data.metrics.filter(r=>r.operation==='realtime_recovery').reduce((n,r)=>n+Math.max(0,r.samples-r.failures),0);
 const databaseAttention=data.database!==null&&(data.database.lockWaits>0||data.database.slowRequests>0||data.database.activeSlots<data.database.totalSlots);
 return {readFailures,attentionDiagnostics,unconfirmedRealtime,recoveries,databaseAttention};
}
