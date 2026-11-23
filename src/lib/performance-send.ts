import type {PerformanceSampleInput} from './performance-http';
export async function sendPerformanceSample(data:PerformanceSampleInput,token:string|undefined,signal:AbortSignal,fetchImpl:typeof fetch=fetch){
 if(!token)return {accepted:false};
 const response=await fetchImpl('/api/public/nexo-performance',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},
  body:JSON.stringify(data),credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal});
 if(!response.ok)return {accepted:false};
 const result=await response.json();return {accepted:result?.accepted===true};
}
