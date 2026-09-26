/**
 * @file packages/cli/tests/unit/dialog-cli.spec.ts
 * @description FR2-04: unit tests for dialog-cli.ts's pure policy/formatting/racing logic.
 */
import {
  resolveDialogPolicy,
  formatDialogPending,
  formatDialogHandled,
  classifyVerb,
  selectDialog,
  raceWithDialog,
  deadlineFor,
  DialogBlockedError,
  beforeunloadCancelMessage,
  isBeforeunloadCancel,
} from '../../src/dialog-cli.js';

describe('@sutradhar/cli dialog-cli (FR2-04)', () => {
  describe('D1: resolveDialogPolicy precedence (flag > state > report)', () => {
    it('an accept/dismiss flag wins over any persisted state, and persists', () => {
      const r = resolveDialogPolicy('accept', 't', { dialogPolicy: { action: 'dismiss', setAt: 'x' } });
      expect(r).toEqual({ policy: { mode: 'accept', promptText: 't' }, persist: 'set' });
    });

    it('D10 (corrected): --dialog report PERSISTS (persist:"set"), it does not clear the policy', () => {
      const r = resolveDialogPolicy('report', undefined, { dialogPolicy: { action: 'accept', setAt: 'x' } });
      expect(r).toEqual({ policy: { mode: 'report' }, persist: 'set' });
    });

    it('no flag falls back to the persisted state, unchanged', () => {
      const r = resolveDialogPolicy(undefined, undefined, {
        dialogPolicy: { action: 'accept', promptText: 'p', setAt: 'x' },
      });
      expect(r).toEqual({ policy: { mode: 'accept', promptText: 'p' }, persist: 'keep' });
    });

    it('no flag and no persisted state defaults to report', () => {
      const r = resolveDialogPolicy(undefined, undefined, {});
      expect(r).toEqual({ policy: { mode: 'report' }, persist: 'keep' });
    });

    it('DC2 (FR2-14 regression): a persisted "report" is carried forward by a later no-flag command, not overridden back to auto-handling', () => {
      const r = resolveDialogPolicy(undefined, undefined, { dialogPolicy: { action: 'report', setAt: 'x' } });
      expect(r).toEqual({ policy: { mode: 'report' }, persist: 'keep' });
    });
  });

  it('D2: formatDialogPending produces the exact §2.8.5 line', () => {
    expect(formatDialogPending({ type: 'confirm', message: 'Delete?', url: 'http://x/' })).toBe(
      'dialogPending: {"type":"confirm","message":"Delete?","defaultValue":null,"url":"http://x/"}',
    );
  });

  it('D3: formatDialogHandled produces the exact §2.8.5 line for policy and caller cases', () => {
    expect(
      formatDialogHandled({ type: 'confirm', message: 'Sure?', action: 'accept', by: 'policy' }),
    ).toBe('dialogHandled: {"type":"confirm","message":"Sure?","action":"accept","promptText":null,"by":"policy"}');
    expect(
      formatDialogHandled({ type: 'prompt', message: 'name?', action: 'accept', promptText: 'zz', by: 'caller' }),
    ).toBe('dialogHandled: {"type":"prompt","message":"name?","action":"accept","promptText":"zz","by":"caller"}');
  });

  it('D4: a message with newlines/quotes stays one line and round-trips', () => {
    const out = formatDialogPending({ type: 'alert', message: 'line1\n"quoted"', url: 'http://x/' });
    expect(out.includes('\n')).toBe(false);
    const parsed = JSON.parse(out.slice('dialogPending: '.length));
    expect(parsed.message).toBe('line1\n"quoted"');
  });

  it('D5: classifyVerb (trigger/guarded/exempt)', () => {
    for (const v of ['click', 'clicktext', 'clickrole', 'clickpoint']) expect(classifyVerb(v)).toBe('trigger');
    for (const v of ['eval', 'snap', 'nav', 'type', 'wait', 'unknownverb']) expect(classifyVerb(v)).toBe('guarded');
    for (const v of ['dialog', 'doctor', 'profile', 'sessions', 'close', undefined, '__dialog-warden']) {
      expect(classifyVerb(v)).toBe('exempt');
    }
  });

  it('D6: selectDialog returns the OLDEST (FIFO) and the remainder', () => {
    const t2 = { dialogType: 'alert', message: 'b', url: 'u', openedAt: '2026-01-01T00:00:02Z' };
    const t1 = { dialogType: 'confirm', message: 'a', url: 'u', openedAt: '2026-01-01T00:00:01Z' };
    const { target, rest } = selectDialog([t2, t1]);
    expect(target).toBe(t1);
    expect(rest).toEqual([t2]);
  });

  describe('D7: raceWithDialog', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('(a) work resolves before any dialog appears', async () => {
      const work = new Promise((resolve) => setTimeout(() => resolve('ok'), 100));
      const p = raceWithDialog(work, () => [], { graceMs: 250 });
      await vi.advanceTimersByTimeAsync(150);
      await expect(p).resolves.toEqual({ kind: 'done', value: 'ok' });
    });

    it('(b) a confirm appears and stays pending past the grace window', async () => {
      const work = new Promise(() => {}); // never resolves
      let elapsed = 0;
      const p = raceWithDialog(
        work,
        () => (elapsed >= 100 ? [{ dialogType: 'confirm', message: 'm', url: 'u', openedAt: 'x' }] : []),
        { graceMs: 250, pollMs: 25 },
      );
      for (let i = 0; i < 20 && elapsed < 500; i++) {
        await vi.advanceTimersByTimeAsync(25);
        elapsed += 25;
      }
      const result = await p;
      expect(result.kind).toBe('dialog');
    });

    it('(c) a confirm appears then clears before the grace elapses — work still wins', async () => {
      const work = new Promise((resolve) => setTimeout(() => resolve('done'), 600));
      let t = 0;
      const p = raceWithDialog(
        work,
        () => (t >= 100 && t < 200 ? [{ dialogType: 'confirm', message: 'm', url: 'u', openedAt: 'x' }] : []),
        { graceMs: 250, pollMs: 25 },
      );
      for (let i = 0; i < 30; i++) {
        await vi.advanceTimersByTimeAsync(25);
        t += 25;
      }
      await expect(p).resolves.toEqual({ kind: 'done', value: 'done' });
    });

    it('(d) a beforeunload pending throughout is ignored — work still wins', async () => {
      const work = new Promise((resolve) => setTimeout(() => resolve('done'), 3100));
      const p = raceWithDialog(
        work,
        () => [{ dialogType: 'beforeunload', message: 'm', url: 'u', openedAt: 'x' }],
        { graceMs: 250, pollMs: 100, ignoreTypes: ['beforeunload'] },
      );
      await vi.advanceTimersByTimeAsync(3200);
      await expect(p).resolves.toEqual({ kind: 'done', value: 'done' });
    });

    it('a rejection from work propagates as this function\'s own rejection', async () => {
      const work = Promise.reject(new Error('boom'));
      await expect(raceWithDialog(work, () => [], { graceMs: 250 })).rejects.toThrow('boom');
    });
  });

  it('D8: DialogBlockedError has the exact message/exitCode/stdoutLines', () => {
    const confirm = { dialogType: 'confirm', message: 'm', url: 'http://x/', openedAt: 'x' };
    const err = new DialogBlockedError('snap', [confirm], 'blocked');
    expect(err.exitCode).toBe(3);
    expect(err.name).toBe('DialogBlockedError');
    expect(err.message).toBe('a confirm dialog is open and blocking the page, so "snap" did not run.');
    expect(err.stdoutLines()).toEqual([formatDialogPending({ type: 'confirm', message: 'm', url: 'http://x/' })]);
  });

  it('D9: deadlineFor default/override/wait-scaling/ignored-invalid', () => {
    expect(deadlineFor('snap', [], {})).toBe(300000);
    expect(deadlineFor('wait', ['#x', '200000'], {})).toBe(630000);
    expect(deadlineFor('snap', [], { SUTRADHAR_CLI_DEADLINE_MS: '5000' })).toBe(5000);
    expect(deadlineFor('snap', [], { SUTRADHAR_CLI_DEADLINE_MS: 'abc' })).toBe(300000);
    expect(deadlineFor('snap', [], { SUTRADHAR_CLI_DEADLINE_MS: '-1' })).toBe(300000);
  });

  it('D10: beforeunload cancel message and detector', () => {
    expect(beforeunloadCancelMessage('http://b/')).toBe(
      "Navigate failed: the page's beforeunload dialog was dismissed (--dialog dismiss is in effect), " +
        'so the navigation to http://b/ was cancelled. Use --dialog accept to leave pages that ask for confirmation.',
    );
    const history = [{ dialogType: 'beforeunload', action: 'dismiss', handledAt: '2026-01-01T00:00:05.000Z' }];
    expect(isBeforeunloadCancel(new Error('net::ERR_ABORTED'), history, Date.parse('2026-01-01T00:00:00.000Z'))).toBe(
      true,
    );
    expect(isBeforeunloadCancel(new Error('net::ERR_ABORTED'), [], Date.parse('2026-01-01T00:00:00.000Z'))).toBe(
      false,
    );
    expect(isBeforeunloadCancel(new Error('some other error'), history, Date.parse('2026-01-01T00:00:00.000Z'))).toBe(
      false,
    );
  });
});
