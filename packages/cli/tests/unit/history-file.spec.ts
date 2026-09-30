/**
 * @file packages/cli/tests/unit/history-file.spec.ts
 * @description FR2-11: the CLI's history.jsonl. Arg redaction (typed text / clipboard / eval / dialog / select
 * never stored), the line builder and its size guard, append (creation, rotation, torn-line repair, never
 * throws), the tolerant reader, the exact human format, and that clearing session state never deletes history.
 */
import { mkdtemp, rm, readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  redactCliArgs,
  secretsOfCliArgs,
  buildHistoryLine,
  appendHistoryLine,
  readHistoryFile,
  formatHistoryHuman,
  HISTORY_MAX_LINE_BYTES,
  HISTORY_ROTATED_FILE_NAME,
  type CliHistoryLineV1,
} from '../../src/history-file.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'fr2-11-hist-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const baseInput = {
  ts: '2026-09-25T14:02:11.123Z',
  sessionId: 'sess_1',
  cwd: '/w',
  verb: 'nav',
  args: ['http://x/'],
  exitCode: 0,
  durationMs: 12,
};
const line = (over: Partial<CliHistoryLineV1> = {}): CliHistoryLineV1 => ({ ...buildHistoryLine(baseInput), ...over });

describe('FR2-11 redactCliArgs / secretsOfCliArgs (C1)', () => {
  it('C1: typed text, clipboard text, eval, nav, dialog, select', () => {
    expect(redactCliArgs('type', ['#pw', 'hunter', '2'])).toEqual(['#pw', '<8 chars>']);
    expect(redactCliArgs('setclipboard', ['a b'])).toEqual(['<3 chars>']);
    const ev = redactCliArgs('eval', ['fetch("https://t/?k=SECRET-E")']);
    expect(ev.join('')).not.toContain('SECRET-E');
    expect(redactCliArgs('nav', ['https://a/p?token=SECRET-N#f'])).toEqual(['https://a/p']);
    expect(redactCliArgs('dialog', ['accept'])).toEqual(['accept']);
    expect(redactCliArgs('dialog', ['accept', 'Ada'])).toEqual(['accept', '<3 chars>']);
    expect(redactCliArgs('select', ['#country', 'SECRET-OPT'])).toEqual(['#country', '<10 chars>']);
  });
  it('type with no text and click with a selector; every arg capped at 200', () => {
    expect(redactCliArgs('type', ['#pw'])).toEqual(['#pw']);
    expect(redactCliArgs('type', [])).toEqual([]);
    expect(redactCliArgs('click', ['#go'])).toEqual(['#go']);
    expect(redactCliArgs('click', ['a'.repeat(500)])[0]).toHaveLength(200);
  });
  it('secretsOfCliArgs names the raw strings the verbs must not leak', () => {
    expect(secretsOfCliArgs('type', ['#pw', 'hunter', '2'])).toEqual(['hunter 2']);
    expect(secretsOfCliArgs('setclipboard', ['tok', 'en'])).toEqual(['tok en']);
    expect(secretsOfCliArgs('dialog', ['accept', 'Ada'])).toEqual(['Ada']);
    expect(secretsOfCliArgs('click', ['#x'])).toEqual([]);
  });
});

