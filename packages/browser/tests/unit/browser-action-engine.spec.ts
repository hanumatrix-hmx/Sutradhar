/**
 * @file packages/browser/tests/unit/browser-action-engine.spec.ts
 * @description Unit tests for BrowserActionEngine: occlusion-safe click, ExecutionVerifier
 * wiring, node-id staleness guard, duplicate-action guard, cross-frame element resolution,
 * and the honest-error tab-lifecycle stubs.
 */

import { BrowserActionEngine, IBrowserTab } from '../../src/index.js';
import { createTabId } from '@pinchtab/contracts';
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
function mockHandle(overrides: Partial<Record<'click' | 'hover' | 'type' | 'select' | 'focus' | 'scrollIntoView', any>> = {}) {
  return {
    click: overrides.click ?? vi.fn().mockResolvedValue(undefined),
    hover: overrides.hover ?? vi.fn().mockResolvedValue(undefined),
    type: overrides.type ?? vi.fn().mockResolvedValue(undefined),
    select: overrides.select ?? vi.fn().mockResolvedValue(undefined),
    focus: overrides.focus ?? vi.fn().mockResolvedValue(undefined),
    scrollIntoView: overrides.scrollIntoView ?? vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn(),
  };
}

describe('@pinchtab/browser BrowserActionEngine click occlusion detection', () => {
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

describe('@pinchtab/browser BrowserActionEngine ExecutionVerifier wiring', () => {
  it('attaches a verification result to a successful action, verified true with no spec', async () => {
    const page = {
      frames: vi.fn().mockReturnValue([]),
      evaluate: vi.fn().mockResolvedValue(undefined), // scroll's own page.evaluate call
    } as unknown as Page;

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'scroll',
      maxRetries: 0,
    });

    expect(result.success).toBe(true);
    expect(result.verification?.verified).toBe(true);
  });

  it('reports verification.verified:false (without failing the action) when a shouldUrlChange spec is not met', async () => {
    const page = {
      frames: vi.fn().mockReturnValue([]),
      evaluate: vi.fn().mockResolvedValue(undefined),
    } as unknown as Page;

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'scroll',
      maxRetries: 0,
      verificationSpec: { shouldUrlChange: true },
    });

    // The scroll itself still succeeded — verification is informational, not gating.
    expect(result.success).toBe(true);
    expect(result.verification?.verified).toBe(false);
    expect(result.verification?.reason).toContain('Expected URL change');
  });

  it('downgrades to verified:false when candidateConfidence is below the low-confidence threshold', async () => {
    const page = {
      frames: vi.fn().mockReturnValue([]),
      evaluate: vi.fn().mockResolvedValue(undefined),
    } as unknown as Page;

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'scroll',
      maxRetries: 0,
      verificationSpec: { candidateConfidence: 0.2 },
    });

    expect(result.success).toBe(true);
    expect(result.verification?.verified).toBe(false);
    expect(result.verification?.confidence).toBe(0.2);
    expect(result.verification?.reason).toContain('below the verification threshold');
  });

  it('reports verified:true when candidateConfidence is at/above the threshold', async () => {
    const page = {
      frames: vi.fn().mockReturnValue([]),
      evaluate: vi.fn().mockResolvedValue(undefined),
    } as unknown as Page;

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'scroll',
      maxRetries: 0,
      verificationSpec: { candidateConfidence: 0.75 },
    });

    expect(result.success).toBe(true);
    expect(result.verification?.verified).toBe(true);
  });
});

