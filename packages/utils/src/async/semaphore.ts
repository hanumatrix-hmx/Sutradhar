/**
 * @file packages/utils/src/async/semaphore.ts
 * @description Non-blocking async Semaphore for resource concurrency limiting.
 */

export class Semaphore {
  private currentPermits: number;
  private readonly queue: Array<(releaser: () => void) => void> = [];

  public constructor(public readonly maxPermits: number) {
    if (maxPermits <= 0) {
      throw new Error('Semaphore maxPermits must be greater than 0');
    }
    this.currentPermits = maxPermits;
  }

  public acquire(): Promise<() => void> {
    return new Promise((resolve) => {
      const releaser = (): void => {
        if (this.queue.length > 0) {
          const next = this.queue.shift();
          if (next) {
            next(releaser);
          }
        } else {
          this.currentPermits++;
        }
      };

      if (this.currentPermits > 0) {
        this.currentPermits--;
        resolve(releaser);
      } else {
        this.queue.push(resolve);
      }
    });
  }

  public async runExclusive<T>(task: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await task();
    } finally {
      release();
    }
  }

  public getAvailablePermits(): number {
    return this.currentPermits;
  }
}
