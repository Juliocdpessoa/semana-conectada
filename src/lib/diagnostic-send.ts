// Deliberately not a serverFn: reporting a session error must not call getSession.
export async function sendDiagnostic(data:unknown,token:string|undefined,signal:AbortSignal,fetchImpl:typeof fetch=fetch){
 const headers=new Headers({'content-type':'application/json'});
 if(token)headers.set('authorization',`Bearer ${token}`);
 const response=await fetchImpl('/api/public/nexo-diagnostics',{
  method:'POST',headers,body:JSON.stringify(data),signal,credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',
 });
 if(!response.ok)return {accepted:false};
 const result=await response.json();return {accepted:result?.accepted===true};
}
