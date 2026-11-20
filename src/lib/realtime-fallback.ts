type Options = {
  refresh: () => Promise<unknown>;
  canRefresh: () => boolean;
  onFallback?: (active: boolean) => void;
  setTimer?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
  random?: () => number;
  now?: () => number;
};

/** Bounded read-only fallback. No polling on a healthy channel, no overlapping
 * requests, no work in hidden/offline tabs, and jitter between affected clients. */
export function createRealtimeFallback(options: Options) {
  const setTimer = options.setTimer ?? setTimeout;
  const clearTimer = options.clearTimer ?? clearTimeout;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let healthy = false, disposed = false, running = false, disconnected = false;
  let lastStartedAt: number | undefined;
  function cancel() { if (timer !== undefined) clearTimer(timer); timer = undefined; }
  function schedule() {
    if (disposed || healthy || timer !== undefined || running) return;
    timer = setTimer(() => { timer = undefined; void run(); }, 60_000 + Math.floor((options.random ?? Math.random)() * 20_000));
  }
  async function run() {
    if (disposed || running) return;
    if (!options.canRefresh()) { schedule(); return; }
    running = true;
    lastStartedAt = (options.now ?? Date.now)();
    if (!healthy) options.onFallback?.(true);
    try { await options.refresh(); } catch { /* Keep saved data/drafts and retry only at the bounded interval. */ }
    finally { running = false; schedule(); }
  }
  schedule(); // Also covers a channel that never finishes connecting.
  return {
    status(status: string) {
      if (disposed) return;
      if (status === "SUBSCRIBED") {
        healthy = true; cancel(); options.onFallback?.(false);
        if (disconnected) { disconnected = false; void run(); }
      } else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
        healthy = false; disconnected = true; options.onFallback?.(true); schedule();
      }
    },
    resume() {
      if (disposed || running || !options.canRefresh()) return;
      if (lastStartedAt !== undefined && (options.now ?? Date.now)() - lastStartedAt < 15_000) return;
      cancel(); void run();
    },
    dispose() { disposed = true; cancel(); },
  };
}
