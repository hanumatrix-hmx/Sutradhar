/**
 * @file packages/cli/tests/unit/text-output.spec.ts
 * @description I-048 (release 0.6.2): what `sutradhar text` prints for a window of page text, as pure functions
 * (the marker rule, the --json shape, the read-error line and exit code).
 */
import { textOutput, textReadErrorOutput, isPageTextReadError, textContinueHint, runTextCommand } from '../../src/text-output.js';
import type { PageTextResult } from '@sutradhar/capability-runtime';

const base: PageTextResult = {
  sessionId: 's1', tabId: 't1', url: 'https://x.test/', text: 'abcd', offset: 0, returnedChars: 4, totalChars: 4, truncated: false, source: 'dom',
};

describe('textOutput', () => {
  it('a complete read prints the text only: no marker, exit 0', () => {
    const o = textOutput({ ...base, text: 'hello', returnedChars: 5, totalChars: 5 }, false);
    expect(o.stdout).toEqual(['hello']);
    expect(o.stderr).toEqual([]);
    expect(o.exitCode).toBe(0);
  });

  it('shape A: a truncated first window prints the text, then the marker on its own final stdout line naming the next offset', () => {
    const r = { ...base, text: 'x'.repeat(4000), returnedChars: 4000, totalChars: 10499, truncated: true };
    const o = textOutput(r, false);
    expect(o.stdout).toEqual([
      'x'.repeat(4000),
      '[page text truncated: showing characters 0-4000 of 10499. Continue with: sutradhar text --offset 4000]',
    ]);
    expect(o.stderr).toEqual([]);
    expect(o.exitCode).toBe(0);
  });

  it('shape A for a window after the first: the hint names the END of that window (offset + returnedChars), not its length (S8 A-1)', () => {
    const r = { ...base, text: 'z'.repeat(4000), offset: 4000, returnedChars: 4000, totalChars: 10037, truncated: true };
    const o = textOutput(r, false);
    expect(o.stdout[1]).toBe('[page text truncated: showing characters 4000-8000 of 10037. Continue with: sutradhar text --offset 8000]');
    expect(o.stdout[1]).not.toContain('--offset 4000]');
    expect(o.exitCode).toBe(0);
  });

  it('shape B: the last paged window prints the (end) marker', () => {
    const r = { ...base, text: 'y'.repeat(2499), offset: 8000, returnedChars: 2499, totalChars: 10499, truncated: true };
    expect(textOutput(r, false).stdout[1]).toBe('[page text: showing characters 8000-10499 of 10499 (end)]');
  });

  it('shape C: offset past the end prints an empty window, then the past-the-end marker, exit 0', () => {
    const r = { ...base, text: '', offset: 20000, returnedChars: 0, totalChars: 10499, truncated: true };
    const o = textOutput(r, false);
    expect(o.stdout).toEqual(['', '[page text: offset 20000 is past the end; the page text has 10499 characters]']);
    expect(o.exitCode).toBe(0);
  });

  it('--json prints exactly one parseable document equal to the result, and NO marker line', () => {
    const r = { ...base, text: 'x'.repeat(10), returnedChars: 10, totalChars: 50, truncated: true };
    const o = textOutput(r, true);
    expect(o.stdout).toHaveLength(1);
    expect(JSON.parse(o.stdout[0]!)).toEqual(r);
    expect(o.stdout[0]).not.toContain('[page text');
    expect(o.exitCode).toBe(0);
  });

  it('the continue hint uses the end of the window', () => {
    expect(textContinueHint(4000)).toBe('Continue with: sutradhar text --offset 4000');
  });
});

describe('textReadErrorOutput (M-048r: a failed read is never empty stdout with exit 0)', () => {
  const err = Object.assign(new Error('the page text could not be read: Execution context was destroyed'), { name: 'PageTextReadError', source: 'dom' });

  it('prints exactly "Error: text read failed: <reason>" on stderr, nothing on stdout, exit 1, no Fatal:', () => {
    const o = textReadErrorOutput(err);
    expect(o.stderr).toEqual(['Error: text read failed: the page text could not be read: Execution context was destroyed']);
    expect(o.stdout).toEqual([]);
    expect(o.exitCode).toBe(1);
    expect(o.stderr.join('\n')).not.toContain('Fatal');
  });

  it('is identified by err.name (the class is duplicated per bundle), not instanceof', () => {
    expect(isPageTextReadError(err)).toBe(true);
    expect(isPageTextReadError(new Error('boom'))).toBe(false);
    expect(isPageTextReadError(Object.assign(new Error('x'), { name: 'TypeError' }))).toBe(false);
    expect(isPageTextReadError(undefined)).toBe(false);
    expect(isPageTextReadError('PageTextReadError')).toBe(false);
  });

  it('--json mode also leaves stdout empty on a failed read', () => {
    expect(textReadErrorOutput(err).stdout).toEqual([]);
  });
});

describe('runTextCommand (the whole verb minus printing)', () => {
  const win: PageTextResult = { ...base, text: 'x'.repeat(4000), returnedChars: 4000, totalChars: 9000, truncated: true };

  it('calls readTextWindow with the session id, no tab, and exactly the flags given', async () => {
    const readTextWindow = vi.fn(async () => win);
    const out = await runTextCommand({ readTextWindow }, 'sess_1', { offset: 4000, maxChars: 2000, jsonMode: false });
    expect(readTextWindow).toHaveBeenCalledTimes(1);
    expect(readTextWindow).toHaveBeenCalledWith('sess_1', undefined, { offset: 4000, maxChars: 2000 });
    expect(out.exitCode).toBe(0);
    expect(out.stdout[1]).toContain('Continue with: sutradhar text --offset 4000');
  });

  it('passes {} when no flag was given (the runtime default window applies) and never calls snapshot()', async () => {
    const readTextWindow = vi.fn(async () => win);
    const snapshot = vi.fn();
    await runTextCommand({ readTextWindow, snapshot } as any, 's', { jsonMode: false });
    expect(readTextWindow).toHaveBeenCalledWith('s', undefined, {});
    expect(snapshot).not.toHaveBeenCalled();
  });

  it('a PageTextReadError becomes the exit-1 stderr outcome with empty stdout (M-048r)', async () => {
    const e = Object.assign(new Error('the page text could not be read: boom'), { name: 'PageTextReadError' });
    const out = await runTextCommand({ readTextWindow: async () => { throw e; } }, 's', { jsonMode: true });
    expect(out).toEqual({ stdout: [], stderr: ['Error: text read failed: the page text could not be read: boom'], exitCode: 1 });
  });

  it('any other error is rethrown (it reaches main().catch, like any failing verb)', async () => {
    await expect(runTextCommand({ readTextWindow: async () => { throw new TypeError('maxChars must be ...'); } }, 's', { jsonMode: false })).rejects.toThrow(TypeError);
  });
});
