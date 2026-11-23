// Caller-scoped transport. No service key, retries, refresh or authorization bypass.
export function createIdentityFetch(base: typeof fetch, key: string, requestSignal?: AbortSignal, authTimeoutMs=5000): typeof fetch {
  return (input,init) => {
    const headers=new Headers(input instanceof Request?input.headers:undefined);
    new Headers(init?.headers).forEach((v,k)=>headers.set(k,v));
    if(key.startsWith('sb_publishable_')&&headers.get('authorization')===`Bearer ${key}`)headers.delete('authorization');
    headers.set('apikey',key);
    const url=new URL(input instanceof Request?input.url:String(input));
    const signals=[requestSignal,init?.signal??undefined,...(url.pathname.startsWith('/auth/v1/')?[AbortSignal.timeout(authTimeoutMs)]:[])].filter((s):s is AbortSignal=>!!s);
    return base(input,{...init,headers,signal:signals.length?AbortSignal.any(signals):undefined});
  };
}
