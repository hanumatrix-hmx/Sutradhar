/**
 * @file packages/utils/src/async/mutex.ts
 * @description Non-blocking async Mutex lock for TypeScript concurrency control.
 */

export class Mutex {
  private locked = false;
  private readonly queue: Array<(releaser: () => void) => void> = [];

  /**
   * Acquires the mutex lock. Returns a releaser function to unlock.
   */
  public acquire(): Promise<() => void> {
    return new Promise((resolve) => {
      const releaser = (): void => {
        if (this.queue.length > 0) {
          const next = this.queue.shift();
          if (next) {
            next(releaser);
          }
        } else {
          this.locked = false;
        }
      };

      if (this.locked) {
        this.queue.push(resolve);
      } else {
        this.locked = true;
        resolve(releaser);
      }
    });
  }

  /**
   * Executes an async task exclusively within the mutex lock.
   */
  public async runExclusive<T>(task: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await task();
    } finally {
      release();
    }
  }

  public isLocked(): boolean {
    return this.locked;
  }
}
