/**
 * @file packages/browser/tests/unit/page-settle.spec.ts
 * @description FR2-08: the extracted settle wait, and its NODE-SIDE hard bound (T5/D14).
 */

import { DEFAULT_SETTLE_SPEC, SETTLE_HARD_BOUND_GRACE_MS, resolveSettleSpec, waitForPageSettle } from '../../src/index.js';
import type { Page } from 'puppeteer-core';

const asPage = (p: unknown): Page => p as Page;

describe('FR2-08 page-settle', () => {
  it('P1: resolveSettleSpec', () => {
    expect(resolveSettleSpec(undefined)).toBeNull();
    expect(resolveSettleSpec(false)).toBeNull();
    expect(resolveSettleSpec(true)).toEqual({ mutationQuietMs: 300, networkIdleMs: 500, timeoutMs: 5000 });
    expect(resolveSettleSpec({ mutationQuietMs: 100 })).toEqual({ mutationQuietMs: 100, networkIdleMs: 500, timeoutMs: 5000 });
    // an explicitly-undefined field does not wipe its default
    expect(resolveSettleSpec({ timeoutMs: undefined, networkIdleMs: 9 })).toEqual({ mutationQuietMs: 300, networkIdleMs: 9, timeoutMs: 5000 });
    expect(DEFAULT_SETTLE_SPEC).toEqual({ mutationQuietMs: 300, networkIdleMs: 500, timeoutMs: 5000 });
  });

  it('P2: settle:true makes exactly one evaluate(fn, 300, 5000) and one waitForNetworkIdle({500, 5000})', async () => {
    const evaluate = vi.fn().mockResolvedValue(undefined);
    const waitForNetworkIdle = vi.fn().mockResolvedValue(undefined);
    await waitForPageSettle(asPage({ evaluate, waitForNetworkIdle }), true);
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(evaluate).toHaveBeenCalledWith(expect.any(Function), 300, 5000);
    expect(waitForNetworkIdle).toHaveBeenCalledTimes(1);
    expect(waitForNetworkIdle).toHaveBeenCalledWith({ idleTime: 500, timeout: 5000 });
  });

  it('P3: hard bound: evaluate and waitForNetworkIdle never resolve -> returns by timeoutMs + grace, no unhandled rejection', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown): void => void unhandled.push(e);
    process.on('unhandledRejection', onUnhandled);
    try {
      let rejectEval: (e: Error) => void = () => undefined;
      const page = {
        evaluate: vi.fn(() => new Promise((_r, rej) => (rejectEval = rej))),
        waitForNetworkIdle: vi.fn(() => new Promise(() => {})),
      };
      const t0 = performance.now();
      await waitForPageSettle(asPage(page), { timeoutMs: 100 });
      const dt = performance.now() - t0;
      expect(dt).toBeGreaterThanOrEqual(100 + SETTLE_HARD_BOUND_GRACE_MS - 20); // it waited for the bound, not less
      rejectEval(new Error('late'));
      await new Promise((r) => setTimeout(r, 30));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  }, 10000);

  it('P4: rejections from either half are swallowed', async () => {
    const page = {
      evaluate: vi.fn().mockRejectedValue(new Error('Execution context was destroyed')),
      waitForNetworkIdle: vi.fn().mockRejectedValue(new Error('Waiting for network idle failed: timeout')),
    };
    await expect(waitForPageSettle(asPage(page), true)).resolves.toBeUndefined();
    const throwing = {
      evaluate: vi.fn(() => {
        throw new Error('sync throw');
      }),
      waitForNetworkIdle: vi.fn(() => {
        throw new Error('sync throw');
      }),
    };
    await expect(waitForPageSettle(asPage(throwing), true)).resolves.toBeUndefined();
  });

  it('P5: no settle -> no page calls at all', async () => {
    const page = { evaluate: vi.fn(), waitForNetworkIdle: vi.fn() };
    await waitForPageSettle(asPage(page), undefined);
    await waitForPageSettle(asPage(page), false);
    expect(page.evaluate).not.toHaveBeenCalled();
    expect(page.waitForNetworkIdle).not.toHaveBeenCalled();
  });

  it('P6: the hard-bound timer is cleared on normal completion', async () => {
    vi.useFakeTimers();
    try {
      const page = { evaluate: vi.fn().mockResolvedValue(undefined), waitForNetworkIdle: vi.fn().mockResolvedValue(undefined) };
      await waitForPageSettle(asPage(page), true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
