/**
 * @file packages/browser/tests/unit/post-conditions.spec.ts
 * @description FR2-07: the pure deciders and helpers behind each built-in post-condition.
 * Every decider takes a plain observation and returns a BuiltInVerdict; none needs a browser.
 */

import {
  PostConditionRecorder,
  activeInfoInPage,
  armKeyListenerInPage,
  bounded,
  decideClipboardVerdict,
  decideDragVerdict,
  decideFocusVerdict,
  decideKeyVerdict,
  decideNavigationVerdict,
  decidePointVerdict,
  decideTouchVerdict,
  decideUploadVerdict,
  finishKeyObservation,
  finishPointObservation,
  inspectPng,
  observePoint,
  keyEffectRule,
  keyMatches,
  readKeyObservationInPage,
  recordScreenshotEvidence,
  recordWaitForSelectorEvidence,
  statDownloadedFile,
  type KeyObservation,
  type NavSnapshot,
  type TargetInfo,
} from '../../src/index.js';

const SENTINEL = 'SECRET-FIELD-VALUE-12345';

const textInput = (over: Partial<TargetInfo> = {}): TargetInfo => ({
  kind: 'element',
  desc: 'input#q',
  textEntry: true,
  readOnly: false,
  selStart: 3,
  selEnd: 3,
  valueLen: 3,
  ...over,
});

describe('FR2-07 keyEffectRule / keyMatches', () => {
  it('P1: key effect rules', () => {
    const t = textInput();
    expect(keyEffectRule('a', [], t)).toBe('value-changed');
    expect(keyEffectRule('A', ['Shift'], t)).toBe('value-changed');
    expect(keyEffectRule('a', ['Control'], t)).toBe('none');
    expect(keyEffectRule('Backspace', [], textInput({ selStart: 0, selEnd: 0 }))).toBe('none');
    expect(keyEffectRule('Backspace', [], textInput({ selStart: 2, selEnd: 2 }))).toBe('value-changed');
    expect(keyEffectRule('Backspace', [], textInput({ selStart: 0, selEnd: 2 }))).toBe('value-changed');
    expect(keyEffectRule('Delete', [], textInput({ selStart: 3, selEnd: 3, valueLen: 3 }))).toBe('none');
    expect(keyEffectRule('Delete', [], textInput({ selStart: 1, selEnd: 1, valueLen: 3 }))).toBe('value-changed');
    expect(keyEffectRule('Tab', [], textInput())).toBe('focus-moved');
    expect(keyEffectRule('Tab', ['Shift'], textInput())).toBe('focus-moved');
    expect(keyEffectRule('Tab', [], textInput({ textEntry: false }))).toBe('focus-moved');
    expect(keyEffectRule('Enter', [], t)).toBe('none');
    expect(keyEffectRule('a', [], textInput({ textEntry: false }))).toBe('none');
    expect(keyEffectRule('é', [], t)).toBe('value-changed');
    expect(keyEffectRule('a', [], { ...t, kind: 'body' })).toBe('none');
    // contenteditable Backspace has no null selection contract: only delivery
    expect(keyEffectRule('Backspace', [], textInput({ selStart: null, selEnd: null }))).toBe('none');
  });

  it('P2: keyMatches', () => {
    expect(keyMatches('a', { key: 'A' })).toBe(true);
    expect(keyMatches('Numpad0', { key: '0', code: 'Numpad0' })).toBe(true);
    expect(keyMatches('Enter', { key: 'Enter' })).toBe(true);
    expect(keyMatches('Enter', { key: 'a' })).toBe(false);
  });
});

