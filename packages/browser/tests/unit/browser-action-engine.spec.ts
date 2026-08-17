/**
 * @file packages/browser/tests/unit/browser-action-engine.spec.ts
 * @description Unit tests for BrowserActionEngine: occlusion-safe click, ExecutionVerifier
 * wiring, node-id staleness guard, duplicate-action guard, cross-frame element resolution,
 * and the honest-error tab-lifecycle stubs.
 */

import { BrowserActionEngine, IBrowserTab } from '../../src/index.js';
import { createTabId } from '@sutradhar/contracts';
import type { Page, Frame, ElementHandle } from 'puppeteer-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** A real, guaranteed-to-exist file path (this spec file itself) for tests that need
 *  `assertUploadPathAllowed`'s existence check to pass so they can exercise other logic. */
const EXISTING_FILE_PATH = fileURLToPath(import.meta.url);

function mockTab(page: Page): IBrowserTab {
  const actionHistory: any[] = [];
  return {
    id: createTabId('tab_1'),
    url: 'https://example.com',
    title: 'Example',
    active: true,
    isActive: true,
    isClosed: false,
    page,
    setActive: () => {},
    navigate: async () => ({}) as any,
    executeAction: async () => ({}) as any,
    close: async () => {},
    toDto: () => ({}) as any,
    getActionHistory: () => actionHistory,
    recordAction: (entry: any) => actionHistory.push(entry),
  } as unknown as IBrowserTab;
}

/** A single-frame page: `frames()` returns just the main frame (matching real Puppeteer,
 *  which always includes it), so resolveElement takes the fast single-target path. */
function singleFramePage(waitForSelectorImpl: (...args: any[]) => any): Page {
  const mainFrame = {
    isDetached: () => false,
    waitForSelector: vi.fn().mockImplementation(waitForSelectorImpl),
  } as unknown as Frame;
  return {
    frames: vi.fn().mockReturnValue([mainFrame]),
    mainFrame: vi.fn().mockReturnValue(mainFrame),
  } as unknown as Page;
}

/** A click/hover-ready ElementHandle double with a scripted `.evaluate()` call sequence. */
function mockHandle(
  overrides: Partial<Record<'click' | 'hover' | 'type' | 'press' | 'select' | 'focus' | 'scrollIntoView', any>> = {},
) {
  return {
    click: overrides.click ?? vi.fn().mockResolvedValue(undefined),
    hover: overrides.hover ?? vi.fn().mockResolvedValue(undefined),
    type: overrides.type ?? vi.fn().mockResolvedValue(undefined),
    press: overrides.press ?? vi.fn().mockResolvedValue(undefined),
    select: overrides.select ?? vi.fn().mockResolvedValue(undefined),
    focus: overrides.focus ?? vi.fn().mockResolvedValue(undefined),
    scrollIntoView: overrides.scrollIntoView ?? vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn(),
  };
}

