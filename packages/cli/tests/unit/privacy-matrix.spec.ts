/**
 * @file packages/cli/tests/unit/privacy-matrix.spec.ts
 * @description FR2-11 fix-1: the GENERATED privacy matrix (tools/scenario-suite/lib/fr2-11-privacy-matrix.mjs) run
 * through everything the CLI writes or prints: every verb's args, the line's error / actionsUnavailable / actions,
 * the serialized history.jsonl line, and the human `sutradhar history` rows. audit-1 found scheme-less URLs stored
 * raw in `args` (F2) and full upload/download paths (F3); both are pinned here, not by hand-picked canaries.
 */
import { redactCliArgs, buildHistoryLine, formatHistoryHuman, type CliHistoryLineV1 } from '../../src/history-file.js';
import { redactHistoryText, sanitizeHistoryEntry } from '@sutradhar/browser';
import { fullMatrix, rotatingMatrix, evaluate, selfTest } from '../../../../tools/scenario-suite/lib/fr2-11-privacy-matrix.mjs';

const OPTS = { origin: 'http://127.0.0.1:5123', hostPort: '127.0.0.1:5123' };
const matrix = fullMatrix(OPTS);
const summarize = (f: { id: string; kind: string }[]): string => JSON.stringify(f.slice(0, 5), null, 1) + ` (${f.length} failing)`;
const leaksOnly = (f: { kind: string }[]) => f.filter((x) => x.kind === 'leak');

// every CLI verb that records a line, with the position the text can occupy
const VERBS = ['nav', 'newtab', 'audit', 'compare', 'click', 'clicktext', 'clickrole', 'hover', 'scroll', 'wait', 'waitfor', 'upload', 'download', 'screenshot', 'grant', 'focustab', 'closetab', 'drag', 'snap', 'text', 'tabs', 'axsnap'];

describe('FR2-11 fix-1: the canary search (self-test)', () => {
  it('passes its own controls', () => {
    expect(selfTest(OPTS).problems).toEqual([]);
  });
});

describe('FR2-11 fix-1: redactCliArgs', () => {
  for (const verb of VERBS) {
    it(`${verb}: the text as arg 0, arg 1 and arg 2 never leaks (${matrix.length} cells x 3 positions)`, () => {
      const f = evaluate(matrix, (t: string) => JSON.stringify([...redactCliArgs(verb, [t, 'x', 'y']), ...redactCliArgs(verb, ['x', t, 'y']), ...redactCliArgs(verb, ['x', 'y', t])]));
      expect(summarize(leaksOnly(f))).toBe('[] (0 failing)');
    });
  }
  it('type / select / dialog / setclipboard / eval keep their value redaction', () => {
    const f = evaluate(matrix, (t: string) =>
      JSON.stringify([
        redactCliArgs('type', ['#f', t]),
        redactCliArgs('select', ['#f', t]),
        redactCliArgs('dialog', ['accept', t]),
        redactCliArgs('setclipboard', [t]),
        redactCliArgs('eval', [`fetch(${JSON.stringify(t)})`]),
        redactCliArgs('eval', [t]),
        redactCliArgs('type', [t, 'hunter2']),
      ]),
    );
    expect(summarize(leaksOnly(f))).toBe('[] (0 failing)');
    expect(redactCliArgs('type', ['#pw', 'hunter2'])).toEqual(['#pw', '<7 chars>']);
    expect(redactCliArgs('setclipboard', ['a b'])).toEqual(['<3 chars>']);
    expect(redactCliArgs('select', ['#s', 'CNRYsel'])).toEqual(['#s', '<7 chars>']);
    expect(redactCliArgs('dialog', ['accept', 'Ada'])).toEqual(['accept', '<3 chars>']);
  });
  it('F2: a scheme-less URL argument is redacted (the audit-1 repro) and the display origin/path still shows', () => {
    expect(redactCliArgs('nav', ['127.0.0.1:5123/p?token=CNRYx'])).toEqual(['127.0.0.1:5123/p[redacted]']);
    expect(redactCliArgs('nav', ['example.com/?token=CNRYx'])).toEqual(['example.com/[redacted]']);
    expect(redactCliArgs('nav', ['example.com?token=CNRYx'])).toEqual(['example.com[redacted]']);
    expect(redactCliArgs('nav', ['http://127.0.0.1:5123/p?q=(a)&token=CNRYx'])).toEqual(['http://127.0.0.1:5123/p']);
    expect(redactCliArgs('click', ['a[href="http://h/p?q=1"]'])[0]).not.toContain('q=1');
  });
  it('F3: upload / screenshot / compare file arguments are stored as a basename; download / audit directory arguments as <dir>', () => {
    expect(redactCliArgs('upload', ['#file', 'C:\\Users\\CNRYu\\docs\\report.pdf'])).toEqual(['#file', 'report.pdf']);
    expect(redactCliArgs('upload', ['#file', '/home/CNRYu/docs/report.pdf'])).toEqual(['#file', 'report.pdf']);
    expect(redactCliArgs('upload', ['#file', 'CNRYrel/dir/report.pdf'])).toEqual(['#file', 'report.pdf']);
    expect(redactCliArgs('download', ['#dl', 'C:\\Users\\CNRYd\\out dir'])).toEqual(['#dl', '<dir>']);
    expect(redactCliArgs('screenshot', ['E:\\work\\CNRYs\\shot.png'])).toEqual(['shot.png']);
    expect(redactCliArgs('audit', ['http://h/p?t=CNRYa', 'C:\\x\\CNRYa\\out'])).toEqual(['http://h/p', '<dir>']);
    expect(redactCliArgs('compare', ['http://a/p?x=1', 'http://b/q#f', 'D:\\CNRYc\\cmp.png'])).toEqual(['http://a/p', 'http://b/q', 'cmp.png']);
  });
});

