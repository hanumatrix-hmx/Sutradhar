/**
 * @file packages/cli/tests/unit/direct-cdp-broker.spec.ts
 * @description FR2-04 fix-1, GAP-225: `DirectCdpBroker`'s "unknown blocks" fallback path
 * (dialog-broker.ts) had zero direct tests before this — the audit found that mutating it to
 * return `'busy'` without also reporting an `unknown` dialog (the exact change that would
 * silently let `runDialogGate` treat a blocked-with-no-hint target as `clear`) still passed all
 * 95 pre-existing `cli` tests. These tests exercise `DirectCdpBroker.list()`/`handle()` directly
 * against a mocked `@sutradhar/browser`, so a regression of that specific behavior fails here.
 *
 * Also covers GAP-222 (`handle()` must work without a prior `list()` call — the warden-down
 * `dialog accept|dismiss` path) and GAP-221 is covered separately in dialog-broker.spec.ts (the
 * gate-level prompt-default fallback).
 */
import { DirectCdpBroker } from '../../src/dialog-broker.js';

const state = {
  connectResult: undefined as any,
  targets: [] as Array<{ info: { targetId: string; url: string; openerTargetId?: string }; target: any }>,
  livenessResults: new Map<string, 'responsive' | 'blocked' | 'error'>(),
  handleCalls: [] as Array<{ accept: boolean; promptText: string | undefined }>,
  handleShouldFail: false,
  closeCalls: [] as string[],
};

vi.mock('@sutradhar/browser', async (importOriginal) => {
  // FR2-04 fix-3: `DirectCdpBroker.list()` now also calls the real, pure
  // `attributeDialogHolders`/`probeTargetsConcurrently` helpers from this module — pull those
  // through from the actual implementation instead of stubbing them, since these tests only need
  // to control connect/list/liveness/handle, not re-implement fix-3's own attribution logic.
  const actual = await importOriginal<typeof import('@sutradhar/browser')>();
  return {
    ...actual,
    connectForDialogs: vi.fn(async () => state.connectResult),
    listPageTargets: vi.fn(() => state.targets),
    livenessProbe: vi.fn(async (session: { targetId: string }) => state.livenessResults.get(session.targetId) ?? 'responsive'),
    handleDialogOnTarget: vi.fn(async (session: { targetId: string }, accept: boolean, promptText: string | undefined) => {
      if (state.handleShouldFail) throw new Error('No dialog is showing');
      state.handleCalls.push({ accept, promptText });
    }),
    closeTargetAtBrowserLevel: vi.fn(async (_browser: unknown, targetId: string) => {
      state.closeCalls.push(targetId);
    }),
  };
});

function fakeTarget(targetId: string, url: string, openerTargetId?: string) {
  return {
    info: { targetId, url, openerTargetId },
    target: {
      createCDPSession: vi.fn(async () => ({ targetId })),
    },
  };
}