describe('@sutradhar/browser BrowserActionEngine click occlusion detection', () => {
  it('reports success:false when the target element is occluded at its click point', async () => {
    const handle = mockHandle();
    handle.evaluate
      .mockResolvedValueOnce(false) // assertNotStale: not stale
      .mockResolvedValueOnce(false); // isHit: occluded
    const page = singleFramePage(() => Promise.resolve(handle));

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'click',
      selector: '#start button',
      maxRetries: 0,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('occluded');
    expect(handle.click).not.toHaveBeenCalled();
  });

  it('scrolls the element into view before checking occlusion, so a below-the-fold element is not wrongly reported as occluded', async () => {
    // Regression test: elementFromPoint(cx, cy) returns null for a point outside the current
    // viewport — a below-the-fold element (e.g. a checkout button revealed only after adding
    // several items to a cart) used to fail the occlusion check for that reason alone, before
    // Puppeteer's own click() ever got a chance to auto-scroll it into view. Caught live against
    // real Chrome on a cart page where the checkout button sat below window.innerHeight.
    const handle = mockHandle();
    handle.evaluate.mockResolvedValueOnce(false).mockResolvedValue(true);
    const page = singleFramePage(() => Promise.resolve(handle));

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'click',
      selector: '[data-test="checkout"]',
      maxRetries: 0,
    });

    expect(result.success).toBe(true);
    expect(handle.scrollIntoView).toHaveBeenCalledTimes(1);
    // scrollIntoView must run before the occlusion-check evaluate call (the second evaluate()
    // call — the first is assertNotStale's own check), not after.
    const scrollOrder = (handle.scrollIntoView as any).mock.invocationCallOrder[0];
    const occlusionCheckOrder = (handle.evaluate as any).mock.invocationCallOrder[1];
    expect(scrollOrder).toBeLessThan(occlusionCheckOrder);
  });

  it('reports success:true and clicks when the target element is the topmost hit', async () => {
    const handle = mockHandle();
    handle.evaluate.mockResolvedValueOnce(false).mockResolvedValue(true);
    const page = singleFramePage(() => Promise.resolve(handle));

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'click',
      selector: '#start button',
      maxRetries: 0,
    });

    expect(result.success).toBe(true);
    expect(handle.click).toHaveBeenCalledTimes(1);
  });

  it('clicks at a specific offset within the element instead of its center, when one is given', async () => {
    // Needed for canvas-rendered UI: the interactive thing is pixels drawn inside a <canvas>,
    // not a sub-selectable DOM node, so the only way to hit a specific spot is a pixel offset
    // relative to the element's own top-left corner.
    const handle = mockHandle();
    handle.evaluate.mockResolvedValueOnce(false).mockResolvedValue(true);
    const page = singleFramePage(() => Promise.resolve(handle));

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'click',
      selector: '#canvas-app',
      offset: { x: 80, y: 158 },
      maxRetries: 0,
    });

    expect(result.success).toBe(true);
    expect(handle.click).toHaveBeenCalledWith(
      expect.objectContaining({ offset: { x: 80, y: 158 } }),
    );
    // The occlusion check (evaluate call index 2: [0] assertNotStale, [1] stability wait,
    // [2] occlusion check) must be told about the same offset, not silently fall back to center.
    const occlusionCheckArgs = (handle.evaluate as any).mock.calls[2];
    expect(occlusionCheckArgs[1]).toEqual({ x: 80, y: 158 });
  });

  it('waits for the bounding box to stop changing before checking occlusion, so a click during a CSS transition is not treated as immediately safe', async () => {
    // Regression test: a button revealed mid-transition (e.g. a slide-in panel) is technically
    // present, visible, and unoccluded the instant it's added to the DOM — nothing else in the
    // click path catches a click landing before the element finishes animating to its final
    // position. Caught live: a real "Confirm" button inside an 800ms slide-in panel got clicked
    // successfully at its pre-transition position instead of waiting for the panel to settle.
    // This test only confirms the stability-wait call is wired in at the right point in the
    // sequence (its actual rAF-polling behavior needs a real page — see
    // tools/engine-comparison/hard-fixtures/animated-panel.html for the live check); the mocked
    // evaluate here can't exercise real animation-frame timing.
    const handle = mockHandle();
    handle.evaluate.mockResolvedValueOnce(false).mockResolvedValue(true);
    const page = singleFramePage(() => Promise.resolve(handle));

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'click',
      selector: '#confirm-btn',
      maxRetries: 0,
    });

    expect(result.success).toBe(true);
    // Call order: [0] assertNotStale, [1] stability wait, [2] occlusion check, [3] marker setup...
    const stabilityWaitCall = (handle.evaluate as any).mock.calls[1];
    expect(stabilityWaitCall[1]).toEqual(expect.any(Number)); // timeoutMs passed as the 2nd evaluate() arg
    const stabilityWaitOrder = (handle.evaluate as any).mock.invocationCallOrder[1];
    const occlusionCheckOrder = (handle.evaluate as any).mock.invocationCallOrder[2];
    expect(stabilityWaitOrder).toBeLessThan(occlusionCheckOrder);
  });

  it('falls back to a JS-level click when the CDP click is not observed as delivered', async () => {
    const handle = mockHandle();
    // Sequence: not-stale, stability-wait, isHit=true, marker-setup (void), delivered=false
    // (CDP click silently failed to reach the target — the reproduced upstream Puppeteer/CDP
    // defect), then the fallback JS-level click's own handle.evaluate call.
    handle.evaluate
      .mockResolvedValueOnce(false) // assertNotStale
      .mockResolvedValueOnce(undefined) // stability wait
      .mockResolvedValueOnce(true) // isHit
      .mockResolvedValueOnce(undefined) // marker setup
      .mockResolvedValueOnce(false) // delivered?
      .mockResolvedValueOnce(undefined); // fallback el.click()
    const page = singleFramePage(() => Promise.resolve(handle));

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'click',
      selector: '#start button',
      maxRetries: 0,
    });

    expect(result.success).toBe(true);
    expect(handle.click).toHaveBeenCalledTimes(1); // CDP click was still attempted first
    expect(handle.evaluate).toHaveBeenCalledTimes(6); // ...and the fallback JS click ran too
  });

  it('treats the delivered-check as satisfied (and returns promptly) when the renderer is blocked, e.g. by a native dialog', async () => {
    const handle = mockHandle();
    // isHit + marker-setup resolve normally; the delivered-check evaluate call never resolves
    // at all -- simulating a page blocked by alert()/confirm() -- so the bounded race inside
    // verifiedClick must be what saves this from hanging for the test's lifetime.
    handle.evaluate
      .mockResolvedValueOnce(false) // assertNotStale
      .mockResolvedValueOnce(undefined) // stability wait
      .mockResolvedValueOnce(true) // isHit
      .mockResolvedValueOnce(undefined) // marker setup
      .mockImplementationOnce(() => new Promise(() => {})); // delivered-check: never resolves
    const page = singleFramePage(() => Promise.resolve(handle));

    const engine = new BrowserActionEngine();
    const start = Date.now();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'click',
      selector: '#alert-button',
      maxRetries: 0,
    });
    const elapsedMs = Date.now() - start;

    expect(result.success).toBe(true);
    expect(elapsedMs).toBeLessThan(5000); // bounded by the ~1.5s race, not the page's own hang
  });

  it('does not trigger the fallback click when the CDP click already navigated the page away', async () => {
    const handle = mockHandle();
    handle.evaluate
      .mockResolvedValueOnce(false) // assertNotStale
      .mockResolvedValueOnce(undefined) // stability wait
      .mockResolvedValueOnce(true) // isHit
      .mockResolvedValueOnce(undefined) // marker setup
      .mockRejectedValueOnce(new Error('Execution context was destroyed, most likely because of a navigation.'));
    const page = singleFramePage(() => Promise.resolve(handle));

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'click',
      selector: 'button[type="submit"]',
      maxRetries: 0,
    });

    expect(result.success).toBe(true);
    expect(handle.click).toHaveBeenCalledTimes(1);
    expect(handle.evaluate).toHaveBeenCalledTimes(5); // no 6th (fallback) call
  });

  it('click_by_role now goes through the occlusion-safe path and reports a real miss instead of swallowing it', async () => {
    const handle = mockHandle();
    handle.evaluate.mockResolvedValueOnce(false).mockResolvedValueOnce(false); // not stale, occluded
    const page = singleFramePage(() => Promise.resolve(handle));

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'click_by_role',
      role: 'button',
      maxRetries: 0,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('occluded');
    expect(handle.click).not.toHaveBeenCalled();
  });

  it('click_by_text now goes through the occlusion-safe path and reports a real miss instead of swallowing it (PROB-012)', async () => {
    // Before this fix, click_by_text called element.click() directly — an occluding overlay
    // would never be detected, and the click would report success even though the real click
    // event went to whatever was actually on top. Same regression shape as click_by_role above.
    const handle = mockHandle();
    handle.evaluate.mockResolvedValueOnce(false).mockResolvedValueOnce(false); // not stale, occluded
    const page = singleFramePage(() => Promise.resolve(handle));

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'click_by_text',
      text: 'Submit',
      maxRetries: 0,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('occluded');
    expect(handle.click).not.toHaveBeenCalled();
  });

  it('click_by_role resolves via Puppeteer\'s aria/ selector engine, not a plain [role="x"] CSS selector — so it matches implicit roles too', async () => {
    // Regression test: the previous implementation used `[role="button"]`, a CSS attribute
    // selector that only matches elements with an EXPLICIT role="button" attribute — missing
    // the vast majority of real interactive elements (a plain <button> has an IMPLICIT role of
    // "button" without ever declaring it). aria/ queries the browser's own computed
    // accessibility tree instead, so it catches both.
    const handle = mockHandle();
    handle.evaluate.mockResolvedValueOnce(false).mockResolvedValue(true);
    const mainFrame = {
      isDetached: () => false,
      waitForSelector: vi.fn().mockResolvedValue(handle),
    } as unknown as Frame;
    const page = { frames: vi.fn().mockReturnValue([mainFrame]), mainFrame: vi.fn().mockReturnValue(mainFrame) } as unknown as Page;

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'click_by_role',
      role: 'button',
      name: 'Submit',
      maxRetries: 0,
    });

    expect(result.success).toBe(true);
    expect(handle.click).toHaveBeenCalledTimes(1);
    // The accessible name must actually be threaded into the selector, not silently dropped —
    // the previous implementation accepted and documented `name` as narrowing the match but
    // never used it.
    expect(mainFrame.waitForSelector).toHaveBeenCalledWith(
      'aria/Submit[role="button"]',
      expect.objectContaining({ visible: true }),
    );
  });

  it('click_by_role reports a clear not-found error (role + name) rather than a generic selector-mismatch message', async () => {
    const mainFrame = {
      isDetached: () => false,
      waitForSelector: vi.fn().mockRejectedValue(new Error('not found')),
    } as unknown as Frame;
    const page = { frames: vi.fn().mockReturnValue([mainFrame]), mainFrame: vi.fn().mockReturnValue(mainFrame) } as unknown as Page;

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'click_by_role',
      role: 'checkbox',
      name: 'Accept terms',
      maxRetries: 0,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('role "checkbox"');
    expect(result.error).toContain('accessible name "Accept terms"');
  });

  it('upload_file throws instead of silently no-oping when the selector matches nothing', async () => {
    const page = singleFramePage(() => Promise.reject(new Error('Waiting for selector failed: 5000ms exceeded')));

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'upload_file',
      selector: '#does-not-exist',
      filePath: EXISTING_FILE_PATH,
      maxRetries: 0,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('No file input found');
  });

  it('upload_file rejects a filePath that does not exist, before ever touching the page', async () => {
    const page = singleFramePage(() => Promise.resolve(mockHandle()));

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'upload_file',
      selector: '#file-input',
      filePath: 'E:/definitely/does/not/exist/nope.txt',
      maxRetries: 0,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('does not exist');
  });

  it('upload_file rejects a filePath outside allowedUploadRoots when configured', async () => {
    const page = singleFramePage(() => Promise.resolve(mockHandle()));
    const engine = new BrowserActionEngine(undefined, undefined, undefined, undefined, [
      path.dirname(EXISTING_FILE_PATH) + '/some-other-subdir-that-does-not-contain-this-file',
    ]);

    const result = await engine.executeAction(mockTab(page), {
      actionType: 'upload_file',
      selector: '#file-input',
      filePath: EXISTING_FILE_PATH,
      maxRetries: 0,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('outside the allowed upload directories');
  });

  it('upload_file allows any existing file when allowedUploadRoots is not configured (default, unrestricted)', async () => {
    const handle = mockHandle();
    (handle as any).uploadFile = vi.fn().mockResolvedValue(undefined);
    // Read-back verification (new): the input's real .files[0].name must match the uploaded
    // file's basename.
    handle.evaluate.mockResolvedValueOnce(path.basename(EXISTING_FILE_PATH));
    const page = singleFramePage(() => Promise.resolve(handle));
    const engine = new BrowserActionEngine();

    const result = await engine.executeAction(mockTab(page), {
      actionType: 'upload_file',
      selector: '#file-input',
      filePath: EXISTING_FILE_PATH,
      maxRetries: 0,
    });

    expect(result.success).toBe(true);
  });

  it('type_by_label throws instead of silently typing into the wrong input on a label mismatch', async () => {
    const page = singleFramePage(() => Promise.reject(new Error('failed to find element matching selector')));

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'type_by_label',
      label: 'Does Not Exist',
      value: 'hello',
      maxRetries: 0,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('No input found matching label');
  });
});

