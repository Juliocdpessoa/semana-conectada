import { recordPerformanceSample } from "./performance.functions";
import { createPerformanceSampler, type PerformanceOperation } from "./performance-policy";
const sample = createPerformanceSampler();
export function reportPerformance(
  operation: PerformanceOperation,
  elapsed: number,
  success: boolean,
) {
  if (typeof window === "undefined" || !Number.isFinite(elapsed) || !sample(operation, success))
    return;
  // Fire-and-forget, bounded, cancellable and deliberately not retried.
  void (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
      await recordPerformanceSample({
        data: {
          operation,
          durationMs: Math.min(120000, Math.max(0, Math.round(elapsed))),
          success,
        },
        signal: controller.signal,
      });
    } catch {
      /* Telemetry must never break the user's work. */
    } finally {
      clearTimeout(timer);
    }
  })();
}
