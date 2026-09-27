/**
 * @file packages/cli/tests/unit/dialog-broker.spec.ts
 * @description FR2-04 R-E: runDialogGate must disconnect its own broker connection in a
 * `finally`, on every path — a fake DialogBroker's `dispose()` (the thing that actually calls
 * the underlying browser's `disconnect()` — see DirectCdpBroker/WardenBroker) is asserted called
 * exactly once per path: clear, handled, blocked, and a thrown exception.
 */
import { runDialogGate, WardenBroker, type DialogBroker } from '../../src/dialog-broker.js';
import { DialogBlockedError } from '../../src/dialog-cli.js';

function fakeBroker(overrides: Partial<DialogBroker> = {}): DialogBroker & { disposeCalls: number } {
  let disposeCalls = 0;
  return {
    list: async () => ({ status: 'ok', dialogs: [], busy: [] }),
    handle: async () => {},
    dispose: async () => {
      disposeCalls++;
    },
    get disposeCalls() {
      return disposeCalls;
    },
    ...overrides,
  } as DialogBroker & { disposeCalls: number };
}

describe('@sutradhar/cli runDialogGate (FR2-04 B6, R-E: dispose exactly once per path)', () => {
  it('clear path (no dialogs): dispose called exactly once', async () => {
    const broker = fakeBroker();
    const result = await runDialogGate('snap', broker, { mode: 'report' }, 'command');
    expect(result).toEqual({ status: 'clear' });
    expect(broker.disposeCalls).toBe(1);
  });

  it('handled path (accept policy resolves a pending dialog): dispose called exactly once', async () => {
    const dialog = { targetId: 't1', dialogType: 'confirm', message: 'm', url: 'u', openedAt: 'o1' };
    // GAP-229 (fix-2): the gate re-lists after handling to catch a chained dialog — a stateful
    // mock (list() reports empty once handle() has actually run) is what a REAL broker looks
    // like once `Page.handleJavaScriptDialog` really resolved the dialog; a static mock that
    // always reports the same dialog would (correctly) make the gate treat it as an unbroken
    // chain and fail closed, which is exactly the behavior GAP-229 requires.
    let handled = false;
    const broker = fakeBroker({
      list: async () => ({ status: 'ok', dialogs: handled ? [] : [dialog], busy: [] }),
      handle: async () => {
        handled = true;
      },
    });
    const result = await runDialogGate('snap', broker, { mode: 'accept' }, 'command');
    expect(result.status).toBe('handled');
    expect(broker.disposeCalls).toBe(1);
  });

  it('blocked path (report policy, command mode throws DialogBlockedError): dispose still called exactly once', async () => {
    const dialog = { targetId: 't1', dialogType: 'confirm', message: 'm', url: 'u', openedAt: 'o1' };
    const broker = fakeBroker({ list: async () => ({ status: 'ok', dialogs: [dialog], busy: [] }) });
    await expect(runDialogGate('snap', broker, { mode: 'report' }, 'command')).rejects.toThrow(DialogBlockedError);
    expect(broker.disposeCalls).toBe(1);
  });

  it('blocked path (close mode returns {status:"blocked"} instead of throwing): dispose called exactly once', async () => {
    const dialog = { targetId: 't1', dialogType: 'confirm', message: 'm', url: 'u', openedAt: 'o1' };
    const broker = fakeBroker({ list: async () => ({ status: 'ok', dialogs: [dialog], busy: [] }) });
    const result = await runDialogGate('close', broker, { mode: 'report' }, 'close');
    // FR2-04 fix-3/GAP-242: 'close' mode's blocked result now also carries `records` (empty here —
    // nothing was handled before it blocked) so a caller that DID handle something first never
    // loses that record just because the gate ultimately blocked anyway.
    expect(result).toEqual({ status: 'blocked', dialogs: [dialog], records: [] });
    expect(broker.disposeCalls).toBe(1);
  });

  it('throw path (list() itself throws): dispose still called exactly once, and the original error propagates', async () => {
    const broker = fakeBroker({
      list: async () => {
        throw new Error('boom');
      },
    });
    await expect(runDialogGate('snap', broker, { mode: 'report' }, 'command')).rejects.toThrow('boom');
    expect(broker.disposeCalls).toBe(1);
  });

  it('a failed policy handle (accept/dismiss) in command mode: dispose still called exactly once', async () => {
    const dialog = { targetId: 't1', dialogType: 'confirm', message: 'm', url: 'u', openedAt: 'o1' };
    const broker = fakeBroker({
      list: async () => ({ status: 'ok', dialogs: [dialog], busy: [] }),
      handle: async () => {
        throw new Error('No dialog is showing');
      },
    });
    await expect(runDialogGate('snap', broker, { mode: 'accept' }, 'command')).rejects.toThrow(DialogBlockedError);
    expect(broker.disposeCalls).toBe(1);
  });

  it('GAP-221/D-9: accepting an orphaned prompt with no --dialog-text falls back to its defaultValue, not empty string', async () => {
    const dialog = {
      targetId: 't1',
      dialogType: 'prompt',
      message: 'name?',
      defaultValue: 'dflt',
      url: 'u',
      openedAt: 'o1',
    };
    const handleCalls: Array<{ accept: boolean; promptText: string | undefined }> = [];
    let handled = false;
    const broker = fakeBroker({
      list: async () => ({ status: 'ok', dialogs: handled ? [] : [dialog], busy: [] }),
      handle: async (_targetId, accept, promptText) => {
        handled = true;
        handleCalls.push({ accept, promptText });
      },
    });
    // No promptText on the policy — this is exactly the shape a gate-level `--dialog accept`
    // (with no `--dialog-text`) resolves to.
    const result = await runDialogGate('snap', broker, { mode: 'accept' }, 'command');
    expect(result.status).toBe('handled');
    expect(handleCalls).toEqual([{ accept: true, promptText: 'dflt' }]);
  });

  it('GAP-221: an explicit --dialog-text still wins over the dialog\'s own defaultValue', async () => {
    const dialog = {
      targetId: 't1',
      dialogType: 'prompt',
      message: 'name?',
      defaultValue: 'dflt',
      url: 'u',
      openedAt: 'o1',
    };
    const handleCalls: Array<{ accept: boolean; promptText: string | undefined }> = [];
    let handled = false;
    const broker = fakeBroker({
      list: async () => ({ status: 'ok', dialogs: handled ? [] : [dialog], busy: [] }),
      handle: async (_targetId, accept, promptText) => {
        handled = true;
        handleCalls.push({ accept, promptText });
      },
    });
    const result = await runDialogGate('snap', broker, { mode: 'accept', promptText: 'explicit' }, 'command');
    expect(result.status).toBe('handled');
    expect(handleCalls).toEqual([{ accept: true, promptText: 'explicit' }]);
  });

  it('GAP-223: handle() is called with the dialog\'s dialogId so a late handle can be verified against the right dialog', async () => {
    const dialog = { targetId: 't1', dialogType: 'confirm', message: 'm', url: 'u', openedAt: 'o1', dialogId: 'abc-123' };
    const handleCalls: Array<{ targetId: string; dialogId: string | undefined }> = [];
    let handled = false;
    const broker = fakeBroker({
      list: async () => ({ status: 'ok', dialogs: handled ? [] : [dialog], busy: [] }),
      handle: async (targetId, _accept, _promptText, dialogId) => {
        handled = true;
        handleCalls.push({ targetId, dialogId });
      },
    });
    await runDialogGate('snap', broker, { mode: 'accept' }, 'command');
    expect(handleCalls).toEqual([{ targetId: 't1', dialogId: 'abc-123' }]);
  });

  it('GAP-229: a chained second dialog (e.g. alert->confirm) opened right after the first is handled is caught and handled too, before the gate reports clear', async () => {
    const first = { targetId: 't1', dialogType: 'alert', message: 'm1', url: 'u', openedAt: 'o1' };
    const second = { targetId: 't1', dialogType: 'confirm', message: 'm2', url: 'u', openedAt: 'o2' };
    let round = 0;
    const handleCalls: string[] = [];
    const broker = fakeBroker({
      list: async () => {
        if (round === 0) return { status: 'ok', dialogs: [first], busy: [] };
        if (round === 1) return { status: 'ok', dialogs: [second], busy: [] };
        return { status: 'ok', dialogs: [], busy: [] };
      },
      handle: async (_targetId, _accept, _promptText, _dialogId) => {
        handleCalls.push(round === 0 ? 'first' : 'second');
        round++;
      },
    });
    const result = await runDialogGate('snap', broker, { mode: 'accept' }, 'command');
    expect(result.status).toBe('handled');
    if (result.status === 'handled') {
      expect(result.records.map((r) => r.dialog.message)).toEqual(['m1', 'm2']);
    }
    expect(handleCalls).toEqual(['first', 'second']);
    expect(broker.disposeCalls).toBe(1);
  });

  it('GAP-229: a dialog chain that never stops opening fails CLOSED (throws DialogBlockedError) instead of ever reporting clear', async () => {
    let round = 0;
    const broker = fakeBroker({
      list: async () => {
        round++;
        return { status: 'ok', dialogs: [{ targetId: 't1', dialogType: 'confirm', message: `m${round}`, url: 'u', openedAt: `o${round}` }], busy: [] };
      },
      handle: async () => {},
    });
    await expect(runDialogGate('snap', broker, { mode: 'accept' }, 'command')).rejects.toThrow(DialogBlockedError);
    // Never more than the bounded number of list() calls (max rounds + the final check).
    expect(round).toBeLessThanOrEqual(6);
  });

  // FR2-04 fix-3 decision points 5, 6, 7 — see dialog-broker.ts's runDialogGate doc comment.

  it('decision point 6 (GAP-240): a liveness-inferred "unknown" dialog is NEVER auto-handled by an accept/dismiss policy — the command still blocks, but handle() is never called for it', async () => {
    const unknown = { targetId: 't1', dialogType: 'unknown', message: '', url: 'u', openedAt: 'o1' };
    const handleCalls: string[] = [];
    const broker = fakeBroker({
      list: async () => ({ status: 'ok', dialogs: [unknown], busy: ['t1'] }),
      handle: async (targetId: string) => {
        handleCalls.push(targetId);
      },
    });
    await expect(runDialogGate('snap', broker, { mode: 'accept' }, 'command')).rejects.toThrow(DialogBlockedError);
    expect(handleCalls).toEqual([]); // never auto-recovered — GAP-240's sync-XHR false positive
  });

  it('decision point 6: a real dialog is still auto-handled even alongside an unrelated liveness-inferred "unknown" entry, and the chain re-checks until the unknown one clears on its own', async () => {
    const real = { targetId: 't1', dialogType: 'alert', message: 'm', url: 'u', openedAt: 'o1' };
    const unknown = { targetId: 't2', dialogType: 'unknown', message: '', url: 'u2', openedAt: 'o2' };
    let round = 0;
    const handleCalls: string[] = [];
    const broker = fakeBroker({
      list: async () => {
        round++;
        // t1's real alert is present only on round 1; t2 (collateral/busy) clears by round 2 once
        // the real dialog is gone — mirrors GAP-239's fix (a fresh re-probe decides, not a stale
        // classification).
        if (round === 1) return { status: 'ok', dialogs: [real, unknown], busy: ['t2'] };
        return { status: 'ok', dialogs: [], busy: [] };
      },
      handle: async (targetId: string) => {
        handleCalls.push(targetId);
      },
    });
    const result = await runDialogGate('snap', broker, { mode: 'accept' }, 'command');
    expect(result.status).toBe('handled');
    expect(handleCalls).toEqual(['t1']); // only the real dialog was ever handled
  });

  it('decision point 5 (GAP-241): list() reporting reason "timeout" fails CLOSED (throws), unlike reason "unreachable" which reports clear', async () => {
    const timeoutBroker = fakeBroker({ list: async () => ({ status: 'unknown', reason: 'timeout' }) });
    await expect(runDialogGate('snap', timeoutBroker, { mode: 'report' }, 'command')).rejects.toThrow(DialogBlockedError);

    const unreachableBroker = fakeBroker({ list: async () => ({ status: 'unknown', reason: 'unreachable' }) });
    const result = await runDialogGate('snap', unreachableBroker, { mode: 'report' }, 'command');
    expect(result).toEqual({ status: 'clear' });

    const legacyBroker = fakeBroker({ list: async () => ({ status: 'unknown' }) }); // no reason at all
    const legacyResult = await runDialogGate('snap', legacyBroker, { mode: 'report' }, 'command');
    expect(legacyResult).toEqual({ status: 'clear' });
  });

  it('decision point 7 (GAP-242): dialogs already handled before the chain-limit fail-closed are preserved on the thrown DialogBlockedError, not dropped', async () => {
    let round = 0;
    const broker = fakeBroker({
      list: async () => {
        round++;
        return { status: 'ok', dialogs: [{ targetId: 't1', dialogType: 'confirm', message: `m${round}`, url: 'u', openedAt: `o${round}` }], busy: [] };
      },
      handle: async () => {},
    });
    try {
      await runDialogGate('snap', broker, { mode: 'accept' }, 'command');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(DialogBlockedError);
      const dbe = err as DialogBlockedError;
      // GATE_REGATE_MAX_ROUNDS is 5 — every round handled its one dialog before the loop gave up.
      expect(dbe.handledRecords.length).toBe(5);
      expect(dbe.handledStdoutLines().length).toBe(5);
    }
  });

  it('decision point 7: "close" mode also preserves handledRecords on its blocked result, not just the thrown-error path', async () => {
    let round = 0;
    const broker = fakeBroker({
      list: async () => {
        round++;
        return { status: 'ok', dialogs: [{ targetId: 't1', dialogType: 'confirm', message: `m${round}`, url: 'u', openedAt: `o${round}` }], busy: [] };
      },
      handle: async () => {},
    });
    const result = await runDialogGate('close', broker, { mode: 'accept' }, 'close');
    expect(result.status).toBe('blocked');
    if (result.status === 'blocked') {
      expect(result.records?.length).toBe(5);
    }
  });
});

