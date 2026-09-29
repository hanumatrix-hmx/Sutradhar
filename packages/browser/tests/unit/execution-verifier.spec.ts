/**
 * @file packages/browser/tests/unit/execution-verifier.spec.ts
 * @description FR2-07: the single verification contract — tier composition, confidence table,
 * expectation semantics (visible text, urlChanged:false), evidence capping and JSON-safety.
 */

import {
  ExecutionVerifier,
  failedVerification,
  pageContainsVisibleText,
  visibleTextContainsInPage,
  type BuiltInVerdict,
  type IBrowserTab,
} from '../../src/index.js';

type TabStub = {
  url: string;
  page?: unknown;
  getPendingDialog?: () => { dialogType: string; message: string } | undefined;
};

function tab(stub: TabStub): IBrowserTab {
  return stub as unknown as IBrowserTab;
}

/** A page whose frames answer `evaluate` with the scripted value(s). */
function pageWithFrames(...answers: Array<boolean | 'hang' | 'throw'>) {
  const frames = answers.map((a) => ({
    isDetached: () => false,
    evaluate: vi.fn().mockImplementation(() => {
      if (a === 'hang') return new Promise(() => {});
      if (a === 'throw') return Promise.reject(new Error('frame gone'));
      return Promise.resolve(a);
    }),
  }));
  return {
    frames: () => frames,
    mainFrame: () => frames[0],
    evaluate: vi.fn(), // must never be used
    __frames: frames,
  };
}

const passVerdict = (reason = 'keydown reached input#q'): BuiltInVerdict => ({
  outcome: 'pass',
  reason,
  checks: [{ check: 'press_key.effect', outcome: 'pass' }],
});
const failVerdict: BuiltInVerdict = {
  outcome: 'fail',
  reason: 'its value did not change',
  checks: [{ check: 'press_key.effect', outcome: 'fail' }],
};
const notRunVerdict: BuiltInVerdict = {
  outcome: 'not-run',
  reason: 'no element had focus',
  checks: [{ check: 'press_key.focused-target', outcome: 'not-run' }],
};

