export type RsTransportResult = {
  data: any;
  error: { message: string; code?: string; status?: number } | null;
};
// Lazy/cancellable and single-attempt, including ambiguous write outcomes.
export function createRsRequest(
  call: (signal?: AbortSignal) => Promise<RsTransportResult>,
  mutation = false,
) {
  let signal: AbortSignal | undefined, promise: Promise<RsTransportResult> | undefined;
  const execute = () =>
    (promise ??= Promise.resolve()
      .then(() => call(signal))
      .catch(() => ({
        data: null,
        error: {
          message: mutation
            ? "Não foi possível confirmar o salvamento. Atualize os dados antes de tentar novamente."
            : "Não foi possível carregar os dados. Tente novamente.",
        },
      })));
  return {
    abortSignal(value: AbortSignal) {
      signal = value;
      return this;
    },
    then<A = RsTransportResult, B = never>(
      fulfilled?: ((value: RsTransportResult) => A | PromiseLike<A>) | null,
      rejected?: ((reason: any) => B | PromiseLike<B>) | null,
    ) {
      return execute().then(fulfilled, rejected);
    },
  };
}
