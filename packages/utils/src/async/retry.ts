/**
 * @file packages/utils/src/async/retry.ts
 * @description Exponential backoff retry utility with jitter.
 */

export interface RetryOptions {
  readonly maxRetries?: number;
  readonly initialDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly backoffFactor?: number;
  readonly shouldRetry?: (error: unknown) => boolean;
}

export async function retryWithBackoff<T>(
  task: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? 3;
  const initialDelayMs = options.initialDelayMs ?? 100;
  const maxDelayMs = options.maxDelayMs ?? 5000;
  const backoffFactor = options.backoffFactor ?? 2;
  const shouldRetry = options.shouldRetry ?? ((): boolean => true);

  let attempt = 0;
  let delay = initialDelayMs;
  let lastError: unknown;

  while (attempt <= maxRetries) {
    try {
      return await task();
    } catch (error: unknown) {
      lastError = error;
      attempt++;
      if (attempt > maxRetries || !shouldRetry(error)) {
        throw error;
      }

      // Calculate exponential delay with +/- 20% jitter
      const jitter = delay * 0.2 * (Math.random() * 2 - 1);
      const sleepTime = Math.min(Math.max(0, delay + jitter), maxDelayMs);

      await new Promise((resolve) => setTimeout(resolve, sleepTime));
      delay *= backoffFactor;
    }
  }

  throw lastError;
}