describe('@sutradhar/browser BrowserActionEngine ExecutionVerifier wiring', () => {
  it('attaches an honest verification result to a successful action with no spec and no built-in post-condition check — verified false, not a fabricated true', async () => {
    // press_key (not scroll — scroll gained its own real post-condition check in the
    // "assertEffect everywhere" pass, so it no longer demonstrates "no built-in check").
    const page = {
      frames: vi.fn().mockReturnValue([]),
      keyboard: { press: vi.fn().mockResolvedValue(undefined) },
    } as unknown as Page;

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'press_key',
      key: 'Enter',
      maxRetries: 0,
    });

    // Fixes the field-report remediation's 2d finding: ExecutionVerifier used to hardcode
    // verified:true/confidence:0.9 for ANY non-throwing action, which was never actually
    // evidence of anything beyond "the action didn't throw". `press_key` has no built-in
    // post-condition check and no spec was supplied here, so the honest answer is unverified.
    expect(result.success).toBe(true);
    expect(result.verification?.verified).toBe(false);
    expect(result.verification?.reason).toContain('no built-in');
  });

  it('reports verification.verified:false (without failing the action) when a shouldUrlChange spec is not met', async () => {
    const page = {
      frames: vi.fn().mockReturnValue([]),
      keyboard: { press: vi.fn().mockResolvedValue(undefined) },
    } as unknown as Page;

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'press_key',
      key: 'Enter',
      maxRetries: 0,
      verificationSpec: { shouldUrlChange: true },
    });

    // The action itself still succeeded — verification is informational, not gating.
    expect(result.success).toBe(true);
    expect(result.verification?.verified).toBe(false);
    expect(result.verification?.reason).toContain('Expected URL change');
  });

  it('downgrades to verified:false when candidateConfidence is below the low-confidence threshold', async () => {
    const page = {
      frames: vi.fn().mockReturnValue([]),
      keyboard: { press: vi.fn().mockResolvedValue(undefined) },
    } as unknown as Page;

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'press_key',
      key: 'Enter',
      maxRetries: 0,
      verificationSpec: { candidateConfidence: 0.2 },
    });

    expect(result.success).toBe(true);
    expect(result.verification?.verified).toBe(false);
    expect(result.verification?.confidence).toBe(0.2);
    expect(result.verification?.reason).toContain('below the verification threshold');
  });

  it('does not fabricate verified:true from candidateConfidence alone — a spec-less action stays honestly unverified even at a high confidence', async () => {
    const page = {
      frames: vi.fn().mockReturnValue([]),
      keyboard: { press: vi.fn().mockResolvedValue(undefined) },
    } as unknown as Page;

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'press_key',
      key: 'Enter',
      maxRetries: 0,
      verificationSpec: { candidateConfidence: 0.75 },
    });

    // candidateConfidence above the low-confidence threshold only clears that ONE gate — it is
    // not itself evidence of a verified post-condition. `press_key` still has no built-in check
    // and no shouldUrlChange/expectedUrlSubstring/expectedElementText was given, so this must
    // stay verified:false (confidence halved, per the same discounting the other unverified
    // branches use), per the 2d fix.
    expect(result.success).toBe(true);
    expect(result.verification?.verified).toBe(false);
    expect(result.verification?.confidence).toBe(0.375);
    expect(result.verification?.reason).toContain('no built-in');
  });

  it('reports verified:true (with the real confidence) for a self-verifying action type even with no spec', async () => {
    const handle = mockHandle();
    handle.evaluate.mockResolvedValueOnce(false).mockResolvedValue(true); // not stale; occlusion/delivery all clear
    const page = singleFramePage(() => Promise.resolve(handle));

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'click',
      selector: '#start button',
      maxRetries: 0,
      verificationSpec: { candidateConfidence: 0.75 },
    });

    // `click` DOES carry a built-in post-condition check (verifiedClickOnHandle's occlusion +
    // delivery-marker check) even without a caller-supplied spec, so it earns a confident pass.
    expect(result.success).toBe(true);
    expect(result.verification?.verified).toBe(true);
    expect(result.verification?.confidence).toBe(0.75);
  });

  it('reports verified:true for click_by_text too, now that it goes through the same occlusion-safe path (closes PROB-012)', async () => {
    const handle = mockHandle();
    handle.evaluate.mockResolvedValueOnce(false).mockResolvedValue(true); // not stale; occlusion/delivery all clear
    const page = singleFramePage(() => Promise.resolve(handle));

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'click_by_text',
      text: 'Submit',
      maxRetries: 0,
      verificationSpec: { candidateConfidence: 0.75 },
    });

    expect(result.success).toBe(true);
    expect(result.verification?.verified).toBe(true);
    expect(result.verification?.confidence).toBe(0.75);
  });
});

describe('@sutradhar/browser BrowserActionEngine node-id staleness guard', () => {
  it('rejects a click on a selector stamped with an older generation than the page currently has', async () => {
    const handle = mockHandle();
    handle.evaluate.mockResolvedValueOnce('generation'); // assertNotStale: IS stale (generation mismatch)
    const page = singleFramePage(() => Promise.resolve(handle));

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'click',
      selector: '[data-sd-node-id="7"]',
      maxRetries: 0,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('stale snapshot');
    expect(handle.click).not.toHaveBeenCalled();
  });

  it('warns but still proceeds when a selector\'s content differs from snapshot time (does NOT hard-block, since this is also the normal signature of ordinary live-updating content, not just virtualized-list recycling)', async () => {
    const handle = mockHandle();
    // First call (assertNotStale) returns 'fingerprint' — a content mismatch. Unlike a
    // 'generation' mismatch, this must NOT throw: live-tested that treating it as fatal blocks
    // completely legitimate clicks on ordinary dynamic content (a price ticker, a relative
    // timestamp), which is a far more common pattern than actual list-node recycling. So the
    // click proceeds — every subsequent evaluate() call (occlusion/delivery) resolves clear.
    handle.evaluate.mockResolvedValueOnce('fingerprint').mockResolvedValue(true);
    const page = singleFramePage(() => Promise.resolve(handle));

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'click',
      selector: '[data-sd-node-id="7"]',
      maxRetries: 0,
    });

    expect(result.success).toBe(true);
    expect(handle.click).toHaveBeenCalled();
  });

  it('does not block a plain CSS selector with no generation stamp', async () => {
    const handle = mockHandle();
    handle.evaluate.mockResolvedValueOnce(false).mockResolvedValue(true);
    const page = singleFramePage(() => Promise.resolve(handle));

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'click',
      selector: '#submit',
      maxRetries: 0,
    });

    expect(result.success).toBe(true);
  });
});

describe('@sutradhar/browser BrowserActionEngine duplicate-action guard', () => {
  it('rejects an immediate repeat click on the same target, without re-dispatching', async () => {
    const handle = mockHandle();
    handle.evaluate.mockResolvedValueOnce(false).mockResolvedValue(true);
    const page = singleFramePage(() => Promise.resolve(handle));

    const engine = new BrowserActionEngine();
    const params = { actionType: 'click' as const, selector: '#submit', maxRetries: 0 };

    const first = await engine.executeAction(mockTab(page), params);
    expect(first.success).toBe(true);
    expect(handle.click).toHaveBeenCalledTimes(1);

    const second = await engine.executeAction(mockTab(page), params);
    expect(second.success).toBe(false);
    expect(second.error).toContain('Duplicate');
    expect(handle.click).toHaveBeenCalledTimes(1); // no second dispatch
  });

  it('does NOT reject repeated press_key calls on the same key (fixes PROB-037 — Tab-Tab-Tab through a form, ArrowDown-ArrowDown through a dropdown, etc. are legitimate, not accidental double-dispatch)', async () => {
    const page = {
      frames: vi.fn().mockReturnValue([]),
      keyboard: { press: vi.fn().mockResolvedValue(undefined) },
    } as unknown as Page;
    const engine = new BrowserActionEngine();
    const tab = mockTab(page);

    const first = await engine.executeAction(tab, { actionType: 'press_key', key: 'Tab', maxRetries: 0 });
    const second = await engine.executeAction(tab, { actionType: 'press_key', key: 'Tab', maxRetries: 0 });
    const third = await engine.executeAction(tab, { actionType: 'press_key', key: 'Tab', maxRetries: 0 });

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(second.error).toBeUndefined();
    expect(third.success).toBe(true);
  });

  it('does not guard non-mutating actions like wait_for_selector', async () => {
    const handle = mockHandle();
    const page = singleFramePage(() => Promise.resolve(handle));

    const engine = new BrowserActionEngine();
    const params = { actionType: 'wait_for_selector' as const, selector: '#thing', maxRetries: 0 };

    const first = await engine.executeAction(mockTab(page), params);
    const second = await engine.executeAction(mockTab(page), params);

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
  });

  it('does not block the internal retry loop within a single executeAction call', async () => {
    const handle = mockHandle();
    handle.evaluate.mockResolvedValueOnce(false).mockResolvedValue(true); // attempt 2 only
    let attempts = 0;
    const page = singleFramePage(() => {
      attempts++;
      if (attempts < 2) return Promise.reject(new Error('transient failure'));
      return Promise.resolve(handle);
    });

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'click',
      selector: '#retry-me',
      maxRetries: 2,
    });

    expect(result.success).toBe(true);
    expect(result.retriesUsed).toBe(1);
  });
});