describe('FR2-11 buildHistoryLine (C2, C3)', () => {
  it('C2: exactly the base keys, v 1 and type command, no error/truncated when not given', () => {
    const l = buildHistoryLine(baseInput);
    expect(Object.keys(l).sort()).toEqual(
      ['actions', 'actionsEvicted', 'args', 'cwd', 'durationMs', 'exitCode', 'sessionId', 'ts', 'type', 'v', 'verb'].sort(),
    );
    expect(l.v).toBe(1);
    expect(l.type).toBe('command');
    expect(l.actions).toEqual([]);
    expect(l.actionsEvicted).toBe(0);
  });
  it('error is URL-redacted and capped at 300', () => {
    const l = buildHistoryLine({ ...baseInput, error: 'z'.repeat(500) + ' bad http://x/?t=SECRET-ERR' });
    expect(l.error).toHaveLength(300);
    const u = buildHistoryLine({ ...baseInput, error: 'bad http://x/?t=SECRET-ERR ' + 'z'.repeat(500) });
    expect(u.error).toBe('bad http://x/[redacted]'); // fail-closed: the tail after a cut is dropped up to the next URL or path
    expect(u.error).not.toContain('SECRET-ERR');
  });
  it('C3: the 64 KiB guard drops the actions and says how many', () => {
    const actions = Array.from({ length: 50 }, (_, i) => ({
      actionType: 'a',
      success: true,
      executionTimeMs: 1,
      timestamp: 't',
      tabId: 'tab',
      seq: i + 1,
      target: 'x'.repeat(2000),
    }));
    const l = buildHistoryLine({ ...baseInput, actions });
    expect(l.truncated).toBe(true);
    expect(l.actionsOmitted).toBe(50);
    expect(l.actions).toEqual([]);
    expect(Buffer.byteLength(JSON.stringify(l))).toBeLessThan(HISTORY_MAX_LINE_BYTES);
  });
  it('defense in depth: the raw secret strings are scrubbed from error and from every action string', () => {
    const l = buildHistoryLine({
      ...baseInput,
      verb: 'type',
      args: ['#pw', '<8 chars>'],
      error: 'could not type hunter-SECRET into the field',
      actions: [
        {
          actionType: 'type', success: false, executionTimeMs: 1, timestamp: 't', tabId: 'tab', seq: 1,
          error: 'field reads hunter-SECRET',
          verification: { verified: false, urlChanged: false, elementFound: false, confidence: 0, reason: 'Action failed: hunter-SECRET', evidence: { tier: 'action-failed', checks: [] } },
        } as never,
      ],
      secrets: ['hunter-SECRET'],
    });
    expect(JSON.stringify(l)).not.toContain('hunter-SECRET');
  });
});

describe('FR2-11 appendHistoryLine (C4, C5, C6, C9, torn-line repair)', () => {
  it('C4: creates the nested dir; two appends give exactly two newline-terminated, parseable, equal lines', async () => {
    const file = path.join(dir, 'a', 'b', 'history.jsonl');
    const l1 = line({ verb: 'one' });
    const l2 = line({ verb: 'two' });
    expect(await appendHistoryLine(file, l1)).toEqual({ ok: true, rotated: false });
    expect(await appendHistoryLine(file, l2)).toEqual({ ok: true, rotated: false });
    const text = await readFile(file, 'utf-8');
    expect(text.endsWith('\n')).toBe(true);
    const parts = text.split('\n');
    expect(parts).toHaveLength(3);
    expect(JSON.parse(parts[0]!)).toEqual(l1);
    expect(JSON.parse(parts[1]!)).toEqual(l2);
  });

  it('C5: rotation renames the old file byte-for-byte to history.1.jsonl and starts a fresh one', async () => {
    const file = path.join(dir, 'history.jsonl');
    await appendHistoryLine(file, line({ verb: 'first' }), { rotateBytes: 100 });
    const firstBytes = await readFile(file);
    expect(firstBytes.length).toBeGreaterThanOrEqual(100);
    const res = await appendHistoryLine(file, line({ verb: 'second' }), { rotateBytes: 100 });
    expect(res).toEqual({ ok: true, rotated: true });
    expect(Buffer.compare(await readFile(path.join(dir, HISTORY_ROTATED_FILE_NAME)), firstBytes)).toBe(0);
    const now = (await readFile(file, 'utf-8')).split('\n').filter(Boolean);
    expect(now).toHaveLength(1);
    expect(JSON.parse(now[0]!).verb).toBe('second');
  });

  it('a file below the threshold is not rotated (boundary)', async () => {
    const file = path.join(dir, 'history.jsonl');
    await appendHistoryLine(file, line());
    const size = (await stat(file)).size;
    const res = await appendHistoryLine(file, line(), { rotateBytes: size + 1 });
    expect(res).toEqual({ ok: true, rotated: false });
  });

  it('C6: a directory at the target path resolves {ok:false, code} and never throws', async () => {
    const file = path.join(dir, 'history.jsonl');
    await mkdir(file);
    const res = await appendHistoryLine(file, line());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(['EISDIR', 'EPERM', 'EACCES']).toContain(res.code);
  });

  it('C9: 30 concurrent appends in one process give exactly 30 parseable lines', async () => {
    const file = path.join(dir, 'history.jsonl');
    const results = await Promise.all(Array.from({ length: 30 }, (_, i) => appendHistoryLine(file, line({ verb: `v${i}`, args: ['x'.repeat(3000)] }))));
    expect(results.every((r) => r.ok)).toBe(true);
    const parts = (await readFile(file, 'utf-8')).split('\n').filter(Boolean);
    expect(parts).toHaveLength(30);
    const verbs = parts.map((p) => JSON.parse(p).verb).sort();
    expect(verbs).toEqual(Array.from({ length: 30 }, (_, i) => `v${i}`).sort());
  });

  it('a torn last line (no trailing newline) is not glued onto the next append: the new line stays readable', async () => {
    const file = path.join(dir, 'history.jsonl');
    await appendHistoryLine(file, line({ verb: 'before' }));
    await writeFile(file, (await readFile(file, 'utf-8')) + '{"v":1,"type":"comm');
    await appendHistoryLine(file, line({ verb: 'after' }));
    const r = await readHistoryFile(file);
    expect(r.lines.map((x) => x.parsed.verb)).toEqual(['before', 'after']);
    expect(r.skipped).toBe(1);
  });
});

