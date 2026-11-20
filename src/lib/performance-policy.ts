export type PerformanceOperation = "activities_list" | "activities_filter";
export function performanceOperation(filters: Record<string, unknown>): PerformanceOperation {
  return Object.entries(filters).some(
    ([key, value]) =>
      key !== "sapStatusById" &&
      (Array.isArray(value)
        ? value.length > 0
        : typeof value === "string"
          ? value !== "" && value !== "all"
          : value === true),
  )
    ? "activities_filter"
    : "activities_list";
}
// One minute per operation/tab; no queue, raw errors, task values or retry storm.
export function createPerformanceSampler(now = Date.now, random = Math.random) {
  const last = new Map<PerformanceOperation, number>();
  return (operation: PerformanceOperation, success: boolean) => {
    const current = now();
    if (last.has(operation) && current - last.get(operation)! < 60_000) return false;
    if (last.has(operation) && success && random() > 0.2) return false;
    last.set(operation, current);
    return true;
  };
}
