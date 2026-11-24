/** One invocation-local content recovery budget. Never wrap persistence or sends.
 * Nested generation validators share this object, so they cannot stack retries. */
export function createGenerationRecovery(signal?: AbortSignal) {
  let recoveryUsed = false;
  return {
    async run<T>(operation: () => Promise<T>, beforeAttempt?: () => Promise<unknown>): Promise<T> {
      signal?.throwIfAborted();
      await beforeAttempt?.();
      signal?.throwIfAborted();
      try { return await operation(); }
      catch (error) {
        if (recoveryUsed || signal?.aborted) throw error;
        recoveryUsed = true;
        await beforeAttempt?.();
        signal?.throwIfAborted();
        return operation();
      }
    },
  };
}
export type GenerationRecovery = ReturnType<typeof createGenerationRecovery>;