describe('FR2-11 readHistoryFile (C7)', () => {
  it('C7: valid + blank + torn + non-object + wrong-v + valid gives 2 lines, skipped 3', async () => {
    const file = path.join(dir, 'history.jsonl');
    const a = JSON.stringify(line({ verb: 'a' }));
    const b = JSON.stringify(line({ verb: 'b' }));
    await writeFile(file, [a, '', '{"v":1,"type":"comm', '[1,2]', '{"v":"x"}', b].join('\n') + '\n');
    const r = await readHistoryFile(file);
    expect(r.lines).toHaveLength(2);
    expect(r.skipped).toBe(3);
    expect(r.lines[0]!.raw).toBe(a);
    expect(r.lines[1]!.raw).toBe(b);
  });
  it('a missing file is {lines: [], skipped: 0}; CRLF lines parse', async () => {
    const file = path.join(dir, 'nope.jsonl');
    expect(await readHistoryFile(file)).toEqual({ lines: [], skipped: 0, rotatedExists: false });
    await writeFile(file, JSON.stringify(line()) + '\r\n');
    expect((await readHistoryFile(file)).lines).toHaveLength(1);
  });
  it('a directory at the path throws (only ENOENT is swallowed)', async () => {
    const file = path.join(dir, 'history.jsonl');
    await mkdir(file);
    await expect(readHistoryFile(file)).rejects.toThrow();
  });
  it('a truncated final line does not break reading', async () => {
    const file = path.join(dir, 'history.jsonl');
    const a = JSON.stringify(line({ verb: 'a' }));
    await writeFile(file, a + '\n' + a.slice(0, a.length - 20));
    const r = await readHistoryFile(file);
    expect(r.lines).toHaveLength(1);
    expect(r.skipped).toBe(1);
  });
});

