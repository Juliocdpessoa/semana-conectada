import {useEffect,useState} from "react";
import {supabase} from "@/integrations/supabase/client";
import {availabilityWeekDates} from "@/lib/new-availability-center";
import type {AvailabilityRow,AvailabilityWeek} from "@/lib/weekly-availability";
import {toast} from "sonner";
type Props={week:AvailabilityWeek & {id:string};rows:AvailabilityRow[];readOnly:boolean;onDistribute:(center:string,local:string,days:Record<string,number>)=>void};
const fmt=(n:number)=>n.toLocaleString("pt-BR",{maximumFractionDigits:2});
export function AvailabilityCapacity({week,rows,readOnly,onDistribute}:Props){
 const dates=availabilityWeekDates(week);
 const defaults=Object.fromEntries(dates.map(d=>[d,[0,6].includes(new Date(d+"T12:00:00").getDay())?0:8.8]));
 const [days,setDays]=useState<Record<string,number>>(defaults);
 const [version,setVersion]=useState(0),[saved,setSaved]=useState(""),[busy,setBusy]=useState(false),[loaded,setLoaded]=useState(false);
 const [mode,setMode]=useState("week"),[metric,setMetric]=useState("hh");
 const [history,setHistory]=useState<any[]>([]);
 useEffect(()=>{let active=true;setLoaded(false);
 (async()=>{const {data,error}=await (supabase as any).from("weekly_capacity_journey").select("*").eq("week_id",week.id).maybeSingle();
 if(!active)return;if(error){toast.error("Não foi possível carregar a jornada.");return;}
 setDays(data?.days??defaults);setVersion(data?.version??0);setSaved(data?new Date(data.updated_at).toLocaleString("pt-BR"):"");setLoaded(true);
 })();return()=>{active=false};},[week.id]);
 const denominator=mode==="week"?Object.values(days).reduce((a,b)=>a+b,0):(days[mode]??0);
 const groups=new Map<string,{center:string;local:string;hours:number}>();
 for(const r of rows){if(mode!=="week"&&r.date!==mode)continue;const k=JSON.stringify([r.center,r.local]);const g=groups.get(k)??{center:r.center,local:r.local,hours:0};g.hours+=r.hours;groups.set(k,g);}
 const bars=[...groups.entries()].sort((a,b)=>b[1].hours-a[1].hours);
 const max=Math.max(1,...bars.map(([,g])=>metric==="hh"?g.hours:denominator?g.hours/denominator:0));
 const weekly=Object.values(days).reduce((a,b)=>a+b,0);
 async function save(){if(readOnly||busy||!loaded)return;setBusy(true);
 try{const db=supabase as any;const result=version?await db.from("weekly_capacity_journey").update({days}).eq("week_id",week.id).eq("version",version).select().maybeSingle():await db.from("weekly_capacity_journey").insert({week_id:week.id,days}).select().single();
 if(result.error||!result.data)throw Error("Jornada alterada por outra pessoa ou sem permissão. Atualize a tela.");
 setVersion(result.data.version);setSaved(new Date(result.data.updated_at).toLocaleString("pt-BR"));toast.success("Jornada semanal salva com histórico.");
 }catch(e){toast.error(e instanceof Error?e.message:"Erro ao salvar");}finally{setBusy(false);}}
 return <section className="mb-4 space-y-3 rounded-lg border border-border bg-card p-4">
 <h3 className="text-sm font-semibold">Capacidade por centro de trabalho</h3>
 <p className="text-xs text-muted-foreground">Pessoas equivalentes = HH disponível ÷ jornada por pessoa do período. Não representa a contagem de colaboradores únicos. A jornada não altera o cálculo do RS.</p>
 <div className="flex flex-wrap items-end gap-2">
 {dates.map(d=><label key={d} className="text-xs">{d.slice(8)}/{d.slice(5,7)}<input aria-label={"Jornada "+d} type="number" min="0" max="24" step="0.1" disabled={readOnly||!loaded} value={days[d]??0} onChange={e=>setDays({...days,[d]:Math.min(24,Math.max(0,Number(e.target.value)))})} className="input-base block w-20"/></label>)}
 <span className="text-xs">{fmt(weekly)} h/pessoa na semana</span>
 {!readOnly&&<button className="btn-primary text-xs" disabled={busy||!loaded} onClick={save}>Salvar jornada</button>}
 <button className="btn-secondary text-xs" onClick={async()=>{const {data,error}=await (supabase as any).from("weekly_capacity_journey_history").select("*").eq("week_id",week.id).order("updated_at",{ascending:false}).limit(30);if(error)toast.error("Erro ao consultar histórico");else setHistory(data??[]);}}>Histórico da jornada</button>
 </div>
 <p className="text-xs text-muted-foreground">{saved?"Jornada salva em "+saved:"Referência sugerida de 8,8 h por dia útil: confira e salve antes de usar como referência oficial."}</p>
 {history.length>0&&<div className="max-h-40 overflow-auto text-xs">{history.map(h=><p key={h.id}>Versão {h.version} · {new Date(h.updated_at).toLocaleString("pt-BR")} · {h.updated_by_name||h.updated_by} · {Object.entries(h.days).map(([d,v])=>d+": "+v+"h").join(" | ")}</p>)}</div>}
 <div className="flex flex-wrap gap-2"><select aria-label="Período do gráfico" className="input-base text-xs" value={mode} onChange={e=>setMode(e.target.value)}><option value="week">Semana completa</option>{dates.map(d=><option key={d} value={d}>{d.slice(8)}/{d.slice(5,7)}</option>)}</select><select aria-label="Métrica do gráfico" className="input-base text-xs" value={metric} onChange={e=>setMetric(e.target.value)}><option value="hh">HH disponível</option><option value="people">Pessoas equivalentes</option></select></div>
 {!denominator&&<p className="text-xs text-amber-700">Jornada zero: não é possível calcular pessoas equivalentes neste período.</p>}

 <div className="overflow-x-auto pb-2">
 <div role="img" aria-label={metric==="hh"?"HH disponível por centro de trabalho":"Pessoas equivalentes por centro de trabalho"} className="flex min-w-full items-end gap-3 border-b border-border px-2 pt-8" style={{height:340,width:Math.max(600,bars.length*105)}}>
 {bars.map(([k,g])=>{const v=metric==="hh"?g.hours:denominator?g.hours/denominator:0;return <div key={k} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end" title={g.center+" · "+g.local+" | "+fmt(g.hours)+" HH | "+(denominator?fmt(g.hours/denominator)+" pessoas equivalentes":"sem referência")}>
 <div className="flex w-full flex-1 flex-col justify-end items-center">
 <span className="mb-1 whitespace-nowrap text-xs font-semibold">{fmt(v)}</span>
 <div className="w-10 rounded-t bg-primary transition-all hover:brightness-110 sm:w-14" style={{height:(v/max*230)+"px",minHeight:v>0?2:0}}/>
 </div>
 <div className="h-16 w-full pt-2 text-center text-[10px]"><div className="break-words font-semibold">{g.center}</div><div className="text-muted-foreground">{g.local}</div></div>
 </div>})}
 </div>
 </div>
 <p className="text-xs text-muted-foreground">{metric==="hh"?"HH disponível":"Pessoas equivalentes"} · Passe o mouse sobre uma coluna para ver os dois valores.</p>

 </section>;
}
