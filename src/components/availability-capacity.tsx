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
 const [mode,setMode]=useState("week"),[metric,setMetric]=useState("hh"),[center,setCenter]=useState(""),[total,setTotal]=useState("");
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
 const choices=[...new Map(rows.map(r=>[JSON.stringify([r.center,r.local]),r])).entries()];
 const weekly=Object.values(days).reduce((a,b)=>a+b,0),amount=Number(total.replace(",","."));
 const preview:Record<string,number>={};let allocated=0;const activeDates=dates.filter(d=>days[d]>0);
 activeDates.forEach((d,i)=>{const value=i===activeDates.length-1?Math.round((amount-allocated)*100)/100:Math.round(amount*days[d]/weekly*100)/100;preview[d]=value;allocated+=value;});
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
 <div className="max-h-96 space-y-2 overflow-auto">{bars.map(([k,g])=>{const v=metric==="hh"?g.hours:denominator?g.hours/denominator:0;return <div key={k} className="grid grid-cols-[minmax(100px,1fr)_3fr] items-center gap-3 text-xs"><span>{g.center} · {g.local}</span><div><div className="h-4 rounded bg-muted"><div className="h-full rounded bg-primary" style={{width:(v/max*100)+"%"}}/></div><span>{fmt(g.hours)} HH · {denominator?fmt(g.hours/denominator)+" pessoas equivalentes":"sem referência"}</span></div></div>})}</div>
 {!readOnly&&<details className="border-t pt-3"><summary className="cursor-pointer text-xs font-medium">Distribuir HH semanal por jornada</summary><p className="my-2 text-xs">Sugestão proporcional. Aplicar altera o rascunho; use Salvar disponibilidade para registrar a versão.</p>
 <div className="flex flex-wrap gap-2"><select aria-label="Centro para distribuição" className="input-base" value={center} onChange={e=>setCenter(e.target.value)}><option value="">Selecione o centro e local</option>{choices.map(([k,r])=><option key={k} value={k}>{r.center} · {r.local}</option>)}</select><input aria-label="HH semanal para distribuição" className="input-base" placeholder="HH semanal" value={total} onChange={e=>setTotal(e.target.value)}/></div>
 {amount>0&&weekly>0&&<p className="my-2 text-xs">{fmt(amount/weekly)} pessoas equivalentes · {Object.entries(preview).map(([d,h])=>d.slice(8)+": "+fmt(h)+" HH").join(" | ")}</p>}
 <button className="btn-primary mt-2 text-xs" disabled={!loaded||!center||!Number.isFinite(amount)||amount<=0||weekly<=0} onClick={()=>{const [c,l]=JSON.parse(center);if(window.confirm("Aplicar esta distribuição ao rascunho de "+c+"? As cargas dos demais centros serão preservadas."))onDistribute(c,l,Object.fromEntries(dates.map(d=>[d,preview[d]??0])));}}>Aplicar prévia ao rascunho</button>
 </details>}
 </section>;
}
