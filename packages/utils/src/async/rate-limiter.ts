/**
 * @file packages/utils/src/async/rate-limiter.ts
 * @description Token bucket RateLimiter for throttling API & LLM calls.
 */

export interface RateLimiterOptions {
  readonly tokensPerInterval: number;
  readonly intervalMs: number;
}

export class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly tokensPerInterval: number;
  private readonly intervalMs: number;

  public constructor(options: RateLimiterOptions) {
    if (options.tokensPerInterval <= 0 || options.intervalMs <= 0) {
      throw new Error('RateLimiter tokensPerInterval and intervalMs must be greater than 0');
    }
    this.tokensPerInterval = options.tokensPerInterval;
    this.intervalMs = options.intervalMs;
    this.tokens = options.tokensPerInterval;
    this.lastRefill = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    if (elapsed > this.intervalMs) {
      const refillCount = Math.floor(elapsed / this.intervalMs) * this.tokensPerInterval;
      this.tokens = Math.min(this.tokensPerInterval, this.tokens + refillCount);
      this.lastRefill = now;
    }
  }

  public tryRemoveToken(count = 1): boolean {
    this.refill();
    if (this.tokens >= count) {
      this.tokens -= count;
      return true;
    }
    return false;
  }

  public async removeToken(count = 1): Promise<void> {
    while (!this.tryRemoveToken(count)) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  public getAvailableTokens(): number {
    this.refill();
    return this.tokens;
  }
}
