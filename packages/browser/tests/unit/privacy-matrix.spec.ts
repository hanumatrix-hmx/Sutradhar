/**
 * @file packages/browser/tests/unit/privacy-matrix.spec.ts
 * @description FR2-11 fix-1: the GENERATED privacy matrix (every secret position x every surround, see
 * tools/scenario-suite/lib/fr2-11-privacy-matrix.mjs) run through every stored string of a history entry.
 * audit-1 REOPENed on hand-picked canaries; here a cell that leaks, or one that over-redacts the display
 * origin/path or a file basename, fails by name.
 */
import {
  redactHistoryUrl,
  redactUrlsInText,
  sanitizeHistoryEntry,
  evalCodePreview,
  type ActionHistoryEntry,
} from '../../src/index.js';
import { fullMatrix, evaluate, selfTest, findCanaries, urlCases, pathCases } from '../../../../tools/scenario-suite/lib/fr2-11-privacy-matrix.mjs';

const matrix = fullMatrix({ origin: 'http://127.0.0.1:5123', hostPort: '127.0.0.1:5123' });
const entryOf = (over: Record<string, unknown>): ActionHistoryEntry =>
  ({ actionType: 'click', success: false, executionTimeMs: 1, timestamp: '2026-01-01T00:00:00.000Z', ...over }) as unknown as ActionHistoryEntry;
const summarize = (f: { id: string; kind: string }[]): string => JSON.stringify(f.slice(0, 5), null, 1) + ` (${f.length} failing)`;
/** Stored JSON of a sanitized entry that carries the text in `field`. */
const stored = (over: Record<string, unknown>): string => JSON.stringify(sanitizeHistoryEntry(entryOf(over)));

describe('FR2-11 fix-1: the canary search itself (self-test + negative controls)', () => {
  it('sees a canary in every generated text, catches an identity redactor on every cell, and catches an eraser', () => {
    const r = selfTest({ origin: 'http://127.0.0.1:5123', hostPort: '127.0.0.1:5123' });
    expect(r.problems).toEqual([]);
    expect(r.cases).toBeGreaterThanOrEqual(1000);
  });
  it('the matrix covers every required secret position', () => {
    const ids = [...urlCases(), ...pathCases()].map((c) => c.id).join(' ');
    for (const needle of ['query-', 'fragment-', 'userinfo-', 'path-param', 'schemeless-', 'ipv6-', 'pct-brackets', 'multi-url', 'data-url', 'blob-url', 'win-', 'unc', 'posix', 'spaces', 'file-url']) {
      expect(ids).toContain(needle);
    }
  });
});

describe('FR2-11 fix-1: free text (redactUrlsInText)', () => {
  it('no cell leaks and none over-redacts the origin/path or a basename', () => {
    const f = evaluate(matrix, (t: string) => redactUrlsInText(t));
    expect(summarize(f)).toBe('[] (0 failing)');
  });
  it('is idempotent on every cell', () => {
    const bad = matrix.filter((c: { text: string }) => redactUrlsInText(redactUrlsInText(c.text)) !== redactUrlsInText(c.text));
    expect(bad.map((c: { id: string }) => c.id).slice(0, 5)).toEqual([]);
  });
});

describe('FR2-11 fix-1: every string field of a stored history entry', () => {
  const fields: [string, (t: string) => Record<string, unknown>][] = [
    ['error', (t) => ({ error: t })],
    ['selector', (t) => ({ selector: t })],
    ['target (non-navigate)', (t) => ({ target: t })],
    ['target (navigate)', (t) => ({ actionType: 'navigate', target: t })],
    ['target (eval preview)', (t) => ({ actionType: 'eval', target: t })],
    ['url', (t) => ({ url: t })],
    ['verification.reason', (t) => ({ verification: { verified: false, confidence: 'none', reason: `Action failed: ${t}`, evidence: { tier: 'action-failed', checks: [] } } })],
    ['evidence expected', (t) => ({ verification: { verified: false, confidence: 'none', reason: 'r', evidence: { tier: 'x', checks: [{ check: 'c', outcome: 'fail', expected: t }] } } })],
    ['evidence observed', (t) => ({ verification: { verified: false, confidence: 'none', reason: 'r', evidence: { tier: 'x', checks: [{ check: 'c', outcome: 'fail', observed: t }] } } })],
    ['evidence detail', (t) => ({ verification: { verified: false, confidence: 'none', reason: 'r', evidence: { tier: 'x', checks: [{ check: 'c', outcome: 'fail', detail: t }] } } })],
  ];
  for (const [name, build] of fields) {
    it(`${name}: no canary survives, for ${matrix.length} cells`, () => {
      const f = evaluate(matrix, (t: string) => stored(build(t)));
      const leaks = f.filter((x: { kind: string }) => x.kind !== 'over-redacted'); // keep-checks are made on redactUrlsInText above
      expect(summarize(leaks)).toBe('[] (0 failing)');
    });
  }
  it('evalCodePreview redacts the same cells', () => {
    const f = evaluate(matrix, (t: string) => evalCodePreview(`fetch(${JSON.stringify(t)})`)).filter((x: { kind: string }) => x.kind === 'leak');
    expect(summarize(f)).toBe('[] (0 failing)');
  });
});

describe('FR2-11 fix-1: redactHistoryUrl on every bare URL and path cell', () => {
  it('no canary survives a bare value (no surround)', () => {
    const bare = matrix.filter((c: { id: string }) => c.id.endsWith('|""""'));
    expect(bare.length).toBeGreaterThan(50);
    const f = evaluate(bare, (t: string) => redactHistoryUrl(t)).filter((x: { kind: string }) => x.kind === 'leak');
    expect(summarize(f)).toBe('[] (0 failing)');
  });
  it('the display origin and pathname still show for an http URL', () => {
    expect(redactHistoryUrl('http://127.0.0.1:5/p/q?x=(a)&t=1#f')).toBe('http://127.0.0.1:5/p/q');
    expect(redactHistoryUrl('https://a.test/p;jsessionid=Z/q')).toBe('https://a.test/p');
  });
});

describe('FR2-11 fix-1: what is deliberately NOT removed', () => {
  it('ordinary text, selectors and page paths without a URL marker are untouched', () => {
    for (const s of ['No element found for selector: #btn', 'input[type=file]', 'a new document committed', 'Did it work?', 'expected "Welcome" to be visible']) {
      expect(redactUrlsInText(s)).toBe(s);
    }
    expect(findCanaries(redactUrlsInText('x'))).toEqual([]);
  });
});
