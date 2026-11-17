export type ContinuousField={key:string;label:string;type:string;visible:boolean;filter:boolean};
export type ContinuousStatus={key:string;label:string;color:string;active:boolean};
export type ContinuousConfig={worksite_id:string;mode:"continuous";fields:ContinuousField[];statuses:ContinuousStatus[];version:number;updated_by_name?:string;updated_at?:string};
export const normalizeHeader=(v:unknown)=>String(v??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase().replace(/[^A-Z0-9]/g,"");
export const fiocruzColumns=["ss","status","requester","description","os","budget","budget_type","local","sector","criticality","requested_date","contract_date","sent_date","approved_date","finished_date","value","value_bdi","measurement","progress","","notes"];
export function continuousKey(d:Record<string,unknown>){
 // Never use OS alone: one OS may have several budgets.
 return JSON.stringify([d.ss??"",d.os??"",d.budget??"",String(d.description??"").trim()]);}
export function parseContinuousGrid(grid:unknown[][],cfg:ContinuousConfig,parseDate:(n:number)=>string){
 const index=grid.findIndex(r=>normalizeHeader(r[1])===normalizeHeader(cfg.fields.find(f=>f.key==="ss")?.label??"Nº S.S")&&normalizeHeader(r[3])===normalizeHeader(cfg.fields.find(f=>f.key==="requester")?.label??"SOLICITANTE")&&normalizeHeader(r[4])===normalizeHeader(cfg.fields.find(f=>f.key==="description")?.label??"SOLICITAÇÃO"));
 if(index<0)throw Error("Cabeçalho da aba ORÇAMENTOS não encontrado: confira Nº S.S, SOLICITANTE e SOLICITAÇÃO.");
 const seen=new Set<string>();const result:Array<{key:string;data:Record<string,unknown>;line:number}>=[];
 for(let i=index+1;i<grid.length;i++){
 const row=grid[i];if(!row?.some(v=>v!==null&&v!==undefined&&String(v).trim()!==""))continue;
 const data:Record<string,unknown>={};
 for(let j=0;j<fiocruzColumns.length;j++){
 const key=fiocruzColumns[j];if(!key)continue;
 const f=cfg.fields.find(f=>f.key===key);let v=row[j+1];
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