describe('FR2-07 decideKeyVerdict', () => {
  const post = (over: Record<string, unknown> = {}) => ({
    delivered: true,
    onTarget: true,
    valueChanged: true,
    afterValueLen: 4,
    focusMoved: false,
    afterDesc: 'input#b',
    ...over,
  });
  const base = (over: Partial<KeyObservation> = {}): KeyObservation => ({
    key: 'a',
    modifiers: [],
    pre: { target: textInput() },
    post: post(),
    ...over,
  });

  it('P3: one case per row of the verdict table', () => {
    const cases: Array<[string, KeyObservation, string, string]> = [
      ['pre dialog', base({ pre: { skipped: 'dialog' } }), 'not-run', 'a dialog was already open'],
      ['no frame api', base({ pre: { skipped: 'no-frame-api' } }), 'not-run', "could not observe the page's focused element"],
      ['pre error', base({ pre: { error: 'no answer within 1000ms' } }), 'not-run', "could not observe the page's focused element"],
      ['frame unreachable', base({ pre: { target: textInput({ kind: 'frame-unreachable' }) } }), 'not-run', 'whose frame could not be matched'],
      ['navigated', base({ post: undefined, navigated: true }), 'pass', 'the page navigated'],
      ['after dialog', base({ post: undefined, postTimedOut: true, dialogAfter: 'confirm' }), 'not-run', 'a confirm dialog opened after the press'],
      ['after timeout', base({ post: undefined, postTimedOut: true }), 'not-run', 'the page did not answer'],
      ['body', base({ pre: { target: textInput({ kind: 'body' }) }, post: undefined }), 'not-run', 'no element had focus'],
      ['value changed', base(), 'pass', 'its value changed (length 3→4)'],
      ['value unchanged', base({ post: post({ valueChanged: false, afterValueLen: 3 }) }), 'fail', 'value did not change (length 3→3)'],
      ['value unchanged, key never delivered (swallowed)', base({ post: post({ delivered: false, onTarget: false, valueChanged: false, afterValueLen: 3 }) }), 'fail', 'no trusted keydown'],
      ['readonly', base({ pre: { target: textInput({ readOnly: true }) }, post: post({ valueChanged: false, afterValueLen: 3 }) }), 'fail', 'the field is readonly'],
      ['tab moved', base({ key: 'Tab', post: post({ focusMoved: true }) }), 'pass', 'Tab moved focus from input#q to input#b'],
      ['tab stuck', base({ key: 'Tab', post: post({ focusMoved: false }) }), 'fail', 'Tab did not move focus away from input#q'],
      ['enter delivered', base({ key: 'Enter', post: post({ valueChanged: false }) }), 'pass', 'only delivery was verified'],
      ['enter elsewhere', base({ key: 'Enter', post: post({ onTarget: false }) }), 'fail', 'reached a different element'],
      ['enter not delivered', base({ key: 'Enter', post: post({ delivered: false, onTarget: false }) }), 'fail', 'no trusted keydown'],
    ];
    for (const [name, obs, outcome, substr] of cases) {
      const v = decideKeyVerdict(obs);
      expect(v.outcome, name).toBe(outcome);
      expect(v.reason, name).toContain(substr);
    }
  });

  it('D11: no check or reason ever contains a field value handed to the observation', () => {
    const obs = base({ pre: { target: { ...textInput(), desc: 'input#q' } }, post: { ...post(), afterDesc: 'input#b' } });
    (obs.pre.target as unknown as Record<string, unknown>).value = SENTINEL;
    (obs.post as unknown as Record<string, unknown>).value = SENTINEL;
    const v = decideKeyVerdict(obs);
    expect(JSON.stringify(v)).not.toContain(SENTINEL);
  });

  it('records the three stable check ids for a normal press', () => {
    const v = decideKeyVerdict(base());
    expect(v.checks.map((c) => c.check)).toEqual(['press_key.focused-target', 'press_key.key-delivered', 'press_key.effect']);
  });
});