describe('FR2-11 formatHistoryHuman (C8)', () => {
  it('C8: the exact human format for two sessions, a failing action, three verification labels and a v2 line', () => {
    const mk = (parsed: Record<string, unknown>) => ({ raw: JSON.stringify(parsed), parsed: parsed as never });
    const r = {
      lines: [
        mk({
          v: 1, type: 'command', ts: '2026-09-25T14:02:11.123Z', sessionId: 'sess_A', cwd: '/w', verb: 'nav', args: ['http://127.0.0.1:5/p.html'],
          exitCode: 0, durationMs: 1204, actionsEvicted: 0,
          actions: [
            { actionType: 'navigate', success: true, target: 'http://127.0.0.1:5/p.html', tabId: 'tab_1', seq: 1, verification: { verified: true, urlChanged: true, elementFound: true, confidence: 0.9, reason: 'r' } },
          ],
        }),
        mk({
          v: 1, type: 'command', ts: '2026-09-25T14:02:17.000Z', sessionId: 'sess_A', cwd: '/w', verb: 'click', args: ['#missing'],
          exitCode: 1, durationMs: 15840, actionsEvicted: 0, error: 'boom\nsecond line',
          actions: [
            { actionType: 'click', success: false, selector: '#missing', error: 'No element found for selector: #missing\nmore', tabId: 'tab_1', seq: 1, verification: { verified: false, evidence: { tier: 'action-failed', checks: [] } } },
          ],
        }),
        mk({
          v: 1, type: 'command', ts: '2026-09-25T14:03:00.000Z', sessionId: 'sess_B', cwd: '/w', verb: 'eval', args: ['document.title'],
          exitCode: 0, durationMs: 310, actionsEvicted: 3,
          actions: [
            { actionType: 'eval', success: true, target: 'document.title', tabId: 'tab_2', seq: 1 },
            { actionType: 'click', success: true, selector: '#a', tabId: 'tab_2', seq: 2, verification: { verified: false, evidence: { tier: 'contradicted', checks: [] } } },
          ],
        }),
        mk({ v: 2, ts: '2026-09-25T14:04:00.000Z', sessionId: 'sess_B', whatever: true }),
      ],
      skipped: 0,
      rotatedExists: false,
    };
    const expected = [
      'History: 4 command(s) in /f/history.jsonl',
      '--- session sess_A ---',
      '2026-09-25 14:02:11Z  exit 0    1204ms  nav http://127.0.0.1:5/p.html',
      '    - navigate ok verified tab_1 http://127.0.0.1:5/p.html',
      '2026-09-25 14:02:17Z  exit 1   15840ms  click #missing',
      '    error: boom',
      '    - click FAILED action-failed tab_1 #missing: No element found for selector: #missing',
      '--- session sess_B (current) ---',
      '2026-09-25 14:03:00Z  exit 0     310ms  eval document.title',
      '    - eval ok no-verification tab_2 document.title',
      '    - click ok contradicted tab_2 #a',
      '    (3 earlier action(s) of this command were evicted from the 200-entry in-memory history)',
      '2026-09-25 14:04:00Z  (history line version 2 — upgrade sutradhar to display it)',
    ].join('\n');
    expect(formatHistoryHuman(r, { file: '/f/history.jsonl', currentSessionId: 'sess_B' })).toBe(expected);
  });
  it('no (current) marker when the current session is unknown; a rotated file adds the footer; long URL in a command is middle-truncated', () => {
    const long = 'https://example.test/' + 'p'.repeat(200);
    const parsed = { v: 1, ts: '2026-09-25T14:02:11.123Z', sessionId: 's', verb: 'nav', args: [long], exitCode: 0, durationMs: 1, actions: [], actionsEvicted: 0 };
    const out = formatHistoryHuman({ lines: [{ raw: '', parsed: parsed as never }], skipped: 0, rotatedExists: true }, { file: path.join('/d', 'history.jsonl') });
    expect(out).not.toContain('(current)');
    expect(out).toContain('…');
    expect(out).not.toContain('p'.repeat(100));
    expect(out.split('\n').at(-1)).toBe(`Older commands were rotated to ${path.join('/d', 'history.1.jsonl')} (not shown).`);
  });
});

describe('FR2-11 state paths (C10)', () => {
  it('C10: HISTORY_FILE_PATH is history.jsonl next to state.json (same dir), and clearState never deletes it', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'fr2-11-state-'));
    try {
      vi.stubEnv('SUTRADHAR_CLI_STATE_DIR', tmp);
      vi.resetModules();
      const st = await import('../../src/state.js');
      expect(st.HISTORY_FILE_PATH).toBe(path.join(st.STATE_DIR, 'history.jsonl'));
      expect(path.dirname(st.HISTORY_FILE_PATH)).toBe(path.resolve(tmp));
      await st.writeState({ sessionId: 's', wsEndpoint: 'ws://x' });
      await appendHistoryLine(st.HISTORY_FILE_PATH, line());
      await st.clearState();
      expect(await st.readState()).toBeUndefined();
      const after = await readHistoryFile(st.HISTORY_FILE_PATH);
      expect(after.lines).toHaveLength(1); // survives close / self-heal
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
