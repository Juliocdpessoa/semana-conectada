export type ContinuousField={key:string;label:string;type:string;visible:boolean;filter:boolean};
export type ContinuousStatus={key:string;label:string;color:string;active:boolean};
export type ContinuousConfig={worksite_id:string;mode:"continuous";fields:ContinuousField[];statuses:ContinuousStatus[];version:number;updated_by_name?:string;updated_at?:string};
export const normalizeHeader=(v:unknown)=>String(v??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase().replace(/[^A-Z0-9]/g,"");
export const fiocruzColumns=["ss","status","requester","description","os","budget","budget_type","local","sector","criticality","requested_date","contract_date","sent_date","approved_date","finished_date","value","value_bdi","measurement","progress","","notes"];
export function continuousKey(d:Record<string,unknown>){
 // Never use OS alone: one OS may have several budgets.
 return JSON.stringify([d.ss??"",d.os??"",d.budget??"",String(d.description??"").trim()]);}
export function parseContinuousGrid(grid:unknown[][],cfg:ContinuousConfig,parseDate:(n:number)=>string){
 const label=(key:string)=>normalizeHeader(cfg.fields.find(f=>f.key===key)?.label??key);
 const index=grid.findIndex(r=>["ss","requester","description"].every(key=>r.some(v=>normalizeHeader(v)===label(key))));
 if(index<0)throw Error("Cabeçalho da aba ORÇAMENTOS não encontrado: confira Nº S.S, SOLICITANTE e SOLICITAÇÃO.");
 const headers=grid[index].map(normalizeHeader);
 const legacy=headers[1]===label("ss")&&headers[3]===label("requester")&&headers[4]===label("description");
 const columns=new Map<string,number>();
 for(const field of cfg.fields){
 const matches=headers.map((h,i)=>h===label(field.key)?i:-1).filter(i=>i>=0);
 if(matches.length>1)throw Error("Coluna duplicada: "+field.label);
 const position=legacy?fiocruzColumns.indexOf(field.key)+1:(matches[0]??-1);
 if(position<0)throw Error("Coluna não encontrada: "+field.label);
 columns.set(field.key,position);
 }
 const seen=new Set<string>();const result:Array<{key:string;data:Record<string,unknown>;line:number}>=[];
 for(let i=index+1;i<grid.length;i++){
 const row=grid[i];if(!row?.some(v=>v!==null&&v!==undefined&&String(v).trim()!==""))continue;
 const data:Record<string,unknown>={};
 for(const f of cfg.fields){
 const key=f.key;let v=row[columns.get(key)!];
 if(v===null||v===undefined||v===""||v==="-"){data[key]=null;continue;}
 if(key==="status"){const label=normalizeHeader(v);const st=cfg.statuses.find(s=>normalizeHeader(s.key+"-"+s.label)===label||normalizeHeader(s.label)===label||s.key===String(v).trim());if(!st||!st.active)throw Error("Status não configurado na linha "+(i+1)+": "+v);v=st.key;}
 else if(f?.type==="number"){if(typeof v!=="number"){const text=String(v).replace(/R\$/g,"").trim();v=Number(text.includes(",")?text.replace(/\./g,"").replace(",","."):text);}if(!Number.isFinite(v)||Number(v)<0)throw Error("Valor inválido na linha "+(i+1));}
 else if(f?.type==="date"){if(typeof v==="number")v=parseDate(v);else if(/^\d{2}\/\d{2}\/\d{4}$/.test(String(v)))v=String(v).split("/").reverse().join("-");else if(!/^\d{4}-\d{2}-\d{2}$/.test(String(v)))throw Error("Data inválida em "+(f?.label??key)+", linha "+(i+1)+": "+String(v)+". Corrija a planilha antes de importar; nenhum registro foi salvo.");}
 else v=String(v).trim();
 data[key]=v;
 }
 if(!data.description)throw Error("Solicitação vazia na linha "+(i+1));
 if(!data.status)throw Error("Status vazio na linha "+(i+1));
 const key=continuousKey(data);if(seen.has(key))throw Error("Registro duplicado na planilha, linha "+(i+1)+". Confira SS, OS, orçamento e solicitação.");seen.add(key);result.push({key,data,line:i+1});
 }
 if(!result.length)throw Error("Nenhum registro encontrado.");return result;
}
