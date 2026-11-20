import {useState} from "react";
import {useQuery} from "@tanstack/react-query";
import { rsTransport as supabase } from "@/lib/rs-transport";
import type {RsPendingSource} from "@/lib/rs-center-pending";
const hh=(n:unknown)=>Number(n??0).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
const date=(s:string|null)=>s?s.split("-").reverse().join("/"):"—";
export function RsCenterImmediateTasks({center,sources,local,userId,worksiteId,revision}:{center:string;sources:RsPendingSource[];local:string;userId:string;worksiteId:string;revision:string}){
 const [page,setPage]=useState(0);
 const query=useQuery({queryKey:["rs-center-immediate",userId,worksiteId,center,sources,local,revision,page],staleTime:30000,queryFn:async({signal})=>{
 const {data,error}=await (supabase as any).rpc("get_rs_center_immediate_tasks",{p_sources:sources,p_center:center,p_local:local||null,p_offset:page*50,p_limit:50}).abortSignal(signal);
 if(error)throw error;return data as {total:number;totalHh:number;missingSapWeeks:string[];rows:Array<{id:string;week_id:string;week_code:string;order_number:string;operation:string;suboperation:string|null;confirmation:string;description:string;actual_start_date:string|null;actual_end_date:string|null;actual_work:number;local:string}>};}});
 return <section className="mt-5 space-y-3 border-t border-border pt-4">
 <h3 className="font-semibold">Apropriações fora da programação · SAP</h3>
 <p className="text-muted-foreground">Código 2 e, na RPBC/IARI, código 1, conforme a regra da apuração ou do fechamento consultado. Apenas fora da programação, com confirmação e HH positivo. Valores antes do teto da especialidade.</p>
 {query.isPending?<p>Carregando apropriações…</p>:query.isError?<p role="alert">Não foi possível carregar. <button className="underline" onClick={()=>void query.refetch()}>Tentar novamente</button></p>:<>
 {query.data.missingSapWeeks.length>0&&<p role="status">Sem carga SAP em: {query.data.missingSapWeeks.join(", ")}. Totais parciais.</p>}
 <p>{query.data.total} apropriação(ões) · Total: <b>{hh(query.data.totalHh)} HH</b></p>
 {query.data.rows.length===0?<p className="text-muted-foreground">Nenhuma apropriação elegível fora da programação neste centro e recorte.</p>:<div className="max-h-96 overflow-auto rounded border border-border"><table className="w-full min-w-[850px] text-left text-xs"><thead className="sticky top-0 bg-muted"><tr>{["Semana","Ordem / Operação","Confirmação","Descrição","Período executado","HH apropriado"].map(h=><th className="p-2" key={h}>{h}</th>)}</tr></thead><tbody>{query.data.rows.map(r=><tr key={r.week_id+":"+r.id} className="rs-hover-row row-zebra border-t border-border"><td className="p-2">{r.week_code}</td><td className="p-2 font-mono">{r.order_number}<br/>{r.operation}{r.suboperation?" / "+r.suboperation:""}</td><td className="p-2">{r.confirmation}</td><td className="p-2">{r.description}</td><td className="p-2">{date(r.actual_start_date)} a {date(r.actual_end_date)}</td><td className="p-2 text-right tabular-nums">{hh(r.actual_work)}</td></tr>)}</tbody><tfoot><tr className="border-t font-semibold"><td colSpan={5} className="p-2">Total do recorte · todas as páginas</td><td className="p-2 text-right">{hh(query.data.totalHh)}</td></tr></tfoot></table></div>}
 {query.data.total>50&&<div className="flex justify-between"><button className="btn-ghost" disabled={page===0||query.isFetching} onClick={()=>setPage(p=>p-1)}>Anterior</button><span>Página {page+1} de {Math.ceil(query.data.total/50)}</span><button className="btn-ghost" disabled={(page+1)*50>=query.data.total||query.isFetching} onClick={()=>setPage(p=>p+1)}>Próxima</button></div>}
 </>}
 </section>;
}
