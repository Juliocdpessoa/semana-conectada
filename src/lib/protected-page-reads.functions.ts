import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from './password-auth';
import { readAllPages } from './read-query-policy';
import { assembleDirectory, canReadDirectory } from './admin-directory-policy';

// Fixed read operations, not a general-purpose proxy. Every query uses the
// caller's JWT and existing RLS. No service client or permissions are added.
async function actorForRead(db: any, userId: string) {
 const { data, error } = await db.from('profiles').select('id,email,approval_status,worksite_id').eq('id', userId).maybeSingle().abortSignal(AbortSignal.timeout(8000));
 if (error || !data || data.approval_status !== 'approved' || !data.worksite_id) throw new Error('Não foi possível validar seu acesso à obra.');
 return data;
}
async function allRows(build: (offset: number, size: number) => any, signal: AbortSignal): Promise<any[]> {
 return readAllPages<any>(async (offset, size) => {
  const { data, error } = await build(offset, size).abortSignal(signal);
  if (error) throw new Error('Não foi possível carregar os dados. Tente novamente.');
  return data ?? [];
 }, signal, 500);
}
export const getAdminDirectory = createServerFn({ method: 'POST' })
 .middleware([requireSupabaseAuth])
 .handler(async ({ context }) => {
  const db = context.supabase as any;
  const actor = await actorForRead(db, context.userId);
  const signal = AbortSignal.timeout(20000);
  const [roles, membership] = await Promise.all([
   db.from('user_roles').select('role').eq('user_id', context.userId).abortSignal(signal),
   db.from('worksite_memberships').select('is_worksite_admin').eq('user_id', context.userId).eq('worksite_id', actor.worksite_id).maybeSingle().abortSignal(signal),
  ]);
  if (roles.error || membership.error) throw new Error('Não foi possível validar as permissões.');
  const global = actor.email?.trim().toLowerCase() === 'julio.pessoa@normatel.com.br';
  if (!canReadDirectory(true, global, (roles.data ?? []).map((r: any) => r.role), membership.data?.is_worksite_admin === true)) throw new Error('Acesso restrito à administração.');
  const memberships = await allRows((from,size) => {
   let q = db.from('worksite_memberships').select('user_id,worksite_id,is_worksite_admin').order('user_id').order('worksite_id').range(from,from+size-1);
   return global ? q : q.eq('worksite_id', actor.worksite_id);
  },signal);
  const allowedIds = [...new Set(memberships.map(row => row.user_id))];
  // Read profiles/roles/audit through their existing RLS, then enforce local
  // membership scope again before returning any row to the browser.
  const profiles = await allRows((from,size) => db.from('profiles').select('id,email,full_name,approval_status,created_at').order('created_at',{ascending:false}).order('id').range(from,from+size-1),signal);
  const visibleIds = global ? profiles.map(row => row.id) : allowedIds;
  const roleRows: any[] = [], auditRows: any[] = [];
  for (let start=0;start<visibleIds.length;start+=200) {
   const ids=visibleIds.slice(start,start+200);
   const [r,a] = await Promise.all([
    allRows((from,size) => db.from('user_roles').select('user_id,role').in('user_id',ids).order('user_id').order('role').range(from,from+size-1),signal),
    allRows((from,size) => db.from('password_reset_latest').select('user_id,event,happened_at,actor_name').in('user_id',ids).order('user_id').range(from,from+size-1),signal),
   ]);
   roleRows.push(...r); auditRows.push(...a);
  }
  const worksites = global ? await allRows((from,size) => db.from('worksites').select('id,code,name').eq('is_active',true).order('code').order('id').range(from,from+size-1),signal) : [];
  return { users: assembleDirectory(profiles,roleRows,memberships,auditRows,global,actor.worksite_id), worksites };
 });

export const getVisibleWeeks = createServerFn({ method: 'POST' })
 .middleware([requireSupabaseAuth])
 .handler(async ({ context }) => {
  const db=context.supabase as any;
  const actor=await actorForRead(db,context.userId);
  return allRows((from,size) => db.from('weeks').select('id,code,label,start_date,end_date,is_active').eq('worksite_id',actor.worksite_id).order('start_date',{ascending:false}).order('id').range(from,from+size-1),AbortSignal.timeout(15000));
 });

