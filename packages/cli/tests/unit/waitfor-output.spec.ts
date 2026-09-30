/**
 * @file packages/cli/tests/unit/waitfor-output.spec.ts
 * @description FR2-08: what `sutradhar waitfor` prints and which exit code it uses, as pure functions.
 */
import { waitForOutcome, EXIT_BLOCKED_BY_DIALOG } from '../../src/waitfor-output.js';
import type { ActionResult } from '@sutradhar/capability-runtime';

const VERIFIED = {
  verified: true,
  urlChanged: false,
  elementFound: true,
  confidence: 0.9,
  reason: 'held',
  evidence: { tier: 'verified' as const, checks: [] },
};

describe('FR2-08 waitForOutcome', () => {
  it('a met wait prints "Condition met after Nms: <condition>" and exits 0', () => {
    const r: ActionResult = { success: true, actionType: 'wait_for', executionTimeMs: 2100, output: { satisfiedAfterMs: 2050, polls: 21 }, verification: VERIFIED };
    const o = waitForOutcome(r, { text: 'Saved successfully', timeoutMs: 15000 });
    expect(o.exitCode).toBe(0);
    expect(o.stdout[0]).toBe('Condition met after 2050ms: text="Saved successfully"');
    expect(o.stdout[1]).toMatch(/^Verification: verified/);
    expect(o.stderr).toEqual([]);
  });

  it('a vacuous textGone still exits 0 but says so on stderr', () => {
    const r: ActionResult = { success: true, actionType: 'wait_for', executionTimeMs: 3, output: { satisfiedAfterMs: 3, presentAtStart: false } };
    const o = waitForOutcome(r, { textGone: 'Never was here' });
    expect(o.exitCode).toBe(0);
    expect(o.stderr).toEqual([
      'Note: "Never was here" was not present when the wait started, so textGone was satisfied immediately — check the text if you expected it.',
    ]);
    // a textGone that WAS present at the start gets no note
    const o2 = waitForOutcome({ ...r, output: { satisfiedAfterMs: 900, presentAtStart: true } }, { textGone: 'Loading' });
    expect(o2.stderr).toEqual([]);
  });

  it('a timeout prints "Wait failed: <error>" and exits 1', () => {
    const r: ActionResult = { success: false, actionType: 'wait_for', executionTimeMs: 3000, error: 'wait_for timed out after 3000ms waiting for text="Never appears": ...' };
    const o = waitForOutcome(r, { text: 'Never appears' });
    expect(o.exitCode).toBe(1);
    expect(o.stdout).toEqual(['Wait failed: wait_for timed out after 3000ms waiting for text="Never appears": ...']);
  });

  it('a dialog-blocked wait exits 3 (FR2-04 parity); a js throw exits 1', () => {
    const d: ActionResult = { success: false, actionType: 'wait_for', executionTimeMs: 1000, error: 'wait_for blocked by an open alert dialog ("x") after 1003ms — handle it' };
    expect(waitForOutcome(d, { text: 'a' }).exitCode).toBe(EXIT_BLOCKED_BY_DIALOG);
    expect(EXIT_BLOCKED_BY_DIALOG).toBe(3);
    const j: ActionResult = { success: false, actionType: 'wait_for', executionTimeMs: 2, error: 'wait_for failed: js condition threw after 2ms: boom' };
    expect(waitForOutcome(j, { js: 'x' }).exitCode).toBe(1);
  });
});
