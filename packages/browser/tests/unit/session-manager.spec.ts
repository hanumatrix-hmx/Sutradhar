/**
 * @file packages/browser/tests/unit/session-manager.spec.ts
 * @description Unit tests for BrowserSessionManager's session create/reuse race handling —
 * concurrent `createSession()` calls for the same caller-supplied sessionId must coalesce onto
 * a single in-flight launch rather than each spawning its own browser.
 */

import { BrowserSessionManager, BrowserLauncher } from '../../src/index.js';
import { EventBus } from '@pinchtab/events';
import { createSessionId } from '@pinchtab/contracts';

function mockBrowserInstance() {
  return {
    isConnected: true,
    newPage: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    onDisconnected: vi.fn(),
  } as any;
}

describe('@pinchtab/browser BrowserSessionManager session create/reuse race handling', () => {
  it('coalesces concurrent createSession() calls for the same sessionId onto a single launch', async () => {
    const launcher = new BrowserLauncher();
    let resolveLaunch!: (v: unknown) => void;
    const launchPromise = new Promise((r) => {
      resolveLaunch = r;
    });
    const launchSpy = vi.spyOn(launcher, 'launch').mockReturnValue(launchPromise as any);

    const manager = new BrowserSessionManager(launcher);
    const sessionId = createSessionId('sess_race');

    const first = manager.createSession({ sessionId });
    const second = manager.createSession({ sessionId });
    const third = manager.createSession({ sessionId });

    // Nothing has resolved yet — the launcher must only have been asked to launch ONCE for
    // all three concurrent callers, not three times.
    expect(launchSpy).toHaveBeenCalledTimes(1);

    resolveLaunch(mockBrowserInstance());
    const [s1, s2, s3] = await Promise.all([first, second, third]);

    expect(s1).toBe(s2);
    expect(s2).toBe(s3);
    expect(manager.getSessionCount()).toBe(1);
  });

  it('a later createSession() call for the same sessionId, after the first resolved, reuses the live session without launching again', async () => {
    const launcher = new BrowserLauncher();
    const launchSpy = vi.spyOn(launcher, 'launch').mockResolvedValue(mockBrowserInstance());

    const manager = new BrowserSessionManager(launcher);
    const sessionId = createSessionId('sess_reuse');

    const first = await manager.createSession({ sessionId });
    const second = await manager.createSession({ sessionId });

    expect(launchSpy).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
  });

  it('removes the pending in-flight entry once the launch settles, even on failure', async () => {
    const launcher = new BrowserLauncher();
    const launchSpy = vi.spyOn(launcher, 'launch').mockRejectedValueOnce(new Error('boom'));
    launchSpy.mockResolvedValueOnce(mockBrowserInstance());

    const manager = new BrowserSessionManager(launcher);
    const sessionId = createSessionId('sess_fail_then_retry');

    await expect(manager.createSession({ sessionId })).rejects.toThrow('boom');

    // A second call after the first failed must retry the launch (the pending entry must
    // have been cleared), not hang forever waiting on a promise that already rejected.
    const session = await manager.createSession({ sessionId });
    expect(session).toBeDefined();
    expect(launchSpy).toHaveBeenCalledTimes(2);
  });

  it('different sessionIds never coalesce — each gets its own launch', async () => {
    const launcher = new BrowserLauncher();
    const launchSpy = vi.spyOn(launcher, 'launch').mockImplementation(async () => mockBrowserInstance());

    const manager = new BrowserSessionManager(launcher);
    const [a, b] = await Promise.all([
      manager.createSession({ sessionId: createSessionId('sess_a') }),
      manager.createSession({ sessionId: createSessionId('sess_b') }),
    ]);

    expect(launchSpy).toHaveBeenCalledTimes(2);
    expect(a).not.toBe(b);
    expect(manager.getSessionCount()).toBe(2);
  });

  it('an uncorrelated (no sessionId) createSession() never coalesces with anything', async () => {
    const launcher = new BrowserLauncher();
    const launchSpy = vi.spyOn(launcher, 'launch').mockImplementation(async () => mockBrowserInstance());

    const manager = new BrowserSessionManager(launcher);
    const [a, b] = await Promise.all([manager.createSession(), manager.createSession()]);

    expect(launchSpy).toHaveBeenCalledTimes(2);
    expect(a.id).not.toBe(b.id);
  });
});

describe('@pinchtab/browser BrowserSessionManager.dispose()', () => {
  it('unsubscribes from the shared EventBus so a disposed manager stops reacting to future events', async () => {
    const bus = new EventBus();
    const launcher = new BrowserLauncher();
    vi.spyOn(launcher, 'launch').mockResolvedValue({
      isConnected: true,
      newPage: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      onDisconnected: vi.fn(),
    } as any);

    const manager = new BrowserSessionManager(launcher, bus);
    const session = await manager.createSession();
    expect(manager.getSession(session.id)).toBeDefined();

    manager.dispose();

    // After dispose(), a 'browser:session:crashed' event for this session must NOT be acted
    // on by this (now-disposed) manager instance — its subscription should be gone.
    await bus.publish('browser:session:crashed', { sessionId: session.id, crashedAt: new Date().toISOString() }, 'corr_1');
    await new Promise((r) => setTimeout(r, 0));

    // The session is still tracked (dispose() doesn't close sessions, only unsubscribes) —
    // proving the crashed-session handler genuinely didn't fire, not that the session was
    // independently removed some other way.
    expect(manager.getSession(session.id)).toBeDefined();
  });

  it('is safe to call when no EventBus was provided', () => {
    const manager = new BrowserSessionManager(new BrowserLauncher());
    expect(() => manager.dispose()).not.toThrow();
  });

  it('stops the idle reaper too (dispose() supersedes stopIdleReaper())', async () => {
    vi.useFakeTimers();
    try {
      const launcher = new BrowserLauncher();
      vi.spyOn(launcher, 'launch').mockResolvedValue({
        isConnected: true,
        newPage: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        onDisconnected: vi.fn(),
      } as any);

      const manager = new BrowserSessionManager(launcher, undefined, undefined, 1000);
      const session = await manager.createSession();
      manager.dispose();

      await vi.advanceTimersByTimeAsync(2000);
      // The reaper interval was cleared by dispose() — the session must still be there.
      expect(manager.getSession(session.id)).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
