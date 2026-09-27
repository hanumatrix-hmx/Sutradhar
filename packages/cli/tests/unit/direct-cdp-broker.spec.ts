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

  // FR2-04 escalation-1, decision 3 (GAP-247): SUPERSEDES fix-3's "handle() on the actual holder
  // closes it" behavior. audit-4's A4-01 measured that exact behavior closing the WRONG, innocent
  // tab first for a dialog on the opener (3/3) or the middle of a 3-target chain (3/3) — because
  // `DirectCdpBroker` only runs when the warden is unreachable, so it has NO per-target history
  // (`confirmedSafe`) to ground "newest target holds it" in (that premise needs every OLDER target
  // to have been tracked continuously from before the dialog opened, which nothing guarantees once
  // the warden is down). `DirectCdpBroker` must now refuse ALL destructive recovery, unconditionally
  // — proven here for the exact "topology says THIS one is the holder" shape that used to close it.
  it('FR2-04 escalation-1/GAP-247: handle() on what topology alone would call "the holder" still refuses to close it — DirectCdpBroker has no history to trust that guess', async () => {
    state.targets = [fakeTarget('opener', 'https://opener/'), fakeTarget('popup', 'about:blank', 'opener')];
    state.livenessResults.set('opener', 'blocked');
    state.livenessResults.set('popup', 'blocked');
    state.handleShouldFail = true;
    const broker = new DirectCdpBroker('ws://x');
    const outcome = await broker.handle('popup', true, undefined);
    expect(outcome?.closedTarget).toBeFalsy();
    expect(outcome?.refused).toBe(true);
    expect(outcome?.message).toMatch(/warden is not running/i);
    expect(state.closeCalls).toEqual([]);
  });

  it('FR2-04 escalation-1/GAP-247: handle() on an ISOLATED blocked target (no sibling relationship) also refuses to close it', async () => {
    state.targets = [fakeTarget('solo', 'https://solo/')]; // no opener, no siblings — the sync-XHR shape
    state.livenessResults.set('solo', 'blocked');
    state.handleShouldFail = true;
    const broker = new DirectCdpBroker('ws://x');
    const outcome = await broker.handle('solo', true, undefined);
    expect(outcome?.refused).toBe(true);
    expect(outcome?.closedTarget).toBeFalsy();
    expect(state.closeCalls).toEqual([]); // never close a target we can't distinguish from a busy script
  });

  // FR2-04 escalation-1, decision 3: the three specific warden-down attribution attacks audit-4's
  // A4-01 named (opener-held, chain-middle, older-sibling) — zero wrong-tab closes in all three, by
  // construction (DirectCdpBroker never closes anything for an unattributed dialog at all).
  it('GAP-247 attack 1: dialog on the OPENER of a chain — handle() on ANY target in the blocked set never closes anything', async () => {
    state.targets = [fakeTarget('opener', 'https://opener/'), fakeTarget('popup', 'about:blank', 'opener')];
    state.livenessResults.set('opener', 'blocked'); // the opener actually holds the (unobserved) dialog
    state.livenessResults.set('popup', 'blocked'); // the popup is only busy because it shares the renderer
    state.handleShouldFail = true;
    const broker = new DirectCdpBroker('ws://x');
    for (const targetId of ['opener', 'popup']) {
      const outcome = await broker.handle(targetId, true, undefined);
      expect(outcome?.closedTarget).toBeFalsy();
    }
    expect(state.closeCalls).toEqual([]);
  });

  it('GAP-247 attack 2: dialog on the MIDDLE of a 3-target chain — handle() on any target never closes anything', async () => {
    state.targets = [
      fakeTarget('grand', 'https://grand/'),
      fakeTarget('mid', 'https://mid/', 'grand'),
      fakeTarget('leaf', 'about:blank', 'mid'),
    ];
    state.livenessResults.set('grand', 'blocked');
    state.livenessResults.set('mid', 'blocked'); // mid actually holds the (unobserved) dialog
    state.livenessResults.set('leaf', 'blocked');
    state.handleShouldFail = true;
    const broker = new DirectCdpBroker('ws://x');
    for (const targetId of ['grand', 'mid', 'leaf']) {
      const outcome = await broker.handle(targetId, true, undefined);
      expect(outcome?.closedTarget).toBeFalsy();
    }
    expect(state.closeCalls).toEqual([]);
  });

  it('GAP-247 attack 3: dialog on the OLDER of two siblings — handle() on any target never closes anything', async () => {
    state.targets = [
      fakeTarget('opener', 'https://opener/'),
      fakeTarget('older', 'about:blank', 'opener'),
      fakeTarget('newer', 'about:blank', 'opener'),
    ];
    state.livenessResults.set('opener', 'blocked');
    state.livenessResults.set('older', 'blocked'); // older actually holds the (unobserved) dialog
    state.livenessResults.set('newer', 'blocked'); // newer is merely a sibling — topology would wrongly prefer it
    state.handleShouldFail = true;
    const broker = new DirectCdpBroker('ws://x');
    for (const targetId of ['opener', 'older', 'newer']) {
      const outcome = await broker.handle(targetId, true, undefined);
      expect(outcome?.closedTarget).toBeFalsy();
    }
    expect(state.closeCalls).toEqual([]);
  });
});
