// Temporary anonymous channel only. Never reads/writes business rows or logs keys/tokens.
const {createClient}=await import(process.argv.includes('--locked-sdk')
 ? '../.audit-tmp/realtime-runtime/node_modules/@supabase/supabase-js/dist/index.mjs'
 : '@supabase/supabase-js');
const url=process.env.VITE_SUPABASE_URL;
const key=process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
if(!url||!key)throw Error('Public configuration missing');
const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},realtime:{timeout:8000}};
const a=createClient(url,key,options),b=createClient(url,key,options);
const topic='nexo-connectivity-probe:'+crypto.randomUUID();
const nonce=crypto.randomUUID();
const states={sender:[],receiver:[]};
function join(channel,label){return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('probe_timeout')),12000);
  channel.subscribe(status=>{states[label].push(status);if(status==='SUBSCRIBED'){clearTimeout(timer);resolve();}
    else if(['CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(status)){clearTimeout(timer);reject(Error(status));}});
});}
let receiveTimer;
try{
 const sender=a.channel(topic,{config:{broadcast:{ack:true}}});
 const receiver=b.channel(topic,{config:{broadcast:{self:false}}});
 let delivered;
 const receipt=new Promise(resolve=>{delivered=resolve;receiveTimer=setTimeout(()=>resolve(false),8000);});
 receiver.on('broadcast',{event:'connectivity_probe'},({payload})=>{if(payload?.probe===nonce)delivered(true);});
 const started=performance.now();
 await Promise.all([join(sender,'sender'),join(receiver,'receiver')]);
 const send=await sender.send({type:'broadcast',event:'connectivity_probe',payload:{probe:nonce}});
 const received=await receipt;
 let race;
 if(process.argv.includes('--rejoin-race')){
   const leaving=a.removeChannel(sender);
   const next=a.channel(topic);
   const reused=next===sender;
   let duplicateSubscribe=false;
   try{next.subscribe();}catch(error){duplicateSubscribe=/subscribe.*multiple|multiple.*subscribe|subscribe.*once/i.test(error?.message??'');}
   await leaving;
   race={reused,duplicateSubscribe};
 }
 console.log(JSON.stringify({kind:'synthetic_broadcast_only',joined:true,send,received,elapsedMs:Math.round(performance.now()-started),states,race}));
 if(!received)process.exitCode=1;
}catch(error){
 console.log(JSON.stringify({kind:'synthetic_broadcast_only',joined:false,error:['probe_timeout','CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(error?.message)?error.message:'transport_failure',states}));
 process.exitCode=1;
}finally{
 clearTimeout(receiveTimer);
 await Promise.all([a.removeAllChannels(),b.removeAllChannels()]);
}
