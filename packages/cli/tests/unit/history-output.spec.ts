/**
 * @file packages/cli/tests/unit/history-output.spec.ts
 * @description I-NAV: the pure classifier / formatter / runner behind `sutradhar back | forward | reload`.
 */
import type { NavigateResult, VerificationResultDto } from '@sutradhar/capability-runtime';
import {
  classifyHistoryOutcome,
  historyExitCode,
  historyOutput,
  runHistoryCommand,
  type HistoryRuntime,
} from '../../src/history-output.js';
import { dismissedBeforeunloadSince, isBeforeunloadCancel } from '../../src/dialog-cli.js';

type Check = { check: string; outcome: 'pass' | 'fail' | 'not-run'; expected?: string | number | boolean; observed?: string | number | boolean };

function verification(over: Partial<VerificationResultDto> & { checks?: Check[]; tier?: string } = {}): VerificationResultDto {
  const { checks = [], tier = 'verified', ...rest } = over as { checks?: Check[]; tier?: string } & Partial<VerificationResultDto>;
  return {
    verified: tier === 'verified',
    urlChanged: true,
    elementFound: true,
    confidence: 0.9,
    reason: 'ok',
    evidence: { tier, checks },
    ...rest,
  } as unknown as VerificationResultDto;
}

const doc = (verb: 'go_back' | 'go_forward', observed = 'new-document'): Check => ({ check: `${verb}.document`, outcome: 'pass', observed });
const idx = (verb: 'go_back' | 'go_forward', outcome: Check['outcome'], expected = 1, observed = 1): Check => ({ check: `${verb}.history-index`, outcome, expected, observed });
const edge = (verb: 'go_back' | 'go_forward', observed: string): Check => ({ check: `${verb}.history-edge`, outcome: 'fail', expected: 'a history entry in this direction', observed });

const MOVED_NEW_DOC = verification({ checks: [doc('go_back'), idx('go_back', 'pass')], reason: 'history moved from entry 2 to 1 (http://x/a) (new document)' });
const MOVED_SAME_DOC = verification({ checks: [doc('go_back', 'same-document'), idx('go_back', 'pass')], reason: 'history moved from entry 3 to 2 (http://x/s#2) (same-document)' });
const BACK_EDGE = verification({
  tier: 'contradicted',
  checks: [doc('go_back', 'none'), idx('go_back', 'fail', -1, 0), edge('go_back', 'index 0 of 3')],
  reason: 'there was no history entry to go back to (index 0 of 3)',
});
const FWD_EDGE = verification({
  tier: 'contradicted',
  checks: [doc('go_forward', 'none'), idx('go_forward', 'fail', 3, 2), edge('go_forward', 'index 2 of 3')],
  reason: 'there was no forward history entry',
});

