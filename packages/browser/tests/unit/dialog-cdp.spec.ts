/**
 * @file packages/browser/tests/unit/dialog-cdp.spec.ts
 * @description FR2-04: unit tests for the raw-CDP dialog primitives (dialog-cdp.ts), using fake
 * CDPSession-shaped EventEmitters — never a real Puppeteer Page/Browser.
 */
import { EventEmitter } from 'node:events';
import {
  connectForDialogs,
  listPageTargets,
  livenessProbe,
  collectDialogEvents,
  handleDialogOnTarget,
} from '../../src/session/dialog-cdp.js';

function fakeSession() {
  const emitter = new EventEmitter();
  const send = vi.fn();
  return {
    send,
    on: (event: string, cb: (...args: any[]) => void) => emitter.on(event, cb),
    off: (event: string, cb: (...args: any[]) => void) => emitter.off(event, cb),
    emit: (event: string, payload: unknown) => emitter.emit(event, payload),
  } as any;
}

describe('@sutradhar/browser dialog-cdp (FR2-04)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('B1: collectDialogEvents returns an opening event emitted after Page.enable, within listenMs', async () => {
    const session = fakeSession();
    session.send.mockImplementation((method: string) => {
      if (method === 'Page.enable') return new Promise(() => {}); // never resolves (Step 1 E2)
      return Promise.resolve();
    });
    const promise = collectDialogEvents(session, { targetId: 't1', url: 'https://x/' }, 400);
    setTimeout(() => session.emit('Page.javascriptDialogOpening', { type: 'confirm', message: 'm', defaultPrompt: undefined }), 50);
    await vi.advanceTimersByTimeAsync(400);
    const events = await promise;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'confirm', message: 'm', targetId: 't1', url: 'https://x/', source: 'event' });
  });

  it('B1b: an empty result (no event) is itself a valid, non-throwing observation', async () => {
    const session = fakeSession();
    session.send.mockResolvedValue(undefined);
    const promise = collectDialogEvents(session, { targetId: 't1', url: 'https://x/' }, 400);
    await vi.advanceTimersByTimeAsync(400);
    expect(await promise).toEqual([]);
  });

  describe('B2: livenessProbe', () => {
    // FR2-04 fix-2/GAP-228: the probe signal changed from `Runtime.evaluate` to
    // `Performance.getMetrics` — audit-2's signal research (and fix-2's own re-verification,
    // evidence/FR2-04/fix-2/signal-reverify/) found `Runtime.evaluate` is NOT decidable (it times
    // out under both a real dialog AND a busy synchronous script), whereas `Performance.getMetrics`
    // answers under a busy script but times out under every dialog type.
    it('resolves -> responsive', async () => {
      const session = fakeSession();
      session.send.mockResolvedValue({ metrics: [] });
      expect(await livenessProbe(session, 1000)).toBe('responsive');
      expect(session.send).toHaveBeenCalledWith('Performance.getMetrics', undefined, { timeout: 1000 });
    });

    it('a "timed out" rejection -> blocked', async () => {
      const session = fakeSession();
      session.send.mockRejectedValue(new Error('Performance.getMetrics timed out'));
      expect(await livenessProbe(session, 1000)).toBe('blocked');
    });

    it('any other rejection -> error', async () => {
      const session = fakeSession();
      session.send.mockRejectedValue(new Error('Session closed'));
      expect(await livenessProbe(session, 1000)).toBe('error');
    });
  });

  it('B3: handleDialogOnTarget sends the exact CDP call and propagates a raw rejection unchanged', async () => {
    const session = fakeSession();
    session.send.mockResolvedValue(undefined);
    await handleDialogOnTarget(session, true, 'x', 5000);
    expect(session.send).toHaveBeenCalledWith('Page.handleJavaScriptDialog', { accept: true, promptText: 'x' }, { timeout: 5000 });

    const session2 = fakeSession();
    session2.send.mockRejectedValue(new Error('No dialog is showing'));
    await expect(handleDialogOnTarget(session2, false, undefined, 5000)).rejects.toThrow('No dialog is showing');
  });

  describe('B4: connectForDialogs', () => {
    it('a rejecting connect returns undefined, never throws', async () => {
      const result = await connectForDialogs('ws://x', 1000, async () => {
        throw new Error('ECONNREFUSED');
      });
      expect(result).toBeUndefined();
    });

    it('a connect that never resolves returns undefined at the timeout', async () => {
      const p = connectForDialogs('ws://x', 1000, () => new Promise(() => {}));
      await vi.advanceTimersByTimeAsync(1000);
      expect(await p).toBeUndefined();
    });

    it('a resolving connect returns the browser', async () => {
      const fakeBrowser = { id: 'b1' } as any;
      const result = await connectForDialogs('ws://x', 1000, async () => fakeBrowser);
      expect(result).toBe(fakeBrowser);
    });
  });

  it('B5: listPageTargets drops about:blank and non-page targets, keeps targets() order', () => {
    const targets = [
      { type: () => 'page', url: () => 'about:blank', _targetId: 'blank' },
      { type: () => 'page', url: () => 'https://a/', _targetId: 'a' },
      { type: () => 'service_worker', url: () => 'https://sw/', _targetId: 'sw' },
      { type: () => 'page', url: () => 'https://b/', _targetId: 'b' },
    ];
    const browser = { targets: () => targets } as any;
    const result = listPageTargets(browser);
    expect(result.map((r) => r.info.targetId)).toEqual(['a', 'b']);
    expect(result.map((r) => r.info.url)).toEqual(['https://a/', 'https://b/']);
  });
});