describe('@sutradhar/browser BrowserActionEngine type clears existing content first', () => {
  it('triple-clicks to select existing text, backspaces it, then types the new value, in that order', async () => {
    const handle = mockHandle();
    handle.evaluate
      .mockResolvedValueOnce(false) // assertNotStale: not stale
      .mockResolvedValueOnce('new value'); // readElementValue read-back: landed correctly
    const page = singleFramePage(() => Promise.resolve(handle));
    const callOrder: string[] = [];
    handle.click.mockImplementation(() => {
      callOrder.push('click');
      return Promise.resolve();
    });
    handle.press.mockImplementation(() => {
      callOrder.push('press');
      return Promise.resolve();
    });
    handle.type.mockImplementation(() => {
      callOrder.push('type');
      return Promise.resolve();
    });

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'type',
      selector: '#field',
      value: 'new value',
    });

    expect(result.success).toBe(true);
    expect(handle.click).toHaveBeenCalledWith({ count: 3 });
    expect(handle.press).toHaveBeenCalledWith('Backspace');
    expect(handle.type).toHaveBeenCalledWith('new value');
    expect(callOrder).toEqual(['click', 'press', 'type']);
  });

  it('throws (does not report success) when the typed value never lands, even after a native-setter repair attempt — fixes the field-report remediation\'s A1 finding', async () => {
    const handle = mockHandle();
    handle.evaluate
      .mockResolvedValueOnce(false) // assertNotStale: not stale
      .mockResolvedValueOnce('') // readElementValue after clearAndType: still empty (the race)
      .mockResolvedValueOnce(undefined) // nativeSetterFill's own evaluate call
      .mockResolvedValueOnce(''); // readElementValue after the repair attempt: still empty
    const page = singleFramePage(() => Promise.resolve(handle));

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'type',
      selector: '#field',
      value: 'Ada',
      maxRetries: 0,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('did not land the expected value');
    expect(result.error).toContain('"Ada"');
  });

  it('falls back to the native-setter fill when the normal type sequence leaves a mismatch, and succeeds if that lands the value', async () => {
    const handle = mockHandle();
    handle.evaluate
      .mockResolvedValueOnce(false) // assertNotStale: not stale
      .mockResolvedValueOnce('') // readElementValue after clearAndType: empty (the race)
      .mockResolvedValueOnce(undefined) // nativeSetterFill's own evaluate call (sets value + dispatches events)
      .mockResolvedValueOnce('Ada'); // readElementValue after the repair: landed correctly
    const page = singleFramePage(() => Promise.resolve(handle));

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'type',
      selector: '#field',
      value: 'Ada',
    });

    expect(result.success).toBe(true);
    // 4 evaluate calls: assertNotStale, first read-back, nativeSetterFill, second read-back.
    expect(handle.evaluate).toHaveBeenCalledTimes(4);
  });

  it('treats a live-input-masked value as landed correctly once it survives a real blur — e.g. Stripe Elements formatting a card number with spaces', async () => {
    const handle = mockHandle();
    handle.evaluate
      .mockResolvedValueOnce(false) // assertNotStale: not stale
      .mockResolvedValueOnce('4242 4242 4242 4242') // read-back: masking inserted spaces
      .mockResolvedValueOnce(undefined) // blur() call
      .mockResolvedValueOnce('4242 4242 4242 4242') // read-back after blur: still stable
      .mockResolvedValueOnce(undefined); // focus() call (restoring focus)
    const page = singleFramePage(() => Promise.resolve(handle));

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'type',
      selector: '#card-number',
      value: '4242424242424242',
    });

    expect(result.success).toBe(true);
    // 5 evaluate calls: assertNotStale, read-back, blur, read-back, focus — no native-setter repair needed.
    expect(handle.evaluate).toHaveBeenCalledTimes(5);
  });

  it('treats a masked value with inserted separators (slash, dash) as landed correctly once it survives a real blur — e.g. an expiry-date field', async () => {
    const handle = mockHandle();
    handle.evaluate
      .mockResolvedValueOnce(false) // assertNotStale: not stale
      .mockResolvedValueOnce('12 / 30') // read-back: masking inserted spaces + a slash
      .mockResolvedValueOnce(undefined) // blur() call
      .mockResolvedValueOnce('12 / 30') // read-back after blur: still stable
      .mockResolvedValueOnce(undefined); // focus() call
    const page = singleFramePage(() => Promise.resolve(handle));

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'type',
      selector: '#expiry',
      value: '1230',
    });

    expect(result.success).toBe(true);
    expect(handle.evaluate).toHaveBeenCalledTimes(5);
  });

  it('catches a masked value that drifts on blur — fixes the Stripe expiry-field digit-loss bug found live (only manifests once focus moves to the next field, e.g. CVC)', async () => {
    const handle = mockHandle();
    handle.evaluate
      .mockResolvedValueOnce(false) // assertNotStale: not stale
      .mockResolvedValueOnce('12 / 30') // read-back immediately after typing: looks correct
      .mockResolvedValueOnce(undefined) // blur() call
      .mockResolvedValueOnce('12 / 3') // read-back after blur: the trailing digit is gone
      .mockResolvedValueOnce(undefined) // focus() call (restoring focus)
      .mockResolvedValueOnce(undefined) // nativeSetterFill's own evaluate call (repair attempt)
      .mockResolvedValueOnce('12 / 3'); // read-back after repair: still drifted
    const page = singleFramePage(() => Promise.resolve(handle));

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'type',
      selector: '#expiry',
      value: '1230',
      maxRetries: 0,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('did not land the expected value');
  });

  it('still fails a genuinely truncated value even though it would pass a naive substring check', async () => {
    const handle = mockHandle();
    handle.evaluate
      .mockResolvedValueOnce(false) // assertNotStale: not stale
      .mockResolvedValueOnce('4242 4242') // read-back: genuinely truncated, not just reformatted
      .mockResolvedValueOnce(undefined) // nativeSetterFill's own evaluate call
      .mockResolvedValueOnce('4242 4242'); // read-back after repair: still truncated
    const page = singleFramePage(() => Promise.resolve(handle));

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'type',
      selector: '#card-number',
      value: '4242424242424242',
      maxRetries: 0,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('did not land the expected value');
  });
});

describe('@sutradhar/browser BrowserActionEngine retry does not interleave with an in-flight dispatch (fixes A2)', () => {
  it('does not start a second dispatch until a timed-out first attempt has settled', async () => {
    const handle = mockHandle();
    let typeCallCount = 0;
    let releaseFirstType: (() => void) | undefined;
    handle.evaluate.mockImplementation(() => Promise.resolve(false)); // never stale
    handle.type.mockImplementation(() => {
      typeCallCount++;
      if (typeCallCount === 1) {
        // First attempt: never resolves on its own within the test's timeout window — the
        // retry loop's own timeoutMs will fire first, simulating exactly the hang GLM's A2
        // repro hit. It DOES eventually resolve, once released below, so the settlement-await
        // fix has something real to wait for.
        return new Promise<void>((resolve) => {
          releaseFirstType = resolve;
        });
      }
      return Promise.resolve();
    });
    const page = singleFramePage(() => Promise.resolve(handle));

    const engine = new BrowserActionEngine();
    const resultPromise = engine.executeAction(mockTab(page), {
      actionType: 'type',
      selector: '#field',
      value: 'Ada',
      timeoutMs: 50, // fire the timeout almost immediately
      maxRetries: 1,
    });

    // Let the timeout fire and the retry loop enter its settlement-await grace period, THEN
    // release the first attempt's type() call — if the fix works, the second attempt's type()
    // (typeCallCount === 2) cannot have started yet, because the loop is still awaiting the
    // first one's settlement.
    await new Promise((r) => setTimeout(r, 100));
    expect(typeCallCount).toBe(1); // second attempt has NOT started while the first is in flight
    releaseFirstType?.();

    await resultPromise.catch(() => {}); // outcome doesn't matter here, only the interleaving
    expect(typeCallCount).toBeLessThanOrEqual(2); // never a third overlapping call
  });
});

describe('@sutradhar/browser BrowserActionEngine duplicate-action guard covers click_by_role/click_by_text targets (fixes the field-report remediation\'s new finding)', () => {
  // Each waitForSelector call returns a FRESH handle (its own `evaluate` mock), matching real
  // Puppeteer where every click_by_role targets a distinct live element — this lets each of the
  // two executeAction calls below script its own assertNotStale(false)-then-true sequence
  // instead of racing a single shared mock across both actions.
  function freshHandlePage(): Page {
    return singleFramePage(() => {
      const handle = mockHandle();
      handle.evaluate.mockResolvedValueOnce(false).mockResolvedValue(true);
      return Promise.resolve(handle);
    });
  }

  it('does NOT reject two different click_by_role calls (different role/name) within the duplicate window', async () => {
    const engine = new BrowserActionEngine();
    const tab = mockTab(freshHandlePage());

    const first = await engine.executeAction(tab, { actionType: 'click_by_role', role: 'button', name: 'Open Actions Menu' });
    const second = await engine.executeAction(tab, { actionType: 'click_by_role', role: 'menuitem', name: 'Archive Item' });

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(second.error).toBeUndefined();
  });

  it('DOES still reject a true duplicate — same role/name, same tab, within the window', async () => {
    const engine = new BrowserActionEngine();
    const tab = mockTab(freshHandlePage());

    const first = await engine.executeAction(tab, { actionType: 'click_by_role', role: 'button', name: 'Submit' });
    const second = await engine.executeAction(tab, { actionType: 'click_by_role', role: 'button', name: 'Submit' });

    expect(first.success).toBe(true);
    expect(second.success).toBe(false);
    expect(second.error).toContain('Duplicate');
  });
});

describe('@sutradhar/browser BrowserActionEngine context-destroyed diagnosis beyond click', () => {
  it('rethrows a clear "page navigated away" diagnosis when type hits an execution-context-destroyed error', async () => {
    const handle = mockHandle();
    handle.evaluate.mockResolvedValueOnce(false); // assertNotStale: not stale
    (handle as any).type = vi
      .fn()
      .mockRejectedValue(new Error('Execution context was destroyed, most likely because of a navigation.'));
    const page = singleFramePage(() => Promise.resolve(handle));

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'type',
      selector: '#field',
      value: 'hello',
      maxRetries: 0,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Page navigated away mid-action');
    expect(result.error).toContain("'type'");
  });

  it('leaves an unrelated type error untouched', async () => {
    const handle = mockHandle();
    handle.evaluate.mockResolvedValueOnce(false);
    (handle as any).type = vi.fn().mockRejectedValue(new Error('some other failure'));
    const page = singleFramePage(() => Promise.resolve(handle));

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'type',
      selector: '#field',
      value: 'hello',
      maxRetries: 0,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('some other failure');
  });
});

