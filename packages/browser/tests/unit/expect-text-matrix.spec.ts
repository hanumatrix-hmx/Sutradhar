/**
 * @file packages/browser/tests/unit/expect-text-matrix.spec.ts
 * @description FR2-07 fix-2: `expect.text` RENDERED-text contract, tested as a GENERATED matrix
 * (hiding mechanism x placement) instead of one example per mechanism a previous audit named.
 * Uses the fake DOM in ./fake-dom.ts (it models the platform primitives as the Chrome spike observed
 * them); the real-browser matrix with an independent observer is in
 * tools/scenario-suite/verify-fr2-07-verification.mjs.
 */

import {
  frameElementRendered,
  pageContainsVisibleText,
  visibleTextContainsInPage,
  type IBrowserTab,
} from '../../src/index.js';
import { append, attachShadow, el, makeDoc, page, runIn, text, type FDoc, type FNode, type Sty } from './fake-dom.js';

const TOKEN = 'TARGET-TOKEN';

/** A hiding mechanism: how it is applied to an element, and whether the contract COUNTS such text. */
interface Mech {
  name: string;
  counted: boolean;
  /** the mechanism is a property of a proper ANCESTOR of the text container (closed <details>) */
  ancestorOnly?: boolean;
  apply: (n: FNode) => void;
}
const setOwn = (o: Sty) => (n: FNode) => void Object.assign(n.own, o);
const MECHS: Mech[] = [
  { name: 'display:none', counted: false, apply: setOwn({ display: 'none' }) },
  { name: 'visibility:hidden', counted: false, apply: setOwn({ visibility: 'hidden' }) },
  { name: 'content-visibility:hidden', counted: false, apply: setOwn({ contentVisibility: 'hidden' }) },
  { name: 'hidden attribute (UA display:none)', counted: false, apply: setOwn({ display: 'none' }) },
  { name: 'zero-area (font-size:0 / 0x0 frame)', counted: false, apply: (n) => void (n.zeroArea = true) },
  { name: 'closed <details> (contents skipped)', counted: false, ancestorOnly: true, apply: (n) => void (n.skipsContents = true) },
  { name: 'opacity:0 (counted)', counted: true, apply: () => undefined },
  { name: 'aria-hidden (counted)', counted: true, apply: () => undefined },
  { name: 'off-screen (counted)', counted: true, apply: () => undefined },
  { name: 'overflow-clipped 0x0 box (counted)', counted: true, apply: () => undefined },
];

/** A placement builds a document with TOKEN in it and returns the node(s) a mechanism can be applied to (`containers` = the nearest boxed element around the text). */
interface Placement {
  name: string;
  build: (doc: FDoc) => { targets: FNode[]; containers: FNode[] };
}
/** Put the node in the page inside an outer wrapper (a proper ancestor of everything else). */
function inPage(doc: FDoc, node: FNode): FNode {
  const outer = el(doc, 'div', {}, [node]);
  page(doc, [outer]);
  return outer;
}
const placements: Placement[] = [
  {
    name: 'main frame, element',
    build: (doc) => {
      const p = el(doc, 'p', {}, [text(doc, TOKEN)]);
      const wrap = el(doc, 'div', {}, [el(doc, 'section', {}, [p])]);
      return { targets: [p, wrap, inPage(doc, wrap)], containers: [p] };
    },
  },
  {
    name: 'open shadow root, element',
    build: (doc) => {
      const host = el(doc, 'div');
      const inner = el(doc, 'p', {}, [text(doc, TOKEN)]);
      attachShadow(host, [inner]);
      return { targets: [inner, host, inPage(doc, host)], containers: [inner] };
    },
  },
  {
    name: 'open shadow root, BARE text node (audit A2-4)',
    build: (doc) => {
      const host = el(doc, 'div');
      attachShadow(host, [text(doc, TOKEN)]);
      return { targets: [host, inPage(doc, host)], containers: [host] };
    },
  },
  {
    name: 'slotted element into a visible host',
    build: (doc) => {
      const span = el(doc, 'span', {}, [text(doc, TOKEN)]);
      const host = el(doc, 'div', {}, [span]);
      attachShadow(host, [el(doc, 'b', {}, [text(doc, 'x')]), el(doc, 'slot')]);
      return { targets: [span, host, inPage(doc, host)], containers: [span] };
    },
  },
  {
    name: 'slotted BARE text into a wrapper inside the shadow tree',
    build: (doc) => {
      const slot = el(doc, 'slot');
      const wrapper = el(doc, 'div', {}, [slot]);
      const host = el(doc, 'div', {}, [text(doc, TOKEN)]);
      attachShadow(host, [wrapper]);
      return { targets: [wrapper, host, inPage(doc, host)], containers: [wrapper] };
    },
  },
  {
    name: 'nested open shadow roots',
    build: (doc) => {
      const innerHost = el(doc, 'div');
      const p = el(doc, 'p', {}, [text(doc, TOKEN)]);
      attachShadow(innerHost, [p]);
      const outerHost = el(doc, 'div');
      attachShadow(outerHost, [innerHost]);
      return { targets: [p, innerHost, outerHost, inPage(doc, outerHost)], containers: [p] };
    },
  },
  {
    name: 'extremely deep DOM (10050 levels) ending in a shadow host',
    build: (doc) => {
      const p = el(doc, 'p', {}, [text(doc, TOKEN)]);
      const host = el(doc, 'div');
      attachShadow(host, [p]);
      let top = host;
      for (let i = 0; i < 10050; i++) top = el(doc, 'div', {}, [top]);
      return { targets: [top, p, inPage(doc, top)], containers: [p] };
    },
  },
];