describe('@sutradhar/cli DirectCdpBroker (FR2-04 fix-1, GAP-225/GAP-222)', () => {
  beforeEach(() => {
    state.connectResult = { connected: true, disconnect: vi.fn(async () => {}) };
    state.targets = [];
    state.livenessResults = new Map();
    state.handleCalls = [];
    state.handleShouldFail = false;
    state.closeCalls = [];
  });

  it('a blocked target with a matching hint is reported as that real dialog, not "unknown"', async () => {
    state.targets = [fakeTarget('t1', 'https://x/')];
    state.livenessResults.set('t1', 'blocked');
    const broker = new DirectCdpBroker('ws://x', {
      type: 'confirm',
      message: 'hi',
      url: 'https://x/',
      openedAt: '2020-01-01T00:00:00.000Z',
    });
    const result = await broker.list();
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('unreachable');
    expect(result.dialogs).toEqual([
      expect.objectContaining({ targetId: 't1', dialogType: 'confirm', message: 'hi' }),
    ]);
    // A hinted-and-identified target isn't "busy" — busy is reserved for the truly unknown case.
    expect(result.busy).toEqual([]);
  });

  it('GAP-225: a blocked target with NO hint is reported as an "unknown" dialog AND listed as busy — never silently dropped', async () => {
    state.targets = [fakeTarget('t1', 'https://x/')];
    state.livenessResults.set('t1', 'blocked');
    const broker = new DirectCdpBroker('ws://x'); // no hint at all
    const result = await broker.list();
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('unreachable');
    // The critical assertion (this is what a "return busy, drop the dialog" mutation breaks):
    // an unidentified blocked target MUST still appear in `dialogs`, not just `busy`, because
    // `runDialogGate` only blocks on `dialogs.length > 0` — a `busy`-only report would be
    // silently treated as `clear` and let `runtime.attach()` risk the GAP-017 hang/wrong-tab bug.
    expect(result.dialogs).toHaveLength(1);
    expect(result.dialogs[0]).toMatchObject({ targetId: 't1', dialogType: 'unknown', message: '' });
    expect(result.busy).toEqual(['t1']);
  });

  it('a responsive target is reported neither as a dialog nor as busy', async () => {
    state.targets = [fakeTarget('t1', 'https://x/')];
    state.livenessResults.set('t1', 'responsive');
    const broker = new DirectCdpBroker('ws://x');
    const result = await broker.list();
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('unreachable');
    expect(result.dialogs).toEqual([]);
    expect(result.busy).toEqual([]);
  });

  it('connectForDialogs failing entirely reports status "unknown" with reason "unreachable" (falls through to normal attach)', async () => {
    // FR2-04 fix-3, decision point 5: `reason` now distinguishes "never reachable at all" (this
    // case — safe to fall through to `clear`) from "reachable but the probe itself timed out"
    // (`reason:'timeout'`, which the gate must fail CLOSED on instead — see dialog-broker.spec.ts).
    state.connectResult = undefined;
    const broker = new DirectCdpBroker('ws://x');
    const result = await broker.list();
    expect(result).toEqual({ status: 'unknown', reason: 'unreachable' });
  });

  it('GAP-222: handle() works even when list() was never called first (warden-down "dialog accept|dismiss")', async () => {
    state.targets = [fakeTarget('t1', 'https://x/')];
    const broker = new DirectCdpBroker('ws://x');
    // No broker.list() call here — this is exactly the shape of cli.ts's cmdDialog, which builds
    // a fresh broker and calls handle() directly.
    await expect(broker.handle('t1', true, 'hello')).resolves.toBeUndefined();
    expect(state.handleCalls).toEqual([{ accept: true, promptText: 'hello' }]);
  });

  it('handle() still throws a clear error when the browser is unreachable even lazily', async () => {
    state.connectResult = undefined;
    const broker = new DirectCdpBroker('ws://x');
    await expect(broker.handle('t1', true, undefined)).rejects.toThrow(/could not reach the browser/i);
  });

  it('FR2-04 fix-3/GAP-236: a popup+opener pair both blocked — list() attributes the popup as the holder (no blockedBy) and the opener as blockedBy the popup', async () => {
    state.targets = [fakeTarget('opener', 'https://opener/'), fakeTarget('popup', 'about:blank', 'opener')];
    state.livenessResults.set('opener', 'blocked');
    state.livenessResults.set('popup', 'blocked');
    const broker = new DirectCdpBroker('ws://x');
    const result = await broker.list();
    if (result.status !== 'ok') throw new Error('unreachable');
    const opener = result.dialogs.find((d) => d.targetId === 'opener');
    const popup = result.dialogs.find((d) => d.targetId === 'popup');
    expect(popup?.blockedBy).toBeUndefined();
    expect(opener?.blockedBy).toBe('popup');
  });

  it('FR2-04 fix-3/GAP-236, decision point 3: handle() on a collaterally-blocked target refuses to close it and redirects to the real holder', async () => {
    state.targets = [fakeTarget('opener', 'https://opener/'), fakeTarget('popup', 'about:blank', 'opener')];
    state.livenessResults.set('opener', 'blocked');
    state.livenessResults.set('popup', 'blocked');
    state.handleShouldFail = true; // forces the recovery-close branch, same as a real "No dialog is showing"
    const broker = new DirectCdpBroker('ws://x');
    const outcome = await broker.handle('opener', true, undefined);
    expect(outcome?.redirectTo).toBe('popup');
    expect(outcome?.closedTarget).toBeFalsy();
    expect(state.closeCalls).toEqual([]); // never closed the wrong tab
  });

  it('FR2-04 fix-3/GAP-236, decision point 3: handle() on the actual holder closes it and names it (GAP-244)', async () => {
    state.targets = [fakeTarget('opener', 'https://opener/'), fakeTarget('popup', 'about:blank', 'opener')];
    state.livenessResults.set('opener', 'blocked');
    state.livenessResults.set('popup', 'blocked');
    state.handleShouldFail = true;
    const broker = new DirectCdpBroker('ws://x');
    const outcome = await broker.handle('popup', true, undefined);
    expect(outcome?.closedTarget).toBe(true);
    expect(outcome?.message).toContain('popup');
    expect(state.closeCalls).toEqual(['popup']);
  });

  it('FR2-04 fix-3/GAP-240, decision point 6: handle() on an ISOLATED blocked target (no sibling relationship) refuses to close it', async () => {
    state.targets = [fakeTarget('solo', 'https://solo/')]; // no opener, no siblings — the sync-XHR shape
    state.livenessResults.set('solo', 'blocked');
    state.handleShouldFail = true;
    const broker = new DirectCdpBroker('ws://x');
    const outcome = await broker.handle('solo', true, undefined);
    expect(outcome?.isolated).toBe(true);
    expect(outcome?.closedTarget).toBeFalsy();
    expect(state.closeCalls).toEqual([]); // GAP-240: never close a target we can't distinguish from a busy script
  });
});