describe('@sutradhar/browser BrowserActionEngine keyboard modifiers', () => {
  it('presses and releases modifiers around press_key, in reverse order on release', async () => {
    const order: string[] = [];
    const page = {
      frames: vi.fn().mockReturnValue([]),
      keyboard: {
        down: vi.fn().mockImplementation(async (k: string) => order.push(`down:${k}`)),
        up: vi.fn().mockImplementation(async (k: string) => order.push(`up:${k}`)),
        press: vi.fn().mockImplementation(async (k: string) => order.push(`press:${k}`)),
      },
    } as unknown as Page;

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'press_key',
      key: 'a',
      modifiers: ['Control', 'Shift'],
      maxRetries: 0,
    });

    expect(result.success).toBe(true);
    expect(order).toEqual(['down:Control', 'down:Shift', 'press:a', 'up:Shift', 'up:Control']);
  });

  it('releases modifiers even when the underlying action throws', async () => {
    const order: string[] = [];
    const page = {
      frames: vi.fn().mockReturnValue([]),
      keyboard: {
        down: vi.fn().mockImplementation(async (k: string) => order.push(`down:${k}`)),
        up: vi.fn().mockImplementation(async (k: string) => order.push(`up:${k}`)),
        press: vi.fn().mockRejectedValue(new Error('boom')),
      },
    } as unknown as Page;

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'press_key',
      key: 'a',
      modifiers: ['Control'],
      maxRetries: 0,
    });

    expect(result.success).toBe(false);
    expect(order).toEqual(['down:Control', 'up:Control']);
  });

  it('does not touch the keyboard at all when no modifiers are given', async () => {
    const page = {
      frames: vi.fn().mockReturnValue([]),
      keyboard: {
        down: vi.fn(),
        up: vi.fn(),
        press: vi.fn().mockResolvedValue(undefined),
      },
    } as unknown as Page;

    const engine = new BrowserActionEngine();
    await engine.executeAction(mockTab(page), { actionType: 'press_key', key: 'a', maxRetries: 0 });

    expect((page.keyboard.down as any)).not.toHaveBeenCalled();
    expect((page.keyboard.up as any)).not.toHaveBeenCalled();
  });
});

describe('@sutradhar/browser BrowserActionEngine multi-select', () => {
  it('selects multiple values when `values` is given', async () => {
    const handle = mockHandle();
    handle.evaluate
      .mockResolvedValueOnce(false) // assertNotStale
      .mockResolvedValueOnce(['red', 'blue']); // read-back verification
    (handle as any).select = vi.fn().mockResolvedValue(['red', 'blue']);
    const page = singleFramePage(() => Promise.resolve(handle));

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'select_option',
      selector: '#colors',
      values: ['red', 'blue'],
      maxRetries: 0,
    });

    expect(result.success).toBe(true);
    expect((handle as any).select).toHaveBeenCalledWith('red', 'blue');
    expect(result.outputData).toEqual({ selectedValues: ['red', 'blue'] });
  });

  it('still supports a single `value` for backward compatibility', async () => {
    const handle = mockHandle();
    handle.evaluate
      .mockResolvedValueOnce(false) // assertNotStale
      .mockResolvedValueOnce(['red']); // read-back verification
    (handle as any).select = vi.fn().mockResolvedValue(['red']);
    const page = singleFramePage(() => Promise.resolve(handle));

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'select_option',
      selector: '#colors',
      value: 'red',
      maxRetries: 0,
    });

    expect(result.success).toBe(true);
    expect((handle as any).select).toHaveBeenCalledWith('red');
  });

  it('throws when the read-back selected value does not match what was requested', async () => {
    const handle = mockHandle();
    handle.evaluate
      .mockResolvedValueOnce(false) // assertNotStale
      .mockResolvedValueOnce(['green']); // read-back: landed on the wrong option
    (handle as any).select = vi.fn().mockResolvedValue(['green']);
    const page = singleFramePage(() => Promise.resolve(handle));

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'select_option',
      selector: '#colors',
      value: 'red',
      maxRetries: 0,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('did not land the expected value');
  });
});

describe('@sutradhar/browser BrowserActionEngine per-tab action concurrency guard', () => {
  it('serializes two concurrent actions against the same tab instead of interleaving them', async () => {
    const order: string[] = [];
    let resolveFirst!: () => void;
    const firstGate = new Promise<void>((r) => {
      resolveFirst = r;
    });

    // press_key (not scroll — scroll now issues several internal page.evaluate calls of its
    // own for real post-condition verification, which would confuse this test's single-call
    // ordering trace). press_key still only touches page.keyboard.press once, so it stays a
    // clean probe for the tab-level serialization queue this test actually exercises.
    const page = {
      frames: vi.fn().mockReturnValue([]),
      keyboard: {
        press: vi.fn().mockImplementation(async () => {
          order.push('press-1-start');
          await firstGate; // held open until the test releases it
          order.push('press-1-end');
        }),
      },
    } as unknown as Page;

    const engine = new BrowserActionEngine();
    const tab = mockTab(page);

    const first = engine.executeAction(tab, { actionType: 'press_key', key: 'Enter', maxRetries: 0 });
    // Give the first action a tick to actually start (and get stuck on firstGate).
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual(['press-1-start']);

    // The second call must not start its own keyboard.press until the first has resolved —
    // if the queue didn't serialize, 'press-2-start' would appear before 'press-1-end'.
    // Uses a different key than the first ('Tab' vs 'Enter') so the duplicate-action guard
    // (same tab + actionType + target within 1s) doesn't reject it as a double-dispatch —
    // that guard is a real, separate mechanism from the serialization queue this test targets.
    (page.keyboard.press as any).mockImplementationOnce(async () => {
      order.push('press-2-start');
    });
    const second = engine.executeAction(tab, { actionType: 'press_key', key: 'Tab', maxRetries: 0 });
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual(['press-1-start']); // second still hasn't run

    resolveFirst();
    await Promise.all([first, second]);

    expect(order).toEqual(['press-1-start', 'press-1-end', 'press-2-start']);
  });

  it('does not serialize actions against two different tabs', async () => {
    const pageA = {
      frames: vi.fn().mockReturnValue([]),
      keyboard: { press: vi.fn().mockResolvedValue(undefined) },
    } as unknown as Page;
    const pageB = {
      frames: vi.fn().mockReturnValue([]),
      keyboard: { press: vi.fn().mockResolvedValue(undefined) },
    } as unknown as Page;

    const engine = new BrowserActionEngine();
    const tabA = mockTab(pageA);
    (tabA as any).id = 'tab_A';
    const tabB = mockTab(pageB);
    (tabB as any).id = 'tab_B';

    const [resultA, resultB] = await Promise.all([
      engine.executeAction(tabA, { actionType: 'press_key', key: 'Enter', maxRetries: 0 }),
      engine.executeAction(tabB, { actionType: 'press_key', key: 'Enter', maxRetries: 0 }),
    ]);

    expect(resultA.success).toBe(true);
    expect(resultB.success).toBe(true);
  });
});