describe('I-NAV classifyHistoryOutcome (history-index / history-edge checks only)', () => {
  it('C1: a passing history-index is moved, for a new-document AND a same-document entry', () => {
    expect(classifyHistoryOutcome('back', MOVED_NEW_DOC)).toBe('moved');
    expect(classifyHistoryOutcome('back', MOVED_SAME_DOC)).toBe('moved');
    const fwd = verification({ checks: [doc('go_forward'), idx('go_forward', 'pass', 2, 2)] });
    expect(classifyHistoryOutcome('forward', fwd)).toBe('moved');
  });

  it('C2: the history-edge check makes it an edge, for back AND forward', () => {
    expect(classifyHistoryOutcome('back', BACK_EDGE)).toBe('edge');
    expect(classifyHistoryOutcome('forward', FWD_EDGE)).toBe('edge');
  });

  it('C3: a failed history-index WITHOUT an edge check is not-moved (e.g. forward index 0 of 2 did not move)', () => {
    const notMoved = verification({ tier: 'contradicted', checks: [doc('go_forward', 'none'), idx('go_forward', 'fail', 1, 0)], reason: 'the history index did not move (still 0)' });
    expect(classifyHistoryOutcome('forward', notMoved)).toBe('not-moved');
    const backNotMoved = verification({ tier: 'contradicted', checks: [doc('go_back', 'none'), idx('go_back', 'fail', 1, 2)], reason: 'the history index did not move (still 2)' });
    expect(classifyHistoryOutcome('back', backNotMoved)).toBe('not-moved');
  });

  it('C4: a not-run history-index (dialog open, CDP timeout) and NO checks at all are unconfirmed; so is a missing verification', () => {
    const dialog = verification({ tier: 'unverifiable', checks: [{ check: 'go_back.document', outcome: 'not-run' }, idx('go_back', 'not-run')], reason: 'a beforeunload dialog is open' });
    expect(classifyHistoryOutcome('back', dialog)).toBe('unconfirmed');
    expect(classifyHistoryOutcome('back', verification({ checks: [] }))).toBe('unconfirmed');
    expect(classifyHistoryOutcome('forward', undefined)).toBe('unconfirmed');
    const baseline = verification({ tier: 'unverifiable', checks: [{ check: 'go_back.document', outcome: 'not-run' }] });
    expect(classifyHistoryOutcome('back', baseline)).toBe('unconfirmed');
  });

  it('C5: reload is reloaded whatever its checks say', () => {
    const r = verification({ checks: [{ check: 'reload.document', outcome: 'pass', observed: 'new-document' }] });
    expect(classifyHistoryOutcome('reload', r)).toBe('reloaded');
    expect(classifyHistoryOutcome('reload', undefined)).toBe('reloaded');
  });

  it('C6: the edge is recognised even when an --expect-* failure replaced the verification reason (Rule 5)', () => {
    const replaced = { ...FWD_EDGE, reason: 'Expected URL change from http://x/c, but URL remained http://x/c', verified: false };
    expect(replaced.reason).not.toContain('no forward history entry');
    expect(classifyHistoryOutcome('forward', replaced)).toBe('edge');
    const replacedBack = { ...BACK_EDGE, reason: 'Current URL http://x/a does not contain expected substring zzz' };
    expect(classifyHistoryOutcome('back', replacedBack)).toBe('edge');
  });

  it('C7: the reason TEXT never decides (a reason that talks about "no history entry" without the edge check is not an edge)', () => {
    const lying = verification({
      tier: 'contradicted',
      checks: [doc('go_back', 'none'), idx('go_back', 'fail', 1, 2)],
      reason: 'there was no history entry to go back to (index 0 of 3)',
    });
    expect(classifyHistoryOutcome('back', lying)).toBe('not-moved');
  });

  it('C8: expected === -1 never decides either (a failed index with expected -1 and no edge check is not-moved)', () => {
    const minusOne = verification({ tier: 'contradicted', checks: [doc('go_back', 'none'), idx('go_back', 'fail', -1, 0)] });
    expect(classifyHistoryOutcome('back', minusOne)).toBe('not-moved');
  });

  it('C9: the other direction\'s edge check does not count (a go_forward edge on a back is ignored)', () => {
    const wrong = verification({ tier: 'contradicted', checks: [doc('go_back', 'none'), idx('go_back', 'fail', 1, 2), edge('go_forward', 'index 2 of 3')] });
    expect(classifyHistoryOutcome('back', wrong)).toBe('not-moved');
  });
});

describe('I-NAV exit codes: edge -> 1 > failed --expect-* -> 4 > 0', () => {
  const withFailedExpect = (v: VerificationResultDto): VerificationResultDto =>
    ({ ...v, evidence: { ...v.evidence, checks: [...v.evidence.checks, { check: 'expect.urlChanged', outcome: 'fail', expected: true, observed: false }] } }) as VerificationResultDto;

  it('X1: forward edge + failed --expect-* -> 1; back edge + failed --expect-* -> 1', () => {
    expect(historyExitCode(classifyHistoryOutcome('forward', withFailedExpect(FWD_EDGE)), withFailedExpect(FWD_EDGE), true)).toBe(1);
    expect(historyExitCode(classifyHistoryOutcome('back', withFailedExpect(BACK_EDGE)), withFailedExpect(BACK_EDGE), true)).toBe(1);
  });

  it('X2: edge without --expect-* -> 1', () => {
    expect(historyExitCode('edge', BACK_EDGE, false)).toBe(1);
    expect(historyExitCode('edge', FWD_EDGE, false)).toBe(1);
  });

  it('X3: forward not-moved + failed --expect-* -> 4; back not-moved + failed --expect-* -> 4', () => {
    const fwd = withFailedExpect(verification({ tier: 'contradicted', checks: [doc('go_forward', 'none'), idx('go_forward', 'fail', 1, 0)] }));
    const back = withFailedExpect(verification({ tier: 'contradicted', checks: [doc('go_back', 'none'), idx('go_back', 'fail', 1, 2)] }));
    expect(historyExitCode(classifyHistoryOutcome('forward', fwd), fwd, true)).toBe(4);
    expect(historyExitCode(classifyHistoryOutcome('back', back), back, true)).toBe(4);
  });

  it('X4: moved: 0, or 4 with a failed expectation; unconfirmed: 0, or 4 with a failed expectation; not-moved without --expect-*: 0', () => {
    expect(historyExitCode('moved', MOVED_NEW_DOC, true)).toBe(0);
    expect(historyExitCode('moved', withFailedExpect(MOVED_NEW_DOC), true)).toBe(4);
    expect(historyExitCode('moved', withFailedExpect(MOVED_NEW_DOC), false)).toBe(0);
    const unc = verification({ tier: 'unverifiable', checks: [idx('go_back', 'not-run')] });
    expect(historyExitCode('unconfirmed', unc, false)).toBe(0);
    expect(historyExitCode('unconfirmed', withFailedExpect(unc), true)).toBe(4);
    expect(historyExitCode('not-moved', verification({ checks: [idx('go_back', 'fail')] }), false)).toBe(0);
  });
});