describe('@pinchtab/browser BrowserActionEngine node-id staleness guard', () => {
  it('rejects a click on a selector stamped with an older generation than the page currently has', async () => {
    const handle = mockHandle();
    handle.evaluate.mockResolvedValueOnce(true); // assertNotStale: IS stale
    const page = singleFramePage(() => Promise.resolve(handle));

    const engine = new BrowserActionEngine();
    const result = await engine.executeAction(mockTab(page), {
      actionType: 'click',
      selector: '[data-pt-node-id="7"]',
      maxRetries: 0,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('stale snapshot');
    expect(handle.click).not.toHaveBeenCalled();
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

describe('@pinchtab/browser BrowserActionEngine duplicate-action guard', () => {
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

describe('@pinchtab/browser BrowserActionEngine context-destroyed diagnosis beyond click', () => {
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

describe('@pinchtab/browser BrowserActionEngine keyboard modifiers', () => {
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

describe('@pinchtab/browser BrowserActionEngine multi-select', () => {
  it('selects multiple values when `values` is given', async () => {
    const handle = mockHandle();
    handle.evaluate.mockResolvedValue(false); // assertNotStale
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
    handle.evaluate.mockResolvedValue(false);
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
});

describe('@pinchtab/browser BrowserActionEngine per-tab action concurrency guard', () => {
  it('serializes two concurrent actions against the same tab instead of interleaving them', async () => {
    const order: string[] = [];
    let resolveFirst!: () => void;
    const firstGate = new Promise<void>((r) => {
      resolveFirst = r;
    });

    const page = {
      frames: vi.fn().mockReturnValue([]),
      evaluate: vi.fn().mockImplementation(async () => {
        order.push('scroll-1-start');
        await firstGate; // held open until the test releases it
        order.push('scroll-1-end');
      }),
    } as unknown as Page;

    const engine = new BrowserActionEngine();
    const tab = mockTab(page);

    const first = engine.executeAction(tab, { actionType: 'scroll', maxRetries: 0 });
    // Give the first action a tick to actually start (and get stuck on firstGate).
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual(['scroll-1-start']);

    // The second call must not start its own page.evaluate until the first has resolved —
    // if the queue didn't serialize, 'scroll-2-start' would appear before 'scroll-1-end'.
    (page.evaluate as any).mockImplementationOnce(async () => {
      order.push('scroll-2-start');
    });
    const second = engine.executeAction(tab, { actionType: 'scroll', maxRetries: 0 });
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual(['scroll-1-start']); // second still hasn't run

    resolveFirst();
    await Promise.all([first, second]);

    expect(order).toEqual(['scroll-1-start', 'scroll-1-end', 'scroll-2-start']);
  });

  it('does not serialize actions against two different tabs', async () => {
    const pageA = { frames: vi.fn().mockReturnValue([]), evaluate: vi.fn().mockResolvedValue(undefined) } as unknown as Page;
    const pageB = { frames: vi.fn().mockReturnValue([]), evaluate: vi.fn().mockResolvedValue(undefined) } as unknown as Page;

    const engine = new BrowserActionEngine();
    const tabA = mockTab(pageA);
    (tabA as any).id = 'tab_A';
    const tabB = mockTab(pageB);
    (tabB as any).id = 'tab_B';

    const [resultA, resultB] = await Promise.all([
      engine.executeAction(tabA, { actionType: 'scroll', maxRetries: 0 }),
      engine.executeAction(tabB, { actionType: 'scroll', maxRetries: 0 }),
    ]);

    expect(resultA.success).toBe(true);
    expect(resultB.success).toBe(true);
  });
});

describe('@pinchtab/browser BrowserActionEngine cross-frame element resolution', () => {
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

describe('@pinchtab/browser BrowserActionEngine right-click (button-aware)', () => {
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

describe('@pinchtab/browser BrowserActionEngine drag_and_drop', () => {
  it('resolves both source and target handles and calls drag then drop', async () => {
    const source = mockHandle();
    const target = mockHandle();
    (source as any).drag = vi.fn().mockResolvedValue(undefined);
    (target as any).drop = vi.fn().mockResolvedValue(undefined);
    source.evaluate.mockResolvedValue(false); // assertNotStale: not stale
    target.evaluate.mockResolvedValue(false);

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

describe('@pinchtab/browser BrowserActionEngine touch_tap', () => {
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

describe('@pinchtab/browser BrowserActionEngine action-history recording', () => {
  it('records a successful action into the tab history', async () => {
    const page = { frames: vi.fn().mockReturnValue([]), evaluate: vi.fn().mockResolvedValue(undefined) } as unknown as Page;
    const engine = new BrowserActionEngine();
    const tab = mockTab(page);

    const result = await engine.executeAction(tab, { actionType: 'scroll', maxRetries: 0 });

    expect(result.success).toBe(true);
    expect(tab.getActionHistory()).toHaveLength(1);
    expect(tab.getActionHistory()[0]).toMatchObject({ actionType: 'scroll', success: true });
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

describe('@pinchtab/browser BrowserActionEngine screenshot-on-failure', () => {
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

describe('@pinchtab/browser BrowserActionEngine download_file', () => {
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

describe('@pinchtab/browser BrowserActionEngine actions fail loudly with no live page (no fabricated success)', () => {
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

describe('@pinchtab/browser BrowserActionEngine tab-lifecycle actions are session-level, not engine-level', () => {
  // 'switch_tab'/'open_new_tab'/'close_tab' were removed from the ActionType union — tab
  // bookkeeping is a session-level concern (PinchTabRuntime.focusTab/createTab/closeTab, or
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
