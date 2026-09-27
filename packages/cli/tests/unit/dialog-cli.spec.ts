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
  describeUnknownDialog,
  type PendingDialogEntry,
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

  it('D5b (FR2-04 fix-3/GAP-237): tabs is GUARDED, not exempt — it still calls runtime.attach() via withSessionFlow regardless of exemption, so leaving it exempt let it hang ~180s against any open dialog (audit-3, 3/3). It must go through the gate like every other verb now.', () => {
    expect(classifyVerb('tabs')).toBe('guarded');
  });

  it('D6: selectDialog returns the OLDEST (FIFO) and the remainder', () => {
    const t2 = { dialogType: 'alert', message: 'b', url: 'u', openedAt: '2026-01-01T00:00:02Z' };
    const t1 = { dialogType: 'confirm', message: 'a', url: 'u', openedAt: '2026-01-01T00:00:01Z' };
    const { target, rest } = selectDialog([t2, t1]);
    expect(target).toBe(t1);
    expect(rest).toEqual([t2]);
  });

  // FR2-04 escalation-1, GAP-249 (audit-4's A20): selectDialog must SKIP a `blockedBy` or
  // `confirmedSafe` entry even when it's the OLDEST by openedAt — a mutation that picks
  // `sorted[0]` unconditionally (audit-4's exact A20) survived vitest here before this test
  // existed, because D6 above never gives it an entry with blockedBy/confirmedSafe set at all.
  it('D6b (GAP-236/GAP-249 A20): selectDialog skips an OLDER blockedBy entry and picks the real (younger) holder instead', () => {
    const collateral = { dialogType: 'unknown', message: '', url: 'u', openedAt: '2026-01-01T00:00:01Z', blockedBy: 'holder-1', targetId: 'opener' };
    const holder = { dialogType: 'unknown', message: '', url: 'u', openedAt: '2026-01-01T00:00:02Z', targetId: 'holder-1' };
    const { target, rest } = selectDialog([collateral, holder]);
    expect(target).toBe(holder);
    expect(rest).toEqual([collateral]);
  });

  it('D6c (escalation-1 decision 1, GAP-249 A20): selectDialog skips an OLDER confirmedSafe entry too, even with no blockedBy', () => {
    const safe = { dialogType: 'unknown', message: '', url: 'u', openedAt: '2026-01-01T00:00:01Z', confirmedSafe: true, targetId: 'safe-tab' };
    const holder = { dialogType: 'unknown', message: '', url: 'u', openedAt: '2026-01-01T00:00:02Z', targetId: 'holder-1' };
    const { target, rest } = selectDialog([safe, holder]);
    expect(target).toBe(holder);
    expect(rest).toEqual([safe]);
  });

  it('D6d: when EVERY entry is blockedBy/confirmedSafe (no addressable holder at all), selectDialog returns no target', () => {
    const collateral = { dialogType: 'unknown', message: '', url: 'u', openedAt: '2026-01-01T00:00:01Z', blockedBy: 'holder-1', targetId: 'opener' };
    const safe = { dialogType: 'unknown', message: '', url: 'u', openedAt: '2026-01-01T00:00:02Z', confirmedSafe: true, targetId: 'safe-tab' };
    const { target, rest } = selectDialog([collateral, safe]);
    expect(target).toBeUndefined();
    expect(rest).toEqual([collateral, safe]);
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

    it('FR2-04 fix-3, decision point 8 (overhead): the poll timer is cleared the moment work wins the race, not left pending until it would have next fired', async () => {
      // audit-3 traced +100ms of the +129ms measured per-command overhead to exactly this: the
      // dialogWatch loop's in-flight setTimeout(pollMs) was never cancelled when `work` won
      // Promise.race, so it kept Node's event loop alive (a real, ref'd timer) until it eventually
      // fired on its own. `vi.getTimerCount()` gives a direct, non-timing-based assertion: right
      // after raceWithDialog resolves, there must be ZERO timers left registered by it — not "zero
      // once enough time has passed for the old timer to fire anyway".
      const work = new Promise((resolve) => setTimeout(() => resolve('ok'), 40));
      const p = raceWithDialog(work, () => [], { graceMs: 250, pollMs: 100 });
      await vi.advanceTimersByTimeAsync(40);
      await expect(p).resolves.toEqual({ kind: 'done', value: 'ok' });
      // Only `work`'s own already-fired setTimeout(40) could still be a phantom entry in some
      // fake-timer implementations right at the firing instant; give the microtask queue a beat
      // and then require the poll timer specifically to be gone.
      await Promise.resolve();
      expect(vi.getTimerCount()).toBe(0);
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

  describe('D11 (FR2-04 escalation-2, GAP-253): describeUnknownDialog reflects what selectDialog would ACTUALLY act on', () => {
    it('a real, tracked dialog only: no note at all (not a liveness-inferred entry)', () => {
      const real: PendingDialogEntry = { dialogType: 'confirm', message: 'm', url: 'u', openedAt: '2026-01-01T00:00:01Z', targetId: 't1' };
      expect(describeUnknownDialog(real, [real])).toEqual([]);
    });

    it('a lone "unknown" candidate that IS what selectDialog would pick: the original "would act on this tab" note', () => {
      const only: PendingDialogEntry = { dialogType: 'unknown', message: '', url: 'u', openedAt: '2026-01-01T00:00:01Z', targetId: 'p1' };
      expect(describeUnknownDialog(only, [only])).toEqual([
        '  Note: tab p1 appears to be the actual dialog holder -- "dialog accept/dismiss" would act on this tab.',
      ]);
    });

    // GAP-253's exact finding (audit-5 A5-01): a real tracked dialog opened BEFORE a fresh,
    // never-confirmed collateral/candidate popup exists. The old code looked at the "unknown"
    // entry alone and said "would act on this tab" even though selectDialog's global FIFO always
    // picks the earlier, real dialog first.
    it('a real tracked dialog co-exists with a later "unknown" candidate: the candidate note says accept acts on the tracked dialog FIRST, not itself', () => {
      const real: PendingDialogEntry = { dialogType: 'alert', message: 'hi', url: 'u', openedAt: '2026-01-01T00:00:01Z', targetId: 'real-1' };
      // Liveness-inferred entries are synthesized with "now" as openedAt (see dialog-broker.ts /
      // dialog-warden.ts) which always sorts AFTER a dialog that genuinely opened earlier.
      const candidate: PendingDialogEntry = { dialogType: 'unknown', message: '', url: 'u', openedAt: '2026-01-01T00:00:02Z', targetId: 'p1' };
      const notes = describeUnknownDialog(candidate, [real, candidate]);
      expect(notes).toHaveLength(1);
      expect(notes[0]).toContain('would currently act on the earlier alert dialog on tab real-1 first, not this one');
      expect(notes[0]).not.toContain('would act on this tab');
    });

    it('two never-confirmed "unknown" candidates: the OLDER one\'s note defers to the younger, FIFO-selected one, never claiming the close for itself', () => {
      const older: PendingDialogEntry = { dialogType: 'unknown', message: '', url: 'u', openedAt: '2026-01-01T00:00:01Z', targetId: 'older' };
      const younger: PendingDialogEntry = { dialogType: 'unknown', message: '', url: 'u', openedAt: '2026-01-01T00:00:02Z', targetId: 'younger' };
      // selectDialog is plain FIFO among un-blockedBy/un-confirmedSafe entries, so with neither
      // linked to the other via blockedBy, it picks the OLDER one — the note on `older` must claim
      // the close, and the note on `younger` must defer to it (not the other way around).
      const olderNotes = describeUnknownDialog(older, [older, younger]);
      expect(olderNotes[0]).toContain('would act on this tab');
      const youngerNotes = describeUnknownDialog(younger, [older, younger]);
      expect(youngerNotes[0]).toContain('would currently act on the earlier unknown dialog on tab older first');
    });

    it('confirmedSafe/blockedBy entries are unaffected by the GAP-253 fix (unchanged messages)', () => {
      const safe: PendingDialogEntry = { dialogType: 'unknown', message: '', url: 'u', openedAt: '2026-01-01T00:00:01Z', targetId: 's1', confirmedSafe: true };
      expect(describeUnknownDialog(safe, [safe])[0]).toContain('history proves it cannot be hiding a dialog (likely just a slow script)');
      const collateral: PendingDialogEntry = { dialogType: 'unknown', message: '', url: 'u', openedAt: '2026-01-01T00:00:01Z', targetId: 'c1', blockedBy: 'holder-1' };
      expect(describeUnknownDialog(collateral, [collateral])[0]).toContain('would act on tab holder-1, not this one');
    });
  });

  describe('D12 (FR2-04 escalation-2, GAP-254): describeUnknownDialog never claims a close will happen when the warden is down', () => {
    it('a wardenDown candidate that would otherwise be "the holder" gets a refusal note, not a close promise', () => {
      const d: PendingDialogEntry = { dialogType: 'unknown', message: '', url: 'u', openedAt: '2026-01-01T00:00:01Z', targetId: 'p1', wardenDown: true };
      const notes = describeUnknownDialog(d, [d]);
      expect(notes[0]).toContain('cannot safely confirm or close it -- it will refuse rather than guess');
      expect(notes[0]).not.toContain('would act on this tab');
    });

    it('a wardenDown collateral entry gets a refusal note naming both tabs, not a "would act on tab X" promise', () => {
      const d: PendingDialogEntry = { dialogType: 'unknown', message: '', url: 'u', openedAt: '2026-01-01T00:00:01Z', targetId: 'c1', blockedBy: 'holder-1', wardenDown: true };
      const notes = describeUnknownDialog(d, [d]);
      expect(notes[0]).toContain('the dialog warden is not running, so "dialog accept/dismiss" cannot safely act on either tab and will refuse');
      expect(notes[0]).not.toContain('would act on tab holder-1');
    });

    it('without wardenDown, the ORIGINAL unconditional messages are preserved (regression guard)', () => {
      const holder: PendingDialogEntry = { dialogType: 'unknown', message: '', url: 'u', openedAt: '2026-01-01T00:00:01Z', targetId: 'p1' };
      expect(describeUnknownDialog(holder, [holder])[0]).toBe(
        '  Note: tab p1 appears to be the actual dialog holder -- "dialog accept/dismiss" would act on this tab.',
      );
      const collateral: PendingDialogEntry = { dialogType: 'unknown', message: '', url: 'u', openedAt: '2026-01-01T00:00:01Z', targetId: 'c1', blockedBy: 'holder-1' };
      expect(describeUnknownDialog(collateral, [collateral])[0]).toBe(
        '  Note: tab c1 is unresponsive only because it shares a browser process with tab holder-1, which appears to actually hold the dialog -- "dialog accept/dismiss" would act on tab holder-1, not this one.',
      );
    });
  });
});
