/**
 * @file packages/browser/tests/unit/browser-action-engine.spec.ts
 * @description Unit tests for BrowserActionEngine: occlusion-safe click, ExecutionVerifier
 * wiring, node-id staleness guard, duplicate-action guard, cross-frame element resolution,
 * and the honest-error tab-lifecycle stubs.
 */

import { BrowserActionEngine, IBrowserTab, defaultDownloadRoot } from '../../src/index.js';
// Test-only hook (FR2-01 fix-1, GAP-013) — not part of the package's public surface, so it's
// imported directly from the source module rather than re-exported via index.ts.
import { __TEST_ONLY_setWaitForSelectorOuterGraceMs } from '../../src/actions/browser-action-engine.js';
import { createTabId } from '@sutradhar/contracts';
import type { Page, Frame, ElementHandle } from 'puppeteer-core';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { existsSync, rmSync, mkdtempSync, mkdirSync, symlinkSync, writeFileSync, unlinkSync, utimesSync } from 'node:fs';

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

  it('click_by_text uses a concatenated-descendant-text XPath match, not text()-only — so it can find a phrase split across sibling elements (e.g. <mark>-highlighted search terms), preferring the deepest match', async () => {
    // Regression test for a real bug found live against Frontiers.org's search results
    // (Milestone 95, 2026-08-18): a title like "...artificial intelligence in healthcare..."
    // rendered with each matched query word wrapped in its own <mark> meant no single
    // element's direct text() ever contained the full phrase, even though it read as one
    // continuous phrase and correctly appeared in snapshot's own pageText. `contains(text(),
    // ...)` structurally cannot match this; `contains(., ...)` (concatenated descendant text,
    // like textContent) can — but needs the `not(.//*[contains(., ...)])` clause to prefer the
    // innermost/most specific match over every ancestor up to <html>, which trivially also
    // contains any substring present anywhere on the page.
    const handle = mockHandle();
    handle.evaluate.mockResolvedValueOnce(false).mockResolvedValue(true); // not stale; occlusion/delivery all clear
    const page = singleFramePage(() => Promise.resolve(handle));

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'click_by_text',
      text: 'artificial intelligence in healthcare',
      maxRetries: 0,
    });

    expect(result.success).toBe(true);
    const mainFrame = page.mainFrame();
    const [xpath] = (mainFrame.waitForSelector as any).mock.calls[0];
    expect(xpath).toContain('contains(., "artificial intelligence in healthcare")');
    expect(xpath).toContain('not(.//*[contains(., "artificial intelligence in healthcare")])');
    expect(xpath).not.toContain('contains(text(),');
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
    (handle as any).evaluate = vi.fn().mockResolvedValue(true); // visible, for the default state
    const page = singleFramePage(() => Promise.resolve(handle));
    (page as any).frames()[0].$ = vi.fn().mockResolvedValue(handle);

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

  it('fully settles each cross-frame selector probe before starting the next, so no losing wait survives to reject after a frame detach', async () => {
    const handle = mockHandle();
    handle.evaluate.mockResolvedValueOnce(false).mockResolvedValue(true);
    const order: string[] = [];

    const mainFrame = {
      isDetached: () => false,
      waitForSelector: vi
        .fn()
        .mockRejectedValueOnce(new Error('not found during main-frame head start'))
        .mockImplementationOnce(() =>
          new Promise((_resolve, reject) => {
            order.push('main-probe-start');
            setTimeout(() => {
              order.push('main-probe-settled');
              reject(new Error('not in main frame'));
            }, 5);
          }),
        ),
    } as unknown as Frame;
    const iframe = {
      isDetached: () => false,
      waitForSelector: vi.fn().mockImplementation(async () => {
        order.push('iframe-probe-start');
        return handle;
      }),
    } as unknown as Frame;
    const page = {
      frames: vi.fn().mockReturnValue([mainFrame, iframe]),
      mainFrame: vi.fn().mockReturnValue(mainFrame),
    } as unknown as Page;

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'click',
      selector: '#inside-dynamic-iframe',
      maxRetries: 0,
    });

    expect(result.success).toBe(true);
    expect(order).toEqual(['main-probe-start', 'main-probe-settled', 'iframe-probe-start']);
    expect(handle.click).toHaveBeenCalledTimes(1);
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

  it('GAP-010: a never-resolving screenshot does not block the failed result past the 3000ms cap', async () => {
    vi.useFakeTimers();
    try {
      const page = singleFramePage(() => Promise.reject(new Error('boom')));
      // Simulates the audit-1 finding: a screenshot against a backgrounded/unresponsive tab can
      // hang far longer than any reasonable "best effort" (up to the ~180s CDP protocol
      // timeout). This mock never resolves or rejects at all.
      (page as any).screenshot = vi.fn().mockImplementation(() => new Promise(() => {}));

      const engine = new BrowserActionEngine();
      const resultPromise = engine.executeAction(mockTab(page), {
        actionType: 'click',
        selector: '#does-not-exist',
        maxRetries: 0,
      });

      // Advance past the action's own timeout/retry bookkeeping plus the 3000ms screenshot cap.
      await vi.advanceTimersByTimeAsync(20000);
      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.failureScreenshot).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('@sutradhar/browser BrowserActionEngine download_file', () => {
  // GAP-307: download_file takes a real on-disk lock file (os.tmpdir()) keyed by the browser's
  // wsEndpoint. A constant endpoint made every test - and every concurrently running vitest
  // process on the machine - contend for the SAME lock file, so give each mock browser its own.
  let wsCounter = 0;
  function uniqueWs(tag = 'mock-browser'): string {
    return `ws://${tag}-${process.pid}-${Date.now()}-${wsCounter++}`;
  }

  function mockCdpClient() {
    const handlers = new Map<string, (evt: any) => void>();
    const waiters = new Map<string, Array<() => void>>();
    return {
      send: vi.fn().mockResolvedValue(undefined),
      on: vi.fn((evt: string, cb: (evt: any) => void) => {
        handlers.set(evt, cb);
        for (const w of waiters.get(evt) ?? []) w();
        waiters.delete(evt);
      }),
      off: vi.fn((evt: string) => handlers.delete(evt)),
      detach: vi.fn().mockResolvedValue(undefined),
      emit: (evt: string, payload: any) => handlers.get(evt)?.(payload),
      // GAP-307: resolves once the engine has registered a listener for `evt` (event-based, not
      // a fixed sleep). The engine registers its listeners only after a real lock-file
      // acquisition + CDP calls, whose latency varies with machine load; emitting before that
      // silently dropped the event and the test then hung until the action timeout.
      // Hard-bounded so a real regression fails fast instead of hanging.
      whenListening: (evt: string): Promise<void> =>
        handlers.has(evt)
          ? Promise.resolve()
          : new Promise<void>((resolve, reject) => {
              const t = setTimeout(
                () => reject(new Error(`engine never registered a listener for ${evt}`)),
                10000,
              );
              const list = waiters.get(evt) ?? [];
              list.push(() => {
                clearTimeout(t);
                resolve();
              });
              waiters.set(evt, list);
            }),
    };
  }

  it('resolves with the downloaded filename and path once Page.downloadProgress reports completed', async () => {
    const handle = mockHandle();
    handle.evaluate.mockResolvedValueOnce(false).mockResolvedValue(true); // not stale, isHit, marker, delivered
    const page = singleFramePage(() => Promise.resolve(handle));
    const client = mockCdpClient();
    (page as any).browser = vi.fn().mockReturnValue({
      wsEndpoint: vi.fn().mockReturnValue(uniqueWs()), target: vi.fn().mockReturnValue({ createCDPSession: vi.fn().mockResolvedValue(client) }),
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
    await client.whenListening('Browser.downloadProgress');
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
      wsEndpoint: vi.fn().mockReturnValue(uniqueWs()), target: vi.fn().mockReturnValue({ createCDPSession: vi.fn().mockResolvedValue(client) }),
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

    await client.whenListening('Browser.downloadProgress');
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
      wsEndpoint: vi.fn().mockReturnValue(uniqueWs()), target: vi.fn().mockReturnValue({ createCDPSession: vi.fn().mockResolvedValue(client) }),
    });

    const engine = new BrowserActionEngine();
    const promise = engine.executeAction(mockTab(page), {
      actionType: 'download_file',
      selector: '#download-link',
      maxRetries: 0,
    });

    await client.whenListening('Browser.downloadProgress');
    client.emit('Browser.downloadWillBegin', { guid: 'gc', suggestedFilename: 'c.pdf' });
    client.emit('Browser.downloadProgress', { guid: 'gc', state: 'canceled' });

    const result = await promise;

    expect(result.success).toBe(false);
    expect(result.error).toContain('canceled');
  });

  it('resets the download session to deny (without detaching it, FR2-05 fix-2/GAP-301) and does not leave a dangling unhandled rejection when the trigger click fails', async () => {
    // Regression test: if verifiedClick throws (e.g. trigger element not found) before the
    // download promise is awaited, its own timeout timer must not fire an unobserved
    // rejection later, and the CDP session's download behavior must be reset.
    //
    // FR2-05 fix-2 (GAP-301): the session is no longer detached at all — audit-2 confirmed
    // live that detaching right after the 'deny' reset made Chrome silently revert the
    // browser-wide download setting anyway, so this engine now keeps ONE never-detached
    // session per browser for download-behavior management instead.
    const page = singleFramePage(() => Promise.reject(new Error('not found')));
    const client = mockCdpClient();
    (page as any).browser = vi.fn().mockReturnValue({
      wsEndpoint: vi.fn().mockReturnValue(uniqueWs()), target: vi.fn().mockReturnValue({ createCDPSession: vi.fn().mockResolvedValue(client) }),
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
      expect(client.send).toHaveBeenCalledWith('Browser.setDownloadBehavior', { behavior: 'deny' });
      expect(client.detach).not.toHaveBeenCalled();

      // Give any dangling timer/microtask a chance to surface before asserting none did.
      await new Promise((r) => setTimeout(r, 50));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  // FR2-05 additions: symlink/junction escape (B2), guid filtering and filePath reporting (B6),
  // the setDownloadBehavior reset (B7), and the constructor's empty-array default (B12-adjacent).
  describe('FR2-05: containment, reporting and cleanup', () => {
    let tmpRoot: string;

    beforeEach(() => {
      tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'fr2-05-engine-'));
    });

    afterEach(() => {
      rmSync(tmpRoot, { recursive: true, force: true });
    });

    it('E1: rejects a downloadDir reached through a junction/symlink with a not-yet-created tail, without ever creating a CDP session', async () => {
      const root = path.join(tmpRoot, 'root');
      const outside = path.join(tmpRoot, 'outside');
      mkdirSync(root, { recursive: true });
      mkdirSync(outside, { recursive: true });
      symlinkSync(outside, path.join(root, 'jn'), process.platform === 'win32' ? 'junction' : 'dir');

      const handle = mockHandle();
      const page = singleFramePage(() => Promise.resolve(handle));
      const createCDPSession = vi.fn();
      (page as any).browser = vi.fn().mockReturnValue({ wsEndpoint: vi.fn().mockReturnValue(uniqueWs()), target: vi.fn().mockReturnValue({ createCDPSession }) });

      const engine = new BrowserActionEngine(undefined, undefined, undefined, [root]);
      const result = await engine.executeAction(mockTab(page), {
        actionType: 'download_file',
        selector: '#download-link',
        downloadDir: path.join(root, 'jn', 'newsub'),
        maxRetries: 0,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('outside the allowed download directories');
      expect(createCDPSession).not.toHaveBeenCalled();
      expect(existsSync(path.join(outside, 'newsub'))).toBe(false);
    });

    it('E2: rejects a downloadDir whose literal spelling is a prefix-lookalike of an allowed root', async () => {
      const root = path.join(tmpRoot, 'root');
      mkdirSync(root, { recursive: true });
      const handle = mockHandle();
      const page = singleFramePage(() => Promise.resolve(handle));

      const engine = new BrowserActionEngine(undefined, undefined, undefined, [root]);
      const result = await engine.executeAction(mockTab(page), {
        actionType: 'download_file',
        selector: '#download-link',
        downloadDir: root + '-evil',
        maxRetries: 0,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('outside the allowed download directories');
    });

    it('E3: rejects a downloadDir that traverses out of the allowed root via ..', async () => {
      const root = path.join(tmpRoot, 'root');
      mkdirSync(root, { recursive: true });
      const handle = mockHandle();
      const page = singleFramePage(() => Promise.resolve(handle));

      const engine = new BrowserActionEngine(undefined, undefined, undefined, [root]);
      const result = await engine.executeAction(mockTab(page), {
        actionType: 'download_file',
        selector: '#download-link',
        downloadDir: path.join(root, '..', 'x'),
        maxRetries: 0,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('outside the allowed download directories');
    });

    it("E4: prefers CDP's filePath over the suggested filename when it differs (e.g. Chrome uniquified the name)", async () => {
      const dir = path.join(tmpRoot, 'dir');
      mkdirSync(dir, { recursive: true });
      const handle = mockHandle();
      handle.evaluate.mockResolvedValue(true);
      const page = singleFramePage(() => Promise.resolve(handle));
      const client = mockCdpClient();
      (page as any).browser = vi.fn().mockReturnValue({ wsEndpoint: vi.fn().mockReturnValue(uniqueWs()), target: vi.fn().mockReturnValue({ createCDPSession: vi.fn().mockResolvedValue(client) }) });

      const engine = new BrowserActionEngine(undefined, undefined, undefined, [dir]);
      const promise = engine.executeAction(mockTab(page), {
        actionType: 'download_file',
        selector: '#download-link',
        downloadDir: dir,
        maxRetries: 0,
      });

      await client.whenListening('Browser.downloadProgress');
      client.emit('Browser.downloadWillBegin', { guid: 'g1', suggestedFilename: 'r.pdf' });
      client.emit('Browser.downloadProgress', { guid: 'g1', state: 'completed', filePath: path.join(dir, 'r (1).pdf') });

      const result = await promise;
      expect(result.success).toBe(true);
      expect(result.outputData).toMatchObject({
        downloadedPath: path.join(dir, 'r (1).pdf'),
        downloadedFilename: 'r (1).pdf',
      });
    });

    it('E5: ignores progress events for a different guid (a concurrent download in the same browser)', async () => {
      const dir = path.join(tmpRoot, 'dir');
      mkdirSync(dir, { recursive: true });
      const handle = mockHandle();
      handle.evaluate.mockResolvedValue(true);
      const page = singleFramePage(() => Promise.resolve(handle));
      const client = mockCdpClient();
      (page as any).browser = vi.fn().mockReturnValue({ wsEndpoint: vi.fn().mockReturnValue(uniqueWs()), target: vi.fn().mockReturnValue({ createCDPSession: vi.fn().mockResolvedValue(client) }) });

      const engine = new BrowserActionEngine(undefined, undefined, undefined, [dir]);
      const promise = engine.executeAction(mockTab(page), {
        actionType: 'download_file',
        selector: '#download-link',
        downloadDir: dir,
        maxRetries: 0,
      });

      await client.whenListening('Browser.downloadProgress');
      client.emit('Browser.downloadWillBegin', { guid: 'g1', suggestedFilename: 'a.pdf' });
      client.emit('Browser.downloadProgress', { guid: 'g2', state: 'completed' });

      let settled = false;
      void promise.then(() => (settled = true));
      await new Promise((r) => setTimeout(r, 20));
      expect(settled).toBe(false);

      client.emit('Browser.downloadProgress', { guid: 'g1', state: 'completed' });
      const result = await promise;
      expect(result.success).toBe(true);
      expect(result.outputData).toMatchObject({ downloadedFilename: 'a.pdf' });
    });

    // GAP-307: ordering race. A progress event for a DIFFERENT download (another tab/process in
    // the same browser) that arrives BEFORE this call's own downloadWillBegin used to be accepted
    // as this call's result (beganGuid was still unset). Fully deterministic: no timers - every
    // event is emitted synchronously once the engine has registered its listeners.
    it("GAP-307: a foreign guid's 'completed' progress delivered BEFORE this call's own downloadWillBegin is ignored, not accepted as this call's file", async () => {
      const dir = path.join(tmpRoot, 'dir');
      mkdirSync(dir, { recursive: true });
      const handle = mockHandle();
      handle.evaluate.mockResolvedValue(true);
      const page = singleFramePage(() => Promise.resolve(handle));
      const client = mockCdpClient();
      (page as any).browser = vi.fn().mockReturnValue({ wsEndpoint: vi.fn().mockReturnValue(uniqueWs()), target: vi.fn().mockReturnValue({ createCDPSession: vi.fn().mockResolvedValue(client) }) });

      const engine = new BrowserActionEngine(undefined, undefined, undefined, [dir]);
      const promise = engine.executeAction(mockTab(page), {
        actionType: 'download_file',
        selector: '#download-link',
        downloadDir: dir,
        maxRetries: 0,
      });

      await client.whenListening('Browser.downloadProgress');
      // Foreign download finishes first, with its own filePath inside the dir.
      client.emit('Browser.downloadProgress', { guid: 'foreign', state: 'completed', filePath: path.join(dir, 'foreign.bin') });
      // Then this call's own download begins and completes.
      client.emit('Browser.downloadWillBegin', { guid: 'mine', suggestedFilename: 'mine.pdf' });
      client.emit('Browser.downloadProgress', { guid: 'mine', state: 'completed' });

      const result = await promise;
      expect(result.success).toBe(true);
      expect(result.outputData).toMatchObject({
        downloadedFilename: 'mine.pdf',
        downloadedPath: path.join(dir, 'mine.pdf'),
      });
    });

    it("GAP-307: a foreign guid's 'canceled' progress delivered BEFORE this call's own downloadWillBegin does not fail this call", async () => {
      const dir = path.join(tmpRoot, 'dir');
      mkdirSync(dir, { recursive: true });
      const handle = mockHandle();
      handle.evaluate.mockResolvedValue(true);
      const page = singleFramePage(() => Promise.resolve(handle));
      const client = mockCdpClient();
      (page as any).browser = vi.fn().mockReturnValue({ wsEndpoint: vi.fn().mockReturnValue(uniqueWs()), target: vi.fn().mockReturnValue({ createCDPSession: vi.fn().mockResolvedValue(client) }) });

      const engine = new BrowserActionEngine(undefined, undefined, undefined, [dir]);
      const promise = engine.executeAction(mockTab(page), {
        actionType: 'download_file',
        selector: '#download-link',
        downloadDir: dir,
        maxRetries: 0,
      });

      await client.whenListening('Browser.downloadProgress');
      client.emit('Browser.downloadProgress', { guid: 'foreign', state: 'canceled' });
      client.emit('Browser.downloadWillBegin', { guid: 'mine', suggestedFilename: 'mine.pdf' });
      client.emit('Browser.downloadProgress', { guid: 'mine', state: 'completed' });

      const result = await promise;
      expect(result.success).toBe(true);
      expect(result.outputData).toMatchObject({ downloadedFilename: 'mine.pdf' });
    });

    it('E6: sanitizes a hostile suggestedFilename with path.basename when there is no filePath', async () => {
      const dir = path.join(tmpRoot, 'dir');
      mkdirSync(dir, { recursive: true });
      const handle = mockHandle();
      handle.evaluate.mockResolvedValue(true);
      const page = singleFramePage(() => Promise.resolve(handle));
      const client = mockCdpClient();
      (page as any).browser = vi.fn().mockReturnValue({ wsEndpoint: vi.fn().mockReturnValue(uniqueWs()), target: vi.fn().mockReturnValue({ createCDPSession: vi.fn().mockResolvedValue(client) }) });

      const engine = new BrowserActionEngine(undefined, undefined, undefined, [dir]);
      const promise = engine.executeAction(mockTab(page), {
        actionType: 'download_file',
        selector: '#download-link',
        downloadDir: dir,
        maxRetries: 0,
      });

      await client.whenListening('Browser.downloadProgress');
      client.emit('Browser.downloadWillBegin', { guid: 'g1', suggestedFilename: '../../evil.txt' });
      client.emit('Browser.downloadProgress', { guid: 'g1', state: 'completed' });

      const result = await promise;
      expect(result.success).toBe(true);
      expect(result.outputData).toMatchObject({ downloadedPath: path.join(dir, 'evil.txt') });
    });

    it('E7: fails when CDP reports a filePath outside the download directory', async () => {
      const dir = path.join(tmpRoot, 'dir');
      mkdirSync(dir, { recursive: true });
      const handle = mockHandle();
      handle.evaluate.mockResolvedValue(true);
      const page = singleFramePage(() => Promise.resolve(handle));
      const client = mockCdpClient();
      (page as any).browser = vi.fn().mockReturnValue({ wsEndpoint: vi.fn().mockReturnValue(uniqueWs()), target: vi.fn().mockReturnValue({ createCDPSession: vi.fn().mockResolvedValue(client) }) });

      const engine = new BrowserActionEngine(undefined, undefined, undefined, [dir]);
      const promise = engine.executeAction(mockTab(page), {
        actionType: 'download_file',
        selector: '#download-link',
        downloadDir: dir,
        maxRetries: 0,
      });

      await client.whenListening('Browser.downloadProgress');
      client.emit('Browser.downloadWillBegin', { guid: 'g1', suggestedFilename: 'x.bin' });
      client.emit('Browser.downloadProgress', { guid: 'g1', state: 'completed', filePath: path.join(tmpRoot, 'elsewhere', 'x.bin') });

      const result = await promise;
      expect(result.success).toBe(false);
      expect(result.error).toContain('outside the download directory');
    });

    it('E8: resets Browser.setDownloadBehavior to deny (fail closed) on both success and cancellation, WITHOUT detaching the session (fix-2/GAP-301: detaching was the reason the reset did not stick live)', async () => {
      const dir = path.join(tmpRoot, 'dir');
      mkdirSync(dir, { recursive: true });
      const handle = mockHandle();
      handle.evaluate.mockResolvedValue(true);

      // Success path.
      {
        const page = singleFramePage(() => Promise.resolve(handle));
        const client = mockCdpClient();
        (page as any).browser = vi.fn().mockReturnValue({ wsEndpoint: vi.fn().mockReturnValue(uniqueWs()), target: vi.fn().mockReturnValue({ createCDPSession: vi.fn().mockResolvedValue(client) }) });
        const engine = new BrowserActionEngine(undefined, undefined, undefined, [dir]);
        const promise = engine.executeAction(mockTab(page), {
          actionType: 'download_file',
          selector: '#download-link',
          downloadDir: dir,
          maxRetries: 0,
        });
        await client.whenListening('Browser.downloadProgress');
        client.emit('Browser.downloadWillBegin', { guid: 'g1', suggestedFilename: 'a.pdf' });
        client.emit('Browser.downloadProgress', { guid: 'g1', state: 'completed' });
        await promise;

        const resetCall = client.send.mock.calls.find(
          (c: any[]) => c[0] === 'Browser.setDownloadBehavior' && c[1]?.behavior === 'deny',
        );
        expect(resetCall).toBeDefined();
        expect(client.detach).not.toHaveBeenCalled();
      }

      // Cancellation path.
      {
        const page = singleFramePage(() => Promise.resolve(handle));
        const client = mockCdpClient();
        (page as any).browser = vi.fn().mockReturnValue({ wsEndpoint: vi.fn().mockReturnValue(uniqueWs()), target: vi.fn().mockReturnValue({ createCDPSession: vi.fn().mockResolvedValue(client) }) });
        const engine = new BrowserActionEngine(undefined, undefined, undefined, [dir]);
        const promise = engine.executeAction(mockTab(page), {
          actionType: 'download_file',
          selector: '#download-link',
          downloadDir: dir,
          maxRetries: 0,
        });
        await client.whenListening('Browser.downloadProgress');
        client.emit('Browser.downloadWillBegin', { guid: 'g1', suggestedFilename: 'a.pdf' });
        client.emit('Browser.downloadProgress', { guid: 'g1', state: 'canceled' });
        await promise;

        const resetCall = client.send.mock.calls.find(
          (c: any[]) => c[0] === 'Browser.setDownloadBehavior' && c[1]?.behavior === 'deny',
        );
        expect(resetCall).toBeDefined();
        expect(client.detach).not.toHaveBeenCalled();
      }
    });

    it('E9: upload_file rejects a filePath reached through a link that escapes the allowed upload roots', async () => {
      const root = path.join(tmpRoot, 'root');
      const outside = path.join(tmpRoot, 'outside');
      mkdirSync(root, { recursive: true });
      mkdirSync(outside, { recursive: true });
      writeFileSync(path.join(outside, 'secret.txt'), 'shh');
      symlinkSync(outside, path.join(root, 'jn'), process.platform === 'win32' ? 'junction' : 'dir');

      const handle = mockHandle();
      const page = singleFramePage(() => Promise.resolve(handle));
      const engine = new BrowserActionEngine(undefined, undefined, undefined, undefined, [root]);
      const result = await engine.executeAction(mockTab(page), {
        actionType: 'upload_file',
        selector: '#f',
        filePath: path.join(root, 'jn', 'secret.txt'),
        maxRetries: 0,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('outside the allowed upload directories');
    });

    it('E10: an explicit empty allowedDownloadRoots array behaves like the default, not a crash', async () => {
      const handle = mockHandle();
      handle.evaluate.mockResolvedValue(true);
      const page = singleFramePage(() => Promise.resolve(handle));
      const client = mockCdpClient();
      (page as any).browser = vi.fn().mockReturnValue({ wsEndpoint: vi.fn().mockReturnValue(uniqueWs()), target: vi.fn().mockReturnValue({ createCDPSession: vi.fn().mockResolvedValue(client) }) });

      const engine = new BrowserActionEngine(undefined, undefined, undefined, []);
      const promise = engine.executeAction(mockTab(page), {
        actionType: 'download_file',
        selector: '#download-link',
        maxRetries: 0,
      });

      await client.whenListening('Browser.downloadProgress');
      client.emit('Browser.downloadWillBegin', { guid: 'g1', suggestedFilename: 'a.pdf' });
      client.emit('Browser.downloadProgress', { guid: 'g1', state: 'completed' });

      const result = await promise;
      expect(result.success).toBe(true);
      expect(client.send).toHaveBeenCalledWith(
        'Browser.setDownloadBehavior',
        expect.objectContaining({ downloadPath: defaultDownloadRoot() }),
      );
    });

    // ── FR2-05 fix-2 (GAP-301/GAP-302): fail-fast cross-process lock + session reuse ─────────
    it('E11 (GAP-301/302): a second download_file on the SAME browser while one is in flight fails FAST with a clear error, not a queue/timeout', async () => {
      const dir = path.join(tmpRoot, 'e11');
      mkdirSync(dir, { recursive: true });
      const handle = mockHandle();
      handle.evaluate.mockResolvedValue(true); // not stale / not occluded / delivered — so the
      // first call's click actually succeeds and it's genuinely awaiting the download (holding
      // the lock), not failing fast on its own for an unrelated reason.
      const page = singleFramePage(() => Promise.resolve(handle));
      const client = mockCdpClient();
      const browserMock = {
        wsEndpoint: vi.fn().mockReturnValue(uniqueWs('e11')),
        target: vi.fn().mockReturnValue({ createCDPSession: vi.fn().mockResolvedValue(client) }),
      };
      (page as any).browser = vi.fn().mockReturnValue(browserMock);

      const engine = new BrowserActionEngine(undefined, undefined, undefined, [dir]);
      // Two DIFFERENT tabs of the SAME browser — the duplicate-action guard is per-tab, so this
      // must not be masked by that unrelated guard; the lock this test exercises is per-BROWSER
      // (keyed by wsEndpoint), exactly matching the real GAP-301 concurrency shape (different
      // tabs/processes, one shared browser-wide setDownloadBehavior).
      const tab1 = mockTab(page);
      const tab2 = mockTab(page);
      (tab2 as any).id = createTabId('tab_2_e11');
      // First call: never completes (no downloadWillBegin/downloadProgress emitted), so it's
      // still holding the lock when the second call starts. Give it enough headroom to clear
      // its own real on-disk case-sensitivity detection (GAP-300 — a real `fsutil` subprocess
      // spawn, cached per-directory afterward) and actually reach the lock before we start
      // timing the second call's fail-fast behavior.
      const first = engine.executeAction(tab1, {
        actionType: 'download_file',
        selector: '#download-link',
        downloadDir: dir,
        maxRetries: 0,
        timeoutMs: 5000,
      });
      await client.whenListening('Browser.downloadProgress');

      const start = Date.now();
      const second = await engine.executeAction(tab2, {
        actionType: 'download_file',
        selector: '#download-link',
        downloadDir: dir,
        maxRetries: 0,
        timeoutMs: 5000,
      });
      // "Fails fast": well under the 5000ms timeoutMs each call was given, and specifically
      // fast because the directory's case-sensitivity is already cached by the first call — not
      // an assertion that ties this test to a specific fsutil subprocess latency.
      expect(Date.now() - start).toBeLessThan(2000);
      expect(second.success).toBe(false);
      expect(second.error).toContain('already in progress');

      // Clean up the first, still-pending call.
      client.emit('Browser.downloadWillBegin', { guid: 'anything', suggestedFilename: 'x.pdf' });
      client.emit('Browser.downloadProgress', { guid: 'anything', state: 'canceled' });
      await first;
    });

    it('E12 (GAP-301 cause 1): reuses ONE CDP session across sequential download_file calls on the same browser and never detaches it', async () => {
      const dir = path.join(tmpRoot, 'e12');
      mkdirSync(dir, { recursive: true });
      const handle = mockHandle();
      handle.evaluate.mockResolvedValue(true); // not stale / not occluded / marker delivered, every call
      const page = singleFramePage(() => Promise.resolve(handle));
      const client = mockCdpClient();
      const createCDPSession = vi.fn().mockResolvedValue(client);
      const browserMock = {
        wsEndpoint: vi.fn().mockReturnValue(uniqueWs('e12')),
        target: vi.fn().mockReturnValue({ createCDPSession }),
      };
      (page as any).browser = vi.fn().mockReturnValue(browserMock);

      const engine = new BrowserActionEngine(undefined, undefined, undefined, [dir]);

      let driveCount = 0;
      const drive = async () => {
        driveCount++;
        const guid = `g-${driveCount}`;
        const tab = mockTab(page);
        (tab as any).id = createTabId(`tab_e12_${driveCount}`);
        const promise = engine.executeAction(tab, {
          actionType: 'download_file',
          selector: '#download-link',
          downloadDir: dir,
          maxRetries: 0,
          timeoutMs: 2000,
        });
        await client.whenListening('Browser.downloadProgress');
        client.emit('Browser.downloadWillBegin', { guid, suggestedFilename: 'a.pdf' });
        client.emit('Browser.downloadProgress', { guid, state: 'completed' });
        return promise;
      };

      const r1 = await drive();
      const r2 = await drive();
      expect(r1.success).toBe(true);
      expect(r2.success).toBe(true);
      // ONE session created for this browser across BOTH calls — the whole point of GAP-301's
      // never-detached-session fix.
      expect(createCDPSession).toHaveBeenCalledTimes(1);
      expect(client.detach).not.toHaveBeenCalled();
      // Both calls reset to 'deny' — twice, once per call.
      const denyCalls = client.send.mock.calls.filter(
        (c: any[]) => c[0] === 'Browser.setDownloadBehavior' && c[1]?.behavior === 'deny',
      );
      expect(denyCalls.length).toBe(2);
    });

    it('E13 (GAP-301 cause 3): an abandoned dispatch (aborted by the outer timeout) releases the lock promptly instead of holding it until its own inner timeout', async () => {
      const dir = path.join(tmpRoot, 'e13');
      mkdirSync(dir, { recursive: true });
      // Every evaluate() call hangs forever — assertNotStale (the very first thing
      // verifiedClick does) therefore never resolves on its own, since (unlike the later
      // occlusion/delivery checks) it has no internal race/timeout of its own. This makes the
      // real in-flight dispatch work TRULY unable to settle by itself, so the only thing that
      // can ever end it is this engine's own outer-timeout abandonment/abort path — exactly
      // what this test needs to isolate and verify.
      const hungHandle = mockHandle();
      hungHandle.evaluate = vi.fn().mockImplementation(() => new Promise(() => {}));
      const normalHandle = mockHandle();
      normalHandle.evaluate.mockResolvedValue(true);
      let resolveCalls = 0;
      const page = singleFramePage(() => {
        resolveCalls++;
        return Promise.resolve(resolveCalls === 1 ? hungHandle : normalHandle);
      });
      const client = mockCdpClient();
      const browserMock = {
        wsEndpoint: vi.fn().mockReturnValue(uniqueWs('e13')),
        target: vi.fn().mockReturnValue({ createCDPSession: vi.fn().mockResolvedValue(client) }),
      };
      (page as any).browser = vi.fn().mockReturnValue(browserMock);

      const engine = new BrowserActionEngine(undefined, undefined, undefined, [dir]);
      const tab1 = mockTab(page);
      const result = await engine.executeAction(tab1, {
        actionType: 'download_file',
        selector: '#download-link',
        downloadDir: dir,
        maxRetries: 0,
        timeoutMs: 100,
      });
      expect(result.success).toBe(false);

      // The FIRST dispatch's real in-flight work can NEVER settle on its own (its evaluate()
      // hangs forever, unconditionally) — so if the lock were only released when that work
      // naturally finishes, it would never be released at all. Wait past the outer engine's own
      // abandonment grace period (TIMEOUT_SETTLEMENT_GRACE_MS = 2000ms, from when the 100ms
      // outer timeout fired) before trying the second call — proving the lock was released by
      // the ABORT path, not by the abandoned work completing.
      await new Promise((r) => setTimeout(r, 2300));

      // A different tab (same browser) so the unrelated per-tab duplicate-action guard can't
      // mask this.
      const tab2 = mockTab(page);
      (tab2 as any).id = createTabId('tab_2_e13');
      const second = engine.executeAction(tab2, {
        actionType: 'download_file',
        selector: '#download-link',
        downloadDir: dir,
        maxRetries: 0,
        timeoutMs: 2000,
      });
      // FR2-05 fix-2 (GAP-300): resolveDownloadDir now does REAL on-disk case-sensitivity
      // detection (a real `fsutil` subprocess spawn, or a filesystem probe as fallback) before
      // the lock is even acquired. That's cached per-directory (see
      // `_clearCaseSensitivityCacheForTests`) so the second call on the SAME directory is fast,
      // but give the first real detection call (paid once by the FIRST download_file above) a
      // realistic amount of headroom rather than racing it.
      await client.whenListening('Browser.downloadProgress');
      client.emit('Browser.downloadWillBegin', { guid: 'g-e13-2', suggestedFilename: 'b.pdf' });
      client.emit('Browser.downloadProgress', { guid: 'g-e13-2', state: 'completed' });
      const secondResult = await second;
      expect(secondResult.success).toBe(true);
    }, 10000);
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

describe('@sutradhar/browser BrowserActionEngine wait_for_selector states (FR2-01, fix-1)', () => {
  // NOTE on this whole block (fix-1 for GAP-008/009/011/013/015/016): GAP-008 replaced the
  // visible/hidden wait mechanism itself (Puppeteer's own rAF-throttled `waitForSelector({visible
  // /hidden: true})`) with Node-side interval polling built on `frame.$` + `handle.evaluate`
  // (see browser-action-engine.ts `pierceFirstMatch`/`isHandleVisible`). Every test below that
  // exercises the visible or hidden path had its mock shape updated to match — `waitForSelector`
  // mocks became `$`(+`evaluate`) mocks — but each test's INTENT (what real behavior it proves)
  // is unchanged or strengthened, never weakened. `state:'attached'` still goes through
  // `resolveElement`/`frame.waitForSelector` exactly as before, so E9's mock is untouched.

  it('E1: default state is now visible — the intentional 0.5.0 behavior change from the old attached-only default', async () => {
    const handle = mockHandle();
    (handle as any).evaluate = vi.fn().mockResolvedValue(true); // visible: non-empty box, visibility not hidden
    const dollarMock = vi.fn().mockResolvedValue(handle);
    const mainFrame = { isDetached: () => false, $: dollarMock } as unknown as Frame;
    const page = { frames: vi.fn().mockReturnValue([mainFrame]), mainFrame: vi.fn().mockReturnValue(mainFrame) } as unknown as Page;

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'wait_for_selector',
      selector: '#t',
      maxRetries: 0,
    });

    expect(result.success).toBe(true);
    expect(result.outputData?.state).toBe('visible');
    expect(dollarMock).toHaveBeenCalledWith('pierce/#t');
  });

  it('E2: state:"visible" only succeeds once the element is genuinely visible, never on attached-but-hidden', async () => {
    let visibleNow = false;
    const handle = mockHandle();
    (handle as any).evaluate = vi.fn().mockImplementation(() => Promise.resolve(visibleNow));
    const dollarMock = vi.fn().mockResolvedValue(handle);
    const mainFrame = { isDetached: () => false, $: dollarMock } as unknown as Frame;
    const page = { frames: vi.fn().mockReturnValue([mainFrame]), mainFrame: vi.fn().mockReturnValue(mainFrame) } as unknown as Page;

    // Flip visible after the first poll — proves the wait genuinely re-checks rather than
    // trusting attached-but-hidden as a success (the exact bug this item fixes).
    setTimeout(() => {
      visibleNow = true;
    }, 120);

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'wait_for_selector',
      selector: '#t',
      state: 'visible',
      timeoutMs: 2000,
      maxRetries: 0,
    });

    expect(result.success).toBe(true);
    expect((handle as any).evaluate.mock.calls.length).toBeGreaterThan(1);
  });

  it('E3: state:"attached" returns even though the element is hidden — the old default behavior, unchanged', async () => {
    const handle = mockHandle();
    const page = singleFramePage(() => Promise.resolve(handle));

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'wait_for_selector',
      selector: '#t',
      state: 'attached',
      maxRetries: 0,
    });

    expect(result.success).toBe(true);
    expect(result.outputData?.state).toBe('attached');
    const mainFrame = (page.frames() as unknown as Frame[])[0]!;
    const firstCallOptions = (mainFrame.waitForSelector as any).mock.calls[0][1];
    expect(firstCallOptions.visible).not.toBe(true);
  });

  it('E4: state:"hidden" resolves on hide or removal, and reports matchedAtStart', async () => {
    let present = true;
    const handle = mockHandle();
    (handle as any).evaluate = vi.fn().mockResolvedValue(true); // visible while present
    const dollarMock = vi.fn().mockImplementation(() => Promise.resolve(present ? handle : null));
    const mainFrame = { isDetached: () => false, $: dollarMock } as unknown as Frame;
    const page = { frames: vi.fn().mockReturnValue([mainFrame]), mainFrame: vi.fn().mockReturnValue(mainFrame) } as unknown as Page;

    setTimeout(() => {
      present = false; // "hide or removal" — from the hidden wait's perspective these look the same
    }, 120);

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'wait_for_selector',
      selector: '#toast',
      state: 'hidden',
      timeoutMs: 2000,
      maxRetries: 0,
    });

    expect(result.success).toBe(true);
    expect(result.outputData?.state).toBe('hidden');
    expect(result.outputData?.matchedAtStart).toBe(true);

    present = true; // reset for the second sub-case, a typo'd selector that never matches
    dollarMock.mockResolvedValue(null);
    const result2 = await engine.executeAction(mockTab(page), {
      actionType: 'wait_for_selector',
      selector: '#toast',
      state: 'hidden',
      maxRetries: 0,
    });

    expect(result2.success).toBe(true);
    expect(result2.outputData?.matchedAtStart).toBe(false);
  });

  it('E5: hidden across multiple frames requires EVERY frame to agree, and frame probes within one pass now run in parallel (GAP-059, FR2-01 fix-3)', async () => {
    const order: string[] = [];
    const mainHandle = mockHandle();
    (mainHandle as any).evaluate = vi.fn().mockResolvedValue(false); // main frame: already hidden
    const mainFrame = {
      isDetached: () => false,
      $: vi.fn().mockImplementation(() => {
        order.push('main-probe-start');
        return new Promise((resolve) =>
          setTimeout(() => {
            order.push('main-probe-settled');
            resolve(mainHandle);
          }, 5),
        );
      }),
    } as unknown as Frame;
    const iframeHandle = mockHandle();
    (iframeHandle as any).evaluate = vi.fn().mockResolvedValue(true); // iframe: still visible, forever
    const iframe = {
      isDetached: () => false,
      $: vi.fn().mockImplementation(() => {
        order.push('iframe-probe-start');
        return new Promise((resolve) =>
          setTimeout(() => {
            order.push('iframe-probe-settled');
            resolve(iframeHandle);
          }, 5),
        );
      }),
    } as unknown as Frame;
    const page = {
      frames: vi.fn().mockReturnValue([mainFrame, iframe]),
      mainFrame: vi.fn().mockReturnValue(mainFrame),
    } as unknown as Page;

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'wait_for_selector',
      selector: '#banner',
      state: 'hidden',
      timeoutMs: 300,
      maxRetries: 0,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/waiting for state=hidden/);
    // BEFORE fix-3 (fix-1/fix-2): frames were probed SEQUENTIALLY within a pass, so this
    // asserted "iframe-probe-start" only ever happens after "main-probe-settled" — a losing
    // Promise.any race would have interleaved them the OTHER way, which is what that assertion
    // was actually guarding against (an abandoned, unbounded cross-frame race, the PROB-015
    // shape `resolveElement` avoids). That sequential ordering was also GAP-059's own bug: pass
    // latency scaled linearly with the number of busy frames because each frame's up-to-250ms
    // probe was paid one at a time instead of concurrently.
    // AFTER fix-3: every live frame's probe for a pass is started together via `Promise.all`
    // (see `isHiddenInEveryFrame`), which is safe here for a DIFFERENT reason than a plain
    // Promise.any race would be — each individual probe (`raceFrameProbe`) is still its own
    // fully-self-contained, independently-~250ms-bounded call with its own dispose-on-late-
    // resolve handling, never abandoned to run indefinitely. So the correct invariant to assert
    // now is the opposite of before: both frames' probes START back-to-back in the SAME pass,
    // and at least one frame's probe is still in flight when the other's probe starts — proving
    // genuine concurrency, not a regression back to sequential probing.
    const iframeStartIdx = order.indexOf('iframe-probe-start');
    expect(iframeStartIdx).toBeGreaterThan(0);
    expect(order[iframeStartIdx - 1]).toBe('main-probe-start');
    // The main frame's probe for this SAME pass must not have already settled by the time the
    // iframe's probe for that pass starts — that's exactly the parallel-start guarantee GAP-059
    // relies on. (Both probes share the same 5ms mock delay and are registered in the same
    // microtask, so main's settle event cannot appear before iframe's start event.)
    const mainSettledIdx = order.indexOf('main-probe-settled');
    expect(mainSettledIdx).toBeGreaterThan(iframeStartIdx);
  });

  it('E6: a visible timeout names the state and diagnoses that matches exist but are hidden', async () => {
    const mainFrame = {
      isDetached: () => false,
      $: vi.fn().mockResolvedValue(null),
      $$eval: vi.fn().mockResolvedValue([false]),
    } as unknown as Frame;
    const page = {
      frames: vi.fn().mockReturnValue([mainFrame]),
      mainFrame: vi.fn().mockReturnValue(mainFrame),
    } as unknown as Page;

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'wait_for_selector',
      selector: '#t',
      timeoutMs: 50,
      maxRetries: 0,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/timed out after \d+ms waiting for state=visible/);
    expect(result.error).toContain('attached to the DOM, but none is visible');
  });

  it('E7: first match hidden, a later match visible — diagnosed instead of silently timing out', async () => {
    const mainFrame = {
      isDetached: () => false,
      $: vi.fn().mockResolvedValue(null),
      $$eval: vi.fn().mockResolvedValue([false, true]),
    } as unknown as Frame;
    const page = {
      frames: vi.fn().mockReturnValue([mainFrame]),
      mainFrame: vi.fn().mockReturnValue(mainFrame),
    } as unknown as Page;

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'wait_for_selector',
      selector: '.dup',
      timeoutMs: 50,
      maxRetries: 0,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('later match(es) are');
  });

  it('E8: visible with zero matches keeps the node-id staleness guidance and the "no element found" substring', async () => {
    const mainFrame = {
      isDetached: () => false,
      $: vi.fn().mockResolvedValue(null),
    } as unknown as Frame;
    const plainPage = {
      frames: vi.fn().mockReturnValue([mainFrame]),
      mainFrame: vi.fn().mockReturnValue(mainFrame),
    } as unknown as Page;

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(plainPage), {
      actionType: 'wait_for_selector',
      selector: '#nope',
      timeoutMs: 50,
      maxRetries: 0,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('state=visible');
    expect(result.error).toContain('No element found for selector: #nope');

    const nodeIdPage = {
      frames: vi.fn().mockReturnValue([mainFrame]),
      mainFrame: vi.fn().mockReturnValue(mainFrame),
      evaluate: vi.fn().mockResolvedValue(null),
    } as unknown as Page;

    const nodeIdResult = await engine.executeAction(mockTab(nodeIdPage), {
      actionType: 'wait_for_selector',
      selector: '[data-sd-node-id="99"]',
      timeoutMs: 50,
      maxRetries: 0,
    });

    expect(nodeIdResult.success).toBe(false);
    expect(nodeIdResult.error).toContain('navigated since the last snapshot');
  });

  it('E9: an attached timeout names the state too (attached path unchanged — still frame.waitForSelector, no matches)', async () => {
    const mainFrame = {
      isDetached: () => false,
      waitForSelector: vi.fn().mockRejectedValue(new Error('timeout')),
    } as unknown as Frame;
    const page = {
      frames: vi.fn().mockReturnValue([mainFrame]),
      mainFrame: vi.fn().mockReturnValue(mainFrame),
    } as unknown as Page;

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'wait_for_selector',
      selector: '#t',
      state: 'attached',
      timeoutMs: 50,
      maxRetries: 0,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/waiting for state=attached/);
  });

  it('GAP-009a: an attached timeout with a genuinely EXISTING match says so, never "No element found"', async () => {
    const matchHandle = mockHandle();
    const mainFrame = {
      isDetached: () => false,
      waitForSelector: vi.fn().mockRejectedValue(new Error('timeout')),
      $$eval: vi.fn().mockResolvedValue([true]), // diagnosis: 1 match, visible (visibility irrelevant to 'attached')
    } as unknown as Frame;
    const page = {
      frames: vi.fn().mockReturnValue([mainFrame]),
      mainFrame: vi.fn().mockReturnValue(mainFrame),
    } as unknown as Page;

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'wait_for_selector',
      selector: '#t',
      state: 'attached',
      timeoutMs: 50,
      maxRetries: 0,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/waiting for state=attached/);
    expect(result.error).not.toContain('No element found');
    expect(result.error).toContain('already match');
  });

  it('GAP-009b: a visible timeout where the first match IS visible (a late race) says so, never "No element found"', async () => {
    const mainFrame = {
      isDetached: () => false,
      $: vi.fn().mockResolvedValue(null), // the wait itself never caught it in time
      $$eval: vi.fn().mockResolvedValue([true]), // but by diagnosis time, it's visible
    } as unknown as Frame;
    const page = {
      frames: vi.fn().mockReturnValue([mainFrame]),
      mainFrame: vi.fn().mockReturnValue(mainFrame),
    } as unknown as Page;

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'wait_for_selector',
      selector: '#t',
      timeoutMs: 50,
      maxRetries: 0,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/waiting for state=visible/);
    expect(result.error).not.toContain('No element found');
    expect(result.error).toContain('became visible after the wait gave up');
  });

  it('E10: the state-naming error beats the generic outer-race timeout message (GAP-013: this test genuinely depends on the grace period)', async () => {
    // Each `$` probe takes 60ms and never resolves a handle. With a 100ms `timeoutMs`, the
    // polling loop (check, sleep to the 100ms deadline, check again) settles at ~160ms — AFTER
    // the plain outer-race deadline of 100ms but BEFORE the graced deadline of 100+2000=2100ms.
    const mainFrame = {
      isDetached: () => false,
      $: vi.fn().mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(null), 60))),
    } as unknown as Frame;
    const page = {
      frames: vi.fn().mockReturnValue([mainFrame]),
      mainFrame: vi.fn().mockReturnValue(mainFrame),
    } as unknown as Page;

    const engine = new BrowserActionEngine();
    const params = { actionType: 'wait_for_selector' as const, selector: '#t', timeoutMs: 100, maxRetries: 0 };

    const withGrace = await engine.executeAction(mockTab(page), params);
    expect(withGrace.success).toBe(false);
    expect(withGrace.error).not.toMatch(/^Action wait_for_selector timed out after/);
    expect(withGrace.error).toMatch(/state=visible/);

    // Now prove the test above actually EXERCISES the grace, rather than passing regardless of
    // it: with the grace zeroed out, the outer race (100ms) and the inner state-aware wait
    // (~160ms) go back to racing each other like before FR2-01, and the outer, state-less
    // message wins instead.
    const previous = __TEST_ONLY_setWaitForSelectorOuterGraceMs(0);
    try {
      const withoutGrace = await engine.executeAction(mockTab(page), params);
      expect(withoutGrace.success).toBe(false);
      expect(withoutGrace.error).toMatch(/^Action wait_for_selector timed out after/);
    } finally {
      __TEST_ONLY_setWaitForSelectorOuterGraceMs(previous);
    }
  });

  it('E11: an invalid state bypassing the type system fails clearly instead of being silently coerced', async () => {
    const handle = mockHandle();
    const page = singleFramePage(() => Promise.resolve(handle));

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'wait_for_selector',
      selector: '#t',
      state: 'bogus' as any,
      maxRetries: 0,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid wait_for_selector state "bogus"');
  });

  it('E12: timeoutMs <= 0 means "check once, don\'t wait" (GAP-011 rewrite — the old 1ms-clamp behavior always failed even when already in the requested state)', async () => {
    // Sub-case 1: state visible, already visible → immediate success.
    {
      const handle = mockHandle();
      (handle as any).evaluate = vi.fn().mockResolvedValue(true);
      const mainFrame = { isDetached: () => false, $: vi.fn().mockResolvedValue(handle) } as unknown as Frame;
      const page = { frames: vi.fn().mockReturnValue([mainFrame]), mainFrame: vi.fn().mockReturnValue(mainFrame) } as unknown as Page;
      const result = await new BrowserActionEngine().executeAction(mockTab(page), {
        actionType: 'wait_for_selector',
        selector: '#t',
        timeoutMs: 0,
        maxRetries: 0,
      });
      expect(result.success).toBe(true);
      expect(result.outputData?.state).toBe('visible');
    }

    // Sub-case 2: state visible, attached but hidden, negative timeoutMs → immediate failure,
    // naming the state, not a hang and not the old "clamped to 1ms" Puppeteer race.
    {
      const handle = mockHandle();
      (handle as any).evaluate = vi.fn().mockResolvedValue(false);
      const mainFrame = { isDetached: () => false, $: vi.fn().mockResolvedValue(handle) } as unknown as Frame;
      const page = { frames: vi.fn().mockReturnValue([mainFrame]), mainFrame: vi.fn().mockReturnValue(mainFrame) } as unknown as Page;
      const result = await new BrowserActionEngine().executeAction(mockTab(page), {
        actionType: 'wait_for_selector',
        selector: '#t',
        timeoutMs: -5,
        maxRetries: 0,
      });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/state=visible/);
    }

    // Sub-case 3: state attached, present → immediate success regardless of visibility.
    {
      const handle = mockHandle();
      const mainFrame = { isDetached: () => false, $: vi.fn().mockResolvedValue(handle) } as unknown as Frame;
      const page = { frames: vi.fn().mockReturnValue([mainFrame]), mainFrame: vi.fn().mockReturnValue(mainFrame) } as unknown as Page;
      const result = await new BrowserActionEngine().executeAction(mockTab(page), {
        actionType: 'wait_for_selector',
        selector: '#t',
        state: 'attached',
        timeoutMs: 0,
        maxRetries: 0,
      });
      expect(result.success).toBe(true);
    }

    // Sub-case 4: state attached, nothing matches → immediate failure.
    {
      const mainFrame = { isDetached: () => false, $: vi.fn().mockResolvedValue(null) } as unknown as Frame;
      const page = { frames: vi.fn().mockReturnValue([mainFrame]), mainFrame: vi.fn().mockReturnValue(mainFrame) } as unknown as Page;
      const result = await new BrowserActionEngine().executeAction(mockTab(page), {
        actionType: 'wait_for_selector',
        selector: '#t',
        state: 'attached',
        timeoutMs: 0,
        maxRetries: 0,
      });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/state=attached/);
    }

    // Sub-case 5: state hidden, nothing matches → immediate success (documented semantics).
    {
      const mainFrame = { isDetached: () => false, $: vi.fn().mockResolvedValue(null) } as unknown as Frame;
      const page = { frames: vi.fn().mockReturnValue([mainFrame]), mainFrame: vi.fn().mockReturnValue(mainFrame) } as unknown as Page;
      const result = await new BrowserActionEngine().executeAction(mockTab(page), {
        actionType: 'wait_for_selector',
        selector: '#t',
        state: 'hidden',
        timeoutMs: 0,
        maxRetries: 0,
      });
      expect(result.success).toBe(true);
      expect(result.outputData?.matchedAtStart).toBe(false);
    }

    // Sub-case 6: state hidden, still visible → immediate failure, not a ~6s hang.
    {
      const handle = mockHandle();
      (handle as any).evaluate = vi.fn().mockResolvedValue(true);
      const mainFrame = { isDetached: () => false, $: vi.fn().mockResolvedValue(handle) } as unknown as Frame;
      const page = { frames: vi.fn().mockReturnValue([mainFrame]), mainFrame: vi.fn().mockReturnValue(mainFrame) } as unknown as Page;
      const result = await new BrowserActionEngine().executeAction(mockTab(page), {
        actionType: 'wait_for_selector',
        selector: '#t',
        state: 'hidden',
        timeoutMs: 0,
        maxRetries: 0,
      });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/state=hidden/);
      expect(result.error).toContain('still visible');
    }

    // Sub-case 7 (GAP-058, FR2-01 audit-3/fix-3): every sub-case above passes `maxRetries: 0`
    // explicitly, which means none of them actually exercise the REAL default retry path — and
    // that's exactly how this gap slipped through fix-1/fix-2: the engine's OUTER retry loop
    // still applied its ordinary `maxRetries ?? 2` default for a `timeoutMs <= 0` "check once"
    // call, so a failing check-once wait was silently retried up to 2 more times (confirmed
    // live: retriesUsed:2, ~1.5s total for something documented as instantaneous), even though
    // `checkWaitForSelectorOnce` itself has no concept of retrying. This sub-case omits
    // `maxRetries` entirely — using whatever the engine actually defaults to — so a regression
    // back to "check once" secretly retrying would show up here as `retriesUsed !== 0` and as a
    // materially slower `executionTimeMs`, not just as a passing assertion that only ever
    // exercised the overridden path.
    {
      const mainFrame = { isDetached: () => false, $: vi.fn().mockResolvedValue(null) } as unknown as Frame;
      const page = { frames: vi.fn().mockReturnValue([mainFrame]), mainFrame: vi.fn().mockReturnValue(mainFrame) } as unknown as Page;
      const result = await new BrowserActionEngine().executeAction(mockTab(page), {
        actionType: 'wait_for_selector',
        selector: '#t',
        state: 'attached',
        timeoutMs: 0,
        // No `maxRetries` override — this is the real default path GAP-058 was about.
      });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/state=attached/);
      expect(result.retriesUsed).toBe(0);
      // GAP-058's live repro showed ~1.5s (3 attempts with 500ms/1000ms backoff) for exactly
      // this shape of call before the fix; a real "check once" call should be near-instant.
      expect(result.executionTimeMs).toBeLessThan(500);
    }
  });

  it('E13: the visibility diagnosis is best-effort — a frame with no $$eval support still returns a state-naming error, not a TypeError', async () => {
    const mainFrame = {
      isDetached: () => false,
      $: vi.fn().mockResolvedValue(null),
      // Deliberately no `$$eval` — diagnoseSelectorVisibility must swallow that, not throw.
    } as unknown as Frame;
    const page = {
      frames: vi.fn().mockReturnValue([mainFrame]),
      mainFrame: vi.fn().mockReturnValue(mainFrame),
    } as unknown as Page;

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'wait_for_selector',
      selector: '#t',
      timeoutMs: 50,
      maxRetries: 0,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/waiting for state=visible/);
    expect(result.error).not.toMatch(/TypeError/);
  });

  it('GAP-015: an invalid selector under state hidden fails fast with the real parser error, not "still visible" after the full timeout', async () => {
    const syntaxError = new Error("Failed to execute 'querySelector' on 'Document': '#[[[' is not a valid selector.");
    const mainFrame = {
      isDetached: () => false,
      $: vi.fn().mockRejectedValue(syntaxError),
    } as unknown as Frame;
    const page = {
      frames: vi.fn().mockReturnValue([mainFrame]),
      mainFrame: vi.fn().mockReturnValue(mainFrame),
    } as unknown as Page;

    const engine = new BrowserActionEngine();
    const start = Date.now();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'wait_for_selector',
      selector: '#[[[',
      state: 'hidden',
      timeoutMs: 6000,
      maxRetries: 0,
    });
    const elapsedMs = Date.now() - start;

    expect(result.success).toBe(false);
    expect(result.error).toContain('is not a valid selector');
    expect(result.error).toContain('state=hidden');
    expect(result.error).not.toContain('still visible');
    // Not a ~6s hang — the parser error must surface almost immediately, well under timeoutMs.
    expect(elapsedMs).toBeLessThan(2000);
  });

  it('GAP-016: hidden succeeding on the first match still reports otherVisibleMatches when a LATER match is visible', async () => {
    const firstHandle = mockHandle();
    (firstHandle as any).evaluate = vi.fn().mockResolvedValue(false); // first match: hidden
    const mainFrame = {
      isDetached: () => false,
      $: vi.fn().mockResolvedValue(firstHandle),
      $$eval: vi.fn().mockResolvedValue([false, true]), // full match set: first hidden, second visible
    } as unknown as Frame;
    const page = {
      frames: vi.fn().mockReturnValue([mainFrame]),
      mainFrame: vi.fn().mockReturnValue(mainFrame),
    } as unknown as Page;

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'wait_for_selector',
      selector: '#banner, #stays',
      state: 'hidden',
      maxRetries: 0,
    });

    expect(result.success).toBe(true);
    expect(result.outputData?.otherVisibleMatches).toBe(1);
  });
});

