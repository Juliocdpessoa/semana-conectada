import {sendPerformanceSample} from './performance-send';
import {currentTelemetryToken} from './access-diagnostics-client';
import { createPerformanceSampler, type PerformanceOperation } from "./performance-policy";
import type { RealtimeHealthOperation } from './realtime-health';
const sample = createPerformanceSampler();
export function reportPerformance(
  operation: PerformanceOperation,
  elapsed: number,
  success: boolean,
) {
  if (typeof window === "undefined" || !Number.isFinite(elapsed) || !sample(operation, success))
    return;
  sendSample(operation,Math.min(120000,Math.max(0,Math.round(elapsed))),success);
}
let healthWindow=0,healthCount=0;
export function reportRealtimeHealth(operation:RealtimeHealthOperation,elapsed:number,success:boolean){
 if(typeof window==='undefined'||!Number.isFinite(elapsed))return;
 const now=Date.now();if(now-healthWindow>=600000){healthWindow=now;healthCount=0;}
 if(healthCount>=12)return;healthCount++;
 sendSample(operation,Math.min(86400000,Math.max(0,Math.round(elapsed))),success);
}
function sendSample(operation:PerformanceOperation|RealtimeHealthOperation,elapsed:number,success:boolean){
  // Fire-and-forget, bounded, cancellable and deliberately not retried.
  void (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
      await sendPerformanceSample({
          operation,
          durationMs: elapsed,
          success,
      },currentTelemetryToken(),controller.signal);
    } catch {
      /* Telemetry must never break the user's work. */
    } finally {
      clearTimeout(timer);
    }
  })();
}