describe('FR2-07 in-page key observers (behaviour on a fake DOM)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('arm + read: a trusted matching keydown on the target is delivered; a value change is seen', () => {
    const listeners: Record<string, (e: unknown) => void> = {};
    const input = { tagName: 'INPUT', id: 'q', className: '', value: 'ab', getAttribute: () => null } as any;
    const win: Record<string, unknown> = {
      addEventListener: (t: string, h: (e: unknown) => void) => void (listeners[t] = h),
      removeEventListener: (t: string) => void delete listeners[t],
    };
    vi.stubGlobal('window', win);
    vi.stubGlobal('document', { activeElement: input, body: { tagName: 'BODY' } });
    armKeyListenerInPage('tok');
    expect(win['tok']).toBeDefined();
    listeners['keydown']!({ key: 'c', code: 'KeyC', isTrusted: true, composedPath: () => [input] });
    input.value = 'abc';
    const out = readKeyObservationInPage('tok', 'c') as any;
    expect(out).toMatchObject({ delivered: true, onTarget: true, valueChanged: true, afterValueLen: 3, focusMoved: false });
    expect(win['tok']).toBeUndefined(); // no trace left
    expect(input.__sdKeyMark).toBeUndefined();
    expect(listeners['keydown']).toBeUndefined();
    // a second read finds nothing (page navigated / already read)
    expect(readKeyObservationInPage('tok', 'c')).toEqual({ missing: true });
  });

  it('an untrusted (page-dispatched) keydown does not count as delivery', () => {
    const listeners: Record<string, (e: unknown) => void> = {};
    const input = { tagName: 'INPUT', id: 'q', className: '', value: '', getAttribute: () => null } as any;
    vi.stubGlobal('window', {
      addEventListener: (t: string, h: (e: unknown) => void) => void (listeners[t] = h),
      removeEventListener: () => {},
    });
    vi.stubGlobal('document', { activeElement: input, body: { tagName: 'BODY' } });
    armKeyListenerInPage('tok2');
    listeners['keydown']!({ key: 'c', code: 'KeyC', isTrusted: false, composedPath: () => [input] });
    const out = readKeyObservationInPage('tok2', 'c') as any;
    expect(out.delivered).toBe(false);
  });

  it('activeInfoInPage reports lengths and flags, never the value', () => {
    const input = {
      tagName: 'INPUT', id: 'pw', className: 'a b c', value: SENTINEL, readOnly: false, disabled: false,
      selectionStart: 4, selectionEnd: 4, isContentEditable: false,
      getAttribute: (n: string) => (n === 'type' ? 'password' : null),
      textContent: '',
    } as any;
    vi.stubGlobal('document', { activeElement: input, body: { tagName: 'BODY' }, documentElement: {} });
    const info = activeInfoInPage();
    expect(info).toMatchObject({ kind: 'element', textEntry: true, valueLen: SENTINEL.length, desc: 'input#pw.a.b' });
    expect(JSON.stringify(info)).not.toContain(SENTINEL);
  });
});

describe('FR2-07 observePoint frame descent', () => {
  it('matches the child frame by bounding box (no expando on the page), then arms inside it and reports inner coordinates', async () => {
    const child = { evaluate: vi.fn().mockResolvedValueOnce({ armed: true, desc: 'button#xo-btn' }), childFrames: () => [] };
    const box = { left: 10, top: 20, width: 200, height: 44 };
    const ownerHit = vi.fn().mockResolvedValue(true);
    const decoy = { frameElement: async () => ({ evaluate: vi.fn().mockResolvedValue(false) }), evaluate: vi.fn(), childFrames: () => [] };
    const real = { frameElement: async () => ({ evaluate: ownerHit }), ...child };
    const main = {
      evaluate: vi.fn().mockResolvedValueOnce({ frame: true, innerX: 40, innerY: 12, box }),
      childFrames: () => [decoy, real],
    };
    const page = { mainFrame: () => main } as any;
    const arm = await observePoint({ url: 'u', page }, 60, 40, ['click']);
    expect(arm).toMatchObject({ hit: { desc: 'button#xo-btn' }, innerX: 40, innerY: 12, fromInFrame: true });
    expect(arm.frame).toBe(real);
    expect(ownerHit).toHaveBeenCalledWith(expect.any(Function), box); // matched by the box argument, not a mark
  });

  it('an unmatched frame is frameUnreachable (not-run), never a guess', async () => {
    const main = { evaluate: vi.fn().mockResolvedValue({ frame: true, innerX: 1, innerY: 1, box: { left: 0, top: 0, width: 5, height: 5 } }), childFrames: () => [] };
    const arm = await observePoint({ url: 'u', page: { mainFrame: () => main } as any }, 1, 1, ['click']);
    expect(arm).toMatchObject({ frameUnreachable: true });
  });
});