describe('@sutradhar/browser BrowserActionEngine wait_for_selector states (FR2-01, fix-2, audit-2 gaps)', () => {
  it('GAP-030: a busy/unresponsive frame does not stall detecting an element already visible in a healthy frame', async () => {
    const visibleHandle = mockHandle();
    (visibleHandle as any).evaluate = vi.fn().mockResolvedValue(true);
    const healthyFrame = {
      isDetached: () => false,
      $: vi.fn().mockResolvedValue(visibleHandle),
    } as unknown as Frame;
    // Simulates a busy/unresponsive cross-origin (out-of-process) iframe: its `$` call never
    // settles on its own within the test's lifetime, standing in for a CDP round-trip that
    // never comes back because the frame's renderer is blocked.
    const busyFrame = {
      isDetached: () => false,
      $: vi.fn().mockImplementation(() => new Promise(() => {})),
    } as unknown as Frame;
    const page = {
      frames: vi.fn().mockReturnValue([busyFrame, healthyFrame]),
      mainFrame: vi.fn().mockReturnValue(busyFrame),
    } as unknown as Page;

    const engine = new BrowserActionEngine();
    const start = Date.now();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'wait_for_selector',
      selector: '#t',
      state: 'visible',
      timeoutMs: 2000,
      maxRetries: 0,
    });
    const elapsedMs = Date.now() - start;

    expect(result.success).toBe(true);
    // Before GAP-030's fix, `pierceFirstMatch` had no per-frame bound, so a frame whose `$`
    // never resolves would stall the ENTIRE poll pass — including the healthy frame's
    // already-visible element — all the way out to `timeoutMs` (2000ms here). Resolving well
    // under that, on roughly one FRAME_PROBE_TIMEOUT_MS window, proves the busy frame did not
    // block detection in the healthy one.
    expect(elapsedMs).toBeLessThan(1000);
  });

  it('GAP-031: a hidden wait does not falsely report success when the tab/session itself closes mid-wait', async () => {
    const fatalError = new Error(
      'Protocol error (DOM.querySelector): Session closed. Most likely the page has been closed.',
    );
    const mainFrame = {
      isDetached: () => false,
      $: vi.fn().mockRejectedValue(fatalError),
    } as unknown as Frame;
    const page = {
      frames: vi.fn().mockReturnValue([mainFrame]),
      mainFrame: vi.fn().mockReturnValue(mainFrame),
    } as unknown as Page;

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'wait_for_selector',
      selector: '#stays',
      state: 'hidden',
      timeoutMs: 2000,
      maxRetries: 0,
    });

    // Before GAP-031's fix, `pierceFirstMatch` swallowed EVERY non-syntax-error rejection
    // (including this one) into "no match", which made `isHiddenInEveryFrame` conclude every
    // frame was hidden — a FALSE SUCCESS for an element that never actually hid, just because
    // the check itself stopped being able to run (the exact scenario audit-2's
    // `probe-audit2.mjs n4` reproduced live: tab closed mid-wait, false success).
    expect(result.success).toBe(false);
    expect(result.error).toContain('Session closed');
  });

  it('GAP-031: a visible wait also surfaces a fatal check failure instead of a plain timeout', async () => {
    const fatalError = new Error('Protocol error (DOM.querySelector): Target closed.');
    const mainFrame = {
      isDetached: () => false,
      $: vi.fn().mockRejectedValue(fatalError),
    } as unknown as Frame;
    const page = {
      frames: vi.fn().mockReturnValue([mainFrame]),
      mainFrame: vi.fn().mockReturnValue(mainFrame),
    } as unknown as Page;

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'wait_for_selector',
      selector: '#toast',
      state: 'visible',
      timeoutMs: 2000,
      maxRetries: 0,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Target closed');
  });

  it('GAP-032: a NaN timeoutMs (e.g. the CLI parsing "5s") is rejected immediately, not silently reinterpreted', async () => {
    const mainFrame = { isDetached: () => false, $: vi.fn().mockResolvedValue(null) } as unknown as Frame;
    const page = {
      frames: vi.fn().mockReturnValue([mainFrame]),
      mainFrame: vi.fn().mockReturnValue(mainFrame),
    } as unknown as Page;

    const engine = new BrowserActionEngine();
    const start = Date.now();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'wait_for_selector',
      selector: '#t',
      state: 'visible',
      timeoutMs: NaN,
      maxRetries: 0,
    });
    const elapsedMs = Date.now() - start;

    // Before GAP-032's fix, a NaN timeoutMs made `Date.now() + waitMs` itself NaN, so the poll
    // loop's own `remaining <= 0` deadline check was permanently false and `setTimeout(fn,
    // NaN)` fired in ~0ms — a runaway, CPU-bound poll loop with no legitimate end. Rejecting
    // synchronously, before dispatch, means the mocked `$` is never even called.
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid timeoutMs');
    expect(elapsedMs).toBeLessThan(500);
    expect(mainFrame.$).not.toHaveBeenCalled();
  });

  it('GAP-032: an Infinity timeoutMs is rejected the same way as NaN', async () => {
    const mainFrame = { isDetached: () => false, $: vi.fn().mockResolvedValue(null) } as unknown as Frame;
    const page = {
      frames: vi.fn().mockReturnValue([mainFrame]),
      mainFrame: vi.fn().mockReturnValue(mainFrame),
    } as unknown as Page;

    const engine = new BrowserActionEngine();
    const start = Date.now();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'wait_for_selector',
      selector: '#t',
      state: 'hidden',
      timeoutMs: Infinity,
      maxRetries: 0,
    });
    const elapsedMs = Date.now() - start;

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid timeoutMs');
    expect(elapsedMs).toBeLessThan(500);
    expect(mainFrame.$).not.toHaveBeenCalled();
  });

  it('GAP-032: a finite timeoutMs far beyond setTimeout\'s own ceiling is clamped, not rejected, and still resolves normally', async () => {
    const visibleHandle = mockHandle();
    (visibleHandle as any).evaluate = vi.fn().mockResolvedValue(true);
    const mainFrame = {
      isDetached: () => false,
      $: vi.fn().mockResolvedValue(visibleHandle),
    } as unknown as Frame;
    const page = {
      frames: vi.fn().mockReturnValue([mainFrame]),
      mainFrame: vi.fn().mockReturnValue(mainFrame),
    } as unknown as Page;

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'wait_for_selector',
      selector: '#t',
      state: 'visible',
      timeoutMs: 3e9, // well beyond Node's 2**31-1 ms setTimeout ceiling
      maxRetries: 0,
    });

    // A well-formed, merely-oversized request is a normal wait, not an error — the element is
    // already visible, so this must resolve immediately regardless of how the huge timeoutMs
    // got clamped internally.
    expect(result.success).toBe(true);
  });

  it('GAP-033: an invalid selector under state attached fails fast with the real parser error, not the generic "No element found" after the full timeout', async () => {
    const syntaxError = new Error("Failed to execute 'querySelector' on 'Document': '#[[[' is not a valid selector.");
    const mainFrame = {
      isDetached: () => false,
      $: vi.fn().mockRejectedValue(syntaxError),
      waitForSelector: vi.fn().mockRejectedValue(syntaxError),
    } as unknown as Frame;
    const page = {
      frames: vi.fn().mockReturnValue([mainFrame]),
      mainFrame: vi.fn().mockReturnValue(mainFrame),
    } as unknown as Page;

    const engine = new BrowserActionEngine();
    const start = Date.now();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'wait_for_selector',
      selector: '#[[[',
      state: 'attached',
      timeoutMs: 5000,
      maxRetries: 0,
    });
    const elapsedMs = Date.now() - start;

    // Before GAP-033's fix, `state:'attached'` went straight to `resolveElement`, whose blanket
    // `.catch(() => null)` swallowed this exact syntax error into "no match" and kept
    // re-probing for the FULL timeout before giving up with the generic "No element found"
    // message — GAP-015's fast-fail fix never covered this path.
    expect(result.success).toBe(false);
    expect(result.error).toContain('is not a valid selector');
    expect(result.error).not.toContain('No element found');
    expect(elapsedMs).toBeLessThan(2000);
  });

  it('GAP-033: a genuinely missing element under state attached still times out normally (pre-check does not false-positive)', async () => {
    const mainFrame = {
      isDetached: () => false,
      $: vi.fn().mockResolvedValue(null),
      waitForSelector: vi.fn().mockRejectedValue(new Error('timeout')),
    } as unknown as Frame;
    const page = {
      frames: vi.fn().mockReturnValue([mainFrame]),
      mainFrame: vi.fn().mockReturnValue(mainFrame),
    } as unknown as Page;

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'wait_for_selector',
      selector: '#nope',
      state: 'attached',
      timeoutMs: 50,
      maxRetries: 0,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/waiting for state=attached/);
  });
});

