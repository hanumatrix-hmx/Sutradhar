/**
 * @file packages/cli/tests/unit/dialog-json-routing.spec.ts
 * @description FR2-12 fix-2: unit tests for the pure dialog/JSON-stdout coordination helpers
 * pulled out of `cli.ts` into `dialog-json-routing.ts`. GAP-269 (test-integrity): before this
 * file existed, GAP-261's CLI-side fix and GAP-268's fix had ZERO unit coverage — only the live
 * probe and live-verify scripts caught a regression. These tests specifically kill audit-2's
 * named surviving mutations:
 *  - M6: `reportDialogs`'s `dialogLog` reverted to always `console.log` (never routes to stderr
 *    in `--json` mode).
 *  - M7: the session gate's dialog-handled `dialogLog` reverted the same way.
 *  - M8: `cmdAudit`'s catch-side dialog-blocked-JSON write deleted (or made unconditional again).
 *  - M9: the pre-emption branch's dialog-blocked-JSON write removed.
 * M6/M7 collapse to the same function (`dialogOutputSink`) since both call sites were refactored
 * to share it — a mutation reverting either call site's usage is caught by asserting the
 * function's own contract AND (implicitly) by there being only one implementation left to
 * mutate. M8/M9 are exercised via `printDialogBlockedJsonOnce`'s actual guard behavior: each
 * call site becomes "call this function", so a mutation that deletes one call's guard check, or
 * that removes the shared state entirely, is caught by asserting exactly one of two calls in a
 * row writes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  dialogOutputSink,
  dialogBlockedJsonDoc,
  printDialogBlockedJsonOnce,
  writeJsonStdoutOnce,
  resetJsonStdoutGuard,
} from '../../src/dialog-json-routing.js';
import type { PendingDialogEntry } from '../../src/dialog-cli.js';

function pending(overrides: Partial<PendingDialogEntry> = {}): PendingDialogEntry {
  return {
    dialogType: 'alert',
    message: 'hi',
    defaultValue: undefined,
    url: 'http://x/',
    openedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as PendingDialogEntry;
}

describe('dialogOutputSink (GAP-261 M6/M7 kill)', () => {
  it('routes to console.error when isJsonMode is true — a dialog line must never reach stdout in --json mode', () => {
    expect(dialogOutputSink(true)).toBe(console.error);
  });

  it('routes to console.log when isJsonMode is false — normal human-readable behavior, unchanged from pre-FR2-04', () => {
    expect(dialogOutputSink(false)).toBe(console.log);
  });
});

describe('dialogBlockedJsonDoc', () => {
  it('produces exactly one parseable JSON document with the schema-shaped dialogPending/dialogsHandled keys', () => {
    const doc = dialogBlockedJsonDoc('boom', [pending()]);
    const parsed = JSON.parse(doc);
    expect(parsed).toEqual({
      error: 'boom',
      dialogPending: { type: 'alert', message: 'hi', defaultValue: null, url: 'http://x/' },
      dialogsHandled: [],
    });
    // Exactly one document — no trailing/leading extra content.
    expect(doc.trim().split('\n').filter((l) => l === '}').length).toBe(1);
  });

  it('dialogPending is null when there is no pending dialog (only handled ones)', () => {
    const doc = dialogBlockedJsonDoc('boom', [], [{ dialog: pending(), action: 'dismiss' }]);
    const parsed = JSON.parse(doc);
    expect(parsed.dialogPending).toBeNull();
    expect(parsed.dialogsHandled).toEqual([
      { type: 'alert', message: 'hi', action: 'dismiss', promptText: null, by: 'policy' },
    ]);
  });
});

describe('printDialogBlockedJsonOnce (GAP-268 M8/M9 kill)', () => {
  beforeEach(() => {
    resetJsonStdoutGuard();
  });

  it('the FIRST call writes and returns true', () => {
    const sink = vi.fn();
    const wrote = printDialogBlockedJsonOnce('boom', [pending()], [], sink);
    expect(wrote).toBe(true);
    expect(sink).toHaveBeenCalledTimes(1);
    expect(JSON.parse(sink.mock.calls[0]![0] as string).error).toBe('boom');
  });

  it('a SECOND call for the same command invocation is suppressed — returns false and never calls the sink again (kills the exact GAP-268 shape: two writers racing for the same command)', () => {
    const sink = vi.fn();
    printDialogBlockedJsonOnce('first-writer', [pending()], [], sink); // simulates withSession's pre-emption branch
    const wroteSecond = printDialogBlockedJsonOnce('second-writer (abandoned work catch)', [pending()], [], sink); // simulates cmdAudit's catch
    expect(wroteSecond).toBe(false);
    expect(sink).toHaveBeenCalledTimes(1); // still just the first document — never a second, corrupting write
    expect(JSON.parse(sink.mock.calls[0]![0] as string).error).toBe('first-writer');
  });

  it('resetJsonStdoutGuard lets a NEW command invocation (a fresh CLI process, in reality) write again', () => {
    const sink = vi.fn();
    printDialogBlockedJsonOnce('cmd-1', [pending()], [], sink);
    resetJsonStdoutGuard();
    const wrote = printDialogBlockedJsonOnce('cmd-2', [pending()], [], sink);
    expect(wrote).toBe(true);
    expect(sink).toHaveBeenCalledTimes(2);
  });

  it('defaults to the real console.log when no sink is passed (the production call shape used by cli.ts)', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const wrote = printDialogBlockedJsonOnce('boom', [pending()]);
      expect(wrote).toBe(true);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('writeJsonStdoutOnce (GAP-268 widened kill: the success-path write is ALSO a possible second writer)', () => {
  beforeEach(() => {
    resetJsonStdoutGuard();
  });

  it('the audit SUCCESS write and a prior dialog-blocked write share the SAME guard — the success write is suppressed if the blocked doc already won', () => {
    const sink = vi.fn();
    // Simulates withSession's pre-emption branch firing first...
    printDialogBlockedJsonOnce('a dialog opened while "audit" was running', [pending()], [], sink);
    // ...then the abandoned work actually succeeding anyway and cmdAudit reaching its normal
    // success path — found live by fix-2's own re-verification sweep (2/15 trials at
    // 1560-1570ms): a headless page.screenshot()/page.evaluate() pair can complete even with an
    // open alert().
    const wroteReport = writeJsonStdoutOnce(JSON.stringify({ schemaVersion: 1 }), sink);
    expect(wroteReport).toBe(false);
    expect(sink).toHaveBeenCalledTimes(1);
  });

  it('a normal (no dialog) --json audit run is unaffected: the success write is the FIRST call and always writes', () => {
    const sink = vi.fn();
    const wrote = writeJsonStdoutOnce(JSON.stringify({ schemaVersion: 1 }), sink);
    expect(wrote).toBe(true);
    expect(sink).toHaveBeenCalledTimes(1);
  });
});
