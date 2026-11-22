// Two anonymous synthetic channels only; closes its own socket, never task rows.
const {createClient}=await import(process.argv.includes('--locked-sdk')?'../.audit-tmp/realtime-runtime/node_modules/@supabase/supabase-js/dist/index.mjs':'@supabase/supabase-js');
const url=process.env.VITE_SUPABASE_URL,key=process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
if(!url||!key)throw Error('Missing public configuration');
let receiverSocket;
class ReceiverSocket extends WebSocket{constructor(...args){super(...args);receiverSocket=this;}}
const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},realtime:{transport:WebSocket,timeout:8000}};
const a=createClient(url,key,options),b=createClient(url,key,{...options,realtime:{...options.realtime,transport:ReceiverSocket}});
const topic='nexo-recovery-probe:'+crypto.randomUUID(),nonce=crypto.randomUUID();
const states={sender:[],receiver:[]};let timer,recovered,delivered,dropped=false,dropAt;
function deadline(promise){return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('deadline')),25000);})]);}
try{
 const sender=a.channel(topic,{config:{broadcast:{ack:true}}});
 const receiver=b.channel(topic);
 const recovery=new Promise(resolve=>{recovered=resolve;});
 const delivery=new Promise(resolve=>{delivered=resolve;});
 receiver.on('broadcast',{event:'recovery_probe'},({payload})=>{if(payload?.nonce===nonce)delivered(true);});
 const joins=Promise.all([new Promise(resolve=>sender.subscribe(status=>{states.sender.push(status);if(status==='SUBSCRIBED')resolve();})),new Promise(resolve=>receiver.subscribe(status=>{states.receiver.push(status);if(status==='SUBSCRIBED'){if(dropped)recovered();else resolve();}}))]);
 await deadline(joins);clearTimeout(timer);
 if(!receiverSocket)throw Error('probe_socket_unavailable');
 dropped=true;dropAt=performance.now();receiverSocket.close(4001,'synthetic probe interruption');
 await deadline(recovery);clearTimeout(timer);
 const recoveryMs=Math.round(performance.now()-dropAt);
 const send=await sender.send({type:'broadcast',event:'recovery_probe',payload:{nonce}});
 await deadline(delivery);clearTimeout(timer);
 console.log(JSON.stringify({kind:'synthetic_broadcast_recovery_only',recovered:true,send,delivered:true,recoveryMs,states}));
}catch{console.log(JSON.stringify({kind:'synthetic_broadcast_recovery_only',recovered:false,states}));process.exitCode=1;}
finally{clearTimeout(timer);await Promise.allSettled([a.removeAllChannels(),b.removeAllChannels()]);a.realtime.disconnect();b.realtime.disconnect();}