describe('@sutradhar/browser BrowserActionEngine wait_for_selector states (FR2-01, fix-3, audit-3 gaps)', () => {
  it('GAP-057: a hidden wait must NOT report success while a busy frame\'s element is genuinely, persistently still visible (repro of audit-3 probe-a3.mjs h1/h2 pattern)', async () => {
    // Main frame: no match at all (genuinely absent there). Iframe: a real, visible element,
    // but `frame.$` never answers within FRAME_PROBE_TIMEOUT_MS (250ms) on ANY call — modeling
    // a persistently busy/slow renderer, not a one-off hiccup. Before the fix, EVERY probe of
    // this frame timing out got read as "no match in this frame", which for `hidden` (every
    // frame must agree) meant the whole wait "agreed" — a false SUCCESS while the element was
    // still genuinely visible. After the fix, a timed-out probe is 'unknown', which can never
    // satisfy `hidden` on its own — the wait must keep polling and eventually fail.
    const visibleHandle = mockHandle();
    (visibleHandle as any).evaluate = vi.fn().mockResolvedValue(true);
    const mainFrame = { isDetached: () => false, $: vi.fn().mockResolvedValue(null) } as unknown as Frame;
    const busyIframe = {
      isDetached: () => false,
      $: vi.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(visibleHandle), 2000)),
      ),
    } as unknown as Frame;
    const page = {
      frames: vi.fn().mockReturnValue([mainFrame, busyIframe]),
      mainFrame: vi.fn().mockReturnValue(mainFrame),
    } as unknown as Page;

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'wait_for_selector',
      selector: '#spinner',
      state: 'hidden',
      timeoutMs: 400,
      maxRetries: 0,
    });

    // The one non-negotiable assertion: this must never be `true`. Before the GAP-057 fix, it
    // was — reliably, on every run, because the busy iframe's probe timeout was read as "hidden
    // in this frame" on the very first pass.
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/waiting for state=hidden/);
  });

  it('GAP-057 regression guard: a hidden wait still succeeds once every frame genuinely agrees, even after an earlier pass saw one frame time out (recovering busy frame, not a permanent one)', async () => {
    // Iframe: its FIRST `$` call is slow enough to time out the 250ms probe bound (so pass 1
    // sees 'unknown' for this frame), but it genuinely has no match at all, and every
    // SUBSEQUENT call resolves quickly with `null` — a busy-then-recovers frame, not a busy-
    // forever one. This proves the fix doesn't overcorrect into never succeeding: 'unknown'
    // must fall through to "keep polling", and a later pass that gets a real, fully-agreed
    // answer from every frame must still succeed.
    const mainFrame = { isDetached: () => false, $: vi.fn().mockResolvedValue(null) } as unknown as Frame;
    const recoveringIframe = {
      isDetached: () => false,
      $: vi
        .fn()
        .mockImplementationOnce(() => new Promise((resolve) => setTimeout(() => resolve(null), 400)))
        .mockResolvedValue(null),
    } as unknown as Frame;
    const page = {
      frames: vi.fn().mockReturnValue([mainFrame, recoveringIframe]),
      mainFrame: vi.fn().mockReturnValue(mainFrame),
    } as unknown as Page;

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'wait_for_selector',
      selector: '#banner',
      state: 'hidden',
      timeoutMs: 2000,
      maxRetries: 0,
    });

    expect(result.success).toBe(true);
    expect(result.outputData?.state).toBe('hidden');
  });

  it('GAP-059: probing multiple busy frames within one hidden-wait pass runs in parallel, not sequentially (latency does not scale with frame count)', async () => {
    // 4 frames that are ALL persistently busy (never answer within the 250ms probe bound). If
    // probing were still sequential, paying that ~250ms bound once per frame per pass would
    // cost at least 4 * 250ms = 1000ms for the FIRST pass alone. Probed in parallel, one pass
    // costs ~250ms total regardless of frame count.
    const visibleHandle = mockHandle();
    (visibleHandle as any).evaluate = vi.fn().mockResolvedValue(true);
    const makeBusyFrame = () =>
      ({
        isDetached: () => false,
        $: vi.fn().mockImplementation(
          () => new Promise((resolve) => setTimeout(() => resolve(visibleHandle), 5000)),
        ),
      }) as unknown as Frame;
    const mainFrame = { isDetached: () => false, $: vi.fn().mockResolvedValue(null) } as unknown as Frame;
    const busyFrames = [makeBusyFrame(), makeBusyFrame(), makeBusyFrame(), makeBusyFrame()];
    const page = {
      frames: vi.fn().mockReturnValue([mainFrame, ...busyFrames]),
      mainFrame: vi.fn().mockReturnValue(mainFrame),
    } as unknown as Page;

    const engine = new BrowserActionEngine();
    const t0 = Date.now();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'wait_for_selector',
      selector: '#spinner',
      state: 'hidden',
      timeoutMs: 260,
      maxRetries: 0,
    });
    const elapsedMs = Date.now() - t0;

    expect(result.success).toBe(false);
    // Sequential probing of 4 busy frames would need >= 1000ms just for the first pass, before
    // the 260ms deadline is even checked. Parallel probing keeps the whole call well under
    // that — generous margin kept here to avoid CI timing flakiness while still being tight
    // enough to fail against a sequential regression.
    expect(elapsedMs).toBeLessThan(900);
  });

  it('GAP-059: an abandoned per-frame probe that resolves a real handle AFTER its 250ms bound is disposed, not leaked', async () => {
    const lateHandle = mockHandle();
    const disposeSpy = vi.fn().mockResolvedValue(undefined);
    (lateHandle as any).dispose = disposeSpy;
    const mainFrame = { isDetached: () => false, $: vi.fn().mockResolvedValue(null) } as unknown as Frame;
    const lateFrame = {
      isDetached: () => false,
      // Resolves a REAL handle, but only after the 250ms probe bound has already elapsed —
      // exactly the "abandoned probe settles late" case GAP-059 flagged as a resource leak. Only
      // called ONCE for this test's whole call: `state:'attached'`'s check-once path
      // (`firstAnyHandleAnyFrame`) probes frames sequentially and there's only one other frame
      // besides the (immediately-answering) main frame — an easy assertion that dispose fires
      // exactly once, not a "did it fire at least once" one.
      $: vi.fn().mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(lateHandle), 400))),
    } as unknown as Frame;
    const page = {
      frames: vi.fn().mockReturnValue([mainFrame, lateFrame]),
      mainFrame: vi.fn().mockReturnValue(mainFrame),
    } as unknown as Page;

    const engine = new BrowserActionEngine();
    // `timeoutMs <= 0` drives the single-pass `checkWaitForSelectorOnce` path directly.
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'wait_for_selector',
      selector: '#t',
      state: 'attached',
      timeoutMs: 0,
      maxRetries: 0,
    });
    expect(result.success).toBe(false); // the probe timed out -> 'unknown' -> not confirmed attached
    expect(disposeSpy).not.toHaveBeenCalled(); // not yet — the probe is still abandoned/in flight

    // Give the abandoned real probe time to settle in the background (it resolves at ~400ms).
    await new Promise((r) => setTimeout(r, 500));
    expect(disposeSpy).toHaveBeenCalledTimes(1);
  });

  it('GAP-057 (matchedAtStart): probeSelectorMatchExists reports `undefined` (unknown), never `false`, when a frame times out and no OTHER frame confirms a match', async () => {
    // Main frame answers quickly with no match, in every call. The other frame's FIRST `$` call
    // (the one `probeSelectorMatchExists` makes) never answers within its 250ms probe bound —
    // before the fix, this collapsed straight into `false`, reporting "the selector never
    // matched anything" (a misleading typo diagnosis) instead of "we genuinely don't know".
    // That frame's SECOND `$` call (made moments later by the actual hidden-check,
    // `isHiddenInEveryFrame`) resolves quickly with no match, so the overall wait still succeeds
    // — isolating the assertion to `matchedAtStart` specifically, rather than conflating it with
    // whether the wait itself succeeds.
    const mainFrame = { isDetached: () => false, $: vi.fn().mockResolvedValue(null) } as unknown as Frame;
    const partiallyBusyIframe = {
      isDetached: () => false,
      $: vi
        .fn()
        .mockImplementationOnce(() => new Promise((resolve) => setTimeout(() => resolve(null), 2000)))
        .mockResolvedValue(null),
    } as unknown as Frame;
    const page = {
      frames: vi.fn().mockReturnValue([mainFrame, partiallyBusyIframe]),
      mainFrame: vi.fn().mockReturnValue(mainFrame),
    } as unknown as Page;

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'wait_for_selector',
      selector: '#t',
      state: 'hidden',
      timeoutMs: 0,
      maxRetries: 0,
    });

    expect(result.success).toBe(true);
    expect(result.outputData?.matchedAtStart).toBeUndefined();
    expect('matchedAtStart' in (result.outputData as object)).toBe(true);
  });
});