describe('@sutradhar/browser BrowserActionEngine cross-frame element resolution', () => {
  it('resolves and clicks an element that only exists in a nested iframe, not the main frame', async () => {
    const handle = mockHandle();
    handle.evaluate.mockResolvedValueOnce(false).mockResolvedValue(true);

    const mainFrame = {
      isDetached: () => false,
      waitForSelector: vi.fn().mockRejectedValue(new Error('not found')),
    } as unknown as Frame;
    const iframe = {
      isDetached: () => false,
      waitForSelector: vi.fn().mockResolvedValue(handle),
    } as unknown as Frame;
    const page = {
      frames: vi.fn().mockReturnValue([mainFrame, iframe]),
      mainFrame: vi.fn().mockReturnValue(mainFrame),
    } as unknown as Page;

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'click',
      selector: '#inside-iframe',
      maxRetries: 0,
    });

    expect(result.success).toBe(true);
    expect(handle.click).toHaveBeenCalledTimes(1);
    expect((iframe.waitForSelector as any)).toHaveBeenCalledWith(
      'pierce/#inside-iframe',
      expect.objectContaining({ visible: true }),
    );
  });

  it('reports a clear not-found error when no frame contains the selector', async () => {
    const mainFrame = {
      isDetached: () => false,
      waitForSelector: vi.fn().mockRejectedValue(new Error('not found')),
    } as unknown as Frame;
    const otherFrame = {
      isDetached: () => false,
      waitForSelector: vi.fn().mockRejectedValue(new Error('not found')),
    } as unknown as Frame;
    const page = {
      frames: vi.fn().mockReturnValue([mainFrame, otherFrame]),
      mainFrame: vi.fn().mockReturnValue(mainFrame),
    } as unknown as Page;

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'click',
      selector: '#does-not-exist-anywhere',
      maxRetries: 0,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('No visible element found');
  });

  it('skips a detached frame rather than searching it', async () => {
    const handle = mockHandle();
    handle.evaluate.mockResolvedValueOnce(false).mockResolvedValue(true);

    const detached = {
      isDetached: () => true,
      waitForSelector: vi.fn(),
    } as unknown as Frame;
    const live = { isDetached: () => false, waitForSelector: vi.fn().mockResolvedValue(handle) } as unknown as Frame;
    const page = {
      frames: vi.fn().mockReturnValue([detached, live]),
      mainFrame: vi.fn().mockReturnValue(live),
    } as unknown as Page;

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'click',
      selector: '#thing',
      maxRetries: 0,
    });

    expect(result.success).toBe(true);
    expect((detached.waitForSelector as any)).not.toHaveBeenCalled();
  });

  it('prefers a main-frame match over an identically-matching element in another frame (e.g. a third-party ad iframe)', async () => {
    const mainHandle = mockHandle();
    mainHandle.evaluate.mockResolvedValueOnce(false).mockResolvedValue(true);
    const adHandle = mockHandle();

    const mainFrame = {
      isDetached: () => false,
      waitForSelector: vi.fn().mockResolvedValue(mainHandle),
    } as unknown as Frame;
    const adFrame = {
      isDetached: () => false,
      waitForSelector: vi.fn().mockResolvedValue(adHandle),
    } as unknown as Frame;
    const page = {
      frames: vi.fn().mockReturnValue([mainFrame, adFrame]),
      mainFrame: vi.fn().mockReturnValue(mainFrame),
    } as unknown as Page;

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'click_by_role',
      role: 'button',
      maxRetries: 0,
    });

    expect(result.success).toBe(true);
    expect(mainHandle.click).toHaveBeenCalledTimes(1);
    expect(adHandle.click).not.toHaveBeenCalled();
    // The ad frame's waitForSelector should never even be consulted once the main frame matched.
    expect(adFrame.waitForSelector).not.toHaveBeenCalled();
  });

  it('still finds a main-frame element that appears AFTER the main-frame head-start window, on a page that also has an iframe', async () => {
    // Regression test: resolveElement's fallback race used to search only "otherFrames" (every
    // frame except the main frame) once the head-start window expired — so a main-frame element
    // that shows up later (async-rendered content) than that window, but well within the overall
    // timeout, was never found on any page that also happens to have an iframe. Caught live via
    // a real Chrome run against a page with a 1200ms-delayed main-frame element plus an iframe.
    const handle = mockHandle();
    handle.evaluate.mockResolvedValueOnce(false).mockResolvedValue(true);

    const mainFrame = {
      isDetached: () => false,
      // First call is the short head-start check (not found yet); the element only appears in
      // time for the second call, made during the fallback race.
      waitForSelector: vi.fn().mockRejectedValueOnce(new Error('not found yet')).mockResolvedValue(handle),
    } as unknown as Frame;
    const iframe = {
      isDetached: () => false,
      waitForSelector: vi.fn().mockRejectedValue(new Error('not in this frame')),
    } as unknown as Frame;
    const page = {
      frames: vi.fn().mockReturnValue([mainFrame, iframe]),
      mainFrame: vi.fn().mockReturnValue(mainFrame),
    } as unknown as Page;

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'click',
      selector: '#delayed-main-frame-element',
      maxRetries: 0,
    });

    expect(result.success).toBe(true);
    expect(handle.click).toHaveBeenCalledTimes(1);
    expect((mainFrame.waitForSelector as any)).toHaveBeenCalledTimes(2);
  });
});

describe('@sutradhar/browser BrowserActionEngine right-click (button-aware)', () => {
  it('listens for contextmenu (not click) delivery and reports success on a clean right-click', async () => {
    const handle = mockHandle();
    handle.evaluate.mockResolvedValueOnce(false).mockResolvedValue(true); // not stale, isHit, marker, delivered=true
    const page = singleFramePage(() => Promise.resolve(handle));

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'click',
      selector: '#ctx-target',
      button: 'right',
      maxRetries: 0,
    });

    expect(result.success).toBe(true);
    expect(handle.click).toHaveBeenCalledWith(expect.objectContaining({ button: 'right' }));
  });

  it('falls back to a synthetic contextmenu dispatch (not a JS click) when a right-click is not delivered', async () => {
    const handle = mockHandle();
    handle.evaluate
      .mockResolvedValueOnce(false) // assertNotStale
      .mockResolvedValueOnce(undefined) // stability wait
      .mockResolvedValueOnce(true) // isHit
      .mockResolvedValueOnce(undefined) // marker setup
      .mockResolvedValueOnce(false) // delivered? no
      .mockResolvedValueOnce(undefined); // fallback dispatch
    const page = singleFramePage(() => Promise.resolve(handle));

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'click',
      selector: '#ctx-target',
      button: 'right',
      maxRetries: 0,
    });

    expect(result.success).toBe(true);
    expect(handle.evaluate).toHaveBeenCalledTimes(6);
  });
});

describe('@sutradhar/browser BrowserActionEngine middle-click (button-aware) — fixes a real duplicate-tab bug found live', () => {
  it('listens for auxclick (not click) delivery and reports success on a clean middle-click, without ever falling back to a JS click', async () => {
    const handle = mockHandle();
    handle.evaluate.mockResolvedValueOnce(false).mockResolvedValue(true); // not stale, isHit, marker, delivered=true
    const page = singleFramePage(() => Promise.resolve(handle));

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'click',
      selector: '#link-target',
      button: 'middle',
      maxRetries: 0,
    });

    expect(result.success).toBe(true);
    expect(handle.click).toHaveBeenCalledWith(expect.objectContaining({ button: 'middle' }));
  });

  it('falls back to a synthetic auxclick dispatch (not a JS click, which would open a duplicate target=_blank tab) when a middle-click is not delivered', async () => {
    const handle = mockHandle();
    handle.evaluate
      .mockResolvedValueOnce(false) // assertNotStale
      .mockResolvedValueOnce(undefined) // stability wait
      .mockResolvedValueOnce(true) // isHit
      .mockResolvedValueOnce(undefined) // marker setup
      .mockResolvedValueOnce(false) // delivered? no
      .mockResolvedValueOnce(undefined); // fallback dispatch
    const page = singleFramePage(() => Promise.resolve(handle));

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'click',
      selector: '#link-target',
      button: 'middle',
      maxRetries: 0,
    });

    expect(result.success).toBe(true);
    expect(handle.evaluate).toHaveBeenCalledTimes(6);
  });
});

describe('@sutradhar/browser BrowserActionEngine drag_and_drop', () => {
  it('resolves both source and target handles and calls drag then drop', async () => {
    const source = mockHandle();
    const target = mockHandle();
    (source as any).drag = vi.fn().mockResolvedValue(undefined);
    (target as any).drop = vi.fn().mockResolvedValue(undefined);
    source.evaluate.mockResolvedValue(false); // assertNotStale: not stale
    target.evaluate
      .mockResolvedValueOnce(false) // assertNotStale: not stale
      .mockResolvedValueOnce(undefined) // delivery-marker setup (addEventListener)
      .mockResolvedValueOnce(true); // read-back: 'drop' event was observed

    let call = 0;
    const mainFrame = {
      isDetached: () => false,
      waitForSelector: vi.fn().mockImplementation(() => {
        call++;
        return Promise.resolve(call === 1 ? source : target);
      }),
    } as unknown as Frame;
    const page = { frames: vi.fn().mockReturnValue([mainFrame]), mainFrame: vi.fn().mockReturnValue(mainFrame) } as unknown as Page;

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'drag_and_drop',
      selector: '#drag-source',
      targetSelector: '#drop-target',
      maxRetries: 0,
    });

    expect(result.success).toBe(true);
    expect((source as any).drag).toHaveBeenCalledWith(target);
    expect((target as any).drop).toHaveBeenCalledWith(source);
  });

  it('fails when the target selector cannot be resolved', async () => {
    const source = mockHandle();
    source.evaluate.mockResolvedValue(false);
    let call = 0;
    const mainFrame = {
      isDetached: () => false,
      waitForSelector: vi.fn().mockImplementation(() => {
        call++;
        return call === 1 ? Promise.resolve(source) : Promise.reject(new Error('not found'));
      }),
    } as unknown as Frame;
    const page = { frames: vi.fn().mockReturnValue([mainFrame]), mainFrame: vi.fn().mockReturnValue(mainFrame) } as unknown as Page;

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'drag_and_drop',
      selector: '#drag-source',
      targetSelector: '#missing-target',
      maxRetries: 0,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('target selector');
  });
});

describe('@sutradhar/browser BrowserActionEngine touch_tap', () => {
  it('taps the resolved element', async () => {
    const handle = mockHandle();
    (handle as any).tap = vi.fn().mockResolvedValue(undefined);
    handle.evaluate.mockResolvedValue(false); // assertNotStale
    const page = singleFramePage(() => Promise.resolve(handle));

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'touch_tap',
      selector: '#tap-target',
      maxRetries: 0,
    });

    expect(result.success).toBe(true);
    expect((handle as any).tap).toHaveBeenCalledTimes(1);
  });
});

