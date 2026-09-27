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
  attributeDialogHolders,
  probeTargetsConcurrently,
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

  it('B5 (FR2-04 fix-3/GAP-238): listPageTargets KEEPS about:blank page targets (only drops non-page targets), keeps targets() order', () => {
    // fix-2 excluded about:blank here; fix-3 removes that exclusion — audit-3 found it made the
    // exact popup-left-as-blank-after-recovery shape (GAP-238) invisible to every later gate check.
    const targets = [
      { type: () => 'page', url: () => 'about:blank', _targetId: 'blank' },
      { type: () => 'page', url: () => 'https://a/', _targetId: 'a' },
      { type: () => 'service_worker', url: () => 'https://sw/', _targetId: 'sw' },
      { type: () => 'page', url: () => 'https://b/', _targetId: 'b' },
    ];
    const browser = { targets: () => targets } as any;
    const result = listPageTargets(browser);
    expect(result.map((r) => r.info.targetId)).toEqual(['blank', 'a', 'b']);
    expect(result.map((r) => r.info.url)).toEqual(['about:blank', 'https://a/', 'https://b/']);
  });

  it('B6 (FR2-04 fix-3/GAP-236): listPageTargets populates openerTargetId from Target.opener(), and leaves it undefined when opener() is absent or returns nothing', () => {
    const opener = { type: () => 'page', url: () => 'https://opener/', _targetId: 'opener-id' };
    const popup = {
      type: () => 'page',
      url: () => 'about:blank',
      _targetId: 'popup-id',
      opener: () => opener,
    };
    const noOpenerMethod = { type: () => 'page', url: () => 'https://solo/', _targetId: 'solo' };
    const openerMethodReturnsUndefined = { type: () => 'page', url: () => 'https://x/', _targetId: 'x', opener: () => undefined };
    const browser = { targets: () => [opener, popup, noOpenerMethod, openerMethodReturnsUndefined] } as any;
    const result = listPageTargets(browser);
    expect(result.find((r) => r.info.targetId === 'popup-id')?.info.openerTargetId).toBe('opener-id');
    expect(result.find((r) => r.info.targetId === 'opener-id')?.info.openerTargetId).toBeUndefined();
    expect(result.find((r) => r.info.targetId === 'solo')?.info.openerTargetId).toBeUndefined();
    expect(result.find((r) => r.info.targetId === 'x')?.info.openerTargetId).toBeUndefined();
  });

  describe('B7 (FR2-04 fix-3/GAP-236, escalation-1 decision 1): attributeDialogHolders', () => {
    it('an isolated blocked target (no opener relation to any other blocked target) is its own holder', () => {
      const result = attributeDialogHolders([{ targetId: 't1' }]);
      expect(result.get('t1')).toEqual({ blockedBy: undefined, confirmedSafe: false });
    });

    it('two independent blocked targets with no opener relation are both their own holders (the multi-unknown shape)', () => {
      const result = attributeDialogHolders([{ targetId: 't1' }, { targetId: 't2' }]);
      expect(result.get('t1')?.blockedBy).toBeUndefined();
      expect(result.get('t2')?.blockedBy).toBeUndefined();
    });

    it('a popup and its blocked opener: the popup (child) is the holder, the opener is attributed to it — GAP-236\'s exact shape', () => {
      const result = attributeDialogHolders([
        { targetId: 'opener' },
        { targetId: 'popup', openerTargetId: 'opener' },
      ]);
      expect(result.get('popup')?.blockedBy).toBeUndefined(); // popup is the holder
      expect(result.get('opener')?.blockedBy).toBe('popup'); // opener is collaterally blocked BY the popup
      expect(result.get('popup')?.confirmedSafe).toBe(false);
      expect(result.get('opener')?.confirmedSafe).toBe(false);
    });

    it('a 3-level chain (grandopener -> opener -> popup, all blocked) resolves to the leaf popup as the holder', () => {
      const result = attributeDialogHolders([
        { targetId: 'grand' },
        { targetId: 'opener', openerTargetId: 'grand' },
        { targetId: 'popup', openerTargetId: 'opener' },
      ]);
      expect(result.get('popup')?.blockedBy).toBeUndefined();
      expect(result.get('opener')?.blockedBy).toBe('popup');
      expect(result.get('grand')?.blockedBy).toBe('popup');
    });

    it('an opener with an UNBLOCKED popup (not in the blocked set) is its own holder — the opener relation only matters when both are actually blocked', () => {
      const result = attributeDialogHolders([{ targetId: 'opener' }]);
      expect(result.get('opener')?.blockedBy).toBeUndefined();
    });

    it('several blocked children of one blocked opener: the newest (by discoveredAt) is preferred as the holder', () => {
      const result = attributeDialogHolders([
        { targetId: 'opener' },
        { targetId: 'popup-old', openerTargetId: 'opener', discoveredAt: 100 },
        { targetId: 'popup-new', openerTargetId: 'opener', discoveredAt: 200 },
      ]);
      expect(result.get('popup-new')?.blockedBy).toBeUndefined();
      expect(result.get('popup-old')?.blockedBy).toBe('popup-new');
      expect(result.get('opener')?.blockedBy).toBe('popup-new');
    });

    // FR2-04 escalation-1, decision 1 (GAP-245): a confirmed-safe target must NEVER be treated as
    // (or point to) a holder just because a sibling exists — this is the exact xhr-popup-manual
    // shape audit-4's A4-02 found: a same-renderer popup (here confirmed-safe, having been probed
    // responsive before the opener's blocking script ran) and its busy opener, with no dialog
    // anywhere. GAP-249's A13 (warden drops discoveredAt) and A20 (selectDialog picks a collateral
    // entry) are also killed by these same assertions failing if either regresses.
    it('GAP-245: a confirmed-safe target is never a holder, even with a never-confirmed sibling relationship', () => {
      const result = attributeDialogHolders([
        { targetId: 'opener', confirmedSafe: true },
        { targetId: 'popup', openerTargetId: 'opener', confirmedSafe: true },
      ]);
      expect(result.get('opener')).toEqual({ blockedBy: undefined, confirmedSafe: true });
      expect(result.get('popup')).toEqual({ blockedBy: undefined, confirmedSafe: true });
    });

    it('GAP-245 variant: a confirmed-safe opener with a NEVER-CONFIRMED popup — the popup remains the candidate holder, the opener stays confirmed-safe and points at it only informationally', () => {
      const result = attributeDialogHolders([
        { targetId: 'opener', confirmedSafe: true },
        { targetId: 'popup', openerTargetId: 'opener', confirmedSafe: false },
      ]);
      expect(result.get('popup')).toEqual({ blockedBy: undefined, confirmedSafe: false });
      expect(result.get('opener')).toEqual({ blockedBy: 'popup', confirmedSafe: true });
    });

    // FR2-04 escalation-1, decision 2 (GAP-246): a never-confirmed target with NO sibling at all is
    // now eligible to be its OWN holder (fix-3's old "isolated -> refuse" rule is gone) — this is
    // the target=_blank / cross-site-popup shape that alerts during its very first script, which
    // the warden's Page.enable race can miss entirely.
    it('GAP-246: an isolated, never-confirmed target is still its own eligible holder (no longer refused for lack of a sibling)', () => {
      const result = attributeDialogHolders([{ targetId: 'lone', confirmedSafe: false }]);
      expect(result.get('lone')).toEqual({ blockedBy: undefined, confirmedSafe: false });
    });

    it('GAP-246 contrast: an isolated, CONFIRMED-safe target is never eligible (busy, but proven not a dialog)', () => {
      const result = attributeDialogHolders([{ targetId: 'lone', confirmedSafe: true }]);
      expect(result.get('lone')).toEqual({ blockedBy: undefined, confirmedSafe: true });
    });

    // FR2-04 escalation-1: found LIVE (attrib-attack-probe.mjs's rapid-gap100, re-verifying
    // GAP-245) — an EARLIER version of this function built the attribution graph over candidates
    // only, which silently dropped the EDGE between two candidate siblings whenever their shared
    // opener was confirmed-safe (excluded from that graph entirely), so each sibling resolved to
    // itself instead of correctly deferring to the newer one — `dialog accept` closed the older,
    // innocent sibling FIRST (3/3 live) before ever reaching the real holder. A confirmed-safe
    // opener must still connect its candidate children to each other; it just can never be the
    // answer itself.
    it('GAP-245 regression (rapid-gap100 live shape): a CONFIRMED-SAFE opener still connects two never-confirmed siblings — the newer one is correctly preferred, not each one independently', () => {
      const result = attributeDialogHolders([
        { targetId: 'opener', confirmedSafe: true },
        { targetId: 'popup-old', openerTargetId: 'opener', confirmedSafe: false, discoveredAt: 100 },
        { targetId: 'popup-new', openerTargetId: 'opener', confirmedSafe: false, discoveredAt: 200 },
      ]);
      expect(result.get('popup-new')).toEqual({ blockedBy: undefined, confirmedSafe: false }); // the holder
      expect(result.get('popup-old')).toEqual({ blockedBy: 'popup-new', confirmedSafe: false }); // defers to it
      expect(result.get('opener')).toEqual({ blockedBy: 'popup-new', confirmedSafe: true }); // safe, informational pointer
    });

    it('GAP-245 regression, deeper chain: a confirmed-safe MIDDLE node still connects a candidate grandparent to a candidate child', () => {
      const result = attributeDialogHolders([
        { targetId: 'grand', confirmedSafe: false },
        { targetId: 'mid', openerTargetId: 'grand', confirmedSafe: true },
        { targetId: 'leaf', openerTargetId: 'mid', confirmedSafe: false },
      ]);
      // `leaf` is the only real candidate anywhere in the chain -> it holds, regardless of the
      // confirmed-safe node sitting between it and the root.
      expect(result.get('leaf')).toEqual({ blockedBy: undefined, confirmedSafe: false });
      expect(result.get('mid')).toEqual({ blockedBy: 'leaf', confirmedSafe: true });
      expect(result.get('grand')).toEqual({ blockedBy: 'leaf', confirmedSafe: false });
    });
  });

  it('B8 (FR2-04 fix-3/GAP-241): probeTargetsConcurrently probes every entry at once, not one after another', async () => {
    // This file's `beforeEach` installs fake timers — a real `setTimeout`-based probe would never
    // settle without advancing them, so concurrency is proven with manually-controlled gates
    // instead: every probe must have STARTED (incrementing `inFlight`) before any of them is
    // allowed to finish. A serial `for...of await` implementation would deadlock this test
    // outright (the second probe would never start until the first's gate resolves, which nothing
    // here ever does for a serial caller) rather than merely fail an assertion.
    const entries = [{ targetId: 't1' }, { targetId: 't2' }, { targetId: 't3' }];
    let inFlight = 0;
    let maxInFlight = 0;
    const releases: Array<() => void> = [];
    let resolveAllStarted!: () => void;
    const allStarted = new Promise<void>((r) => {
      resolveAllStarted = r;
    });
    const probe = async (entry: { targetId: string }) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      if (inFlight === entries.length) resolveAllStarted();
      await new Promise<void>((release) => releases.push(release));
      inFlight--;
      return 'responsive' as const;
    };
    const resultPromise = probeTargetsConcurrently(entries, probe);
    await allStarted; // only reachable if all 3 probes started concurrently
    expect(maxInFlight).toBe(3);
    for (const release of releases) release();
    const result = await resultPromise; // no timers involved past this point — pure microtasks
    expect(result.get('t1')).toBe('responsive');
    expect(result.get('t2')).toBe('responsive');
    expect(result.get('t3')).toBe('responsive');
  });
});