describe('I-NAV historyOutput (what is printed)', () => {
  const res = (v: VerificationResultDto | undefined, url = 'http://x/a', title = 'Page A'): Pick<NavigateResult, 'url' | 'title' | 'verification'> => ({ url, title, verification: v });
  const opts = { jsonMode: false, expectGiven: false };

  it('P1: a moved back/forward prints Navigated back|forward to <url>, Title, Verification; exit 0', () => {
    const back = historyOutput('back', res(MOVED_NEW_DOC), opts);
    expect(back.stdout).toHaveLength(3);
    expect(back.stdout[0]).toBe('Navigated back to http://x/a');
    expect(back.stdout[1]).toBe('Title: Page A');
    expect(back.stdout[2]).toMatch(/^Verification: verified \(confidence 0\.90\)/);
    expect(back.exitCode).toBe(0);
    const fwd = historyOutput('forward', res(verification({ checks: [doc('go_forward'), idx('go_forward', 'pass', 2, 2)] }), 'http://x/b', 'B'), opts);
    expect(fwd.stdout[0]).toBe('Navigated forward to http://x/b');
  });

  it('P2: a same-document move (pushState / #hash) is still "Navigated back"', () => {
    expect(historyOutput('back', res(MOVED_SAME_DOC, 'http://x/s#2'), opts).stdout[0]).toBe('Navigated back to http://x/s#2');
  });

  it('P3: edges print the exact edge lines on stdout and exit 1', () => {
    const b = historyOutput('back', res(BACK_EDGE, 'http://x/first'), opts);
    expect(b.stdout).toEqual(['Back: no history entry to go back to (still on http://x/first)']);
    expect(b.stderr).toEqual([]);
    expect(b.exitCode).toBe(1);
    const f = historyOutput('forward', res(FWD_EDGE, 'http://x/last'), opts);
    expect(f.stdout).toEqual(['Forward: no forward history entry (still on http://x/last)']);
    expect(f.exitCode).toBe(1);
  });

  it('P4: --json at an edge: the result JSON on stdout (containing the edge check), the edge line on stderr, exit 1', () => {
    const o = historyOutput('back', res(BACK_EDGE, 'http://x/first'), { jsonMode: true, expectGiven: false });
    expect(o.stdout).toHaveLength(1);
    const doc1 = JSON.parse(o.stdout[0]!) as { success: boolean; url: string; verification: { evidence: { checks: Array<{ check: string }> } } };
    expect(doc1.success).toBe(true);
    expect(doc1.url).toBe('http://x/first');
    expect(doc1.verification.evidence.checks.map((c) => c.check)).toContain('go_back.history-edge');
    expect(o.stderr).toEqual(['Back: no history entry to go back to (still on http://x/first)']);
    expect(o.exitCode).toBe(1);
  });

  it('P5: --json after a successful move parses and exits 0', () => {
    const o = historyOutput('back', res(MOVED_NEW_DOC), { jsonMode: true, expectGiven: false });
    expect(() => JSON.parse(o.stdout[0]!)).not.toThrow();
    expect(o.stderr).toEqual([]);
    expect(o.exitCode).toBe(0);
  });

  it('P6: an unconfirmed move prints the neutral line, never "Navigated" or "no history"; exit 0 (4 with a failed --expect-*)', () => {
    const unc = verification({ tier: 'unverifiable', checks: [{ check: 'go_back.document', outcome: 'not-run' }, idx('go_back', 'not-run')], reason: 'a beforeunload dialog is open (see dialogPending)', confidence: 0.45 });
    const o = historyOutput('back', res(unc), opts);
    expect(o.stdout[0]).toBe('Back requested; the history move could not be confirmed (a beforeunload dialog is open (see dialogPending))');
    expect(o.stdout.join('\n')).not.toMatch(/Navigated|no history|no forward/);
    expect(o.stdout[1]).toMatch(/^Verification: NOT verified/);
    expect(o.exitCode).toBe(0);
    const f = historyOutput('forward', res(verification({ checks: [] })), opts);
    expect(f.stdout[0]).toMatch(/^Forward requested; the history move could not be confirmed \(/);
    const withExpect = { ...unc, evidence: { ...unc.evidence, checks: [...unc.evidence.checks, { check: 'expect.url', outcome: 'fail' as const, expected: 'zz', observed: 'http://x/a' }] } };
    const o4 = historyOutput('back', res(withExpect as VerificationResultDto), { jsonMode: false, expectGiven: true });
    expect(o4.exitCode).toBe(4);
    expect(o4.stderr[0]).toMatch(/^Error: expectation failed: /);
  });

  it('P7: not-moved prints only the verification line ("NOT verified"), exit 0', () => {
    const nm = verification({ tier: 'contradicted', checks: [doc('go_back', 'none'), idx('go_back', 'fail', 1, 2)], reason: 'the history index did not move (still 2)', confidence: 0.09 });
    const o = historyOutput('back', res(nm), opts);
    expect(o.stdout).toHaveLength(1);
    expect(o.stdout[0]).toContain('NOT verified');
    expect(o.stdout[0]).toContain('the history index did not move');
    expect(o.exitCode).toBe(0);
  });

  it('P8: reload prints Reloaded <url>, Title, Verification; exit 0', () => {
    const rv = verification({ checks: [{ check: 'reload.document', outcome: 'pass', expected: 'new-document', observed: 'new-document' }], reason: 'a new document committed (loader changed)' });
    const o = historyOutput('reload', res(rv, 'http://x/r', 'R'), opts);
    expect(o.stdout[0]).toBe('Reloaded http://x/r');
    expect(o.stdout[1]).toBe('Title: R');
    expect(o.stdout[2]).toMatch(/^Verification: verified/);
    expect(o.exitCode).toBe(0);
  });
});

describe('I-NAV runHistoryCommand', () => {
  const okResult = (v: VerificationResultDto): NavigateResult => ({ tabId: 't1', url: 'http://x/a', title: 'A', verification: v });
  function fake(over: Partial<HistoryRuntime> = {}): HistoryRuntime & { calls: string[] } {
    const calls: string[] = [];
    const rt = {
      calls,
      goBack: async (...a: unknown[]) => { calls.push(`goBack(${JSON.stringify(a.slice(1))})`); return okResult(MOVED_NEW_DOC); },
      goForward: async (...a: unknown[]) => { calls.push(`goForward(${JSON.stringify(a.slice(1))})`); return okResult(MOVED_NEW_DOC); },
      reload: async (...a: unknown[]) => { calls.push(`reload(${JSON.stringify(a.slice(1))})`); return okResult(MOVED_NEW_DOC); },
      getDialogHistory: () => [] as Array<{ dialogType: string; action?: string; handledAt?: string }>,
      listTabs: async () => [{ url: 'http://x/cur', isActive: true }],
      ...over,
    };
    return rt as unknown as HistoryRuntime & { calls: string[] };
  }
  const base = { jsonMode: false, startedAt: Date.parse('2026-10-04T12:00:00.000Z'), pollMs: 0, pollTries: 2 };

  it('R1: each verb calls exactly its own runtime method with (sessionId, undefined, expect, settle)', async () => {
    const rt = fake();
    await runHistoryCommand(rt, 's1', { ...base, verb: 'back', expect: { urlChanged: true }, settle: true });
    await runHistoryCommand(rt, 's1', { ...base, verb: 'forward' });
    await runHistoryCommand(rt, 's1', { ...base, verb: 'reload', settle: true });
    expect(rt.calls).toEqual(['goBack([null,{"urlChanged":true},true])', 'goForward([null,null,null])', 'reload([null,null,true])']);
  });

  it('R2: a rejecting goBack/goForward/reload propagates (no "Navigated"/"Reloaded" line is ever produced)', async () => {
    for (const verb of ['back', 'forward', 'reload'] as const) {
      const rej = async () => { throw new Error('Navigation timeout of 30000 ms exceeded'); };
      const rt = fake({ goBack: rej, goForward: rej, reload: rej } as Partial<HistoryRuntime>);
      await expect(runHistoryCommand(rt, 's1', { ...base, verb })).rejects.toThrow('Navigation timeout');
    }
  });

  it('R3: a rejection with a dismissed beforeunload opened after the verb started is the cancel message, exit 1 (the dialog-history branch)', async () => {
    const history = [{ dialogType: 'beforeunload', action: 'dismiss', handledAt: '2026-10-04T12:00:05.000Z' }];
    for (const verb of ['back', 'reload'] as const) {
      const rej = async () => { throw new Error('Navigation timeout of 30000 ms exceeded'); };
      const rt = fake({ goBack: rej, reload: rej, getDialogHistory: () => history } as Partial<HistoryRuntime>);
      const out = await runHistoryCommand(rt, 's1', { ...base, verb });
      expect(out.exitCode).toBe(1);
      expect(out.outcome).toBe('cancelled');
      expect(out.stdout).toHaveLength(1);
      expect(out.stdout[0]).toContain("the page's beforeunload dialog was dismissed (--dialog dismiss is in effect)");
      expect(out.stdout[0]).toContain('http://x/cur');
    }
  });

  it('R4: a dismissed beforeunload from BEFORE the verb started, or an accepted one, is not a cancel: the error propagates', async () => {
    const rej = async () => { throw new Error('Navigation timeout of 30000 ms exceeded'); };
    for (const history of [
      [{ dialogType: 'beforeunload', action: 'dismiss', handledAt: '2026-10-04T11:59:59.000Z' }],
      [{ dialogType: 'beforeunload', action: 'accept', handledAt: '2026-10-04T12:00:05.000Z' }],
      [{ dialogType: 'alert', action: 'dismiss', handledAt: '2026-10-04T12:00:05.000Z' }],
    ]) {
      const rt = fake({ reload: rej, getDialogHistory: () => history } as Partial<HistoryRuntime>);
      await expect(runHistoryCommand(rt, 's1', { ...base, verb: 'reload' })).rejects.toThrow('Navigation timeout');
    }
  });

  it('R5: a RESOLVED verb with a dismissed beforeunload in the history is also the cancel (exit 1), never "Navigated"', async () => {
    const history = [{ dialogType: 'beforeunload', action: 'dismiss', handledAt: '2026-10-04T12:00:05.000Z' }];
    const rt = fake({ getDialogHistory: () => history });
    const out = await runHistoryCommand(rt, 's1', { ...base, verb: 'back' });
    expect(out.exitCode).toBe(1);
    expect(out.stdout.join('\n')).not.toContain('Navigated');
    expect(out.stdout[0]).toContain('beforeunload dialog was dismissed');
  });

  it('R6: a normal resolved verb is formatted through historyOutput (moved -> Navigated back)', async () => {
    const out = await runHistoryCommand(fake(), 's1', { ...base, verb: 'back' });
    expect(out.outcome).toBe('moved');
    expect(out.stdout[0]).toBe('Navigated back to http://x/a');
  });
});

describe('I-NAV dismissedBeforeunloadSince (shared with nav\'s isBeforeunloadCancel)', () => {
  const since = Date.parse('2026-10-04T12:00:00.000Z');
  it('D1: only a dismissed beforeunload handled at or after `since` counts', () => {
    expect(dismissedBeforeunloadSince([{ dialogType: 'beforeunload', action: 'dismiss', handledAt: '2026-10-04T12:00:00.000Z' }], since)).toBe(true);
    expect(dismissedBeforeunloadSince([{ dialogType: 'beforeunload', action: 'dismiss', handledAt: '2026-10-04T11:59:59.999Z' }], since)).toBe(false);
    expect(dismissedBeforeunloadSince([{ dialogType: 'beforeunload', action: 'accept', handledAt: '2026-10-04T12:00:01.000Z' }], since)).toBe(false);
    expect(dismissedBeforeunloadSince([{ dialogType: 'confirm', action: 'dismiss', handledAt: '2026-10-04T12:00:01.000Z' }], since)).toBe(false);
    expect(dismissedBeforeunloadSince([{ dialogType: 'beforeunload', action: 'dismiss' }], since)).toBe(false);
    expect(dismissedBeforeunloadSince([], since)).toBe(false);
  });

  it('D2: nav\'s isBeforeunloadCancel is unchanged: it still needs an ERR_ABORTED error', () => {
    const h = [{ dialogType: 'beforeunload', action: 'dismiss', handledAt: '2026-10-04T12:00:01.000Z' }];
    expect(isBeforeunloadCancel(new Error('net::ERR_ABORTED at http://x/'), h, since)).toBe(true);
    expect(isBeforeunloadCancel(new Error('Navigation timeout of 30000 ms exceeded'), h, since)).toBe(false);
  });
});