describe('FR2-11 fix-1: the serialized history.jsonl line and the human rows', () => {
  const lineFor = (t: string): CliHistoryLineV1 => {
    const entry = sanitizeHistoryEntry({
      actionType: 'navigate',
      selector: t,
      target: t,
      url: t,
      success: false,
      error: t,
      executionTimeMs: 1,
      timestamp: '2026-01-01T00:00:00.000Z',
      verification: { verified: false, confidence: 'none', reason: `Action failed: ${t}`, evidence: { tier: 'action-failed', checks: [{ check: 'c', outcome: 'fail', expected: t, observed: t, detail: t }] } },
    } as never);
    return buildHistoryLine({
      ts: '2026-01-01T00:00:00.000Z',
      sessionId: 's1',
      cwd: '/work/project',
      verb: 'nav',
      args: redactCliArgs('nav', [t]),
      exitCode: 1,
      durationMs: 5,
      error: t,
      actions: [{ ...entry, tabId: 'tab_1', seq: 1 }],
      actionsUnavailable: t,
    });
  };
  it('the raw JSON line has no canary, for every cell', () => {
    const f = evaluate(matrix, (t: string) => JSON.stringify(lineFor(t)));
    expect(summarize(leaksOnly(f))).toBe('[] (0 failing)');
  });
  it('the human `sutradhar history` output has no canary, for every cell', () => {
    const f = evaluate(matrix, (t: string) => formatHistoryHuman({ lines: [{ raw: '', parsed: lineFor(t) as never }], skipped: 0, rotatedExists: false }, { file: '/state/history.jsonl' }));
    expect(summarize(leaksOnly(f))).toBe('[] (0 failing)');
  });
  it('a line written by an OLDER (leaky) build is not shown with its query in the human output', () => {
    const old = { v: 1, type: 'command', ts: '2026-01-01T00:00:00.000Z', sessionId: 's', cwd: '/w', verb: 'nav', args: ['127.0.0.1:5/p?token=CNRYold', 'http://h/p?n=1&token=CNRYold2'], exitCode: 0, durationMs: 1, actions: [], actionsEvicted: 0 };
    const out = formatHistoryHuman({ lines: [{ raw: JSON.stringify(old), parsed: old as never }], skipped: 0, rotatedExists: false }, { file: '/s/h.jsonl' });
    expect(out).not.toContain('CNRYold');
  });
  it('the CLI and the browser package share ONE redaction function (same output on every cell)', () => {
    const rotated = rotatingMatrix(OPTS);
    const bad = rotated.filter((c: { text: string }) => redactCliArgs('click', [c.text])[0] !== redactHistoryText(c.text).slice(0, 200));
    expect(bad.map((c: { id: string }) => c.id)).toEqual([]);
  });
});