describe('@sutradhar/browser BrowserActionEngine action-history recording', () => {
  it('records a successful action into the tab history', async () => {
    // press_key, not scroll — scroll now has real post-condition verification requiring
    // multiple realistic page.evaluate return values; press_key stays a clean minimal probe.
    const page = {
      frames: vi.fn().mockReturnValue([]),
      keyboard: { press: vi.fn().mockResolvedValue(undefined) },
    } as unknown as Page;
    const engine = new BrowserActionEngine();
    const tab = mockTab(page);

    const result = await engine.executeAction(tab, { actionType: 'press_key', key: 'Enter', maxRetries: 0 });

    expect(result.success).toBe(true);
    expect(tab.getActionHistory()).toHaveLength(1);
    expect(tab.getActionHistory()[0]).toMatchObject({ actionType: 'press_key', success: true });
  });

  it('records a failed action into the tab history, with the error message', async () => {
    const page = singleFramePage(() => Promise.reject(new Error('boom')));
    const engine = new BrowserActionEngine();
    const tab = mockTab(page);

    const result = await engine.executeAction(tab, {
      actionType: 'click',
      selector: '#does-not-exist',
      maxRetries: 0,
    });

    expect(result.success).toBe(false);
    expect(tab.getActionHistory()).toHaveLength(1);
    expect(tab.getActionHistory()[0]).toMatchObject({ actionType: 'click', success: false });
  });
});

describe('@sutradhar/browser BrowserActionEngine screenshot-on-failure', () => {
  it('attaches a base64 screenshot to a failed action result when the page is still alive', async () => {
    const page = singleFramePage(() => Promise.reject(new Error('boom')));
    (page as any).screenshot = vi.fn().mockResolvedValue('ZmFrZS1wbmc=');

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'click',
      selector: '#does-not-exist',
      maxRetries: 0,
    });

    expect(result.success).toBe(false);
    expect(result.failureScreenshot).toBe('ZmFrZS1wbmc=');
  });

  it('leaves failureScreenshot undefined (not throwing) when the screenshot capture itself fails', async () => {
    const page = singleFramePage(() => Promise.reject(new Error('boom')));
    (page as any).screenshot = vi.fn().mockRejectedValue(new Error('page closed'));

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'click',
      selector: '#does-not-exist',
      maxRetries: 0,
    });

    expect(result.success).toBe(false);
    expect(result.failureScreenshot).toBeUndefined();
  });
});