describe('FR2-07 observers skip renderer reads while a dialog is open', () => {
  it('finishPointObservation names the dialog and never evaluates (the renderer is frozen)', async () => {
    const evaluate = vi.fn().mockResolvedValue({ events: [] });
    const tab = { url: 'u', getPendingDialog: () => ({ dialogType: 'alert' }) } as any;
    const obs = await finishPointObservation(
      tab,
      { hit: { desc: 'button#b' }, frame: { evaluate } as any, token: 't', innerX: 1, innerY: 1 },
      { x: 1, y: 1, event: 'click' },
      'u',
    );
    expect(evaluate).not.toHaveBeenCalled();
    expect(decidePointVerdict(obs)).toMatchObject({ outcome: 'not-run' });
    expect(decidePointVerdict(obs).reason).toContain('an alert dialog opened');
  });

  it('finishKeyObservation names the dialog and never evaluates', async () => {
    const evaluate = vi.fn().mockResolvedValue({});
    const tab = { url: 'u', getPendingDialog: () => ({ dialogType: 'confirm' }) } as any;
    const v = await finishKeyObservation(tab, { target: textInput(), frame: { evaluate } as any, token: 't' }, { key: 'Enter' }, 'u');
    expect(evaluate).not.toHaveBeenCalled();
    expect(v.outcome).toBe('not-run');
    expect(v.reason).toContain('a confirm dialog opened after the press');
  });
});

describe('FR2-07 focus / touch deciders', () => {
  it('focus: pass, fail, dialog, timeout', () => {
    expect(decideFocusVerdict({ ok: true, desc: 'input#a' }).outcome).toBe('pass');
    const fail = decideFocusVerdict({ ok: false, observed: 'body', desc: 'div#x' });
    expect(fail.outcome).toBe('fail');
    expect(fail.reason).toContain('not div#x');
    expect(decideFocusVerdict({ dialog: 'alert' }).outcome).toBe('not-run');
    expect(decideFocusVerdict({ timedOut: true }).outcome).toBe('not-run');
  });

  it('touch: delivered, occluded, undelivered, dialog', () => {
    expect(decideTouchVerdict({ isHit: true, desc: 'button#t', mark: { trusted: true, type: 'touchend' } }).outcome).toBe('pass');
    const occ = decideTouchVerdict({ isHit: false, desc: 'button#t', topDesc: 'div#o', mark: null });
    expect(occ.outcome).toBe('fail');
    expect(occ.reason).toContain('occluded by div#o');
    expect(decideTouchVerdict({ isHit: true, desc: 'button#t', mark: null }).reason).toContain('no trusted touch/pointer/click event');
    expect(decideTouchVerdict({ dialog: 'alert' }).outcome).toBe('not-run');
  });
});

describe('FR2-07 inspectPng / screenshot evidence', () => {
  const PNG_1x1 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
  );

  it('P4: real, empty, JPEG, zero-width', () => {
    expect(inspectPng(PNG_1x1)).toEqual({ ok: true, width: 1, height: 1 });
    expect(inspectPng(Buffer.alloc(0)).ok).toBe(false);
    expect(inspectPng(Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...new Array(30).fill(0)])).ok).toBe(false);
    const zero = Buffer.from(PNG_1x1);
    zero.writeUInt32BE(0, 16);
    expect(inspectPng(zero)).toMatchObject({ ok: false });
  });

  it('a valid PNG is not-run by design; garbage is fail', () => {
    const ok = new PostConditionRecorder('take_screenshot');
    recordScreenshotEvidence(PNG_1x1.toString('base64'), ok);
    expect(ok.toBuiltIn()).toMatchObject({ outcome: 'not-run' });
    expect(ok.toBuiltIn()!.checks[0]).toMatchObject({ check: 'screenshot.png-well-formed', outcome: 'pass', observed: '1x1' });
    const bad = new PostConditionRecorder('take_screenshot');
    recordScreenshotEvidence('bm90IGEgcG5n', bad);
    expect(bad.toBuiltIn()).toMatchObject({ outcome: 'fail' });
    expect(bad.toBuiltIn()!.reason).toContain('not a valid PNG');
  });
});

