/**
 * @file packages/browser/tests/unit/frame-detach.spec.ts
 * @description I-047 (PROB-047): Puppeteer's `Frame` methods are wrapped by `throwIfDetached`, a PLAIN (non-async)
 * function that throws SYNCHRONOUSLY when the frame is detached. A `.catch()` chained on the call, a promise created
 * outside the `try` meant to cover it, or `bounded(frame.evaluate(...))` therefore never sees the error. These tests
 * use fake frames whose decorated methods are plain functions that throw synchronously (U-ctl proves the fake really
 * does), with a scripted detach (one frame detaches while an earlier frame is being probed), and assert each site's
 * documented outcome for a rejection.
 */

import { BrowserActionEngine, DOMSemanticEngine } from '../../src/index.js';
import type { IBrowserTab } from '../../src/index.js';
import { PostConditionRecorder, NavigationProbe, disposeKeyObservation, finishKeyObservation, finishPointObservation, observeUploadTargets, removeUploadListener } from '../../src/verifier/post-conditions.js';
import type { Page } from 'puppeteer-core';

const DETACHED = (id: string): string => `Attempted to use detached Frame '${id}'.`;

/** A frame double whose decorated methods mirror Puppeteer's `throwIfDetached` wrapper: plain functions, sync throw. */
class FakeFrame {
  public detached = false;
  public readonly calls: string[] = [];
  public onCall: ((method: string) => void) | undefined;
  /** What `waitForSelector` resolves to while attached. */
  public match: unknown = null;
  public evalResult: unknown = undefined;
  public evalImpl: (() => unknown) | undefined;
  public constructor(public readonly id: string, private readonly urlStr = 'http://x.test/') {}
  public detach(): void { this.detached = true; }
  public isDetached(): boolean { return this.detached; }
  public url(): string { return this.urlStr; }
  public name(): string { return ''; }
  public parentFrame(): FakeFrame | null { return null; }
  public childFrames(): FakeFrame[] { return []; }
  private guard(method: string): void {
    this.calls.push(method);
    this.onCall?.(method);
    if (this.detached) throw new Error(DETACHED(this.id));
  }
  // plain (non-async) functions: the sync throw is what Puppeteer's wrapper does
  public waitForSelector(_sel: string, _opts?: unknown): Promise<unknown> {
    this.guard('waitForSelector');
    return Promise.resolve(this.match);
  }
  public evaluate(..._args: unknown[]): Promise<unknown> {
    this.guard('evaluate');
    return this.evalImpl ? Promise.resolve(this.evalImpl()) : Promise.resolve(this.evalResult);
  }
  public $(_sel: string): Promise<unknown> {
    this.guard('$');
    return Promise.resolve(this.match);
  }
  public frameElement(): Promise<unknown> {
    this.guard('frameElement');
    return Promise.resolve(null);
  }
}

/** isDetached() still reports attached (a stale view, as when a frame detaches between listing and calling) while every decorated call throws. */
class StaleFrame extends FakeFrame {
  public constructor(id: string) { super(id); this.detached = true; }
  public override isDetached(): boolean { return false; }
}

function fakePage(main: FakeFrame, frames: () => FakeFrame[], extra: Record<string, unknown> = {}): Page {
  return { mainFrame: () => main, frames, title: async () => 'T', url: () => 'http://x.test/', ...extra } as unknown as Page;
}

const engineResolve = (engine: BrowserActionEngine, page: Page, sel: string, timeoutMs: number): Promise<unknown> =>
  (engine as unknown as { resolveElement(p: Page, s: string, o: { timeoutMs: number }): Promise<unknown> }).resolveElement(page, sel, { timeoutMs });