describe('@sutradhar/browser BrowserActionEngine download_file', () => {
  function mockCdpClient() {
    const handlers = new Map<string, (evt: any) => void>();
    return {
      send: vi.fn().mockResolvedValue(undefined),
      on: vi.fn((evt: string, cb: (evt: any) => void) => handlers.set(evt, cb)),
      off: vi.fn((evt: string) => handlers.delete(evt)),
      detach: vi.fn().mockResolvedValue(undefined),
      emit: (evt: string, payload: any) => handlers.get(evt)?.(payload),
    };
  }

  it('resolves with the downloaded filename and path once Page.downloadProgress reports completed', async () => {
    const handle = mockHandle();
    handle.evaluate.mockResolvedValueOnce(false).mockResolvedValue(true); // not stale, isHit, marker, delivered
    const page = singleFramePage(() => Promise.resolve(handle));
    const client = mockCdpClient();
    (page as any).browser = vi.fn().mockReturnValue({
      target: vi.fn().mockReturnValue({ createCDPSession: vi.fn().mockResolvedValue(client) }),
    });

    const allowedDir = path.resolve('/tmp/downloads');
    const engine = new BrowserActionEngine(undefined, undefined, undefined, [allowedDir]);
    const promise = engine.executeAction(mockTab(page), {
      actionType: 'download_file',
      selector: '#download-link',
      downloadDir: allowedDir,
      maxRetries: 0,
    });

    // Give verifiedClick's internal races (real setTimeout-based) time to settle, then fire
    // the CDP download events.
    await new Promise((r) => setTimeout(r, 50));
    client.emit('Browser.downloadWillBegin', { suggestedFilename: 'report.pdf' });
    client.emit('Browser.downloadProgress', { state: 'completed' });

    const result = await promise;

    expect(result.success).toBe(true);
    expect(result.outputData).toMatchObject({
      downloadedFilename: 'report.pdf',
      downloadedPath: path.join(allowedDir, 'report.pdf'),
    });
    expect(client.send).toHaveBeenCalledWith(
      'Browser.setDownloadBehavior',
      expect.objectContaining({ behavior: 'allow', downloadPath: allowedDir, eventsEnabled: true }),
    );
  });

  it('rejects a downloadDir outside the allowed roots instead of trusting it blindly', async () => {
    const handle = mockHandle();
    handle.evaluate.mockResolvedValueOnce(false).mockResolvedValue(true);
    const page = singleFramePage(() => Promise.resolve(handle));

    const engine = new BrowserActionEngine(undefined, undefined, undefined, [path.resolve('/safe/dir')]);
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'download_file',
      selector: '#download-link',
      downloadDir: '/etc',
      maxRetries: 0,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('outside the allowed download directories');
  });

  it('accepts a requested downloadDir that differs only in case from the allowed root, on Windows — fixes the field-report remediation\'s new finding', async () => {
    if (process.platform !== 'win32') return; // the bug (and its fix) is Windows-filesystem-specific
    const handle = mockHandle();
    handle.evaluate.mockResolvedValueOnce(false).mockResolvedValue(true);
    const page = singleFramePage(() => Promise.resolve(handle));
    const client = mockCdpClient();
    (page as any).browser = vi.fn().mockReturnValue({
      target: vi.fn().mockReturnValue({ createCDPSession: vi.fn().mockResolvedValue(client) }),
    });

    // Neither path exists on disk, so `realpath` throws for both and each falls back to its own
    // literal case — exactly the condition that used to make the plain `startsWith` check
    // false-reject a genuinely-nested, not-yet-created subdirectory whose case happened to
    // differ from the allowed root's.
    const allowedRoot = path.resolve('C:\\SutradharTestFakeRoot' + Date.now());
    const requestedSubdir = path.join(allowedRoot.toLowerCase(), 'downloads');
    const engine = new BrowserActionEngine(undefined, undefined, undefined, [allowedRoot]);
    const promise = engine.executeAction(mockTab(page), {
      actionType: 'download_file',
      selector: '#download-link',
      downloadDir: requestedSubdir,
      maxRetries: 0,
    });

    await new Promise((r) => setTimeout(r, 50));
    client.emit('Browser.downloadWillBegin', { suggestedFilename: 'report.pdf' });
    client.emit('Browser.downloadProgress', { state: 'completed' });

    const result = await promise;

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('fails cleanly when the download is canceled', async () => {
    const handle = mockHandle();
    handle.evaluate.mockResolvedValueOnce(false).mockResolvedValue(true);
    const page = singleFramePage(() => Promise.resolve(handle));
    const client = mockCdpClient();
    (page as any).browser = vi.fn().mockReturnValue({
      target: vi.fn().mockReturnValue({ createCDPSession: vi.fn().mockResolvedValue(client) }),
    });

    const engine = new BrowserActionEngine();
    const promise = engine.executeAction(mockTab(page), {
      actionType: 'download_file',
      selector: '#download-link',
      maxRetries: 0,
    });

    await new Promise((r) => setTimeout(r, 50));
    client.emit('Browser.downloadProgress', { state: 'canceled' });

    const result = await promise;

    expect(result.success).toBe(false);
    expect(result.error).toContain('canceled');
  });

  it('detaches the CDP session and does not leave a dangling unhandled rejection when the trigger click fails', async () => {
    // Regression test: if verifiedClick throws (e.g. trigger element not found) before the
    // download promise is awaited, its own timeout timer must not fire an unobserved
    // rejection later, and the CDP session must be cleaned up rather than leaked.
    const page = singleFramePage(() => Promise.reject(new Error('not found')));
    const client = mockCdpClient();
    (page as any).browser = vi.fn().mockReturnValue({
      target: vi.fn().mockReturnValue({ createCDPSession: vi.fn().mockResolvedValue(client) }),
    });

    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);

    try {
      const engine = new BrowserActionEngine();
      const result = await engine.executeAction(mockTab(page), {
        actionType: 'download_file',
        selector: '#missing-link',
        maxRetries: 0,
        timeoutMs: 200,
      });

      expect(result.success).toBe(false);
      expect(client.detach).toHaveBeenCalled();

      // Give any dangling timer/microtask a chance to surface before asserting none did.
      await new Promise((r) => setTimeout(r, 50));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});

describe('@sutradhar/browser BrowserActionEngine actions fail loudly with no live page (no fabricated success)', () => {
  const noPageTab = (): IBrowserTab => mockTab(undefined as unknown as Page);

  it.each([
    { actionType: 'click', selector: '#x' },
    { actionType: 'click_by_text', text: 'Submit' },
    { actionType: 'click_by_role', role: 'button' },
    { actionType: 'type', selector: '#x', value: 'hi' },
    { actionType: 'type_by_label', label: 'Name', value: 'hi' },
    { actionType: 'press_key', key: 'Enter' },
    { actionType: 'scroll' },
    { actionType: 'wait_for_selector', selector: '#x' },
    { actionType: 'select_option', selector: '#x', value: 'v' },
    { actionType: 'hover', selector: '#x' },
    { actionType: 'focus', selector: '#x' },
    { actionType: 'take_screenshot' },
    { actionType: 'drag_and_drop', selector: '#a', targetSelector: '#b' },
    { actionType: 'touch_tap', selector: '#x' },
    { actionType: 'upload_file', selector: '#x', filePath: '/tmp/f.txt' },
    { actionType: 'download_file', selector: '#x' },
  ] as const)('$actionType reports failure instead of fabricated success when the tab has no live page', async (params) => {
    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(noPageTab(), { ...params, maxRetries: 0 });

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

describe('@sutradhar/browser BrowserActionEngine tab-lifecycle actions are session-level, not engine-level', () => {
  // 'switch_tab'/'open_new_tab'/'close_tab' were removed from the ActionType union — tab
  // bookkeeping is a session-level concern (SutradharRuntime.focusTab/createTab/closeTab, or
  // the browser.focus_tab/new_tab/close_tab MCP tools), not something BrowserActionEngine can
  // do correctly on its own (no session context). A caller that bypasses the type system and
  // passes one of these strings anyway still gets an honest "unsupported" error, never a
  // fabricated success — confirmed here via an `as any` cast since TS itself now prevents it.
  it.each(['switch_tab', 'open_new_tab', 'close_tab'])(
    '%s fails loudly instead of pretending to succeed, for a caller that bypasses the type system',
    async (actionType) => {
      const page = {} as unknown as Page;
      const engine = new BrowserActionEngine();
      const result = await engine.executeAction(mockTab(page), {
        actionType: actionType as any,
        maxRetries: 0,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain(actionType);
    },
  );
});

describe('@sutradhar/browser BrowserActionEngine post-action settle wait', () => {
  it('does not wait for settle when the caller does not request it (default off)', async () => {
    // press_key: the only action-specific async call is page.keyboard.press — if a settle wait
    // ran unrequested, it would show up as an extra page.evaluate/waitForNetworkIdle call.
    const evaluateSpy = vi.fn().mockResolvedValue(undefined);
    const waitForNetworkIdleSpy = vi.fn().mockResolvedValue(undefined);
    const page = {
      frames: vi.fn().mockReturnValue([]),
      keyboard: { press: vi.fn().mockResolvedValue(undefined) },
      evaluate: evaluateSpy,
      waitForNetworkIdle: waitForNetworkIdleSpy,
    } as unknown as Page;

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'press_key',
      key: 'Enter',
      maxRetries: 0,
    });

    expect(result.success).toBe(true);
    expect(evaluateSpy).not.toHaveBeenCalled();
    expect(waitForNetworkIdleSpy).not.toHaveBeenCalled();
  });

  it('waits for DOM-quiet and network-idle when settle:true is requested', async () => {
    const evaluateSpy = vi.fn().mockResolvedValue(undefined);
    const waitForNetworkIdleSpy = vi.fn().mockResolvedValue(undefined);
    const page = {
      frames: vi.fn().mockReturnValue([]),
      keyboard: { press: vi.fn().mockResolvedValue(undefined) },
      evaluate: evaluateSpy,
      waitForNetworkIdle: waitForNetworkIdleSpy,
    } as unknown as Page;

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'press_key',
      key: 'Enter',
      maxRetries: 0,
      settle: true,
    });

    expect(result.success).toBe(true);
    expect(evaluateSpy).toHaveBeenCalledTimes(1);
    expect(evaluateSpy).toHaveBeenCalledWith(expect.any(Function), 300, 5000); // DEFAULT_SETTLE_SPEC
    expect(waitForNetworkIdleSpy).toHaveBeenCalledWith({ idleTime: 500, timeout: 5000 });
  });

  it('honors a partial settle spec, filling in defaults for the rest', async () => {
    const evaluateSpy = vi.fn().mockResolvedValue(undefined);
    const waitForNetworkIdleSpy = vi.fn().mockResolvedValue(undefined);
    const page = {
      frames: vi.fn().mockReturnValue([]),
      keyboard: { press: vi.fn().mockResolvedValue(undefined) },
      evaluate: evaluateSpy,
      waitForNetworkIdle: waitForNetworkIdleSpy,
    } as unknown as Page;

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'press_key',
      key: 'Enter',
      maxRetries: 0,
      settle: { mutationQuietMs: 100 },
    });

    expect(result.success).toBe(true);
    expect(evaluateSpy).toHaveBeenCalledWith(expect.any(Function), 100, 5000); // overridden + default
    expect(waitForNetworkIdleSpy).toHaveBeenCalledWith({ idleTime: 500, timeout: 5000 }); // default
  });

  it('does not fail the action if the settle wait itself times out (best-effort, not a hard requirement)', async () => {
    const page = {
      frames: vi.fn().mockReturnValue([]),
      keyboard: { press: vi.fn().mockResolvedValue(undefined) },
      evaluate: vi.fn().mockRejectedValue(new Error('evaluate failed: execution context destroyed')),
      waitForNetworkIdle: vi.fn().mockRejectedValue(new Error('Waiting for network idle failed: timeout')),
    } as unknown as Page;

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'press_key',
      key: 'Enter',
      maxRetries: 0,
      settle: true,
    });

    expect(result.success).toBe(true);
  });
});

describe('@sutradhar/browser BrowserActionEngine scroll — element-targeted (nested scroll containers)', () => {
  it('scrolls the target element itself (its own scrollTop), not the window, when a selector is given', async () => {
    const handle = mockHandle();
    handle.evaluate
      .mockResolvedValueOnce(false) // assertNotStale
      .mockResolvedValueOnce(0) // before: el.scrollTop
      .mockResolvedValueOnce(undefined) // el.scrollBy(...)
      .mockResolvedValueOnce(300) // after: el.scrollTop
      .mockResolvedValueOnce(1000); // maxScrollTop
    const page = singleFramePage(() => Promise.resolve(handle));

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'scroll',
      selector: '.grid-scroller',
      amount: 300,
      maxRetries: 0,
    });

    expect(result.success).toBe(true);
    expect(result.outputData).toEqual({
      direction: 'down',
      selector: '.grid-scroller',
      scrolledFrom: 0,
      scrolledTo: 300,
    });
  });

  it('throws a clear, element-specific error when the target scroll container genuinely does not move (not at a boundary)', async () => {
    const handle = mockHandle();
    handle.evaluate
      .mockResolvedValueOnce(false) // assertNotStale
      .mockResolvedValueOnce(50) // before
      .mockResolvedValueOnce(undefined) // scrollBy
      .mockResolvedValueOnce(50) // after — unchanged
      .mockResolvedValueOnce(1000); // maxScrollTop — nowhere near boundary
    const page = singleFramePage(() => Promise.resolve(handle));

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'scroll',
      selector: '.grid-scroller',
      maxRetries: 0,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('had no effect on ".grid-scroller"');
  });

  it('does not false-fail when the target element is already at its scroll boundary', async () => {
    const handle = mockHandle();
    handle.evaluate
      .mockResolvedValueOnce(false) // assertNotStale
      .mockResolvedValueOnce(1000) // before — already at (near) the bottom
      .mockResolvedValueOnce(undefined) // scrollBy
      .mockResolvedValueOnce(1000) // after — unchanged (genuinely at the boundary)
      .mockResolvedValueOnce(1000); // maxScrollTop
    const page = singleFramePage(() => Promise.resolve(handle));

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'scroll',
      selector: '.grid-scroller',
      direction: 'down',
      maxRetries: 0,
    });

    expect(result.success).toBe(true);
  });

  it('falls back to window-scrolling when no selector is given (unchanged default behavior)', async () => {
    const evaluateSpy = vi.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(undefined).mockResolvedValueOnce(500).mockResolvedValueOnce(1000);
    const page = { frames: vi.fn().mockReturnValue([]), evaluate: evaluateSpy } as unknown as Page;

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'scroll',
      maxRetries: 0,
    });

    expect(result.success).toBe(true);
    expect(result.outputData).toEqual({ direction: 'down', scrolledFrom: 0, scrolledTo: 500 });
  });

  it('direction "bottom" actually jumps to the real scroll boundary, not a relative move (fixes a real bug: "bottom" previously scrolled UP by `amount` instead)', async () => {
    const evaluateSpy = vi
      .fn()
      .mockResolvedValueOnce(0) // before: scrollY at the top
      .mockResolvedValueOnce(undefined) // window.scrollTo(0, scrollHeight)
      .mockResolvedValueOnce(2500) // after: landed at the real bottom
      .mockResolvedValueOnce(2500); // maxScrollY
    const page = { frames: vi.fn().mockReturnValue([]), evaluate: evaluateSpy } as unknown as Page;

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'scroll',
      direction: 'bottom',
      maxRetries: 0,
    });

    expect(result.success).toBe(true);
    expect(result.outputData).toEqual({ direction: 'bottom', scrolledFrom: 0, scrolledTo: 2500 });
  });

  it('direction "top" jumps to scrollY 0 on an element-targeted scroll container', async () => {
    const handle = mockHandle();
    handle.evaluate
      .mockResolvedValueOnce(false) // assertNotStale
      .mockResolvedValueOnce(800) // before: partway down
      .mockResolvedValueOnce(undefined) // el.scrollTop = 0
      .mockResolvedValueOnce(0) // after: at the real top
      .mockResolvedValueOnce(1000); // maxScrollTop
    const page = singleFramePage(() => Promise.resolve(handle));

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'scroll',
      selector: '.grid-scroller',
      direction: 'top',
      maxRetries: 0,
    });

    expect(result.success).toBe(true);
    expect(result.outputData).toEqual({
      direction: 'top',
      selector: '.grid-scroller',
      scrolledFrom: 800,
      scrolledTo: 0,
    });
  });
});