describe('@sutradhar/browser BrowserActionEngine wait_for_selector states (FR2-01, fix-4, audit-4 escalation gaps)', () => {
  it('GAP-081a (isHandleVisible): a fatal session-closed error while checking visibility must report "unknown", never a silently-confirmed "not visible" (which previously let a hidden wait falsely succeed)', async () => {
    // A real handle IS found (frame.$ resolves quickly), but checking ITS visibility fails with
    // a fatal, tab/session-closed-style error. Before the fix, `isHandleVisible`'s
    // `.catch(() => false)` read this identically to a genuine "not visible" computed-style
    // result — for `hidden` (every frame must agree), that meant the whole pass "agreed" on the
    // very first check, a false SUCCESS while visibility was never actually confirmed either way.
    const staleHandle = mockHandle();
    (staleHandle as any).evaluate = vi
      .fn()
      .mockRejectedValue(new Error('Protocol error (Runtime.callFunctionOn): Session closed. Most likely the page has been closed.'));
    const mainFrame = { isDetached: () => false, $: vi.fn().mockResolvedValue(staleHandle) } as unknown as Frame;
    const page = {
      frames: vi.fn().mockReturnValue([mainFrame]),
      mainFrame: vi.fn().mockReturnValue(mainFrame),
    } as unknown as Page;

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'wait_for_selector',
      selector: '#spinner',
      state: 'hidden',
      timeoutMs: 150,
      maxRetries: 0,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('could not verify: one or more frames were unresponsive');
  });

  it('GAP-081b (pierceFirstMatch): an error this code does not otherwise recognize defaults to "unknown", never "no-match" — a probe error is not evidence of absence', async () => {
    // `frame.$` rejects with a genuinely unclassified error on every call (not a selector syntax
    // error, not a fatal session/target-closed error, not an ordinary context-destroyed
    // navigation hiccup). Before the fix, pierceFirstMatch's catch-all mapped this straight to
    // 'no-match' — for `hidden`, indistinguishable from a real confirmed absence, so the wait
    // would falsely "succeed" on the very first pass even though the probe never actually
    // answered either way.
    const mainFrame = {
      isDetached: () => false,
      $: vi.fn().mockRejectedValue(new Error('some genuinely unclassified CDP hiccup')),
    } as unknown as Frame;
    const page = {
      frames: vi.fn().mockReturnValue([mainFrame]),
      mainFrame: vi.fn().mockReturnValue(mainFrame),
    } as unknown as Page;

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'wait_for_selector',
      selector: '#spinner',
      state: 'hidden',
      timeoutMs: 150,
      maxRetries: 0,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('could not verify: one or more frames were unresponsive');
  });

  it('GAP-082: a hidden timeout CONFIRMED visible by a healthy frame still says "is still visible", distinct from the "could not verify" unresponsive-frame message', async () => {
    const visibleHandle = mockHandle();
    (visibleHandle as any).evaluate = vi.fn().mockResolvedValue(true);
    const mainFrame = { isDetached: () => false, $: vi.fn().mockResolvedValue(visibleHandle) } as unknown as Frame;
    const page = {
      frames: vi.fn().mockReturnValue([mainFrame]),
      mainFrame: vi.fn().mockReturnValue(mainFrame),
    } as unknown as Page;

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'wait_for_selector',
      selector: '#banner',
      state: 'hidden',
      timeoutMs: 150,
      maxRetries: 0,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('is still visible');
    expect(result.error).not.toContain('could not verify');
  });

  it('GAP-082 (9th site — checkWaitForSelectorOnce): the timeoutMs<=0 hidden check-once path also distinguishes "could not verify" (unresponsive frame) from "is still visible" (confirmed)', async () => {
    // Sub-case 1: the only frame never answers within its probe bound at all -> 'unknown'.
    {
      const neverAnswers = { isDetached: () => false, $: vi.fn().mockImplementation(() => new Promise(() => {})) } as unknown as Frame;
      const page = {
        frames: vi.fn().mockReturnValue([neverAnswers]),
        mainFrame: vi.fn().mockReturnValue(neverAnswers),
      } as unknown as Page;
      const result = await new BrowserActionEngine().executeAction(mockTab(page), {
        actionType: 'wait_for_selector',
        selector: '#banner',
        state: 'hidden',
        timeoutMs: 0,
        maxRetries: 0,
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('could not verify: one or more frames were unresponsive');
    }

    // Sub-case 2: the frame answers immediately and confirms the element is genuinely visible.
    {
      const visibleHandle = mockHandle();
      (visibleHandle as any).evaluate = vi.fn().mockResolvedValue(true);
      const mainFrame = { isDetached: () => false, $: vi.fn().mockResolvedValue(visibleHandle) } as unknown as Frame;
      const page = {
        frames: vi.fn().mockReturnValue([mainFrame]),
        mainFrame: vi.fn().mockReturnValue(mainFrame),
      } as unknown as Page;
      const result = await new BrowserActionEngine().executeAction(mockTab(page), {
        actionType: 'wait_for_selector',
        selector: '#banner',
        state: 'hidden',
        timeoutMs: 0,
        maxRetries: 0,
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('is still visible');
      expect(result.error).not.toContain('could not verify');
    }
  });

  it('GAP-083: a state=visible timeout where the diagnostic itself times out on every frame says "could not be determined", never the confirmed-negative "No element found"', async () => {
    const mainFrame = {
      isDetached: () => false,
      $: vi.fn().mockResolvedValue(null), // the wait itself never caught a match in time
      $$eval: vi.fn().mockImplementation(() => new Promise(() => {})), // the diagnosis never answers either
    } as unknown as Frame;
    const page = {
      frames: vi.fn().mockReturnValue([mainFrame]),
      mainFrame: vi.fn().mockReturnValue(mainFrame),
    } as unknown as Page;

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'wait_for_selector',
      selector: '#t',
      timeoutMs: 50,
      maxRetries: 0,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/state=visible/);
    expect(result.error).not.toContain('No element found');
    expect(result.error).toMatch(/visibility could not be determined for 1 of 1 frame/);
  });

  it('GAP-084/GAP-087: probing multiple busy frames within a single VISIBLE-state pass now runs in parallel too — mirrors GAP-059\'s hidden-path fix, which this exact scenario (state:visible) previously did NOT get', async () => {
    // Identical shape to the existing GAP-059 hidden-state test, but for `state:'visible'`.
    // Before this fix, `firstVisibleHandleAnyFrame` probed frames SEQUENTIALLY — reintroducing
    // the GAP-059 latency-scales-with-busy-frame-count symptom for the more common visible-state
    // path, which the GAP-059 fix never actually reached.
    const makeBusyFrame = () =>
      ({
        isDetached: () => false,
        $: vi.fn().mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(null), 5000))),
      }) as unknown as Frame;
    const mainFrame = { isDetached: () => false, $: vi.fn().mockResolvedValue(null) } as unknown as Frame;
    const busyFrames = [makeBusyFrame(), makeBusyFrame(), makeBusyFrame(), makeBusyFrame()];
    const page = {
      frames: vi.fn().mockReturnValue([mainFrame, ...busyFrames]),
      mainFrame: vi.fn().mockReturnValue(mainFrame),
    } as unknown as Page;

    const engine = new BrowserActionEngine();
    const t0 = Date.now();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'wait_for_selector',
      selector: '#spinner',
      state: 'visible',
      timeoutMs: 260,
      maxRetries: 0,
    });
    const elapsedMs = Date.now() - t0;

    expect(result.success).toBe(false);
    // Sequential probing of 4 busy frames would need >= 1000ms for the first pass alone.
    // Parallel probing keeps the whole call well under that. This is the exact assertion shape
    // GAP-087 flagged E5 as failing to provide for the visible-state path — a mutation that
    // reintroduces sequential probing here fails this specific test (verified by mutation, see
    // fix-4's live report).
    expect(elapsedMs).toBeLessThan(900);
  });

  it('GAP-085: the otherVisibleMatches diagnostic reports its own uncertainty instead of a silently-wrong confirmed zero when its per-frame check times out', async () => {
    const mainFrame = {
      isDetached: () => false,
      $: vi.fn().mockResolvedValue(null), // already hidden -> the wait itself succeeds immediately
      $$eval: vi.fn().mockImplementation(() => new Promise(() => {})), // the otherVisibleMatches check never answers
    } as unknown as Frame;
    const page = {
      frames: vi.fn().mockReturnValue([mainFrame]),
      mainFrame: vi.fn().mockReturnValue(mainFrame),
    } as unknown as Page;

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'wait_for_selector',
      selector: '#banner',
      state: 'hidden',
      timeoutMs: 150,
      maxRetries: 0,
    });

    expect(result.success).toBe(true);
    expect(result.outputData?.otherVisibleMatches).toBeUndefined();
    expect(result.outputData?.otherVisibleMatchesUnknown).toBe(true);
  });

  it('GAP-086: isHandleVisible is bounded on its own — a handle whose evaluate() never resolves cannot stall a pass past FRAME_PROBE_TIMEOUT_MS', async () => {
    const stuckHandle = mockHandle();
    (stuckHandle as any).evaluate = vi.fn().mockImplementation(() => new Promise(() => {})); // never resolves
    const mainFrame = { isDetached: () => false, $: vi.fn().mockResolvedValue(stuckHandle) } as unknown as Frame;
    const page = {
      frames: vi.fn().mockReturnValue([mainFrame]),
      mainFrame: vi.fn().mockReturnValue(mainFrame),
    } as unknown as Page;

    const engine = new BrowserActionEngine();
    const t0 = Date.now();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'wait_for_selector',
      selector: '#spinner',
      state: 'hidden',
      timeoutMs: 150,
      maxRetries: 0,
    });
    const elapsedMs = Date.now() - t0;

    expect(result.success).toBe(false);
    // Bounded by FRAME_PROBE_TIMEOUT_MS (250ms) per pass, not stalled indefinitely — generous
    // margin kept to avoid CI timing flakiness while still failing against an unbounded regression.
    expect(elapsedMs).toBeLessThan(900);
  });

  it('GAP-112 (FR2-01 audit-5/fix-5): a genuine per-frame THROWN error in the visibility diagnosis must say "could not be determined", never the confirmed-negative "No element found" (element genuinely present)', async () => {
    // Unlike GAP-083's test (the diagnosis HANGS on every frame), this is the sibling shape
    // audit-5 found: the diagnosis's $$eval genuinely THROWS (e.g. getComputedStyle itself
    // erroring) rather than timing out. Before this fix, a thrown error fell through a
    // `.catch(() => null)` inside diagnoseSelectorVisibility and was treated as "nothing to
    // report", contributing to neither `flags` nor `unconfirmedFrames` — so a diagnosis on a
    // single frame that only ever errors returned `null` overall, and the caller fell through
    // to the false "No element found for selector" for an element that IS attached (confirmed
    // by `$` resolving a real handle below; live-reproduced by audit-5 as probe A2).
    const presentHandle = mockHandle();
    (presentHandle as any).evaluate = vi.fn().mockResolvedValue(false); // never confirms visible
    const mainFrame = {
      isDetached: () => false,
      $: vi.fn().mockResolvedValue(presentHandle), // the element IS attached/present
      $$eval: vi.fn().mockRejectedValue(new Error('getComputedStyle threw for this element')),
    } as unknown as Frame;
    const page = {
      frames: vi.fn().mockReturnValue([mainFrame]),
      mainFrame: vi.fn().mockReturnValue(mainFrame),
    } as unknown as Page;

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'wait_for_selector',
      selector: '#present',
      state: 'visible',
      timeoutMs: 150,
      maxRetries: 0,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/state=visible/);
    expect(result.error).not.toContain('No element found');
    expect(result.error).toMatch(/visibility could not be determined for 1 of 1 frame/);
  });

  it('GAP-113 (FR2-01 audit-5/fix-5): the otherVisibleMatches diagnostic reports its own uncertainty, not a silently-wrong confirmed zero, when its per-frame check THROWS (not just times out)', async () => {
    // Sibling of the existing GAP-085 test (which uses a HANGING $$eval). fix-4 only handled
    // the timeout case for countOtherVisibleMatches; a genuine thrown error still fell through
    // a `.catch(() => null)` and silently read as a confirmed zero (live-reproduced by audit-5
    // as probe A3 — a second, genuinely visible match existed but the advisory vanished with
    // no trace it was ever computed).
    const mainFrame = {
      isDetached: () => false,
      $: vi.fn().mockResolvedValue(null), // already hidden -> the wait itself succeeds immediately
      $$eval: vi.fn().mockRejectedValue(new Error('getComputedStyle threw for this element')),
    } as unknown as Frame;
    const page = {
      frames: vi.fn().mockReturnValue([mainFrame]),
      mainFrame: vi.fn().mockReturnValue(mainFrame),
    } as unknown as Page;

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'wait_for_selector',
      selector: '#banner',
      state: 'hidden',
      timeoutMs: 150,
      maxRetries: 0,
    });

    expect(result.success).toBe(true);
    expect(result.outputData?.otherVisibleMatches).toBeUndefined();
    expect(result.outputData?.otherVisibleMatchesUnknown).toBe(true);
  });

  it("GAP-115 (FR2-01 audit-5/fix-5): the ATTACHED-state check-once path (timeoutMs<=0) probes multiple busy frames in PARALLEL — firstAnyHandleAnyFrame's own parallelization, previously unguarded by any test (audit-5's mutation X1, reverting it to sequential probing, passed all 141 existing tests)", async () => {
    // firstAnyHandleAnyFrame is reached ONLY via the timeoutMs<=0 check-once 'attached' path
    // (checkWaitForSelectorOnce) — the timed 'attached' wait uses resolveElement instead. Each
    // frame's own probe (pierceFirstMatch -> raceFrameProbe) is independently bounded to
    // FRAME_PROBE_TIMEOUT_MS (250ms) regardless of how long the mock's own promise takes to
    // settle, so sequential vs. parallel is what the total elapsed time distinguishes here.
    const makeBusyFrame = () =>
      ({
        isDetached: () => false,
        $: vi.fn().mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(null), 5000))),
      }) as unknown as Frame;
    const mainFrame = { isDetached: () => false, $: vi.fn().mockResolvedValue(null) } as unknown as Frame;
    const busyFrames = [makeBusyFrame(), makeBusyFrame(), makeBusyFrame(), makeBusyFrame()];
    const page = {
      frames: vi.fn().mockReturnValue([mainFrame, ...busyFrames]),
      mainFrame: vi.fn().mockReturnValue(mainFrame),
    } as unknown as Page;

    const engine = new BrowserActionEngine();
    const t0 = Date.now();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'wait_for_selector',
      selector: '#thing',
      state: 'attached',
      timeoutMs: 0,
      maxRetries: 0,
    });
    const elapsedMs = Date.now() - t0;

    expect(result.success).toBe(false);
    // Sequential probing of 4 busy frames (each bounded to ~250ms) would need >= 1000ms.
    // Parallel probing keeps the whole call well under that.
    expect(elapsedMs).toBeLessThan(900);
  });
});