// FR2-04 escalation-1, GAP-250: audit-4's M26 (WardenBroker silently drops the `closedTarget`/
// `message` fields from a successful `/v1/dialogs/handle` response) survived vitest because
// nothing exercised `WardenBroker.handle()` directly — only the warden's OWN HTTP handler
// (dialog-warden.spec.ts) and cli.ts's end-to-end wiring were covered. This closes that gap.
describe('@sutradhar/cli WardenBroker.handle (FR2-04 GAP-230/GAP-250 M26)', () => {
  it('surfaces closedTarget + message from a 200 response body (recovery-by-close)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ handled: true, closedTarget: true, message: 'Tab t1 (https://x/) was closed because its dialog could not be addressed directly (unknown dialog).' }),
    });
    const broker = new WardenBroker('http://127.0.0.1:1', 'tok', fetchImpl as any);
    const outcome = await broker.handle('t1', true, undefined);
    expect(outcome).toEqual({ closedTarget: true, message: expect.stringContaining('was closed') });
  });

  it('returns undefined (a real Page.handleJavaScriptDialog resolution, nothing to surface) for a 200 with no closedTarget', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ handled: true }) });
    const broker = new WardenBroker('http://127.0.0.1:1', 'tok', fetchImpl as any);
    const outcome = await broker.handle('t1', true, undefined);
    expect(outcome).toBeUndefined();
  });

  it('surfaces a confirmedSafe 409 refusal (escalation-1 decision 1) distinctly from a plain holderTargetId redirect', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: 'busy but confirmed safe', confirmedSafe: true, holderTargetId: 'candidate' }),
    });
    const broker = new WardenBroker('http://127.0.0.1:1', 'tok', fetchImpl as any);
    const outcome = await broker.handle('t1', true, undefined);
    expect(outcome).toEqual({ refused: true, redirectTo: 'candidate', message: 'busy but confirmed safe' });
  });

  it('surfaces a plain holderTargetId 409 redirect (collateral, real holder named) without refused set', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: 'shares a browser process', holderTargetId: 'popup' }),
    });
    const broker = new WardenBroker('http://127.0.0.1:1', 'tok', fetchImpl as any);
    const outcome = await broker.handle('t1', true, undefined);
    expect(outcome).toEqual({ redirectTo: 'popup', message: 'shares a browser process' });
    expect((outcome as any)?.refused).toBeUndefined();
  });
});
