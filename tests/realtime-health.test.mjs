import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRealtimeHealth} from '../src/lib/realtime-health.ts';
test('records initial connection, one outage and recovery duration, not repeated error callbacks',()=>{
 let now=0;const events=[];const health=createRealtimeHealth((...event)=>events.push(event),()=>now);
 now=300;health.status('SUBSCRIBED');health.status('SUBSCRIBED');
 now=1000;health.status('CHANNEL_ERROR');now=2000;health.status('TIMED_OUT');
 now=4000;health.status('SUBSCRIBED');health.status('SUBSCRIBED');
 assert.deepEqual(events,[['realtime_connect',300,true],['realtime_disconnect',0,false],['realtime_recovery',3000,true]]);
});
test('initial failure is not reported as a healthy initial connection',()=>{
 let now=0;const events=[];const health=createRealtimeHealth((...event)=>events.push(event),()=>now);
 health.status('TIMED_OUT');now=15000;health.status('SUBSCRIBED');
 assert.deepEqual(events,[['realtime_disconnect',0,false],['realtime_recovery',15000,true]]);
});
test('telemetry failure cannot stop the channel status handler',()=>{
 const health=createRealtimeHealth(()=>{throw Error('telemetry unavailable');},()=>0);
 assert.doesNotThrow(()=>{health.status('CHANNEL_ERROR');health.status('SUBSCRIBED');});
});