describe('@sutradhar/browser BrowserActionEngine wait_for_selector states (FR2-01 GAP-132-fix, audit-6 gaps)', () => {
  it('GAP-132 (pierceFirstMatch, critical): a hidden wait must FAIL, never falsely SUCCEED, when the tab closes mid-probe — even though the underlying error text ("Execution context was destroyed") is IDENTICAL to the text an ordinary in-page navigation also produces', async () => {
    // Live-reproduced (audit-6 probe-a6.mjs/diag-tabclose.mjs): 1/30 then 3/60 trials via MCP,
    // 1/80 via the engine directly. Before this fix, `pierceFirstMatch` classified this error
    // by TEXT ALONE as a recoverable per-frame hiccup ('no-match'), which every live frame
    // "agreeing" on reported a false SUCCESS for a `hidden` wait whose element was still
    // genuinely visible right up to the close. The fix checks `frame.page().isClosed()`
    // synchronously, at the moment of the catch, instead of inferring tab-closure from text.
    let closed = false;
    const page: any = { isClosed: () => closed };
    const mainFrame: any = {
      isDetached: () => false,
      page: () => page,
      $: vi.fn().mockImplementation(() => {
        // The tab closes WHILE this exact probe is in flight — the same race audit-6 caught.
        closed = true;
        return Promise.reject(new Error('Execution context was destroyed, most likely because of a navigation.'));
      }),
    };
    page.frames = vi.fn().mockReturnValue([mainFrame]);
    page.mainFrame = vi.fn().mockReturnValue(mainFrame);

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page as Page), {
      actionType: 'wait_for_selector',
      selector: '#stay',
      state: 'hidden',
      timeoutMs: 150,
      maxRetries: 0,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Tab was closed while wait_for_selector was checking its state.');
  });

  it('GAP-132 (isHandleVisible, critical): a hidden wait must FAIL, never falsely succeed, when the tab closes while checking a MATCHED handle\'s own visibility', async () => {
    // Same underlying ambiguity one level down: `handle.evaluate()` throws the identical
    // "Execution context was destroyed" text whether the handle's frame merely navigated or the
    // whole tab closed out from under it. `isHandleVisible` must check `handle.frame.page()
    // .isClosed()`, the same synchronous signal `pierceFirstMatch` now uses.
    let closed = false;
    const page: any = { isClosed: () => closed };
    const frame: any = { isDetached: () => false, page: () => page };
    const handle = mockHandle() as any;
    handle.frame = frame;
    handle.evaluate = vi.fn().mockImplementation(() => {
      closed = true;
      return Promise.reject(new Error('Execution context was destroyed, most likely because of a navigation.'));
    });
    frame.$ = vi.fn().mockResolvedValue(handle);
    page.frames = vi.fn().mockReturnValue([frame]);
    page.mainFrame = vi.fn().mockReturnValue(frame);

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page as Page), {
      actionType: 'wait_for_selector',
      selector: '#stay',
      state: 'hidden',
      timeoutMs: 150,
      maxRetries: 0,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Tab was closed while wait_for_selector was checking its state.');
  });

  it('GAP-132 regression guard: an ordinary in-page navigation (context destroyed, but the TAB itself is NOT closed) must remain the pre-existing recoverable per-frame hiccup, not a new false failure', async () => {
    // The fix must not overcorrect: `page.isClosed()` returning false throughout means this is
    // the ordinary "a single frame's own context was destroyed by an in-page navigation" case
    // (e.g. an iframe destroying/recreating itself mid-wait, like TinyMCE) that fix-3 already
    // established must classify as 'no-match' this pass, not a failure. With no other frame ever
    // confirming a match, that's a genuine, correct 'hidden' success — not a regression.
    const page: any = { isClosed: () => false };
    const mainFrame: any = {
      isDetached: () => false,
      page: () => page,
      $: vi.fn().mockRejectedValue(new Error('Execution context was destroyed, most likely because of a navigation.')),
    };
    page.frames = vi.fn().mockReturnValue([mainFrame]);
    page.mainFrame = vi.fn().mockReturnValue(mainFrame);

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page as Page), {
      actionType: 'wait_for_selector',
      selector: '#stay',
      state: 'hidden',
      timeoutMs: 150,
      maxRetries: 0,
    });

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('GAP-133 (FR2-01 audit-6, major): a visible-wait timeout must not claim "none is visible" when one frame confirms a match but ANOTHER frame never answered the diagnosis', async () => {
    // fix-4's GAP-083 guard only covered the ALL-frames-unanswered case (total === 0). audit-6
    // found the partial case — some frames answer, one doesn't — was never tested: live-verified
    // 2/2 on a busy iframe and 2/2 on a busy main frame, each with a genuinely VISIBLE match
    // sitting in the frame that never got to answer.
    const frameA: any = {
      isDetached: () => false,
      $: vi.fn().mockResolvedValue(null),
      $$eval: vi.fn().mockResolvedValue([false]),
    };
    const frameB: any = {
      isDetached: () => false,
      $: vi.fn().mockResolvedValue(null),
      $$eval: vi.fn().mockImplementation(() => new Promise(() => {})), // never answers
    };
    const page: any = {
      frames: vi.fn().mockReturnValue([frameA, frameB]),
      mainFrame: vi.fn().mockReturnValue(frameA),
    };

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page as Page), {
      actionType: 'wait_for_selector',
      selector: '#x',
      state: 'visible',
      timeoutMs: 150,
      maxRetries: 0,
    });

    expect(result.success).toBe(false);
    expect(result.error).not.toContain('but none is');
    expect(result.error).toMatch(/could not be fully determined/);
    expect(result.error).toMatch(/1 of 2 frame/);
  });

  it('GAP-218: with a frame unanswered, the timeout message must not claim "the first match is not visible" from the answered frames alone', async () => {
    // The answered frame's first match is hidden and its second is visible, but another frame
    // never answered, so the answered frame's "first match" need not be the first in document order.
    const frameA: any = {
      isDetached: () => false,
      $: vi.fn().mockResolvedValue(null),
      $$eval: vi.fn().mockResolvedValue([false, true]),
    };
    const frameB: any = {
      isDetached: () => false,
      $: vi.fn().mockResolvedValue(null),
      $$eval: vi.fn().mockImplementation(() => new Promise(() => {})),
    };
    const page: any = { frames: vi.fn().mockReturnValue([frameB, frameA]), mainFrame: vi.fn().mockReturnValue(frameB) };

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page as Page), {
      actionType: 'wait_for_selector',
      selector: '#x',
      state: 'visible',
      timeoutMs: 150,
      maxRetries: 0,
    });

    expect(result.success).toBe(false);
    expect(result.error).not.toContain('the first match is not visible');
    expect(result.error).toMatch(/could not be fully determined/);
  });

  it('GAP-217: a visible-wait timeout diagnosis must report a closed tab, never "No element found", when the tab closes during diagnosis', async () => {
    let closed = false;
    const page: any = { isClosed: () => closed };
    const frame: any = {
      isDetached: () => false,
      page: () => page,
      $: vi.fn().mockResolvedValue(null),
      $$eval: vi.fn().mockImplementation(() => {
        closed = true;
        return Promise.reject(new Error('Execution context was destroyed, most likely because of a navigation.'));
      }),
    };
    page.frames = vi.fn().mockImplementation(() => (closed ? [] : [frame]));
    page.mainFrame = vi.fn().mockReturnValue(frame);

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page as Page), {
      actionType: 'wait_for_selector',
      selector: '#stay',
      state: 'visible',
      timeoutMs: 150,
      maxRetries: 0,
    });

    expect(result.success).toBe(false);
    expect(result.error).not.toContain('No element found');
    expect(result.error).toContain('Tab was closed while wait_for_selector was checking its state.');
  });

  it('GAP-217: a hidden-wait success must not report a confident zero for otherVisibleMatches when a frame errors because the tab closed', async () => {
    let closed = false;
    const page: any = { isClosed: () => closed };
    const frame: any = {
      isDetached: () => false,
      page: () => page,
      $: vi.fn().mockResolvedValue(null),
      $$eval: vi.fn().mockImplementation(() => {
        closed = true;
        return Promise.reject(new Error('Execution context was destroyed, most likely because of a navigation.'));
      }),
    };
    page.frames = vi.fn().mockReturnValue([frame]);
    page.mainFrame = vi.fn().mockReturnValue(frame);

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page as Page), {
      actionType: 'wait_for_selector',
      selector: '#gone',
      state: 'hidden',
      timeoutMs: 150,
      maxRetries: 0,
    });

    // The hidden verdict is reached before $$eval runs; the tab closes only during the advisory count.
    expect(result.success).toBe(true);
    expect(result.outputData?.otherVisibleMatchesUnknown).toBe(true);
  });

  it('GAP-219: liveFramesOf must throw the tab-closed error, not fall back to the main frame, when the tab is closed and has no live frames', async () => {
    const mainFrame: any = { isDetached: () => true };
    const page: any = {
      isClosed: () => true,
      frames: vi.fn().mockReturnValue([mainFrame]),
      mainFrame: vi.fn().mockReturnValue(mainFrame),
    };
    const engine = new BrowserActionEngine();
    expect(() => (engine as any).liveFramesOf(page)).toThrow('Tab was closed while wait_for_selector was checking its state.');
  });
});

