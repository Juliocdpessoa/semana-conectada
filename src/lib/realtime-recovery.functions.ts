import {createServerFn} from '@tanstack/react-start';
import {z} from 'zod';
import {requireSupabaseAuth} from './password-auth';
export const getActivityRevision=createServerFn({method:'POST'}).middleware([requireSupabaseAuth])
 .validator((data:unknown)=>z.object({weekId:z.string().uuid()}).strict().parse(data))
 .handler(async({data,context})=>{
  const db=context.supabase as any,signal=AbortSignal.timeout(5000);
  const week=await db.from('weeks').select('id,worksite_id').eq('id',data.weekId).maybeSingle().abortSignal(signal);
  if(week.error||!week.data)throw new Error('Não foi possível conferir as atualizações desta semana.');
  const result=await db.rpc('get_activity_revision',{p_week_id:data.weekId,p_worksite_id:week.data.worksite_id}).abortSignal(signal);
  if(result.error||typeof result.data!=='string')throw new Error('Não foi possível conferir as atualizações.');
  return result.data as string;
 });
