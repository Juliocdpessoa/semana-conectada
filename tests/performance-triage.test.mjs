import test from 'node:test';
import assert from 'node:assert/strict';
import {occurrenceTriage,performanceTriage} from '../src/lib/performance-triage.ts';
const base=()=>({groups:[],metrics:[],database:null});
test('transport, timeout and close are not automatically normal or persistent outages',()=>{
 for(const reason of ['transport','timeout','closed','unknown',null])assert.equal(occurrenceTriage({stage:'realtime',category:'network',realtime_reason:reason}).kind,'unknown');
 for(const reason of ['jwt','authorization','quota','replication'])assert.equal(occurrenceTriage({stage:'realtime',category:'auth',realtime_reason:reason}).kind,'attention');
 assert.equal(occurrenceTriage({stage:'password',category:'timeout',realtime_reason:null}).kind,'attention');
});
test('unknown counts and recoveries stay independent without a false recovery percentage',()=>{
 const result=performanceTriage({...base(),groups:[{stage:'realtime',category:'network',realtime_reason:'transport',total:13}],metrics:[{operation:'realtime_recovery',samples:20,failures:1},{operation:'activities_filter',samples:17,failures:1}]});
 assert.deepEqual(result,{readFailures:1,attentionDiagnostics:0,unconfirmedRealtime:13,recoveries:19,databaseAttention:false});
});
test('missing data is not healthy proof; no inferred recoveries or calls',()=>{
 assert.deepEqual(performanceTriage(base()),{readFailures:0,attentionDiagnostics:0,unconfirmedRealtime:0,recoveries:0,databaseAttention:false});
});
test('database concern uses current supplied values only and excludes unrelated metrics',()=>{
 for(const db of [{lockWaits:1,slowRequests:0,activeSlots:2,totalSlots:2},{lockWaits:0,slowRequests:1,activeSlots:2,totalSlots:2},{lockWaits:0,slowRequests:0,activeSlots:1,totalSlots:2}])assert.equal(performanceTriage({...base(),database:db}).databaseAttention,true);
 const result=performanceTriage({...base(),metrics:[{operation:'realtime_disconnect',samples:10,failures:10}]});assert.equal(result.readFailures,0);
});