describe('@sutradhar/browser BrowserActionEngine FR2-06 caller-selector syntax probe', () => {
  /** A page whose main frame supports the syntax probe (`evaluate`) in addition to the
   *  ordinary `waitForSelector`-based resolution path every other test in this file uses. */
  function pageWithProbe(opts: {
    evaluateImpl?: (...args: any[]) => any;
    waitForSelectorImpl?: (...args: any[]) => any;
    isDetached?: () => boolean;
  }) {
    const evaluate = vi.fn().mockImplementation(opts.evaluateImpl ?? (() => Promise.resolve(null)));
    const waitForSelector = vi.fn().mockImplementation(
      opts.waitForSelectorImpl ?? (() => Promise.reject(new Error('No element found for selector'))),
    );
    const mainFrame = {
      isDetached: opts.isDetached ?? (() => false),
      evaluate,
      waitForSelector,
    } as unknown as Frame;
    const screenshot = vi.fn().mockResolvedValue('base64screenshot');
    const page = {
      frames: vi.fn().mockReturnValue([mainFrame]),
      mainFrame: vi.fn().mockReturnValue(mainFrame),
      screenshot,
    } as unknown as Page;
    return { page, mainFrame, evaluate, waitForSelector, screenshot };
  }

  function tabWithDialog(page: Page, getPendingDialog?: () => any): IBrowserTab {
    const tab = mockTab(page);
    if (getPendingDialog) {
      (tab as any).getPendingDialog = getPendingDialog;
    }
    return tab;
  }

  it('E1: a probe-confirmed invalid selector fails before dispatch, with no retry and no screenshot', async () => {
    const parserMessage = "Failed to execute 'querySelector' on 'DocumentFragment': 'div[' is not a valid selector.";
    const { page, waitForSelector, screenshot, evaluate } = pageWithProbe({
      evaluateImpl: () => Promise.resolve(parserMessage),
    });
    const engine = new BrowserActionEngine();
    const tab = tabWithDialog(page);
    const result = await engine.executeAction(tab, { actionType: 'click', selector: 'div[', maxRetries: 2 });

    expect(result.success).toBe(false);
    expect(result.retriesUsed).toBe(0);
    expect(result.error).toContain('Invalid selector "div["');
    expect(result.error).toContain(parserMessage);
    expect(result.error).toContain('Playwright-style');
    expect(result.failureScreenshot).toBeUndefined();
    expect(waitForSelector).not.toHaveBeenCalled();
    expect(screenshot).not.toHaveBeenCalled();
    expect(result.verification?.verified).toBe(false);
    expect(tab.getActionHistory()).toHaveLength(1);
    expect(tab.getActionHistory()[0].success).toBe(false);
    expect(evaluate).toHaveBeenCalledTimes(1);
    const call = evaluate.mock.calls[0];
    expect(call[1]).toBe('css');
    expect(call[2]).toBe('div[');
  });

  it('E2: a probe-cleared but absent selector goes through the normal retry loop, probing only once', async () => {
    const { page, evaluate, waitForSelector } = pageWithProbe({
      evaluateImpl: () => Promise.resolve(null),
      waitForSelectorImpl: () => Promise.reject(new Error('No element found for selector: #nope')),
    });
    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), { actionType: 'click', selector: '#nope' });

    expect(result.error).toContain('No visible element found for selector: #nope');
    expect(result.error).not.toContain('Invalid selector');
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(waitForSelector).toHaveBeenCalledTimes(3); // default maxRetries=2 -> 3 attempts
  });

  it('E3: a probe-cleared, present selector clicks successfully', async () => {
    const handle = mockHandle();
    handle.evaluate.mockResolvedValueOnce(false).mockResolvedValue(true);
    const { page } = pageWithProbe({
      evaluateImpl: () => Promise.resolve(null),
      waitForSelectorImpl: () => Promise.resolve(handle),
    });
    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), { actionType: 'click', selector: '#ok', maxRetries: 0 });

    expect(result.success).toBe(true);
    expect(handle.click).toHaveBeenCalledTimes(1);
  });

  it('E4: an inconclusive probe (rejection) lets the action succeed normally', async () => {
    const handle = mockHandle();
    handle.evaluate.mockResolvedValueOnce(false).mockResolvedValue(true);
    const { page } = pageWithProbe({
      evaluateImpl: () => Promise.reject(new Error('Execution context was destroyed')),
      waitForSelectorImpl: () => Promise.resolve(handle),
    });
    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), { actionType: 'click', selector: '#ok', maxRetries: 0 });

    expect(result.success).toBe(true);
  });

  it('E5: a probe that never resolves is bounded, and the action still succeeds', async () => {
    const handle = mockHandle();
    handle.evaluate.mockResolvedValueOnce(false).mockResolvedValue(true);
    const { page } = pageWithProbe({
      evaluateImpl: () => new Promise(() => {}), // never settles
      waitForSelectorImpl: () => Promise.resolve(handle),
    });
    const engine = new BrowserActionEngine();
    const t0 = Date.now();
    const result = await engine.executeAction(mockTab(page), { actionType: 'click', selector: '#ok', maxRetries: 0 });
    const elapsed = Date.now() - t0;

    expect(result.success).toBe(true);
    expect(elapsed).toBeGreaterThanOrEqual(450);
    expect(elapsed).toBeLessThan(2000);
  });

  it('E6: the probe is skipped for node ids, aria/text prefixes, engine-built selectors, non-selector actions, and a pending dialog', async () => {
    const cases: Array<Record<string, unknown>> = [
      { actionType: 'click', selector: '[data-sd-node-id="12"]', maxRetries: 0 },
      { actionType: 'click', selector: 'aria/Submit[role="button"]', maxRetries: 0 },
      { actionType: 'click', selector: 'text/Hi', maxRetries: 0 },
      { actionType: 'click_by_text', text: 'text=Submit', maxRetries: 0 },
      { actionType: 'click_by_role', role: 'button', name: 'Go >> now', maxRetries: 0 },
      { actionType: 'type_by_label', label: 'Notes >> x', value: 'v', maxRetries: 0 },
      { actionType: 'press_key', key: 'Enter', maxRetries: 0 },
      { actionType: 'scroll', maxRetries: 0 },
    ];
    for (const params of cases) {
      const { page, evaluate } = pageWithProbe({});
      const engine = new BrowserActionEngine();
      await engine.executeAction(mockTab(page), params as any).catch(() => {});
      expect(evaluate).not.toHaveBeenCalled();
    }

    // Pending dialog: skip even for an otherwise-probed selector.
    const { page, evaluate } = pageWithProbe({});
    const engine = new BrowserActionEngine();
    const tab = tabWithDialog(page, () => ({ type: 'alert', message: 'hi' }));
    await engine.executeAction(tab, { actionType: 'click', selector: 'div[', maxRetries: 0 }).catch(() => {});
    expect(evaluate).not.toHaveBeenCalled();
  });

  it('E7: the probe passes xpath// as xpath and pierce/ payload as css', async () => {
    {
      const { page, evaluate } = pageWithProbe({ evaluateImpl: () => Promise.resolve(null) });
      const engine = new BrowserActionEngine();
      await engine.executeAction(mockTab(page), { actionType: 'click', selector: 'xpath//[', maxRetries: 0 }).catch(() => {});
      expect(evaluate.mock.calls[0][1]).toBe('xpath');
      expect(evaluate.mock.calls[0][2]).toBe('/[');
    }
    {
      const { page, evaluate } = pageWithProbe({ evaluateImpl: () => Promise.resolve(null) });
      const engine = new BrowserActionEngine();
      await engine.executeAction(mockTab(page), { actionType: 'click', selector: 'pierce/#x', maxRetries: 0 }).catch(() => {});
      expect(evaluate.mock.calls[0][1]).toBe('css');
      expect(evaluate.mock.calls[0][2]).toBe('#x');
    }
  });

  it('E8: drag_and_drop probes both selectors and names the invalid target', async () => {
    const parserMessage = "'div[' is not a valid selector.";
    const { page, evaluate } = pageWithProbe({
      evaluateImpl: (_fn: unknown, _kind: string, expr: string) =>
        Promise.resolve(expr === 'div[' ? parserMessage : null),
    });
    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'drag_and_drop',
      selector: '#src',
      targetSelector: 'div[',
      maxRetries: 0,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid selector "div["');
    expect(evaluate).toHaveBeenCalledTimes(2);
  });

  it('E9: toPuppeteerQuery passthrough never double-prefixes an already-prefixed caller selector', async () => {
    const cases: Array<[string, string]> = [
      ['xpath///button', 'xpath///button'],
      ['pierce/#x', 'pierce/#x'],
      ['#x', 'pierce/#x'],
    ];
    for (const [input, expected] of cases) {
      const { page, waitForSelector } = pageWithProbe({ evaluateImpl: () => Promise.resolve(null) });
      const engine = new BrowserActionEngine();
      await engine.executeAction(mockTab(page), { actionType: 'click', selector: input, maxRetries: 0 }).catch(() => {});
      expect(waitForSelector.mock.calls[0][0]).toBe(expected);
    }

    const { page, waitForSelector } = pageWithProbe({ evaluateImpl: () => Promise.resolve(null) });
    const engine = new BrowserActionEngine();
    await engine
      .executeAction(mockTab(page), { actionType: 'type', selector: 'aria/Name[role="textbox"]', value: 'hi', maxRetries: 0 })
      .catch(() => {});
    expect(waitForSelector.mock.calls[0][0]).toBe('aria/Name[role="textbox"]');
  });

  it('E10: a syntax-error dispatch failure (probe inconclusive, browser itself rejects) stops the retry loop immediately', async () => {
    const { page } = pageWithProbe({});
    // Remove `evaluate` entirely so the pre-loop probe is inconclusive (T11: some mocks have no
    // evaluate) — the browser's OWN dispatch-time syntax-error fast-fail (GAP-033's
    // pierceFirstMatch pre-check, via `frame.$`) is what must surface and stop the retry loop.
    delete (page.mainFrame() as any).evaluate;
    const dollarMock = vi.fn().mockRejectedValue(new Error("'div[' is not a valid selector."));
    (page.mainFrame() as any).$ = dollarMock;
    const engine = new BrowserActionEngine();
    const t0 = Date.now();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'wait_for_selector',
      selector: 'div[',
      state: 'attached',
      timeoutMs: 5000,
    });
    const elapsed = Date.now() - t0;

    expect(result.retriesUsed).toBe(0);
    expect(result.error).toContain('is not a valid selector');
    expect(dollarMock).toHaveBeenCalledTimes(1);
    expect(elapsed).toBeLessThan(400);
  });

  it('E11: the duplicate-action guard never masks a rejected-selector result on a repeat dispatch', async () => {
    const parserMessage = "'div[' is not a valid selector.";
    const { page } = pageWithProbe({ evaluateImpl: () => Promise.resolve(parserMessage) });
    const engine = new BrowserActionEngine();
    const tab = mockTab(page);
    const r1 = await engine.executeAction(tab, { actionType: 'click', selector: 'div[', maxRetries: 0 });
    const r2 = await engine.executeAction(tab, { actionType: 'click', selector: 'div[', maxRetries: 0 });

    expect(r1.error).toContain('Invalid selector');
    expect(r2.error).toContain('Invalid selector');
    expect(r2.error).not.toContain('Duplicate');
  });
});

