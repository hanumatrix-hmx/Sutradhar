/**
 * @file packages/cli/tests/unit/char-rule.spec.ts
 * @description FR2-11 fix-2: the character rule on every CLI surface (args of every verb, the thrown error, the serialized
 * history.jsonl line, the human `sutradhar history` rows) and the `cwd` rule (home-relative or `<dir>`). Property cases are the
 * same seeded strings as the browser package's spec (seed and count below); the isolated cells are the ones only ONE rule protects.
 */
import os from 'node:os';
import { redactCliArgs, buildHistoryLine, formatHistoryHuman, redactCwd, type CliHistoryLineV1 } from '../../src/history-file.js';
import { REDACTED_PLACEHOLDER } from '@sutradhar/browser';
import { generate, DEFAULT_SEED } from '../../../../tools/scenario-suite/lib/fr2-11-property.mjs';

const N_CASES = 4000;
const cases = generate(DEFAULT_SEED + 11, N_CASES) as { id: string; kind: string; secret: string; text: string }[];
const P = REDACTED_PLACEHOLDER;

const VERBS = ['nav', 'newtab', 'audit', 'compare', 'click', 'clicktext', 'clickrole', 'hover', 'scroll', 'wait', 'waitfor', 'upload', 'download', 'screenshot', 'grant', 'focustab', 'closetab', 'drag', 'snap', 'text', 'tabs', 'axsnap', 'press', 'eval', 'type', 'select', 'dialog', 'setclipboard'];
const URL_SHAPED_BEFORE = /[/\\@%]|:[0-9/]|:$/;
/** The selector verbs keep `#id` and `[a=b]` (documented); every other position is checked. */
const selectorExempt = (t: string, secret: string): boolean => {
  const before = t.slice(0, Math.max(0, t.indexOf(secret)));
  if (URL_SHAPED_BEFORE.test(before)) return false;
  return before.endsWith('#') || /\[[^\]\s]*=$/.test(before);
};

describe(`FR2-11 fix-2 CLI property test (seed ${DEFAULT_SEED + 11}, ${N_CASES} generated strings x ${VERBS.length} verbs x 3 positions)`, () => {
  it('SECRET is absent from every verb, every arg position, the thrown error and the serialized line', () => {
    const leaks: { id: string; where: string; text: string }[] = [];
    for (const c of cases) {
      const sel = selectorExempt(c.text, c.secret);
      for (const verb of VERBS) {
        const out = JSON.stringify([
          redactCliArgs(verb, [c.text, 'x', 'y']),
          redactCliArgs(verb, ['x', c.text, 'y']),
          redactCliArgs(verb, ['x', 'y', c.text]),
        ]);
        // a selector verb stores a bare `#id` / `[a=b]` as written (documented): only those cells are exempt, and only in a selector position
        if (out.includes(c.secret) && !(sel && ['click', 'hover', 'type', 'select', 'press', 'drag', 'upload', 'download'].includes(verb))) leaks.push({ id: c.id, where: verb, text: c.text });
      }
      const line = JSON.stringify(buildHistoryLine({ ts: 't', sessionId: 's', cwd: '/w', verb: 'nav', args: [], exitCode: 1, durationMs: 1, error: c.text, actionsUnavailable: c.text }));
      if (line.includes(c.secret)) leaks.push({ id: c.id, where: 'line', text: c.text });
    }
    expect(leaks.slice(0, 8)).toEqual([]);
    expect(leaks.length).toBe(0);
  });
  it('the human `history` output applies the same rule to a line an older build wrote with a query in it', () => {
    const bad: string[] = [];
    for (const c of cases.slice(0, 1500)) {
      const parsed = {
        v: 1, ts: '2026-09-25T14:02:11.123Z', sessionId: 's', verb: 'nav', args: [c.text], exitCode: 1, durationMs: 1, error: c.text, actionsUnavailable: c.text,
        actions: [{ actionType: 'navigate', success: false, target: c.text, error: c.text, tabId: 't', seq: 1 }], actionsEvicted: 0,
      };
      const out = formatHistoryHuman({ lines: [{ raw: '', parsed: parsed as never }], skipped: 0, rotatedExists: false }, { file: '/f' });
      if (out.includes(c.secret)) bad.push(c.text);
    }
    expect(bad.slice(0, 5)).toEqual([]);
  });
});

