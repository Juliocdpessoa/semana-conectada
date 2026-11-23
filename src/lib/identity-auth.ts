import {createMiddleware} from '@tanstack/react-start';
import {getRequest} from '@tanstack/react-start/server';
import {createClient} from '@supabase/supabase-js';
import type {Database} from '@/integrations/supabase/types';
import {createIdentityFetch} from './identity-fetch';
import {isPublicClientKey} from './access-relay';

// Application-owned bounded equivalent of the generated identity middleware.
// Generated files remain untouched; all authorization/RLS checks remain in place.
export const requireIdentity=createMiddleware({type:'function'}).server(async({next})=>{
  const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_PUBLISHABLE_KEY;
  if(!url||!isPublicClientKey(key))throw new Error('Não foi possível iniciar a verificação de acesso.');
  const request=getRequest(),header=request?.headers.get('authorization');
  if(!header?.startsWith('Bearer '))throw new Error('Unauthorized: No bearer token');
  const token=header.slice(7);
  if(token.length>16384||token.split('.').length!==3)throw new Error('Unauthorized: Invalid token');
  const supabase=createClient<Database>(url,key,{
    global:{fetch:createIdentityFetch(fetch,key,request?.signal),headers:{Authorization:`Bearer ${token}`}},
    auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
  });
  const {data,error}=await supabase.auth.getClaims(token);
  if(error||!data?.claims?.sub)throw new Error('Não foi possível validar o acesso. Tente novamente; não é necessário resetar sua senha.');
  return next({context:{supabase,userId:data.claims.sub,claims:data.claims}});
});