describe('@sutradhar/browser BrowserActionEngine FR2-07 built-in post-conditions', () => {
  const PNG_1x1 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

  /** A page whose main frame answers `evaluate` from a script, with a real `keyboard.press`. */
  function keyPage(evaluate: (...args: any[]) => any, opts: { withPageEvaluate?: boolean } = {}) {
    const mainFrame = {
      isDetached: () => false,
      evaluate: vi.fn().mockImplementation(evaluate),
      childFrames: () => [],
    };
    const press = vi.fn().mockResolvedValue(undefined);
    const pageEvaluate = vi.fn().mockResolvedValue(undefined);
    const page = {
      frames: vi.fn().mockReturnValue([mainFrame]),
      mainFrame: vi.fn().mockReturnValue(mainFrame),
      keyboard: { press },
      ...(opts.withPageEvaluate ? { evaluate: pageEvaluate } : {}),
    } as unknown as Page;
    return { page, mainFrame, press, pageEvaluate };
  }

  const inputInfo = { isFrameElement: false, kind: 'element', desc: 'input#q', textEntry: true, readOnly: false, selStart: 0, selEnd: 0, valueLen: 0 };

  function scriptedKeyPage(read: unknown) {
    let n = 0;
    return keyPage(() => {
      n++;
      if (n === 1) return Promise.resolve(inputInfo);
      if (n === 2) return Promise.resolve(undefined);
      return typeof read === 'function' ? (read as () => Promise<unknown>)() : Promise.resolve(read);
    });
  }

  it('E1: press_key on a page with no mainFrame is unverifiable with a specific reason, presses once, and adds no delay', async () => {
    const press = vi.fn().mockResolvedValue(undefined);
    const page = { frames: vi.fn().mockReturnValue([]), keyboard: { press } } as unknown as Page;
    const result = await new BrowserActionEngine().executeAction(mockTab(page), { actionType: 'press_key', key: 'Enter', maxRetries: 0 });
    // event-based, not wall-time: the specific no-mainFrame reason proves the observation was skipped, not timed out
    expect(result.verification?.reason).not.toContain('did not answer');
    expect(result.success).toBe(true);
    expect(result.verification?.evidence.tier).toBe('unverifiable');
    expect(result.verification?.reason).toContain('no built-in');
    expect(result.verification?.reason).toContain("could not observe the page's focused element");
    expect(press).toHaveBeenCalledTimes(1);
  });

  it('E2: press_key with a delivered key whose value changed is verified, with the three stable checks', async () => {
    const { page } = scriptedKeyPage({ delivered: true, onTarget: true, valueChanged: true, afterValueLen: 1, focusMoved: false });
    const result = await new BrowserActionEngine().executeAction(mockTab(page), { actionType: 'press_key', key: 'a', maxRetries: 0 });
    expect(result.verification?.evidence.tier).toBe('verified');
    const byId = Object.fromEntries((result.verification?.evidence.checks ?? []).map((c) => [c.check, c.outcome]));
    expect(byId['press_key.key-delivered']).toBe('pass');
    expect(byId['press_key.effect']).toBe('pass');
    expect(byId['press_key.focused-target']).toBe('pass');
  });

  it('E3: a key that was delivered but changed nothing is contradicted at 0.09, success stays true, and the key is pressed ONCE (no retry)', async () => {
    const { page, press } = scriptedKeyPage({ delivered: true, onTarget: true, valueChanged: false, afterValueLen: 0, focusMoved: false });
    const result = await new BrowserActionEngine().executeAction(mockTab(page), { actionType: 'press_key', key: 'a' }); // default maxRetries (2)
    expect(result.success).toBe(true);
    expect(result.retriesUsed).toBe(0);
    expect(press).toHaveBeenCalledTimes(1);
    expect(result.verification?.evidence.tier).toBe('contradicted');
    expect(result.verification?.confidence).toBeCloseTo(0.09, 5);
    expect(result.verification?.reason).toContain('value did not change');
  });

  it('E4: nothing focused (body) is unverifiable: "no element had focus"', async () => {
    const { page } = keyPage(() => Promise.resolve({ kind: 'body' }));
    const result = await new BrowserActionEngine().executeAction(mockTab(page), { actionType: 'press_key', key: 'a', maxRetries: 0 });
    expect(result.verification?.evidence.tier).toBe('unverifiable');
    expect(result.verification?.reason).toContain('no element had focus');
  });

  it('E5: a context-destroyed read after the press means the page navigated: verified', async () => {
    const { page } = scriptedKeyPage(() => Promise.reject(new Error('Execution context was destroyed, most likely because of a navigation.')));
    const result = await new BrowserActionEngine().executeAction(mockTab(page), { actionType: 'press_key', key: 'Enter', maxRetries: 0 });
    expect(result.verification?.evidence.tier).toBe('verified');
    expect(result.verification?.reason).toContain('navigated');
  });

  it('E6: a read that never resolves is bounded (monotonic clock) and reported not-run, and a pending dialog is named', async () => {
    const { page } = scriptedKeyPage(() => new Promise(() => {}));
    const t0 = performance.now();
    const result = await new BrowserActionEngine().executeAction(mockTab(page), { actionType: 'press_key', key: 'a', maxRetries: 0 });
    // the call RETURNED although the read never resolves (the bound fired); no upper wall-time bound (load-sensitive)
    expect(performance.now() - t0).toBeGreaterThan(900);
    expect(result.success).toBe(true);
    expect(result.verification?.evidence.tier).toBe('unverifiable');
    expect(result.verification?.reason).toContain('the page did not answer');

    // N6: the same hang, but a dialog opened after the press -> named, and dialogPending is the caller's cue.
    const second = scriptedKeyPage(() => new Promise(() => {}));
    const tab = mockTab(second.page);
    let asked = 0;
    (tab as any).getPendingDialog = () => (++asked > 1 ? { dialogType: 'alert', message: 'hi' } : undefined);
    const r2 = await new BrowserActionEngine().executeAction(tab, { actionType: 'press_key', key: 'Enter', maxRetries: 0 });
    expect(r2.verification?.reason).toContain('an alert dialog opened after the press');
  });

  it('E7: press_key observation never calls page.evaluate (only frame evaluate)', async () => {
    const { page, pageEvaluate, mainFrame } = keyPage(
      (() => {
        let n = 0;
        return () => {
          n++;
          if (n === 1) return Promise.resolve(inputInfo);
          if (n === 2) return Promise.resolve(undefined);
          return Promise.resolve({ delivered: true, onTarget: true, valueChanged: true, afterValueLen: 1, focusMoved: false });
        };
      })(),
      { withPageEvaluate: true },
    );
    await new BrowserActionEngine().executeAction(mockTab(page), { actionType: 'press_key', key: 'a', maxRetries: 0 });
    expect(pageEvaluate).not.toHaveBeenCalled();
    expect(mainFrame.evaluate).toHaveBeenCalledTimes(3);
  });

  it('E8: focus is verified when the element is its own document\'s activeElement, contradicted (no retry) when it is not', async () => {
    const good = mockHandle();
    good.evaluate.mockResolvedValueOnce(false).mockResolvedValueOnce({ ok: true, observed: 'input#a', desc: 'input#a' });
    const okPage = singleFramePage(() => Promise.resolve(good));
    const ok = await new BrowserActionEngine().executeAction(mockTab(okPage), { actionType: 'focus', selector: '#a', maxRetries: 0 });
    expect(ok.verification?.evidence.tier).toBe('verified');

    const bad = mockHandle();
    bad.evaluate.mockResolvedValueOnce(false).mockResolvedValueOnce({ ok: false, observed: 'body', desc: 'div#x' });
    const badPage = singleFramePage(() => Promise.resolve(bad));
    const r = await new BrowserActionEngine().executeAction(mockTab(badPage), { actionType: 'focus', selector: '#x' });
    expect(r.success).toBe(true);
    expect(r.verification?.evidence.tier).toBe('contradicted');
    expect(r.verification?.reason).toContain('not div#x');
    expect(bad.focus).toHaveBeenCalledTimes(1);
  });

  it('E9: touch_tap is verified when a trusted event arrived, contradicted (occluded) when not; tap runs once', async () => {
    const good = mockHandle();
    (good as any).tap = vi.fn().mockResolvedValue(undefined);
    good.evaluate
      .mockResolvedValueOnce(false) // assertNotStale
      .mockResolvedValueOnce({ isHit: true, desc: 'button#t', topDesc: 'button#t' }) // arm
      .mockResolvedValueOnce({ trusted: true, type: 'touchend' }); // read
    const r1 = await new BrowserActionEngine().executeAction(mockTab(singleFramePage(() => Promise.resolve(good))), { actionType: 'touch_tap', selector: '#t', maxRetries: 0 });
    expect(r1.verification?.evidence.tier).toBe('verified');

    const bad = mockHandle();
    (bad as any).tap = vi.fn().mockResolvedValue(undefined);
    bad.evaluate
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce({ isHit: false, desc: 'button#t', topDesc: 'div#o' })
      .mockResolvedValueOnce(null);
    const r2 = await new BrowserActionEngine().executeAction(mockTab(singleFramePage(() => Promise.resolve(bad))), { actionType: 'touch_tap', selector: '#t' });
    expect(r2.success).toBe(true);
    expect(r2.verification?.evidence.tier).toBe('contradicted');
    expect(r2.verification?.reason).toContain('occluded by div#o');
    expect((bad as any).tap).toHaveBeenCalledTimes(1);
  });

  describe('E10: download_file evidence (real files in a temp dir)', () => {
    let wsN = 0;
    function cdp() {
      const handlers = new Map<string, (e: any) => void>();
      const waiters = new Map<string, Array<() => void>>();
      return {
        send: vi.fn().mockResolvedValue(undefined),
        on: vi.fn((evt: string, cb: (e: any) => void) => {
          handlers.set(evt, cb);
          for (const w of waiters.get(evt) ?? []) w();
          waiters.delete(evt);
        }),
        off: vi.fn((evt: string) => handlers.delete(evt)),
        detach: vi.fn().mockResolvedValue(undefined),
        emit: (evt: string, p: any) => handlers.get(evt)?.(p),
        whenListening: (evt: string): Promise<void> =>
          handlers.has(evt)
            ? Promise.resolve()
            : new Promise<void>((resolve, reject) => {
                const t = setTimeout(() => reject(new Error('never listened')), 10000);
                const l = waiters.get(evt) ?? [];
                l.push(() => {
                  clearTimeout(t);
                  resolve();
                });
                waiters.set(evt, l);
              }),
      };
    }
    async function run(prepare: (dir: string) => void, ws?: string) {
      const dir = mkdtempSync(path.join(os.tmpdir(), 'fr2-07-dl-'));
      try {
        prepare(dir);
        const handle = mockHandle();
        handle.evaluate.mockResolvedValueOnce(false).mockResolvedValue(true);
        const page = singleFramePage(() => Promise.resolve(handle));
        const client = cdp();
        (page as any).browser = vi.fn().mockReturnValue({
          wsEndpoint: vi.fn().mockReturnValue(ws ?? `ws://127.0.0.1:${process.pid}-${Date.now()}-${wsN++}`),
          target: vi.fn().mockReturnValue({ createCDPSession: vi.fn().mockResolvedValue(client) }),
        });
        const engine = new BrowserActionEngine(undefined, undefined, undefined, [dir]);
        const p = engine.executeAction(mockTab(page), { actionType: 'download_file', selector: '#dl', downloadDir: dir, maxRetries: 0 });
        await client.whenListening('Browser.downloadProgress');
        client.emit('Browser.downloadWillBegin', { guid: 'g', suggestedFilename: 'report.pdf' });
        client.emit('Browser.downloadProgress', { guid: 'g', state: 'completed', filePath: path.join(dir, 'report.pdf') });
        return { result: await p, dir };
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }

    it('a real 10-byte file is verified and its size is reported', async () => {
      const { result } = await run((d) => writeFileSync(path.join(d, 'report.pdf'), '0123456789'));
      expect(result.verification?.evidence.tier).toBe('verified');
      expect(result.outputData?.downloadedSizeBytes).toBe(10);
    });
    it('a 0-byte file is contradicted, success stays true', async () => {
      const { result } = await run((d) => writeFileSync(path.join(d, 'report.pdf'), ''));
      expect(result.success).toBe(true);
      expect(result.verification?.evidence.tier).toBe('contradicted');
      expect(result.verification?.reason).toContain('0 bytes');
    });
    it('a missing file is contradicted', async () => {
      const { result } = await run(() => {});
      expect(result.success).toBe(true);
      expect(result.verification?.evidence.tier).toBe('contradicted');
      expect(result.verification?.reason).toContain('no file exists');
    });
    it('a stale (one hour old) file is contradicted: "predates"', async () => {
      const { result } = await run((d) => {
        const f = path.join(d, 'report.pdf');
        writeFileSync(f, '0123456789');
        const old = new Date(Date.now() - 3_600_000);
        utimesSync(f, old, old);
      });
      expect(result.verification?.evidence.tier).toBe('contradicted');
      expect(result.verification?.reason).toContain('predates');
    });
    it('a remote browser endpoint is unverifiable, never a false pass or fail', async () => {
      const { result } = await run((d) => writeFileSync(path.join(d, 'report.pdf'), '0123456789'), 'ws://10.1.2.3:9222/x');
      expect(result.verification?.evidence.tier).toBe('unverifiable');
      expect(result.verification?.reason).toContain('another host');
    });
  });

  it('E11: wait_for_selector evidence comes from its own output: visible verified, a vacuous hidden (typo) unverifiable', async () => {
    const handle = mockHandle();
    (handle as any).evaluate = vi.fn().mockResolvedValue(true);
    const dollar = vi.fn().mockResolvedValue(handle);
    const mainFrame = { isDetached: () => false, $: dollar } as unknown as Frame;
    const page = { frames: vi.fn().mockReturnValue([mainFrame]), mainFrame: vi.fn().mockReturnValue(mainFrame) } as unknown as Page;
    const r1 = await new BrowserActionEngine().executeAction(mockTab(page), { actionType: 'wait_for_selector', selector: '#t', maxRetries: 0 });
    expect(r1.success).toBe(true);
    expect(r1.verification?.evidence.tier).toBe('verified');
    expect(r1.verification?.evidence.checks[0]).toMatchObject({ check: 'wait_for_selector.state-matched', outcome: 'pass', expected: 'visible' });

    const none = vi.fn().mockResolvedValue(null);
    const emptyFrame = { isDetached: () => false, $: none, $$: vi.fn().mockResolvedValue([]), evaluate: vi.fn().mockResolvedValue(false) } as unknown as Frame;
    const emptyPage = { frames: vi.fn().mockReturnValue([emptyFrame]), mainFrame: vi.fn().mockReturnValue(emptyFrame) } as unknown as Page;
    const r2 = await new BrowserActionEngine().executeAction(mockTab(emptyPage), { actionType: 'wait_for_selector', selector: '#typo', state: 'hidden', timeoutMs: 500, maxRetries: 0 });
    expect(r2.success).toBe(true);
    expect(r2.verification?.evidence.tier).toBe('unverifiable');
    expect(r2.verification?.reason).toContain('vacuously');
  });

  it('E12: take_screenshot: a valid PNG is unverifiable-by-design with png-well-formed pass; garbage is contradicted', async () => {
    const ok = { frames: vi.fn().mockReturnValue([]), screenshot: vi.fn().mockResolvedValue(PNG_1x1) } as unknown as Page;
    const r1 = await new BrowserActionEngine().executeAction(mockTab(ok), { actionType: 'take_screenshot', maxRetries: 0 });
    expect(r1.verification?.evidence.tier).toBe('unverifiable');
    expect(r1.verification?.evidence.checks[0]).toMatchObject({ check: 'screenshot.png-well-formed', outcome: 'pass', observed: '1x1' });
    const bad = { frames: vi.fn().mockReturnValue([]), screenshot: vi.fn().mockResolvedValue('bm90IGEgcG5n') } as unknown as Page;
    const r2 = await new BrowserActionEngine().executeAction(mockTab(bad), { actionType: 'take_screenshot', maxRetries: 0 });
    expect(r2.success).toBe(true);
    expect(r2.verification?.evidence.tier).toBe('contradicted');
    expect(r2.verification?.reason).toContain('not a valid PNG');
  });

  describe('E13: navigate identity via CDP (loaderId + history)', () => {
    function navPage(loaders: string[], opts: { status?: number; noCdp?: boolean } = {}) {
      let frameTreeCalls = 0;
      const send = vi.fn().mockImplementation(async (method: string) => {
        if (method === 'Page.getNavigationHistory') return { currentIndex: 0, entries: [{ id: 1 }] };
        if (method === 'Page.getFrameTree') return { frameTree: { frame: { loaderId: loaders[Math.min(frameTreeCalls++, loaders.length - 1)] } } };
        return {};
      });
      const mainFrame = { isDetached: () => false, evaluate: vi.fn().mockResolvedValue(opts.status ?? 200), childFrames: () => [] };
      const page: any = {
        frames: vi.fn().mockReturnValue([mainFrame]),
        mainFrame: vi.fn().mockReturnValue(mainFrame),
        url: () => 'https://example.com',
        ...(opts.noCdp ? {} : { createCDPSession: vi.fn().mockResolvedValue({ send, detach: vi.fn().mockResolvedValue(undefined) }) }),
      };
      return page as Page;
    }
    it('a changed loader is verified; an unchanged loader at an unchanged URL is contradicted; a 404 is contradicted', async () => {
      const tab1 = mockTab(navPage(['L1', 'L2']));
      (tab1 as any).navigate = async () => { (tab1 as any).url = 'https://example.com/next'; return {}; };
      const r1 = await new BrowserActionEngine().executeAction(tab1, { actionType: 'navigate', url: 'https://example.com/next', maxRetries: 0 });
      expect(r1.verification?.evidence.tier).toBe('verified');

      const r2 = await new BrowserActionEngine().executeAction(mockTab(navPage(['L1', 'L1'])), { actionType: 'navigate', url: 'https://example.com/other', maxRetries: 0 });
      expect(r2.success).toBe(true);
      expect(r2.verification?.evidence.tier).toBe('contradicted');

      const tab3 = mockTab(navPage(['L1', 'L2'], { status: 404 }));
      const r3 = await new BrowserActionEngine().executeAction(tab3, { actionType: 'navigate', url: 'https://example.com/missing', maxRetries: 0 });
      expect(r3.verification?.evidence.tier).toBe('contradicted');
      expect(r3.verification?.reason).toContain('HTTP 404');
    });
    it('a page with no CDP session is unverifiable: baseline could not be captured', async () => {
      const r = await new BrowserActionEngine().executeAction(mockTab(navPage(['L1'], { noCdp: true })), { actionType: 'navigate', url: 'https://example.com/x', maxRetries: 0 });
      expect(r.success).toBe(true);
      expect(r.verification?.evidence.tier).toBe('unverifiable');
      expect(r.verification?.reason).toContain("baseline couldn't be captured");
    });
  });

  it('E14: the duplicate-guard rejection carries an action-failed verification', async () => {
    const engine = new BrowserActionEngine();
    const tab = mockTab(singleFramePage(() => Promise.resolve(null)));
    await engine.executeAction(tab, { actionType: 'click', selector: '#dup', maxRetries: 0, timeoutMs: 1000 });
    const second = await engine.executeAction(tab, { actionType: 'click', selector: '#dup', maxRetries: 0, verificationSpec: { expectedElementText: 'x' } });
    expect(second.success).toBe(false);
    expect(second.error).toContain('Duplicate');
    expect(second.verification?.evidence.tier).toBe('action-failed');
    expect(second.verification?.reason.startsWith('Action failed: Duplicate')).toBe(true);
    expect(second.verification?.evidence.checks).toEqual([
      { check: 'expect.text', outcome: 'not-run', detail: 'the action failed; expectations were not evaluated' },
    ]);
  });

  it('E15: verificationSpec flows through the success path: a self-verifying click with shouldUrlChange:false and an unchanged URL is verified with expect.urlChanged pass', async () => {
    const handle = mockHandle();
    handle.evaluate.mockResolvedValueOnce(false).mockResolvedValue(true);
    const result = await new BrowserActionEngine().executeAction(mockTab(singleFramePage(() => Promise.resolve(handle))), {
      actionType: 'click',
      selector: '#b',
      maxRetries: 0,
      verificationSpec: { shouldUrlChange: false },
    });
    expect(result.verification?.evidence.tier).toBe('verified');
    expect(result.verification?.evidence.checks.find((c) => c.check === 'expect.urlChanged')).toMatchObject({ outcome: 'pass' });
  });

  it('E16: every verification produced above survives a JSON round trip unchanged', async () => {
    const { page } = scriptedKeyPage({ delivered: true, onTarget: true, valueChanged: false, afterValueLen: 0, focusMoved: false });
    const r = await new BrowserActionEngine().executeAction(mockTab(page), { actionType: 'press_key', key: 'a', maxRetries: 0 });
    expect(JSON.parse(JSON.stringify(r.verification))).toEqual(r.verification);
    const failed = await new BrowserActionEngine().executeAction(mockTab(singleFramePage(() => Promise.reject(new Error('x')))), { actionType: 'click', selector: '#z', maxRetries: 0 });
    expect(JSON.parse(JSON.stringify(failed.verification))).toEqual(failed.verification);
    expect(failed.verification?.evidence.tier).toBe('action-failed');
  });
});