describe('FR2-11 fix-2 CLI ISOLATED cells (one rule each)', () => {
  const S = 'CNRYcli1X';
  const any = (verb: string, t: string): string => JSON.stringify([redactCliArgs(verb, [t]), redactCliArgs(verb, ['x', t])]);
  it('rule (a): bare `#S` as a clicktext / waitfor argument (free text, not a selector)', () => {
    expect(any('clicktext', `#${S}`)).not.toContain(S);
    expect(redactCliArgs('clicktext', [`#${S}`])).toEqual([P]);
  });
  it('rule (a): bare `?=S` and a custom-scheme redirect and about:blank#S in args and in the thrown error', () => {
    for (const t of [`?=${S}`, `com.example.app:/cb#access_token=${S}`, `about:blank#${S}`, `intranet:8080/p#${S}`]) {
      expect(any('clicktext', t)).not.toContain(S);
      expect(any('nav', t)).not.toContain(S);
      expect(JSON.stringify(buildHistoryLine({ ts: 't', sessionId: 's', cwd: '/w', verb: 'nav', args: [], exitCode: 1, durationMs: 1, error: `net::ERR_ABORTED at ${t}` }))).not.toContain(S);
    }
  });
  it('rule (b): a form token `a=S` as an argument', () => {
    expect(any('clicktext', `a=${S}`)).not.toContain(S);
    expect(redactCliArgs('clicktext', [`a=${S}`])).toEqual([P]);
  });
  it('rule (c): `user:S@host/` as an argument', () => {
    expect(any('clicktext', `user:${S}@host/`)).not.toContain(S);
    expect(redactCliArgs('clicktext', [`user:${S}@host/`])).toEqual(['host/']);
  });
  it('decoding: `%23S` as an argument', () => {
    expect(any('clicktext', `%23${S}`)).not.toContain(S);
    expect(any('clicktext', `x%253F${S}`)).not.toContain(S);
  });
  it('the path rule: a directory with the canary in a file argument and in a free-text argument', () => {
    for (const t of [`C:\\Users\\${S}\\f.txt`, `//srv/share/${S}/f.txt`, `/home/${S}/f.txt`]) {
      expect(any('upload', t)).not.toContain(S);
      expect(any('clicktext', t)).not.toContain(S);
      expect(redactCliArgs('screenshot', [t])).toEqual(['f.txt']);
    }
  });
  it('selector verbs keep a selector readable', () => {
    expect(redactCliArgs('click', ['#bump'])).toEqual(['#bump']);
    expect(redactCliArgs('type', ['input[name=q]', 'hunter2'])).toEqual(['input[name=q]', '<7 chars>']);
    expect(redactCliArgs('click', [`https://x.test/p#${S}`])[0]).not.toContain(S);
  });
});

describe('FR2-11 fix-2 cwd: home-relative or <dir>, never the home directory name', () => {
  const S = 'CNRYcwd1X';
  it('under the home directory: ~/sub/dir; the home directory itself: ~; outside: <dir>', () => {
    expect(redactCwd(`C:\\Users\\${S}\\work\\proj`, `C:\\Users\\${S}`)).toBe('~/work/proj');
    expect(redactCwd(`c:\\users\\${S}\\work`, `C:\\Users\\${S}`)).toBe('~/work'); // Windows is case-insensitive
    expect(redactCwd(`C:\\Users\\${S}`, `C:\\Users\\${S}`)).toBe('~');
    expect(redactCwd(`/home/${S}/a b/c`, `/home/${S}`)).toBe('~/a b/c');
    expect(redactCwd(`D:\\${S}\\work`, `C:\\Users\\${S}`)).toBe('<dir>');
    expect(redactCwd(`/srv/${S}/app`, `/home/x`)).toBe('<dir>');
    expect(redactCwd(`/home/xy/app`, `/home/x`)).toBe('<dir>'); // a sibling that merely starts with the same letters is not under home
  });
  it('idempotent, and the real OS home directory name is absent from a line built from a cwd under it', () => {
    expect(redactCwd('~/work')).toBe('~/work');
    expect(redactCwd('<dir>')).toBe('<dir>');
    const home = os.homedir();
    const line: CliHistoryLineV1 = buildHistoryLine({ ts: 't', sessionId: 's', cwd: `${home}${os.platform() === 'win32' ? '\\' : '/'}proj`, verb: 'nav', args: [], exitCode: 0, durationMs: 1 });
    expect(line.cwd).toBe('~/proj');
    expect(JSON.stringify(line)).not.toContain(home.replace(/\\/g, '\\\\'));
  });
  it('buildHistoryLine stores cwd through the rule, with an injected home (cwd rule is the ONLY thing that protects this canary)', () => {
    const inside = buildHistoryLine({ ts: 't', sessionId: 's', cwd: `C:\\Users\\${S}\\proj`, home: `C:\\Users\\${S}`, verb: 'nav', args: [], exitCode: 0, durationMs: 1 });
    expect(JSON.stringify(inside)).not.toContain(S);
    const outside = buildHistoryLine({ ts: 't', sessionId: 's', cwd: `D:\\${S}\\proj`, home: 'C:\\Users\\nobody', verb: 'nav', args: [], exitCode: 0, durationMs: 1 });
    expect(JSON.stringify(outside)).not.toContain(S);
    expect(outside.cwd).toBe('<dir>');
  });
});