describe('FR2-07 statDownloadedFile', () => {
  const NOW = 1_700_000_000_000;
  const file = (size: number, mtimeMs: number, isFile = true) => ({ size, mtimeMs, isFile: () => isFile });
  const enoent = () => Object.assign(new Error('ENOENT'), { code: 'ENOENT' });

  it('P5: missing / 0 bytes / stale / ok', async () => {
    const missing = await statDownloadedFile('/d/a.pdf', NOW, { fs: { stat: async () => { throw enoent(); } } });
    expect(missing).toMatchObject({ outcome: 'fail' });
    expect(missing.reason).toContain('no file exists');
    const empty = await statDownloadedFile('/d/a.pdf', NOW, { fs: { stat: async () => file(0, NOW) } });
    expect(empty.reason).toContain('0 bytes');
    const stale = await statDownloadedFile('/d/a.pdf', NOW, { fs: { stat: async () => file(10, NOW - 3_600_000) } });
    expect(stale.reason).toContain('predates this download');
    const ok = await statDownloadedFile('/d/a.pdf', NOW, { fs: { stat: async () => file(10, NOW) } });
    expect(ok).toMatchObject({ outcome: 'pass' });
    expect(ok.checks[0]!.observed).toBe('10 bytes');
    const dir = await statDownloadedFile('/d/a.pdf', NOW, { fs: { stat: async () => file(10, NOW, false) } });
    expect(dir.reason).toContain('not a regular file');
  });

  it('a .crdownload that turns into the final file within the grace period passes', async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const fs = {
        stat: async (p: string) => {
          if (p.endsWith('.crdownload')) return file(5, NOW);
          calls++;
          if (calls < 4) throw enoent();
          return file(10, NOW);
        },
      };
      const p = statDownloadedFile('/d/a.pdf', NOW, { fs });
      await vi.advanceTimersByTimeAsync(1000);
      expect(await p).toMatchObject({ outcome: 'pass' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('a .crdownload that never completes fails with "partial"', async () => {
    vi.useFakeTimers();
    try {
      const fs = {
        stat: async (p: string) => {
          if (p.endsWith('.crdownload')) return file(5, NOW);
          throw enoent();
        },
      };
      const p = statDownloadedFile('/d/a.pdf', NOW, { fs });
      await vi.advanceTimersByTimeAsync(3000);
      const v = await p;
      expect(v.outcome).toBe('fail');
      expect(v.reason).toContain('partial');
    } finally {
      vi.useRealTimers();
    }
  });

  it('a remote browser endpoint is not-run, a local one is checked', async () => {
    const fs = { stat: async () => file(10, NOW) };
    const remote = await statDownloadedFile('/d/a.pdf', NOW, { fs, browserWsEndpoint: 'ws://10.0.0.5:9222/devtools/browser/x' });
    expect(remote.outcome).toBe('not-run');
    expect(remote.reason).toContain('another host');
    for (const ep of ['ws://127.0.0.1:9222/x', 'ws://localhost:1/x', 'ws://[::1]:9222/x']) {
      expect((await statDownloadedFile('/d/a.pdf', NOW, { fs, browserWsEndpoint: ep })).outcome).toBe('pass');
    }
  });
});

describe('FR2-07 decideNavigationVerdict', () => {
  const snap = (over: Partial<NavSnapshot> = {}): NavSnapshot => ({ url: 'http://x/a', loaderId: 'L1', index: 2, count: 4, ...over });

  it('P6: navigate rows', () => {
    const newDoc = decideNavigationVerdict({ kind: 'navigate', requestedUrl: 'http://x/b', before: snap(), after: snap({ url: 'http://x/b', loaderId: 'L2' }) });
    expect(newDoc).toMatchObject({ outcome: 'pass' });
    expect(newDoc.reason).toContain('a new document committed at http://x/b');
    const redirect = decideNavigationVerdict({ kind: 'navigate', requestedUrl: 'http://x/r', before: snap(), after: snap({ url: 'http://x/login', loaderId: 'L2' }) });
    expect(redirect.reason).toContain('(redirected from http://x/r)');
    const sameDoc = decideNavigationVerdict({ kind: 'navigate', requestedUrl: 'http://x/a#s', before: snap(), after: snap({ url: 'http://x/a#s' }) });
    expect(sameDoc.reason).toContain('same-document');
    const noop = decideNavigationVerdict({ kind: 'navigate', requestedUrl: 'http://x/a#s', before: snap({ url: 'http://x/a#s' }), after: snap({ url: 'http://x/a#s' }) });
    expect(noop).toMatchObject({ outcome: 'pass' });
    expect(noop.reason).toContain('already at');
    const none = decideNavigationVerdict({ kind: 'navigate', requestedUrl: 'http://x/z', before: snap(), after: snap() });
    expect(none.outcome).toBe('fail');
    expect(none.reason).toContain('no new document committed');
  });

  it('P6: reload, back, forward', () => {
    expect(decideNavigationVerdict({ kind: 'reload', before: snap(), after: snap({ loaderId: 'L2' }) }).outcome).toBe('pass');
    expect(decideNavigationVerdict({ kind: 'reload', before: snap(), after: snap() }).outcome).toBe('fail');
    const atZero = decideNavigationVerdict({ kind: 'go_back', before: snap({ index: 0 }), after: snap({ index: 0 }) });
    expect(atZero.outcome).toBe('fail');
    expect(atZero.reason).toContain('no history entry to go back to (index 0 of 4)');
    const moved = decideNavigationVerdict({ kind: 'go_back', before: snap(), after: snap({ index: 1, url: 'http://x/p', loaderId: 'L2' }) });
    expect(moved).toMatchObject({ outcome: 'pass' });
    expect(moved.reason).toContain('(new document)');
    const sameDocBack = decideNavigationVerdict({ kind: 'go_back', before: snap(), after: snap({ index: 1 }) });
    expect(sameDocBack.reason).toContain('(same-document)');
    expect(decideNavigationVerdict({ kind: 'go_back', before: snap(), after: snap() }).reason).toContain('did not move (still 2)');
    const end = decideNavigationVerdict({ kind: 'go_forward', before: snap({ index: 3 }), after: snap({ index: 3 }) });
    expect(end.outcome).toBe('fail');
    expect(end.reason).toContain('no forward history entry');
    expect(decideNavigationVerdict({ kind: 'go_forward', before: snap(), after: snap({ index: 3, loaderId: 'L2' }) }).outcome).toBe('pass');
  });

  it('P6: HTTP status', () => {
    const ok = { kind: 'navigate' as const, requestedUrl: 'http://x/m', before: snap(), after: snap({ url: 'http://x/m', loaderId: 'L2' }) };
    const notFound = decideNavigationVerdict({ ...ok, status: 404 });
    expect(notFound.outcome).toBe('fail');
    expect(notFound.reason).toContain('HTTP 404');
    expect(decideNavigationVerdict({ ...ok, status: 200 }).checks.some((c) => c.check === 'navigate.http-status')).toBe(true);
    expect(decideNavigationVerdict({ ...ok, status: 0 }).checks.some((c) => c.check === 'navigate.http-status')).toBe(false);
    expect(decideNavigationVerdict({ ...ok, status: undefined }).outcome).toBe('pass');
  });

  it('P6: baseline unavailable, read failure, pending dialog', () => {
    expect(decideNavigationVerdict({ kind: 'navigate', unavailable: 'no CDP' }).reason).toContain("baseline couldn't be captured");
    expect(decideNavigationVerdict({ kind: 'navigate', before: snap(), afterError: 'x' }).outcome).toBe('not-run');
    const dlg = decideNavigationVerdict({ kind: 'go_back', before: snap(), after: snap({ index: 1 }), dialog: 'beforeunload' });
    expect(dlg.outcome).toBe('not-run');
    expect(dlg.reason).toContain('beforeunload dialog is open');
  });
});

describe('FR2-07 decidePointVerdict / decideDragVerdict', () => {
  const ev = (over: Record<string, unknown> = {}) => ({ type: 'click', trusted: true, onHit: true, cx: 100, cy: 200, targetDesc: 'button#b', ...over });
  const base = { x: 100, y: 200, event: 'click', hit: { desc: 'button#b' } };

  it('P7: click rows', () => {
    expect(decidePointVerdict({ ...base, events: [ev()] }).outcome).toBe('pass');
    expect(decidePointVerdict({ ...base, hit: null }).reason).toContain('no element is at (100, 200)');
    const other = decidePointVerdict({ ...base, events: [ev({ onHit: false, targetDesc: 'body' })] });
    expect(other.outcome).toBe('fail');
    expect(other.reason).toContain('landed on body, not on button#b');
    expect(decidePointVerdict({ ...base, events: [] }).reason).toContain('no trusted click reached the page');
    // the element removed itself on mousedown: Chrome drops the click, the mouseup shows where the press ended
    const vanish = decidePointVerdict({ ...base, events: [ev({ type: 'mousedown' }), ev({ type: 'mouseup', onHit: false, targetDesc: 'html' })] });
    expect(vanish.outcome).toBe('fail');
    expect(vanish.reason).toContain('landed on html, not on button#b');
    expect(decidePointVerdict({ ...base, events: [ev({ type: 'mousedown' })] }).reason).toContain('mousedown reached button#b but no click followed');
    expect(decidePointVerdict({ ...base, events: [ev({ trusted: false })] }).outcome).toBe('fail');
    expect(decidePointVerdict({ ...base, frameUnreachable: true, hit: undefined }).outcome).toBe('not-run');
    expect(decidePointVerdict({ ...base, navigated: true }).outcome).toBe('pass');
    expect(decidePointVerdict({ ...base, dialogAfter: 'alert' }).outcome).toBe('not-run');
    expect(decidePointVerdict({ ...base, events: [ev({ cx: 130 })] }).outcome).toBe('fail'); // off by > 1px
  });

  it('P7: drag rows', () => {
    const d = { x: 10, y: 10, toX: 60, toY: 40, event: 'mousedown', hit: { desc: 'div#pad' } };
    const down = ev({ type: 'mousedown', cx: 10, cy: 10 });
    const up = ev({ type: 'mouseup', cx: 60, cy: 40, onHit: false });
    expect(decideDragVerdict({ ...d, events: [down, up] }).outcome).toBe('pass');
    expect(decideDragVerdict({ ...d, events: [down] }).outcome).toBe('fail');
    expect(decideDragVerdict({ ...d, events: [up] }).outcome).toBe('fail');
    expect(decideDragVerdict({ ...d, fromInFrame: true }).outcome).toBe('not-run');
    expect(decideDragVerdict({ ...d, hit: null }).outcome).toBe('fail');
  });
});

describe('FR2-07 decideUploadVerdict', () => {
  const o = { name: 'a.txt', size: 5 };
  it('P8: all rows', () => {
    expect(decideUploadVerdict({ ...o, event: { trusted: true, names: ['a.txt'], sizes: [5] } }).outcome).toBe('pass');
    expect(
      decideUploadVerdict({ ...o, event: null, inputs: [{ desc: 'input#f', before: [], after: ['a.txt'], afterSizes: [5] }] }).outcome,
    ).toBe('pass');
    const wrong = decideUploadVerdict({ ...o, event: { trusted: true, names: ['b.txt'], sizes: [5] } });
    expect(wrong.outcome).toBe('fail');
    expect(wrong.reason).toContain('received [b.txt], not "a.txt"');
    const size = decideUploadVerdict({ ...o, event: { trusted: true, names: ['a.txt'], sizes: [9] } });
    expect(size.outcome).toBe('fail');
    const already = decideUploadVerdict({ ...o, event: null, inputs: [{ desc: 'input#f', before: ['a.txt'], after: ['a.txt'], afterSizes: [5] }] });
    expect(already.outcome).toBe('not-run');
    expect(already.reason).toContain('already held a file named "a.txt"');
    const nothing = decideUploadVerdict({ ...o, event: null, inputs: [] });
    expect(nothing.outcome).toBe('not-run');
    expect(nothing.reason).toContain('detached');
    expect(decideUploadVerdict({ ...o, skipped: 'dialog' }).outcome).toBe('not-run');
  });
});

describe('FR2-07 decideClipboardVerdict', () => {
  const WRITTEN = 'WRITTEN-TEXT-777';
  const READ = 'DIFFERENT-TEXT-888';
  it('P9: four rows, and neither text ever appears in the evidence', () => {
    const rows = [
      decideClipboardVerdict(WRITTEN, { path: 'clipboard-api', text: WRITTEN }),
      decideClipboardVerdict(WRITTEN, { path: 'clipboard-api', text: READ }),
      decideClipboardVerdict(WRITTEN, { path: 'blocked', error: 'NotAllowedError' }),
      decideClipboardVerdict(WRITTEN, { path: 'unavailable', error: 'timeout' }),
    ];
    expect(rows.map((r) => r.outcome)).toEqual(['pass', 'fail', 'not-run', 'not-run']);
    expect(rows[1]!.reason).toContain('may have been intercepted');
    expect(rows[2]!.reason).toContain('grant_permissions');
    for (const r of rows) {
      const s = JSON.stringify(r);
      expect(s).not.toContain(WRITTEN);
      expect(s).not.toContain(READ);
    }
  });
});

describe('FR2-07 PostConditionRecorder / bounded / wait evidence', () => {
  it('P10: order, last verdict wins, undefined when empty, derived outcome', () => {
    const r = new PostConditionRecorder('press_key');
    expect(r.toBuiltIn()).toBeUndefined();
    r.check({ check: 'a', outcome: 'pass' });
    r.check({ check: 'b', outcome: 'pass' });
    expect(r.toBuiltIn()!.outcome).toBe('pass');
    expect(r.toBuiltIn()!.checks.map((c) => c.check)).toEqual(['a', 'b']);
    r.check({ check: 'c', outcome: 'not-run' });
    expect(r.toBuiltIn()!.outcome).toBe('not-run');
    r.check({ check: 'd', outcome: 'fail', detail: 'nope' });
    expect(r.toBuiltIn()).toMatchObject({ outcome: 'fail', reason: 'nope' });
    r.verdict('pass', 'first');
    r.verdict('not-run', 'second');
    expect(r.toBuiltIn()).toMatchObject({ outcome: 'not-run', reason: 'second' });
    const v = new PostConditionRecorder('x');
    v.verdict('pass', 'only a verdict');
    expect(v.toBuiltIn()).toMatchObject({ outcome: 'pass', checks: [] });
  });

  it('P11: bounded resolves, times out on a monotonic clock, and captures rejections without leaking', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown): void => void unhandled.push(e);
    process.on('unhandledRejection', onUnhandled);
    try {
      expect(await bounded(Promise.resolve(7), 500)).toEqual({ ok: true, value: 7 });
      const t0 = performance.now();
      const hung = await bounded(new Promise(() => {}), 60);
      expect(hung).toEqual({ ok: false, timedOut: true });
      expect(performance.now() - t0).toBeGreaterThanOrEqual(50);
      expect(await bounded(Promise.reject(new Error('bad')), 500)).toEqual({ ok: false, timedOut: false, error: 'bad' });
      // a promise that rejects AFTER we gave up must not be unhandled
      let rejectLate: (e: Error) => void = () => {};
      const late = new Promise<never>((_, rej) => (rejectLate = rej));
      expect((await bounded(late, 20)).ok).toBe(false);
      rejectLate(new Error('late'));
      await new Promise((r) => setTimeout(r, 20));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('P12: wait_for_selector evidence', () => {
    const visible = new PostConditionRecorder('wait_for_selector');
    recordWaitForSelectorEvidence(visible, { state: 'visible', foundSelector: '#t' });
    expect(visible.toBuiltIn()).toMatchObject({ outcome: 'pass' });
    expect(visible.toBuiltIn()!.checks[0]).toMatchObject({ check: 'wait_for_selector.state-matched', expected: 'visible' });
    const vacuous = new PostConditionRecorder('wait_for_selector');
    recordWaitForSelectorEvidence(vacuous, { state: 'hidden', matchedAtStart: false, foundSelector: '#typo' });
    expect(vacuous.toBuiltIn()).toMatchObject({ outcome: 'not-run' });
    expect(vacuous.toBuiltIn()!.reason).toContain('vacuously');
    const others = new PostConditionRecorder('wait_for_selector');
    recordWaitForSelectorEvidence(others, { state: 'hidden', matchedAtStart: true, otherVisibleMatches: 2 });
    expect(others.toBuiltIn()).toMatchObject({ outcome: 'pass' });
    expect(others.toBuiltIn()!.checks[0]!.detail).toContain('2 later match');
  });
});
