/**
 * @file packages/browser/tests/unit/action-history.spec.ts
 * @description FR2-11: the pure history sanitizer. Every string that reaches a stored history entry (and,
 * through the CLI, history.jsonl) passes through these functions, so the privacy contract is pinned here:
 * query/fragment never survive, typed values are never read, and no input is mutated.
 */
import {
  redactHistoryUrl,
  redactUrlsInText,
  capHistoryString,
  evalCodePreview,
  sanitizeHistoryEntry,
  describeActionTarget,
  scrubActionError,
  scrubVerification,
  HISTORY_STRING_CAP,
  HISTORY_TEXT_CAP,
  type ActionHistoryEntry,
  type ActionParams,
} from '../../src/index.js';

const base = { actionType: 'click', success: true, executionTimeMs: 3, timestamp: '2026-01-01T00:00:00.000Z' } as const;

describe('FR2-11 redactHistoryUrl (H1, H2)', () => {
  it('H1: drops query and fragment', () => {
    expect(redactHistoryUrl('https://a.test/p/x?token=S#frag')).toBe('https://a.test/p/x');
  });
  it('H2: scheme table', () => {
    // fix-1 F3: a file: URL never stores its full local path, only the basename
    expect(redactHistoryUrl('file:///E:/r/f.html?t=1')).toBe('file://…/f.html');
    expect(redactHistoryUrl('data:text/html,<b>x')).toBe('data:…');
    expect(redactHistoryUrl('about:blank')).toBe('about:blank');
    expect(redactHistoryUrl('')).toBe('(no url)');
    expect(redactHistoryUrl('not a url')).toBe('not a url');
    expect(redactHistoryUrl('wss://h:1/devtools/browser/abc?x=1')).toBe('wss://h:1/devtools/browser/abc');
    expect(redactHistoryUrl('blob:https://a.test/0000-1111')).toBe('blob:https://a.test');
    expect(redactHistoryUrl('chrome-error://chromewebdata/')).toBe('chrome-error://chromewebdata/');
  });
  it('drops userinfo, javascript: bodies, and the query of an unparsable string', () => {
    expect(redactHistoryUrl('https://user:pw@a.test/p?x=1')).toBe('https://a.test/p');
    expect(redactHistoryUrl('javascript:localStorage.setItem("jwt","SECRET")')).toBe('javascript:…');
    expect(redactHistoryUrl('no scheme?token=SECRET#f')).toBe('no scheme');
    expect(redactHistoryUrl('about:blank?x=SECRET#y')).toBe('about:blank');
  });
});

describe('FR2-11 redactUrlsInText / capHistoryString / evalCodePreview (H3, H4, H5, N12)', () => {
  it('H3: redacts every URL token inside free text', () => {
    const out = redactUrlsInText('Current URL http://x.test/a?t=S does not contain y; also https://b.test/?k=S2');
    expect(out).not.toContain('S2');
    expect(out).not.toMatch(/t=S/);
    expect(out).toContain('http://x.test/a');
    // fix-2: the rule is per character, and everything after a cut (here `y;`) is dropped, so the second URL is gone with its secret
    expect(out).toBe('Current URL http://x.test/a[redacted]');
    expect(redactUrlsInText('see data:text/plain;base64,QUJD now')).toBe('see data:…');
  });
  it('H4: cap with an ellipsis, control chars become spaces, a 199-char string is untouched', () => {
    const c = capHistoryString('a'.repeat(250));
    expect(c).toHaveLength(200);
    expect(c.endsWith('…')).toBe(true);
    expect(capHistoryString('a\nb')).toBe('a b');
    expect(capHistoryString('a'.repeat(199))).toBe('a'.repeat(199));
    expect(capHistoryString('a'.repeat(200))).toBe('a'.repeat(200));
    expect(capHistoryString('a'.repeat(301), 300)).toHaveLength(300);
  });
  it('H5 / N12: eval preview collapses whitespace, drops URL secrets, caps at 200', () => {
    const p = evalCodePreview('  const x =\n  1;\n\n fetch("https://t.test/?k=S") ');
    expect(p).toBe('const x [redacted] 1[redacted]'); // fix-2: `=` and `;` are the rule's characters (deviation D-fix2-3)
    expect(p).not.toContain('S"');
    expect(p).not.toMatch(/\n/);
    const long = evalCodePreview('x '.repeat(5000));
    expect(long).toHaveLength(200);
    expect(long.endsWith('…')).toBe(true);
  });
});

