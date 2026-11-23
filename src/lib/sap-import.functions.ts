import {createServerFn} from '@tanstack/react-start';
import {requireSupabaseAuth} from './password-auth';
import {sapImportSchema,sapImportUnconfirmedMessage} from './sap-import-policy';
export const importActivitySap=createServerFn({method:'POST'}).middleware([requireSupabaseAuth])
 .validator((data:unknown)=>sapImportSchema.parse(data))
 .handler(async({data,context})=>{
  // One fixed caller-authenticated operation. No service client or generic relay.
  const result=await (context.supabase as any).rpc('import_sap_confirmations_once',{
   p_request_id:data.requestId,p_week_id:data.weekId,p_source_file_name:data.fileName,p_rows:data.rows,
  }).abortSignal(AbortSignal.timeout(45000));
  if(result.error)return {ok:false as const,error:['PT409','PT403','PT400'].includes(result.error.code)?result.error.message:sapImportUnconfirmedMessage()};
  if(result.data?.ok!==true||!result.data?.importId)return {ok:false as const,error:sapImportUnconfirmedMessage()};
  return {ok:true as const,importId:String(result.data.importId),count:Number(result.data.count),replayed:result.data.replayed===true};
 });