describe('I-047 frame-detach containment: control', () => {
  it('U-ctl: the fake really throws SYNCHRONOUSLY on a detached frame (not a rejection)', () => {
    const f = new FakeFrame('B');
    f.detach();
    expect(() => f.waitForSelector('x')).toThrow(/detached Frame 'B'/);
    expect(() => f.evaluate(() => 1)).toThrow(/detached Frame/);
    expect(() => f.$('x')).toThrow(/detached Frame/);
    // and the shape a `.catch()` cannot contain:
    let escaped = false;
    try { f.waitForSelector('x').catch(() => null); } catch { escaped = true; }
    expect(escaped).toBe(true);
  });

  it('frameCall turns a synchronous throw into a rejection and passes a value through (module under test)', async () => {
    const mod = await import('../../src/actions/frame-call.js');
    const f = new FakeFrame('B');
    await expect(mod.frameCall(f, (x) => x.waitForSelector('s'))).resolves.toBeNull();
    f.detach();
    let p: Promise<unknown> | undefined;
    expect(() => { p = mod.frameCall(f, (x) => x.waitForSelector('s')); }).not.toThrow();
    await expect(p).rejects.toThrow(/detached Frame 'B'/);
    expect(mod.isDetachedFrameError(new Error(DETACHED('B')))).toBe(true);
    expect(mod.isDetachedFrameError(new Error('something else'))).toBe(false);
  });
});

describe('I-047 resolveElement (browser-action-engine)', () => {
  const engine = new BrowserActionEngine();

  it('U1 loop path: main has no match, A is probed and detaches B, C matches -> C\'s handle, never throws', async () => {
    const main = new FakeFrame('main');
    const a = new FakeFrame('A');
    const b = new FakeFrame('B');
    const c = new FakeFrame('C');
    const handle = { tag: 'C-handle' };
    c.match = handle;
    a.onCall = (m) => { if (m === 'waitForSelector') b.detach(); }; // B detaches while A is being probed
    const page = fakePage(main, () => [main, a, b, c]); // all four live when the pass starts
    await expect(engineResolve(engine, page, '#x', 5000)).resolves.toBe(handle);
    expect(b.calls).toContain('waitForSelector'); // B really was probed after it detached (and its sync throw was contained)
    expect(c.calls).toContain('waitForSelector');
  });

  it('U2 loop path, no match anywhere, frames detaching every pass -> null at the deadline', async () => {
    const main = new FakeFrame('main');
    let n = 0;
    const page = fakePage(main, () => {
      // a fresh (A, B) pair every pass; A's probe detaches B before B is reached
      const a = new FakeFrame(`A${n}`);
      const b = new FakeFrame(`B${n++}`);
      a.onCall = (m) => { if (m === 'waitForSelector') b.detach(); };
      return [main, a, b];
    });
    // 1020 ms: 1000 ms head start (instant in the fake) + a 20 ms loop that spins through several passes
    await expect(engineResolve(engine, page, '#absent', 1020)).resolves.toBeNull();
    expect(n).toBeGreaterThan(1);
  });

  it('U3 single-frame path: the only frame is detached by the time of the call -> null (not a throw)', async () => {
    const stale = new StaleFrame('main'); // isDetached() still says attached; the call itself throws synchronously
    const page = fakePage(stale, () => [stale]);
    await expect(engineResolve(engine, page, '#x', 3000)).resolves.toBeNull();
  });

  it('U4 head start: main detached at call time -> falls into the loop (no throw), a live frame still matches', async () => {
    const staleMain = new StaleFrame('main'); // every main.waitForSelector throws synchronously; isDetached() says attached
    const a = new FakeFrame('A');
    const handle = { tag: 'A-handle' };
    a.match = handle;
    const page = fakePage(staleMain, () => [staleMain, a]);
    await expect(engineResolve(engine, page, '#x', 5000)).resolves.toBe(handle);
  });
});

