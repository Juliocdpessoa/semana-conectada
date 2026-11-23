// Share only an in-flight SDK operation, never a resolved session/access grant.
// Route retries cannot start another refresh while the first is still pending.
export function singleFlight<T>(run: () => PromiseLike<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () => {
    if (!pending) {
      pending = Promise.resolve().then(run).finally(() => { pending = undefined; });
    }
    return pending;
  };
}