export const getAuditHistory = createServerFn({ method: 'POST' })
 .middleware([requireSupabaseAuth])
 .handler(async ({ context }) => {
  const db=context.supabase as any;
  await actorForRead(db,context.userId);
  const signal=AbortSignal.timeout(15000);
  const roles=await db.from('user_roles').select('role').eq('user_id',context.userId).abortSignal(signal);
  if (roles.error || !(roles.data ?? []).some((r:any)=>['admin','planning'].includes(r.role))) throw new Error('Acesso restrito ao histórico.');
  const history=await db.from('activity_history').select('*').order('changed_at',{ascending:false}).order('id').limit(200).abortSignal(signal);
  if(history.error)throw new Error('Não foi possível carregar o histórico.');
  const rows=history.data ?? [];
  const ids=[...new Set(rows.map((row:any)=>row.activity_id).filter(Boolean))];
  const activities=ids.length ? await db.from('activities').select('id,order_number,planning_data').in('id',ids).abortSignal(signal) : {data:[],error:null};
  if(activities.error)throw new Error('Não foi possível carregar os detalhes do histórico.');
  const byId=new Map((activities.data ?? []).map((a:any)=>[a.id,a]));
  return rows.map((h:any)=>{
   const a=byId.get(h.activity_id) as any; const pd=a?.planning_data ?? {};
   return {...h,order_number:a?.order_number ?? null,operacao:pd['Operação']??pd['Operacao']??pd['OPERAÇÃO']??null,
    sub_operacao:pd['Sub operação']??pd['Sub Operação']??pd['Subop']??pd['SUB OPERAÇÃO']??pd['Sub operacao']??null};
  });
 });

const weekSchema=z.object({weekId:z.string().uuid()}).strict();
async function checkWeek(db:any,userId:string,weekId:string,signal:AbortSignal) {
 const actor=await actorForRead(db,userId);
 const week=await db.from('weeks').select('id').eq('id',weekId).eq('worksite_id',actor.worksite_id).maybeSingle().abortSignal(signal);
 if(week.error || !week.data)throw new Error('Não foi possível consultar esta semana na obra atual.');
}
export const getPanelActivityRows = createServerFn({ method:'POST' })
 .middleware([requireSupabaseAuth]).validator((data:unknown)=>weekSchema.parse(data))
 .handler(async({data,context})=>{
  const db=context.supabase as any,signal=AbortSignal.timeout(20000);
  await checkWeek(db,context.userId,data.weekId,signal);
  return allRows((from,size)=>db.from('activities').select('id,order_number,note_number,description,area,specialty,scheduled_date,status,justification,observation,reported_by_name,reported_by_email,reported_at,is_immediate,planning_data').eq('week_id',data.weekId).order('scheduled_date').order('id').range(from,from+size-1),signal);
 });
export const searchOvertimeActivities = createServerFn({ method:'POST' })
 .middleware([requireSupabaseAuth]).validator((data:unknown)=>weekSchema.extend({search:z.string().trim().min(2).max(200)}).strict().parse(data))
 .handler(async({data,context})=>{
  const db=context.supabase as any,signal=AbortSignal.timeout(12000);
  await checkWeek(db,context.userId,data.weekId,signal);
  const term=data.search.replace(/[,%()]/g,' ').replace(/\s+/g,' ');
  const result=await db.from('activities').select('id,week_id,order_number,description').eq('week_id',data.weekId).or(`order_number.ilike.%${term}%,description.ilike.%${term}%`).order('id').limit(20).abortSignal(signal);
  if(result.error)throw new Error('Não foi possível pesquisar as atividades.');
  return result.data ?? [];
 });

export const getWeeklyActivityExportRows = createServerFn({method:'POST'})
 .middleware([requireSupabaseAuth]).validator((data:unknown)=>weekSchema.parse(data))
 .handler(async({data,context})=>{
  const db=context.supabase as any,signal=AbortSignal.timeout(20000);
  await checkWeek(db,context.userId,data.weekId,signal);
  return allRows((from,size)=>db.from('activities').select('id,status,justification,observation,reported_by_name,reported_by_email,reported_at,planning_data,source_row_number').eq('week_id',data.weekId).in('status',['EXECUTADO','NÃO EXECUTADO']).order('source_row_number').order('id').range(from,from+size-1),signal);
 });