describe('I-047 buildGraph (dom-semantic-engine)', () => {
  const node = (id: number) => ({ id, tagName: 'BUTTON', role: 'button', confidence: 1, boundingBox: { x: 0, y: 0, width: 1, height: 1 }, isVisible: true, isEnabled: true });

  it('U5: main scraped 5 nodes; child X detaches while main is scraped -> 5 main nodes, no skipped entry for X', async () => {
    const main = new FakeFrame('main');
    const x = new FakeFrame('X');
    main.evalImpl = () => { x.detach(); return [node(0), node(0), node(0), node(0), node(0)]; };
    const page = fakePage(main, () => [main, x]);
    const tab = { url: 'http://x.test/', title: 'T', page } as unknown as IBrowserTab;
    const graph = await new DOMSemanticEngine().buildGraph(tab);
    expect(graph.nodes.length).toBe(5);
    expect(graph.skippedFrames).toEqual([]); // D6: a frame that is detached by now is simply gone
    expect(x.calls).toContain('evaluate'); // X really was scraped after it detached
  });
});

describe('I-047 post-conditions', () => {
  const detachedFrame = (id: string): FakeFrame => { const f = new FakeFrame(id); f.detach(); return f; };
  const elementTarget = { kind: 'element', desc: 'x' } as never;

  it('U6a disposeKeyObservation ("never throws"): detached frame -> resolves', async () => {
    const f = detachedFrame('K');
    await expect(disposeKeyObservation({ frame: f as never, token: 't', target: elementTarget })).resolves.toBeUndefined();
    expect(f.calls).toContain('evaluate');
  });

  it('U6b finishKeyObservation: detached frame -> resolves with a verdict (postError recorded), never throws', async () => {
    const f = detachedFrame('K');
    const v = await finishKeyObservation({ url: 'http://x.test/' }, { frame: f as never, token: 't', target: elementTarget }, { key: 'a' }, 'http://x.test/');
    expect(v).toBeTruthy();
    expect(f.calls).toContain('evaluate');
  });

  it('U6c finishPointObservation: detached frame -> resolves with navigated=true (isContextDestroyed treats detached-Frame errors as a frame gone), never throws', async () => {
    const f = detachedFrame('P');
    const obs = await finishPointObservation({ url: 'http://x.test/' }, { frame: f as never, token: 't', hit: { desc: 'd' } }, { x: 1, y: 1, event: 'click' }, 'http://x.test/');
    expect(obs.navigated).toBe(true);
    expect(obs.postError).toBeUndefined();
    expect(f.calls).toContain('evaluate');
  });

  it('U6d observeUploadTargets: main frame detached -> resolves {error}, never throws', async () => {
    const f = detachedFrame('U');
    const page = fakePage(f, () => [f]);
    const arm = await observeUploadTargets({ url: 'http://x.test/', page });
    expect(arm.error).toMatch(/detached Frame 'U'/);
    expect(arm.frame).toBeUndefined();
  });

  it('U6e removeUploadListener ("best-effort cleanup", never throws): detached frame -> resolves', async () => {
    const f = detachedFrame('U');
    await expect(removeUploadListener({ frame: f as never, token: 't' })).resolves.toBeUndefined();
    expect(f.calls).toContain('evaluate');
  });

  it('U6f NavigationProbe.finish: the status read on a detached main frame is dropped, finish resolves', async () => {
    const main = new FakeFrame('N');
    let loaderId = 'L1';
    const session = {
      send: async (m: string) => (m === 'Page.getNavigationHistory' ? { currentIndex: 0, entries: [{}] } : { frameTree: { frame: { loaderId } } }),
      detach: async () => {},
    };
    const page = fakePage(main, () => [main], { createCDPSession: async () => session });
    const tab = { url: 'http://x.test/', page };
    const probe = await NavigationProbe.begin(page, tab);
    loaderId = 'L2'; // a different loader: finish() goes on to read the HTTP status through the main frame
    main.detach(); // ... which is detached by then: Frame.evaluate throws synchronously
    const rec = new PostConditionRecorder('navigate');
    await expect(probe.finish('navigate', 'http://x.test/', rec)).resolves.toBeUndefined();
    expect(main.calls).toContain('evaluate');
    expect(rec.toBuiltIn()).toBeTruthy();
  });
});