describe('FR2-11 sanitizeHistoryEntry (H6)', () => {
  it('URL rule for navigate targets, preview rule for eval targets, generic redaction otherwise', () => {
    const nav = sanitizeHistoryEntry({ ...base, actionType: 'navigate', target: 'https://a.test/p?token=SECRET#f' });
    expect(nav.target).toBe('https://a.test/p');
    const ev = sanitizeHistoryEntry({ ...base, actionType: 'eval', target: 'a =\n 1;\nfetch("https://t.test/?k=SECRET")' });
    expect(ev.target).toBe('a [redacted] 1[redacted]');
    const other = sanitizeHistoryEntry({ ...base, actionType: 'click_by_text', target: 'go to https://t.test/x?k=SECRET now' });
    expect(other.target).not.toContain('SECRET');
  });
  it('caps error at 300, selector and target at 200', () => {
    const out = sanitizeHistoryEntry({ ...base, success: false, error: 'e'.repeat(500), selector: 's'.repeat(300), target: 't'.repeat(300) });
    expect(out.error).toHaveLength(HISTORY_TEXT_CAP);
    expect(out.selector).toHaveLength(HISTORY_STRING_CAP);
    expect(out.target).toHaveLength(HISTORY_STRING_CAP);
  });
  it('pre-FR2-07 verification (no evidence) keeps exactly its keys, reason redacted', () => {
    const v = { verified: true, urlChanged: false, elementFound: true, confidence: 0.9, reason: 'Current URL http://x/?t=SECRET ok' };
    const out = sanitizeHistoryEntry({ ...base, verification: v as never });
    expect(Object.keys(out.verification!).sort()).toEqual(['confidence', 'elementFound', 'reason', 'urlChanged', 'verified']);
    expect(out.verification!.reason).not.toContain('SECRET');
    expect(JSON.stringify(out)).not.toContain('SECRET');
  });
  it('post-FR2-07 verification: evidence observed/expected redacted, detail capped at 300, scalars pass through', () => {
    const v = {
      verified: false,
      urlChanged: false,
      elementFound: false,
      confidence: 0.09,
      reason: 'r',
      evidence: {
        tier: 'contradicted',
        checks: [
          { check: 'navigate.committed', outcome: 'fail', observed: 'http://x/?t=SECRET', expected: 'http://y/?u=SECRET2', detail: 'd'.repeat(400) },
          { check: 'x.n', outcome: 'pass', observed: 7, expected: true },
          { check: 'x.none', outcome: 'not-run' },
        ],
      },
    };
    const out = sanitizeHistoryEntry({ ...base, verification: v as never });
    const checks = (out.verification as any).evidence.checks;
    expect(checks[0].observed).toBe('http://x/[redacted]');
    expect(checks[0].expected).toBe('http://y/[redacted]');
    expect(checks[0].detail).toHaveLength(300);
    expect(checks[1]).toEqual({ check: 'x.n', outcome: 'pass', observed: 7, expected: true });
    expect('observed' in checks[2]).toBe(false);
    expect((out.verification as any).evidence.tier).toBe('contradicted');
    expect(JSON.stringify(out)).not.toContain('SECRET');
  });
  it('never mutates its input (deep-equal to a structuredClone taken before) and returns a new object', () => {
    const input: ActionHistoryEntry = {
      ...base,
      selector: '#a',
      error: 'x http://q/?t=SECRET',
      url: 'http://z/?a=SECRET',
      verification: {
        verified: true,
        urlChanged: true,
        elementFound: true,
        confidence: 1,
        reason: 'http://x/?t=SECRET',
        evidence: { tier: 'verified', checks: [{ check: 'c', outcome: 'pass', observed: 'http://x/?t=SECRET' }] },
      } as never,
    };
    const before = structuredClone(input);
    const out = sanitizeHistoryEntry(input);
    expect(input).toEqual(before);
    expect(out).not.toBe(input);
    expect(out.verification).not.toBe(input.verification);
  });
  it('undefined keys stay absent', () => {
    const out = sanitizeHistoryEntry({ ...base, error: undefined, selector: undefined, target: undefined, url: undefined, verification: undefined });
    for (const k of ['error', 'selector', 'target', 'url', 'verification']) expect(k in out).toBe(false);
  });
});

