import {useState} from "react";
import {Popover,PopoverContent,PopoverTrigger} from "@/components/ui/popover";
import {ChevronDown} from "lucide-react";
type Option={value:string;label:string};
export function ContinuousMultiFilter({label,options,selected,onChange,loading=false}:{label:string;options:Option[];selected:string[];onChange:(values:string[])=>void;loading?:boolean}){
 const [search,setSearch]=useState("");
 const available=new Map(options.map(o=>[o.value,o.label]));
 const merged=[...new Set([...options.map(o=>o.value),...selected])].map(value=>({value,label:available.get(value)??value}));
 const normalize=(value:string)=>value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
 const shown=merged.filter(o=>normalize(o.label).includes(normalize(search)));
 const summary=selected.length===1?(available.get(selected[0])??selected[0]):selected.length?selected.length+" selecionados":"Todos";
 return <div className="w-full sm:w-52"><span className="mb-1 block text-xs">{label}</span><Popover><PopoverTrigger asChild><button type="button" aria-label={"Filtrar "+label} className="input-base flex w-full items-center justify-between gap-2 text-left text-xs"><span className="truncate">{summary}</span><ChevronDown className="h-3.5 w-3.5 shrink-0"/></button></PopoverTrigger><PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)] p-2">
 <input aria-label={"Buscar opções de "+label} className="input-base mb-2 w-full text-xs" placeholder="Buscar opções…" value={search} onChange={e=>setSearch(e.target.value)}/>
 <div className="mb-2 flex flex-wrap gap-2"><button type="button" className="btn-ghost text-xs" onClick={()=>onChange([...new Set([...selected,...shown.filter(o=>available.has(o.value)).map(o=>o.value)])])}>Selecionar visíveis</button><button type="button" className="btn-ghost text-xs" onClick={()=>onChange([])}>Limpar seleção</button></div>
 {loading&&<p role="status" className="px-2 text-xs text-muted-foreground">Atualizando opções…</p>}
 <div className="max-h-64 overflow-y-auto">{shown.map(o=><label key={o.value} className="flex cursor-pointer items-start gap-2 rounded px-2 py-2 text-xs hover:bg-muted"><input type="checkbox" className="mt-0.5 accent-primary" checked={selected.includes(o.value)} onChange={e=>onChange(e.target.checked?[...selected,o.value]:selected.filter(v=>v!==o.value))}/><span className="break-words">{o.label}{!available.has(o.value)?" (fora do recorte)":""}</span></label>)}{!shown.length&&!loading&&<p className="p-2 text-xs text-muted-foreground">Nenhuma opção neste recorte.</p>}</div>
 </PopoverContent></Popover></div>;
}