describe('FR2-07 fix-2 expect.text: in-frame RENDERED-text matrix (mechanism x placement)', () => {
  for (const pl of placements) {
    it(`${pl.name}: unhidden text is found`, () => {
      const doc = makeDoc();
      pl.build(doc);
      expect(runIn(doc, visibleTextContainsInPage, TOKEN)).toBe(true);
    });
    for (const m of MECHS) {
      it(`${pl.name} x ${m.name}: ${m.counted ? 'COUNTED' : 'excluded'} (on every target)`, () => {
        for (let ti = 0; ; ti++) {
          const doc = makeDoc();
          const { targets, containers } = pl.build(doc);
          if (ti >= targets.length) break;
          if (m.ancestorOnly && containers.includes(targets[ti]!)) continue;
          m.apply(targets[ti]!);
          expect(runIn(doc, visibleTextContainsInPage, TOKEN), `target #${ti}`).toBe(m.counted);
        }
      });
    }
  }

  it('an absent token is not found, and no style is read for it (cheap prefilter)', () => {
    const doc = makeDoc();
    page(doc, [el(doc, 'p', {}, [text(doc, 'nothing here')])]);
    const gcs = vi.fn(doc.defaultView.getComputedStyle);
    doc.defaultView.getComputedStyle = gcs;
    expect(runIn(doc, visibleTextContainsInPage, TOKEN)).toBe(false);
    expect(gcs).not.toHaveBeenCalled();
  });

  it('script/style/template text never counts (skipped, and not laid out)', () => {
    const doc = makeDoc();
    page(doc, [el(doc, 'script', {}, [text(doc, TOKEN)]), el(doc, 'style', {}, [text(doc, TOKEN)])]);
    expect(runIn(doc, visibleTextContainsInPage, TOKEN)).toBe(false);
  });

  it('a display:contents parent is rendered (checkVisibility is false for it, so the nearest boxed ancestor is judged)', () => {
    const doc = makeDoc();
    page(doc, [el(doc, 'div', {}, [el(doc, 'span', { display: 'contents' }, [text(doc, TOKEN)])])]);
    expect(runIn(doc, visibleTextContainsInPage, TOKEN)).toBe(true);
  });

  it('a display:contents host whose shadow tree holds the text is rendered', () => {
    const doc = makeDoc();
    const host = el(doc, 'div', { display: 'contents' });
    attachShadow(host, [el(doc, 'p', {}, [text(doc, TOKEN)])]);
    page(doc, [host]);
    expect(runIn(doc, visibleTextContainsInPage, TOKEN)).toBe(true);
  });

  it('an unslotted light-DOM child (never rendered) does not count', () => {
    const doc = makeDoc();
    const host = el(doc, 'div', {}, [el(doc, 'span', {}, [text(doc, TOKEN)])]);
    attachShadow(host, [el(doc, 'b', {}, [text(doc, 'x')])]);
    page(doc, [host]);
    expect(runIn(doc, visibleTextContainsInPage, TOKEN)).toBe(false);
  });

  it('text that is a DIRECT child of a closed <details> is excluded (checkVisibility() is true for the details itself); its <summary> text and an open details count', () => {
    const closed = makeDoc();
    page(closed, [el(closed, 'details', {}, [text(closed, 'DIRECT-' + TOKEN), el(closed, 'summary', {}, [text(closed, 'SUMMARY-' + TOKEN)])], { open: false })]);
    expect(runIn(closed, visibleTextContainsInPage, 'DIRECT-' + TOKEN)).toBe(false);
    expect(runIn(closed, visibleTextContainsInPage, 'SUMMARY-' + TOKEN)).toBe(true);
    const open = makeDoc();
    page(open, [el(open, 'details', {}, [text(open, 'DIRECT-' + TOKEN)], { open: true })]);
    expect(runIn(open, visibleTextContainsInPage, 'DIRECT-' + TOKEN)).toBe(true);
  });

  it('a visibility:visible child inside a visibility:hidden parent IS rendered (override), its hidden sibling is not', () => {
    const doc = makeDoc();
    page(doc, [
      el(doc, 'div', { visibility: 'hidden' }, [
        el(doc, 'span', { visibility: 'visible' }, [text(doc, 'VIS-' + TOKEN)]),
        el(doc, 'span', {}, [text(doc, 'HID-' + TOKEN)]),
      ]),
    ]);
    expect(runIn(doc, visibleTextContainsInPage, 'VIS-' + TOKEN)).toBe(true);
    expect(runIn(doc, visibleTextContainsInPage, 'HID-' + TOKEN)).toBe(false);
  });

  it('text split over inline siblings matches ("a<b>c</b>" contains "ac"); a hidden half breaks it', () => {
    const doc = makeDoc();
    const half = el(doc, 'span', {}, [text(doc, 'GHIJ')]);
    page(doc, [el(doc, 'p', {}, [text(doc, 'ABCD'), half])]);
    expect(runIn(doc, visibleTextContainsInPage, 'ABCDGHIJ')).toBe(true);
    half.own.visibility = 'hidden';
    expect(runIn(doc, visibleTextContainsInPage, 'ABCDGHIJ')).toBe(false);
  });

  it('text never matches ACROSS a block boundary or a <br> (innerText puts a newline there)', () => {
    const doc = makeDoc();
    page(doc, [el(doc, 'div', {}, [text(doc, 'ABCD')]), el(doc, 'div', {}, [text(doc, 'GHIJ')])]);
    expect(runIn(doc, visibleTextContainsInPage, 'ABCDGHIJ')).toBe(false);
    const doc2 = makeDoc();
    page(doc2, [el(doc2, 'p', {}, [text(doc2, 'ABCD'), el(doc2, 'br'), text(doc2, 'GHIJ')])]);
    expect(runIn(doc2, visibleTextContainsInPage, 'ABCDGHIJ')).toBe(false);
  });

  it('whitespace is collapsed and text-transform is applied (as innerText did)', () => {
    const doc = makeDoc();
    page(doc, [el(doc, 'p', {}, [text(doc, 'Hello     \n   world')]), el(doc, 'p', { textTransform: 'uppercase' }, [text(doc, 'submit')])]);
    expect(runIn(doc, visibleTextContainsInPage, 'Hello world')).toBe(true);
    expect(runIn(doc, visibleTextContainsInPage, 'SUBMIT')).toBe(true);
    expect(runIn(doc, visibleTextContainsInPage, 'submit')).toBe(false);
  });

  it('FAIL CLOSED: an environment without checkVisibility THROWS instead of answering "visible"', () => {
    const doc = makeDoc();
    const p = el(doc, 'p', {}, [text(doc, TOKEN)]);
    page(doc, [p]);
    (p as { checkVisibility?: unknown }).checkVisibility = undefined;
    expect(() => runIn(doc, visibleTextContainsInPage, TOKEN)).toThrow(/checkVisibility/);
  });

  it('FAIL CLOSED: a work budget that runs out THROWS (never "visible" from an exhausted guard)', () => {
    const doc = makeDoc();
    const many: FNode[] = [];
    // 210k candidate text nodes, each a separate match start; every one needs a judgement
    for (let i = 0; i < 210000; i++) many.push(el(doc, 'span', { display: 'none' }, [text(doc, TOKEN)]));
    const wrap = el(doc, 'div', {}, many);
    page(doc, [wrap]);
    expect(() => runIn(doc, visibleTextContainsInPage, TOKEN)).toThrow(/budget/);
  }, 60000);

  it('is fully self-contained: re-created from toString() it answers identically', () => {
    const clone = new Function(`return (${visibleTextContainsInPage.toString()})`)() as typeof visibleTextContainsInPage;
    const shown = makeDoc();
    page(shown, [el(shown, 'p', {}, [text(shown, TOKEN)])]);
    expect(runIn(shown, clone, TOKEN)).toBe(true);
    const hid = makeDoc();
    page(hid, [el(hid, 'p', { display: 'none' }, [text(hid, TOKEN)])]);
    expect(runIn(hid, clone, TOKEN)).toBe(false);
    const cloneEl = new Function(`return (${frameElementRendered.toString()})`)() as typeof frameElementRendered;
    const d = makeDoc();
    const f = el(d, 'iframe', { visibility: 'hidden' });
    page(d, [f]);
    expect(runIn(d, cloneEl, f)).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// Frames: judged from the PARENT side; hung / unreachable frames fail closed.
// ---------------------------------------------------------------------------------------------

interface FrameMock {
  isDetached: () => boolean;
  parentFrame: () => FrameMock | null;
  frameElement: () => Promise<unknown>;
  evaluate: (fn: (...a: any[]) => unknown, ...args: unknown[]) => Promise<unknown>;
  _doc: FDoc;
}
interface FrameOpts {
  parent?: FrameMock;
  element?: FNode | null | 'throw';
  /** evaluate never answers (an out-of-process frame that went quiet) */
  hang?: boolean;
  /** evaluate rejects */
  fail?: boolean;
}
function mkFrame(doc: FDoc, o: FrameOpts = {}): FrameMock {
  const evaluate = vi.fn((fn: (...a: any[]) => unknown, ...args: unknown[]) => {
    if (o.hang) return new Promise(() => {});
    if (o.fail) return Promise.reject(new Error('frame gone'));
    try {
      return Promise.resolve(runIn(doc, fn as any, ...(args as [])));
    } catch (e) {
      return Promise.reject(e);
    }
  });
  const f: FrameMock = {
    _doc: doc,
    isDetached: () => false,
    parentFrame: () => o.parent ?? null,
    frameElement: async () => {
      if (o.element === 'throw') throw new Error('no frame owner');
      if (!o.element) return null;
      const element = o.element;
      return {
        evaluate: async (fn: (...a: any[]) => unknown) => runIn(element.ownerDocument, fn as any, element),
        dispose: async () => undefined,
      };
    },
    evaluate,
  };
  return f;
}
function pageOf(main: FrameMock, others: FrameMock[]) {
  return { frames: () => [main, ...others], mainFrame: () => main, evaluate: vi.fn() };
}
const tabOf = (p: unknown): IBrowserTab => ({ url: 'u', page: p }) as unknown as IBrowserTab;

/** A parent document holding an <iframe> element (wrapped by an ancestor); returns both. */
function parentWithIframe(mainDoc: FDoc): { iframe: FNode; wrap: FNode } {
  const iframe = el(mainDoc, 'iframe');
  const wrap = el(mainDoc, 'div', {}, [el(mainDoc, 'section', {}, [iframe])]);
  page(mainDoc, [el(mainDoc, 'p', {}, [text(mainDoc, 'main text only')]), wrap]);
  return { iframe, wrap };
}
function childDoc(): FDoc {
  const d = makeDoc();
  page(d, [el(d, 'p', {}, [text(d, TOKEN)])]);
  return d;
}

describe('FR2-07 fix-2 expect.text: frames are judged from the PARENT side (mechanism x frame kind)', () => {
  // Kinds only differ in what the real browser does; the mock differs in whether an out-of-process frame
  // that is hidden would hang if entered (observed live: display:none / hidden-ancestor OOPIFs hung).
  const kinds = [
    { name: 'same-origin iframe', hangsWhenHidden: false },
    { name: 'srcdoc iframe', hangsWhenHidden: false },
    { name: 'sandboxed iframe', hangsWhenHidden: false },
    { name: 'cross-origin (out-of-process) iframe', hangsWhenHidden: true },
  ];
  for (const k of kinds) {
    for (const m of MECHS) {
      for (const where of ['on the iframe element', 'on an ancestor of the iframe element']) {
        if (m.ancestorOnly && where === 'on the iframe element') continue;
        it(`${k.name} x ${m.name} ${where}: ${m.counted ? 'found' : 'not-found (answered, never unavailable)'}`, async () => {
          const mainDoc = makeDoc();
          const { iframe, wrap } = parentWithIframe(mainDoc);
          m.apply(where === 'on the iframe element' ? iframe : wrap);
          const main = mkFrame(mainDoc);
          const child = mkFrame(childDoc(), { parent: main, element: iframe, hang: k.hangsWhenHidden && !m.counted });
          const r = await pageContainsVisibleText(tabOf(pageOf(main, [child])), TOKEN);
          expect(r.result).toBe(m.counted ? 'found' : 'not-found');
          if (!m.counted) expect(child.evaluate).not.toHaveBeenCalled(); // a hidden frame is never entered
        }, 10000);
      }
    }
  }

  for (const m of MECHS) {
    if (m.ancestorOnly) continue; // an <iframe> element has no descendants; covered by the ancestor variants above
    it(`nested iframes x ${m.name}: applied to the OUTER frame element hides the text in the INNER frame`, async () => {
      const mainDoc = makeDoc();
      const { iframe: outerEl } = parentWithIframe(mainDoc);
      const midDoc = makeDoc();
      const innerEl = el(midDoc, 'iframe');
      page(midDoc, [innerEl]);
      m.apply(outerEl);
      const main = mkFrame(mainDoc);
      const mid = mkFrame(midDoc, { parent: main, element: outerEl });
      const inner = mkFrame(childDoc(), { parent: mid, element: innerEl });
      const r = await pageContainsVisibleText(tabOf(pageOf(main, [mid, inner])), TOKEN);
      expect(r.result).toBe(m.counted ? 'found' : 'not-found');
    });
    it(`nested iframes x ${m.name}: applied to the INNER frame element too`, async () => {
      const mainDoc = makeDoc();
      const { iframe: outerEl } = parentWithIframe(mainDoc);
      const midDoc = makeDoc();
      const innerEl = el(midDoc, 'iframe');
      page(midDoc, [innerEl]);
      m.apply(innerEl);
      const main = mkFrame(mainDoc);
      const mid = mkFrame(midDoc, { parent: main, element: outerEl });
      const inner = mkFrame(childDoc(), { parent: mid, element: innerEl });
      const r = await pageContainsVisibleText(tabOf(pageOf(main, [mid, inner])), TOKEN);
      expect(r.result).toBe(m.counted ? 'found' : 'not-found');
    });
  }

  it('a visible frame chain finds the text (positive control for every negative above)', async () => {
    const mainDoc = makeDoc();
    const { iframe } = parentWithIframe(mainDoc);
    const main = mkFrame(mainDoc);
    const child = mkFrame(childDoc(), { parent: main, element: iframe });
    expect((await pageContainsVisibleText(tabOf(pageOf(main, [child])), TOKEN)).result).toBe('found');
  });

  it('FAIL CLOSED: a frame whose frame element is unreachable is unavailable, never found and never not-found', async () => {
    for (const element of [null, 'throw'] as const) {
      const mainDoc = makeDoc();
      parentWithIframe(mainDoc);
      const main = mkFrame(mainDoc);
      const child = mkFrame(childDoc(), { parent: main, element });
      const r = await pageContainsVisibleText(tabOf(pageOf(main, [child])), TOKEN);
      expect(r.result).toBe('unavailable');
      expect(child.evaluate).not.toHaveBeenCalled();
    }
  });

  it('FAIL CLOSED: a non-main frame with no parent frame cannot be judged', async () => {
    const mainDoc = makeDoc();
    parentWithIframe(mainDoc);
    const main = mkFrame(mainDoc);
    const orphan = mkFrame(childDoc(), { element: el(mainDoc, 'iframe') });
    expect((await pageContainsVisibleText(tabOf(pageOf(main, [orphan])), TOKEN)).result).toBe('unavailable');
  });

  it('FAIL CLOSED: a frame whose parent chain cannot be judged is unavailable', async () => {
    const mainDoc = makeDoc();
    const { iframe } = parentWithIframe(mainDoc);
    const midDoc = makeDoc();
    const innerEl = el(midDoc, 'iframe');
    page(midDoc, [innerEl]);
    const main = mkFrame(mainDoc);
    const mid = mkFrame(midDoc, { parent: main, element: null });
    const inner = mkFrame(childDoc(), { parent: mid, element: innerEl });
    void iframe;
    expect((await pageContainsVisibleText(tabOf(pageOf(main, [mid, inner])), TOKEN)).result).toBe('unavailable');
  });

  it('an in-frame judgement that throws (no checkVisibility / budget) is unavailable, not found', async () => {
    const mainDoc = makeDoc();
    const p = el(mainDoc, 'p', {}, [text(mainDoc, TOKEN)]);
    page(mainDoc, [p]);
    (p as { checkVisibility?: unknown }).checkVisibility = undefined;
    const main = mkFrame(mainDoc);
    const r = await pageContainsVisibleText(tabOf(pageOf(main, [])), TOKEN);
    expect(r.result).toBe('unavailable');
  });
});

// ---------------------------------------------------------------------------------------------
// Aggregation (audit-2 A2-2): one hung frame must not mask text another frame has.
// ---------------------------------------------------------------------------------------------

describe('FR2-07 fix-2 expect.text: aggregation across frames', () => {
  const textDoc = (t: string): FDoc => {
    const d = makeDoc();
    page(d, [el(d, 'p', {}, [text(d, t)])]);
    return d;
  };
  /** A page: a main frame plus N child frames, every child's frame element rendered. */
  function world(childSpecs: FrameOpts[], mainText = TOKEN) {
    const mainDoc = makeDoc();
    const iframes = childSpecs.map(() => el(mainDoc, 'iframe'));
    page(mainDoc, [el(mainDoc, 'p', {}, [text(mainDoc, mainText)]), ...iframes]);
    const main = mkFrame(mainDoc);
    const kids = childSpecs.map((o, i) => mkFrame(textDoc('child text ' + i), { parent: main, element: iframes[i]!, ...o }));
    return { main, kids, tab: tabOf(pageOf(main, kids)) };
  }

  it('found in the main frame although 8 cross-origin frames never answer (the audit-2 SDK repro): found, without waiting for them', async () => {
    const w = world(Array.from({ length: 8 }, () => ({ hang: true })));
    const t0 = performance.now();
    const r = await pageContainsVisibleText(w.tab, TOKEN);
    const elapsed = performance.now() - t0;
    expect(r.result).toBe('found');
    // generous bound: the per-frame bound is 1500 ms and must NOT have been waited out
    expect(elapsed).toBeLessThan(1200);
  });

  it('found in a LATER frame while an EARLIER frame hangs', async () => {
    const mainDoc = makeDoc();
    const i1 = el(mainDoc, 'iframe');
    const i2 = el(mainDoc, 'iframe');
    page(mainDoc, [i1, i2]);
    const main = mkFrame(mainDoc);
    const hung = mkFrame(textDoc('x'), { parent: main, element: i1, hang: true });
    const good = mkFrame(textDoc(TOKEN), { parent: main, element: i2 });
    const t0 = performance.now();
    const r = await pageContainsVisibleText(tabOf(pageOf(main, [hung, good])), TOKEN);
    expect(r.result).toBe('found');
    expect(performance.now() - t0).toBeLessThan(1200);
  });

  it('found even if another frame REJECTS', async () => {
    const w = world([{ fail: true }, {}], 'nothing');
    const good = w.kids[1]!;
    good._doc.childNodes.length = 0;
    page(good._doc, [el(good._doc, 'p', {}, [text(good._doc, TOKEN)])]);
    expect((await pageContainsVisibleText(w.tab, TOKEN)).result).toBe('found');
  });

  it('text absent everywhere but one frame hung: UNAVAILABLE naming how many answered (never not-found)', async () => {
    const w = world([{ hang: true }, {}], 'nothing here');
    const r = await pageContainsVisibleText(w.tab, TOKEN);
    expect(r.result).toBe('unavailable');
    expect(r.detail).toContain('only 2 of 3 frames answered');
    expect(r.detail).toContain('1 did not answer within 1500ms');
    expect(r.detail).toContain('hung:'); // names WHICH frame went silent (a bare count hid the culprit in the X10 flake)
  }, 10000);

  it('text absent and every frame answered: not-found', async () => {
    const w = world([{}, {}], 'nothing here');
    expect((await pageContainsVisibleText(w.tab, TOKEN)).result).toBe('not-found');
  });

  it('a hung frame leaves no unhandled rejection behind', async () => {
    const unhandled: unknown[] = [];
    const on = (e: unknown): void => void unhandled.push(e);
    process.on('unhandledRejection', on);
    try {
      const w = world([{ hang: true }, { fail: true }], 'nothing here');
      await pageContainsVisibleText(w.tab, TOKEN);
      await new Promise((r) => setTimeout(r, 30));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', on);
    }
  }, 10000);
});