describe('FR2-11 describeActionTarget (H7) and scrubActionError', () => {
  it('press_key joins modifiers and the key', () => {
    expect(describeActionTarget({ actionType: 'press_key', key: 'ArrowRight', modifiers: ['Control', 'Shift'] })).toBe('Control+Shift+ArrowRight');
  });
  it('NEVER the typed value', () => {
    expect(describeActionTarget({ actionType: 'type', selector: '#pw', value: 'hunter2' })).toBeUndefined();
    expect(describeActionTarget({ actionType: 'select_option', selector: '#s', value: 'hunter2', values: ['hunter2'] })).toBeUndefined();
    expect(describeActionTarget({ actionType: 'type_by_label', label: 'Password', value: 'hunter2' })).toBe('Password');
  });
  it('role/name, upload basename (windows and posix), navigate url, scroll, wait, wait_for_selector', () => {
    expect(describeActionTarget({ actionType: 'click_by_role', role: 'button', name: 'Save' })).toBe('button "Save"');
    expect(describeActionTarget({ actionType: 'click_by_role', role: 'button' })).toBe('button');
    expect(describeActionTarget({ actionType: 'upload_file', filePath: 'C:\\a\\b\\c.pdf' })).toBe('c.pdf');
    expect(describeActionTarget({ actionType: 'upload_file', filePath: '/a/b/d.pdf' })).toBe('d.pdf');
    expect(describeActionTarget({ actionType: 'navigate', url: 'https://a.test/?t=S' })).toBe('https://a.test/?t=S');
    expect(describeActionTarget({ actionType: 'scroll', direction: 'down', amount: 500 })).toBe('down 500');
    expect(describeActionTarget({ actionType: 'wait', milliseconds: 50 })).toBe('50ms');
    expect(describeActionTarget({ actionType: 'wait_for_selector', state: 'hidden' })).toBe('state=hidden');
    expect(describeActionTarget({ actionType: 'click', selector: '#x' })).toBeUndefined();
  });
  it('scrubActionError removes a typed value and the field content from a "type did not land" failure', () => {
    const p: ActionParams = { actionType: 'type', selector: '#pw', value: 'hunter2-SECRET' };
    const e =
      'type did not land the expected value — expected "hunter2-SECRET", but the element\'s real content reads "other-SECRET-2" even after a native-setter fill';
    const out = scrubActionError(p, e);
    expect(out).not.toContain('SECRET');
    expect(out.startsWith('type did not land the expected value')).toBe(true);
    expect(scrubActionError({ actionType: 'select_option', selector: '#s', value: 'opt-SECRET' }, 'No option "opt-SECRET" found')).toBe(
      'No option <value> found',
    );
    expect(scrubActionError({ actionType: 'click', selector: '#x' }, 'boom')).toBe('boom');
  });
  it('F5 (audit-1 mutant A5): type_by_label gets the SAME did-not-land scrub as type: the typed value AND the field content are both gone', () => {
    const p: ActionParams = { actionType: 'type_by_label', label: 'Password', value: 'hunter2-SECRET' };
    // the field reversed what was typed, so its real content ("TERCES-2retnuh") does NOT contain the typed value
    const e =
      'Action failed: type did not land the expected value — expected "hunter2-SECRET", but the element\'s real content reads "TERCES-2retnuh" even after a native-setter fill';
    const out = scrubActionError(p, e);
    expect(out).not.toContain('hunter2');
    expect(out).not.toContain('TERCES');
    expect(out).not.toContain('2retnuh');
    expect(out.startsWith('Action failed: type did not land the expected value')).toBe(true);
    const v = {
      verified: false,
      urlChanged: false,
      elementFound: false,
      confidence: 0,
      reason: e,
      evidence: { tier: 'action-failed', checks: [{ check: 'c', outcome: 'fail', detail: e }] },
    };
    const sv = JSON.stringify(scrubVerification(p, v as never));
    expect(sv).not.toContain('hunter2');
    expect(sv).not.toContain('TERCES');
    // the field content is also dropped from the stored entry when the engine records it (whole path, not just the helper)
    const stored = JSON.stringify(sanitizeHistoryEntry({ ...base, actionType: 'type_by_label', success: false, error: scrubActionError(p, e) }));
    expect(stored).not.toContain('TERCES');
  });
  it('scrubVerification cleans the "Action failed: <error>" reason of a failed action and evidence strings, without mutating', () => {
    const p: ActionParams = { actionType: 'type', selector: '#pw', value: 'hunter2-SECRET' };
    const v = {
      verified: false,
      urlChanged: false,
      elementFound: false,
      confidence: 0,
      reason: 'Action failed: type did not land the expected value — expected "hunter2-SECRET", but the field real content reads "zzz-2"',
      evidence: { tier: 'action-failed', checks: [{ check: 'c', outcome: 'fail', observed: 'typed hunter2-SECRET', detail: 'saw "hunter2-SECRET"' }] },
    };
    const before = structuredClone(v);
    const out = scrubVerification(p, v as never);
    expect(v).toEqual(before);
    expect(JSON.stringify(out)).not.toContain('SECRET');
    expect(JSON.stringify(out)).not.toContain('zzz-2');
    expect((out as any).reason.startsWith('Action failed: type did not land')).toBe(true);
  });
});