describe('FR2-07 ExecutionVerifier: the verification contract', () => {
  const verifier = new ExecutionVerifier();

  it('V1: an action failure is action-failed, confidence 0, with expect.* marked not-run', async () => {
    const v = await verifier.verifyAction(
      tab({ url: 'u' }),
      'u',
      { success: false, actionType: 'click', error: 'boom' },
      { expectedElementText: 'x' },
    );
    expect(v.evidence.tier).toBe('action-failed');
    expect(v.confidence).toBe(0);
    expect(v.reason).toBe('Action failed: boom');
    expect(v.evidence.checks).toEqual([
      { check: 'expect.text', outcome: 'not-run', detail: 'the action failed; expectations were not evaluated' },
    ]);
  });

  it('V2: a self-verifying type with no builtIn and no spec is verified at the candidate confidence', async () => {
    const v = await verifier.verifyAction(tab({ url: 'u' }), 'u', { success: true, actionType: 'click' });
    expect(v.verified).toBe(true);
    expect(v.confidence).toBe(0.9);
    expect(v.reason).toContain('has a built-in post-condition check');
    expect(v.evidence.checks[0]).toMatchObject({ check: 'click.built-in', outcome: 'pass' });
  });

  it('V3: a passing builtIn is verified and the reason names the action', async () => {
    const v = await verifier.verifyAction(tab({ url: 'u' }), 'u', { success: true, actionType: 'press_key' }, {}, passVerdict());
    expect(v.evidence.tier).toBe('verified');
    expect(v.reason.startsWith("'press_key' verified: ")).toBe(true);
  });

  it('V4: a failing builtIn is contradicted at 0.09 with the failure in the reason', async () => {
    const v = await verifier.verifyAction(tab({ url: 'u' }), 'u', { success: true, actionType: 'press_key' }, {}, failVerdict);
    expect(v.evidence.tier).toBe('contradicted');
    expect(v.verified).toBe(false);
    expect(v.confidence).toBeCloseTo(0.09, 5);
    expect(v.reason).toContain('its post-condition check failed:');
    expect(v.reason).toContain('its value did not change');
  });

  it('V5: a not-run builtIn with no spec is unverifiable at 0.45 and coaches toward expect', async () => {
    const v = await verifier.verifyAction(tab({ url: 'u' }), 'u', { success: true, actionType: 'press_key' }, {}, notRunVerdict);
    expect(v.evidence.tier).toBe('unverifiable');
    expect(v.confidence).toBeCloseTo(0.45, 5);
    expect(v.reason).toContain('no built-in post-condition check could run:');
    expect(v.reason).toContain('no element had focus');
    expect(v.reason).toContain('Pass expect:{text|url|urlChanged}');
  });

  it('V6: a not-run builtIn plus a passing expectation is verified, without the coaching sentence', async () => {
    const v = await verifier.verifyAction(
      tab({ url: 'https://b' }),
      'https://a',
      { success: true, actionType: 'press_key' },
      { shouldUrlChange: true },
      notRunVerdict,
    );
    expect(v.evidence.tier).toBe('verified');
    expect(v.confidence).toBe(0.9);
    expect(v.reason).not.toContain('Pass expect');
  });

  it('V6b (fix-1 F4): a not-run builtIn plus a passing (even trivially true) expectation still names the built-in outcome in the reason', async () => {
    const v = await verifier.verifyAction(
      tab({ url: 'https://a' }),
      'https://a',
      { success: true, actionType: 'press_key' },
      { shouldUrlChange: false },
      notRunVerdict,
    );
    expect(v.evidence.tier).toBe('verified');
    expect(v.verified).toBe(true);
    expect(v.reason).not.toMatch(/^Action execution verified successfully/);
    expect(v.reason).toContain('no element had focus');
    expect(v.reason).toContain('could not run');
    expect(v.reason).toContain('Expectations met: urlChanged');
    expect(v.evidence.checks.map((c) => c.outcome)).toContain('not-run');
  });

  it('V7: text absent from every frame is contradicted, and the reason keeps the historic prefix', async () => {
    const page = pageWithFrames(false, false);
    const v = await verifier.verifyAction(
      tab({ url: 'u', page }),
      'u',
      { success: true, actionType: 'press_key' },
      { expectedElementText: 'x' },
      passVerdict(),
    );
    expect(v.evidence.tier).toBe('contradicted');
    expect(v.reason).toContain('Expected text "x" was not found');
    expect(v.evidence.checks.find((c) => c.check === 'expect.text')).toMatchObject({ outcome: 'fail', observed: 'not-found' });
    expect(page.evaluate).not.toHaveBeenCalled();
  });

  it('V8: shouldUrlChange:false fails when the URL changed, passes when it did not', async () => {
    const changed = await verifier.verifyAction(
      tab({ url: 'https://b' }),
      'https://a',
      { success: true, actionType: 'click' },
      { shouldUrlChange: false },
    );
    expect(changed.evidence.tier).toBe('contradicted');
    expect(changed.reason).toContain('Expected the URL to stay');
    const same = await verifier.verifyAction(
      tab({ url: 'https://a' }),
      'https://a',
      { success: true, actionType: 'click' },
      { shouldUrlChange: false },
    );
    expect(same.evidence.tier).toBe('verified');
    expect(same.evidence.checks.find((c) => c.check === 'expect.urlChanged')).toMatchObject({ outcome: 'pass', expected: false });
  });

  it('V9: an unmet URL substring keeps its historic reason text', async () => {
    const v = await verifier.verifyAction(
      tab({ url: 'https://a/x' }),
      'https://a/x',
      { success: true, actionType: 'click' },
      { expectedUrlSubstring: '/never' },
    );
    expect(v.reason).toContain('does not contain expected substring');
    expect(v.evidence.tier).toBe('contradicted');
  });

  it('V10: a candidate below 0.5 is low-confidence at the candidate confidence', async () => {
    const v = await verifier.verifyAction(
      tab({ url: 'u' }),
      'u',
      { success: true, actionType: 'press_key' },
      { candidateConfidence: 0.2 },
      passVerdict(),
    );
    expect(v.evidence.tier).toBe('low-confidence');
    expect(v.confidence).toBe(0.2);
    expect(v.reason).toContain('below the verification threshold');
  });

  it('V11: a pending dialog makes expect.text not-run, tier unverifiable, and no frame is touched', async () => {
    const page = pageWithFrames(true);
    const v = await verifier.verifyAction(
      tab({ url: 'u', page, getPendingDialog: () => ({ dialogType: 'alert', message: 'm' }) }),
      'u',
      { success: true, actionType: 'press_key' },
      { expectedElementText: 'x' },
      passVerdict(),
    );
    const c = v.evidence.checks.find((k) => k.check === 'expect.text');
    expect(c?.outcome).toBe('not-run');
    expect(c?.detail).toContain('dialog is open');
    expect(v.evidence.tier).toBe('unverifiable');
    expect(page.__frames[0]!.evaluate).not.toHaveBeenCalled();
  });

  it('V12: a frame that never answers is bounded (monotonic clock), reported not-run, and leaves no unhandled rejection', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown): void => void unhandled.push(e);
    process.on('unhandledRejection', onUnhandled);
    try {
      const page = pageWithFrames('hang');
      const t0 = performance.now();
      const v = await verifier.verifyAction(
        tab({ url: 'u', page }),
        'u',
        { success: true, actionType: 'click' },
        { expectedElementText: 'x' },
      );
      const elapsed = performance.now() - t0;
      // the call RETURNED although the frame never answers (the bound fired); no upper wall-time bound (load-sensitive)
      expect(elapsed).toBeGreaterThan(1400);
      expect(v.evidence.checks.find((c) => c.check === 'expect.text')?.outcome).toBe('not-run');
      await new Promise((r) => setTimeout(r, 20));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('V12b: some frames throwing and none finding the text is unavailable, never not-found', async () => {
    const r = await pageContainsVisibleText(tab({ url: 'u', page: pageWithFrames(false, 'throw') }), 'x');
    expect(r).toEqual({ result: 'unavailable', detail: '1 of 2 frames could not be inspected' });
    const found = await pageContainsVisibleText(tab({ url: 'u', page: pageWithFrames('throw', true) }), 'x');
    expect(found.result).toBe('found');
  });

  describe('V13: visibleTextContainsInPage', () => {
    afterEach(() => vi.unstubAllGlobals());
    const shadowChild = (innerText: string) => ({ shadowRoot: { children: [{ innerText }], querySelectorAll: () => [] } });
    const stub = (bodyText: string, hosts: unknown[]) =>
      vi.stubGlobal('document', { body: { innerText: bodyText }, querySelectorAll: () => hosts });

    it('finds text in body.innerText', () => {
      stub('hello TARGET world', []);
      expect(visibleTextContainsInPage('TARGET')).toBe(true);
    });
    it('finds text only in a shadow child innerText', () => {
      stub('nothing here', [shadowChild('in shadow TARGET')]);
      expect(visibleTextContainsInPage('TARGET')).toBe(true);
    });
    it('is false when neither has it', () => {
      stub('nothing here', [shadowChild('nor here')]);
      expect(visibleTextContainsInPage('TARGET')).toBe(false);
    });
    it('is fully self-contained: re-created from toString() it behaves identically', () => {
      const clone = new Function(`return (${visibleTextContainsInPage.toString()})`)() as typeof visibleTextContainsInPage;
      stub('nothing', [shadowChild('shadow TARGET')]);
      expect(clone('TARGET')).toBe(true);
      stub('nothing', []);
      expect(clone('TARGET')).toBe(false);
    });
  });

  describe('V13b (fix-1 F1): unrendered shadow hosts / frames contribute nothing', () => {
    afterEach(() => vi.unstubAllGlobals());
    type FakeEl = Record<string, any>;
    const el = (display = 'block', extra: FakeEl = {}): FakeEl => ({
      parentElement: null,
      style: { display, contentVisibility: 'visible' },
      getRootNode: () => ({}),
      ...extra,
    });
    /** A fake page: `body` text, optional shadow hosts, an optional embedding <iframe> element, doc rects. */
    const page = (o: { bodyText?: string; body?: FakeEl; hosts?: FakeEl[]; rects?: number; frameElement?: FakeEl | null }) => {
      const body = o.body ?? el('block', { innerText: o.bodyText ?? '' });
      vi.stubGlobal('window', { getComputedStyle: (e: FakeEl) => e.style, frameElement: o.frameElement ?? null });
      vi.stubGlobal('document', {
        body,
        documentElement: { getClientRects: () => Array.from({ length: o.rects ?? 1 }) },
        querySelectorAll: () => o.hosts ?? [],
      });
    };
    /** A shadow host (`hostStyle`) whose shadow root holds one child with `text`. */
    const shadowHost = (text: string, hostStyle: FakeEl['style'], hostParent: FakeEl | null = null): FakeEl => {
      const host: FakeEl = el('block', { parentElement: hostParent });
      host.style = { display: 'block', contentVisibility: 'visible', ...hostStyle };
      const root = { host };
      host.shadowRoot = { children: [el('block', { innerText: text, getRootNode: () => root })], querySelectorAll: () => [] };
      return host;
    };

    it('NEG: text in an open shadow root whose host is display:none does NOT count (innerText would fall back to textContent)', () => {
      page({ bodyText: 'nothing', hosts: [shadowHost('SHADOW-HIDDEN TARGET', { display: 'none' })] });
      expect(visibleTextContainsInPage('TARGET')).toBe(false);
    });
    it('NEG: the shadow host sits inside a display:none light-DOM ancestor', () => {
      const hiddenDiv = el('none');
      page({ bodyText: 'nothing', hosts: [shadowHost('TARGET', {}, hiddenDiv)] });
      expect(visibleTextContainsInPage('TARGET')).toBe(false);
    });
    it('NEG: the shadow host is under a content-visibility:hidden ancestor', () => {
      const skipped = el('block');
      skipped.style.contentVisibility = 'hidden';
      page({ bodyText: 'nothing', hosts: [shadowHost('TARGET', {}, skipped)] });
      expect(visibleTextContainsInPage('TARGET')).toBe(false);
    });
    it('POS: text in a visible shadow root still counts, including a display:contents host (which has no box of its own)', () => {
      page({ bodyText: 'nothing', hosts: [shadowHost('in shadow TARGET', {})] });
      expect(visibleTextContainsInPage('TARGET')).toBe(true);
      page({ bodyText: 'nothing', hosts: [shadowHost('in shadow TARGET', { display: 'contents' })] });
      expect(visibleTextContainsInPage('TARGET')).toBe(true);
    });
    it('NEG: a display:none iframe document (no box: documentElement has no client rects) contributes nothing, even though body.innerText holds the text', () => {
      page({ bodyText: 'IFRAME-HIDDEN TARGET', rects: 0 });
      expect(visibleTextContainsInPage('TARGET')).toBe(false);
    });
    it('NEG: a same-origin iframe whose embedding <iframe> element is display:none contributes nothing', () => {
      page({ bodyText: 'IFRAME-HIDDEN TARGET', frameElement: el('none') });
      expect(visibleTextContainsInPage('TARGET')).toBe(false);
    });
    it('POS: a visible iframe document (rects present, embedding element rendered) still counts', () => {
      page({ bodyText: 'IFRAME TARGET', rects: 1, frameElement: el('block') });
      expect(visibleTextContainsInPage('TARGET')).toBe(true);
    });
    it('NEG: a display:none body (innerText falls back to textContent) does not count', () => {
      page({ body: el('none', { innerText: 'TARGET' }) });
      expect(visibleTextContainsInPage('TARGET')).toBe(false);
    });
    it('the confirmation runs only for matches: a text that is absent never calls getComputedStyle', () => {
      const gcs = vi.fn();
      page({ bodyText: 'nothing', hosts: [shadowHost('nor here', { display: 'none' })] });
      vi.stubGlobal('window', { getComputedStyle: gcs, frameElement: null });
      expect(visibleTextContainsInPage('TARGET')).toBe(false);
      expect(gcs).not.toHaveBeenCalled();
    });
    it('is self-contained: re-created from toString() it rejects the hidden-host case too', () => {
      const clone = new Function(`return (${visibleTextContainsInPage.toString()})`)() as typeof visibleTextContainsInPage;
      page({ bodyText: 'nothing', hosts: [shadowHost('TARGET', { display: 'none' })] });
      expect(clone('TARGET')).toBe(false);
    });
  });

  it('V14: evidence is capped: strings to 200 chars, checks to 8 with an omission note', async () => {
    const long = 'z'.repeat(1000);
    const ten: BuiltInVerdict = {
      outcome: 'pass',
      reason: 'ok',
      checks: Array.from({ length: 10 }, (_, i) => ({ check: `press_key.c${i}`, outcome: 'pass' as const, observed: long })),
    };
    const v = await verifier.verifyAction(tab({ url: 'u' }), 'u', { success: true, actionType: 'press_key' }, {}, ten);
    expect(v.evidence.checks).toHaveLength(8);
    const obs = v.evidence.checks[0]!.observed as string;
    expect(obs.length).toBeLessThanOrEqual(200);
    expect(obs.endsWith('…')).toBe(true);
    expect(v.evidence.checks[7]!.detail!.endsWith('(+2 more checks omitted)')).toBe(true);
  });

  it('V15: wait with no builtIn is unverifiable with the sleep reason', async () => {
    const v = await verifier.verifyAction(tab({ url: 'u' }), 'u', { success: true, actionType: 'wait' });
    expect(v.evidence.tier).toBe('unverifiable');
    expect(v.reason).toContain('a fixed-duration sleep has no post-condition');
    // `wait` accepts no expect on any surface, so it must not coach toward one
    expect(v.reason).not.toContain('Pass expect');
  });

  it('V16: every tier survives a JSON round trip', async () => {
    const t = tab({ url: 'https://b' });
    const results = [
      await verifier.verifyAction(t, 'https://b', { success: false, actionType: 'click', error: 'e' }),
      await verifier.verifyAction(t, 'https://b', { success: true, actionType: 'click' }),
      await verifier.verifyAction(t, 'https://b', { success: true, actionType: 'press_key' }, {}, failVerdict),
      await verifier.verifyAction(t, 'https://b', { success: true, actionType: 'press_key' }, {}, notRunVerdict),
      await verifier.verifyAction(t, 'https://b', { success: true, actionType: 'press_key' }, { candidateConfidence: 0.1 }, passVerdict()),
    ];
    expect(new Set(results.map((r) => r.evidence.tier))).toEqual(
      new Set(['action-failed', 'verified', 'contradicted', 'unverifiable', 'low-confidence']),
    );
    for (const r of results) expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });

  it('V17: failedVerification equals the verifier output for a failed action, without a tab', async () => {
    const viaVerifier = await verifier.verifyAction(
      tab({ url: 'u' }),
      'u',
      { success: false, actionType: 'click', error: 'boom' },
      { expectedElementText: 'x' },
    );
    expect(failedVerification('boom', ['text'])).toEqual(viaVerifier);
  });

  it('V18: a failed spec check uses the contradicted confidence (0.09), not the old 0.45/0.36', async () => {
    const v = await verifier.verifyAction(
      tab({ url: 'https://a' }),
      'https://a',
      { success: true, actionType: 'navigate' },
      { shouldUrlChange: true },
    );
    expect(v.evidence.tier).toBe('contradicted');
    expect(v.confidence).toBeCloseTo(0.09, 5);
    expect(v.reason).toContain('Expected URL change from https://a');
  });

  it('a spec-only pass keeps the historic reason (iba-acceptance compatibility)', async () => {
    const v = await verifier.verifyAction(
      tab({ url: 'https://b' }),
      'about:blank',
      { success: true, actionType: 'navigate' },
      { shouldUrlChange: true },
    );
    expect(v.verified).toBe(true);
    expect(v.urlChanged).toBe(true);
    expect(v.reason).toBe('Action execution verified successfully with confidence 0.90');
  });

  it('wait_for_selector is now self-verifying for direct verifier callers too', async () => {
    const v = await verifier.verifyAction(tab({ url: 'u' }), 'u', { success: true, actionType: 'wait_for_selector' });
    expect(v.evidence.tier).toBe('verified');
  });
});
