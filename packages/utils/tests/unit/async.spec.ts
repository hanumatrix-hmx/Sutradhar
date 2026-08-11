/**
 * @file packages/utils/tests/unit/async.spec.ts
 * @description Unit tests for Mutex, Semaphore, retryWithBackoff, and RateLimiter.
 */

import { Mutex, Semaphore, retryWithBackoff, RateLimiter } from '../../src/index.js';

describe('Async Control & Rate Limiter Utilities', () => {
  it('should synchronize execution via Mutex', async () => {
    const mutex = new Mutex();
    const executionOrder: number[] = [];

    const task1 = mutex.runExclusive(async () => {
      await new Promise((r) => setTimeout(r, 20));
      executionOrder.push(1);
    });

    const task2 = mutex.runExclusive(async () => {
      executionOrder.push(2);
    });

    await Promise.all([task1, task2]);
    expect(executionOrder).toEqual([1, 2]);
  });

  it('should limit concurrency via Semaphore', async () => {
    const semaphore = new Semaphore(2);
    expect(semaphore.getAvailablePermits()).toBe(2);

    const release1 = await semaphore.acquire();
    expect(semaphore.getAvailablePermits()).toBe(1);

    const release2 = await semaphore.acquire();
    expect(semaphore.getAvailablePermits()).toBe(0);

    release1();
    expect(semaphore.getAvailablePermits()).toBe(1);
    release2();
    expect(semaphore.getAvailablePermits()).toBe(2);
  });

  it('should retry failed tasks with retryWithBackoff', async () => {
    let attempts = 0;
    const task = async (): Promise<string> => {
      attempts++;
      if (attempts < 3) {
        throw new Error('Transient failure');
      }
      return 'success';
    };

    const result = await retryWithBackoff(task, {
      maxRetries: 3,
      initialDelayMs: 10,
    });

    expect(result).toBe('success');
    expect(attempts).toBe(3);
  });

  it('should throttle tokens via RateLimiter', async () => {
    const limiter = new RateLimiter({ tokensPerInterval: 2, intervalMs: 100 });
    expect(limiter.tryRemoveToken()).toBe(true);
    expect(limiter.tryRemoveToken()).toBe(true);
    expect(limiter.tryRemoveToken()).toBe(false);
  });
});
