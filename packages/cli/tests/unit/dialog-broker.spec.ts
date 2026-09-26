/**
 * @file packages/cli/tests/unit/dialog-broker.spec.ts
 * @description FR2-04 R-E: runDialogGate must disconnect its own broker connection in a
 * `finally`, on every path — a fake DialogBroker's `dispose()` (the thing that actually calls
 * the underlying browser's `disconnect()` — see DirectCdpBroker/WardenBroker) is asserted called
 * exactly once per path: clear, handled, blocked, and a thrown exception.
 */
import { runDialogGate, type DialogBroker } from '../../src/dialog-broker.js';
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
    expect(result).toEqual({ status: 'blocked', dialogs: [dialog] });
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
});
