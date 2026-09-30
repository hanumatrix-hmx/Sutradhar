// FR2-07 fix-2: the INDEPENDENT ground-truth observer for `expect.text` ("is this text RENDERED?").
// It is deliberately written differently from the product (packages/browser/src/verifier/execution-verifier.ts):
// the product asks the platform (Element.checkVisibility + computed visibility on the container); this oracle WALKS
// the flat-tree ancestors reading computed display / visibility / content-visibility and the closed-<details> rule
// itself, and it never imports or calls the product function. Both use Range client rects for "is it laid out".
// Frames: the oracle takes each frame's element via puppeteer `frame.frameElement()` ONLY to identify it, then judges
// that element with its own ancestor walk, and never enters a frame it judged hidden (evaluate inside a hidden
// out-of-process frame can hang, which is what made the old X11 observer flaky).

/** In-page (self-contained): does this document hold `tok` in a text node that is rendered? */
export function oracleTextInFrame(tok) {
  const flatParent = (n) => {
    if (n.assignedSlot) return n.assignedSlot;
    if (n.parentElement) return n.parentElement;
    const r = n.getRootNode();
    return r && r.host ? r.host : null;
  };
  const insideOpenSummaryPath = (a, prev) => prev && prev.localName === 'summary' && prev.parentElement === a;
  const rendered = (tn) => {
    const rg = document.createRange();
    rg.selectNodeContents(tn);
    let area = false;
    for (const r of rg.getClientRects()) if (r.width > 0 && r.height > 0) area = true;
    if (!area) return false;
    const c = flatParent(tn);
    if (!c) return false;
    if (getComputedStyle(c).visibility !== 'visible') return false;
    let prev = null;
    for (let a = c; a; prev = a, a = flatParent(a)) {
      const cs = getComputedStyle(a);
      if (cs.display === 'none') return false;
      if (cs.contentVisibility === 'hidden') return false;
      if (a.localName === 'details' && !a.open && !insideOpenSummaryPath(a, prev)) return false;
    }
    return true;
  };
  const stack = [document];
  while (stack.length) {
    const n = stack.pop();
    if (n.nodeType === 3) {
      if (n.data.includes(tok) && rendered(n)) return true;
      continue;
    }
    if (n.nodeType === 1 && (n.localName === 'script' || n.localName === 'style')) continue;
    if (n.nodeType === 1 && n.shadowRoot) for (const k of n.shadowRoot.childNodes) stack.push(k);
    for (const k of n.childNodes) stack.push(k);
  }
  return false;
}

/** In-page, run ON a frame element in its parent document: is the embedded frame shown? (ancestor walk) */
export function oracleFrameShown(el) {
  const flatParent = (n) => {
    if (n.assignedSlot) return n.assignedSlot;
    if (n.parentElement) return n.parentElement;
    const r = n.getRootNode();
    return r && r.host ? r.host : null;
  };
  const b = el.getBoundingClientRect();
  if (!(b.width > 0 && b.height > 0)) return false;
  if (getComputedStyle(el).visibility !== 'visible') return false;
  let prev = null;
  for (let a = el; a; prev = a, a = flatParent(a)) {
    const cs = getComputedStyle(a);
    if (cs.display === 'none') return false;
    // content-visibility:hidden on the <iframe> ITSELF also hides it (spike3-cv-iframe: Chrome paints nothing for it)
    if (cs.contentVisibility === 'hidden') return false;
    if (a.localName === 'details' && !a.open && !(prev && prev.localName === 'summary' && prev.parentElement === a)) return false;
  }
  return true;
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const within = (p, ms) => Promise.race([p, delay(ms).then(() => ({ __timeout: true }))]);

/**
 * Ground truth for `tok` across every frame of a puppeteer `page`.
 * @returns {{found:boolean, frames:Array<{url:string, main:boolean, shown:string, text?:boolean}>, hung:number}}
 */
export async function oracleTruth(page, tok, { frameBudgetMs = 4000 } = {}) {
  const main = page.mainFrame();
  const shownMemo = new Map();
  const shown = (f) => {
    if (f === main) return Promise.resolve('shown');
    if (shownMemo.has(f)) return shownMemo.get(f);
    const p = (async () => {
      const parent = f.parentFrame();
      if (!parent) return 'unknown';
      let h;
      try {
        h = await f.frameElement();
        if (!h) return 'unknown';
        const r = await within(h.evaluate(oracleFrameShown), frameBudgetMs);
        if (r && r.__timeout) return 'unknown';
        if (r !== true) return 'hidden';
      } catch {
        return 'unknown';
      } finally {
        try { await h?.dispose(); } catch { /* gone */ }
      }
      return shown(parent);
    })();
    shownMemo.set(f, p);
    return p;
  };
  const rows = await Promise.all(
    page.frames().map(async (f) => {
      const row = { url: f.url().slice(0, 90), main: f === main, shown: await shown(f) };
      if (row.shown === 'shown') {
        const r = await within(f.evaluate(oracleTextInFrame, tok).catch(() => ({ __error: true })), frameBudgetMs);
        if (r && (r.__timeout || r.__error)) row.shown = 'hung';
        else row.text = r === true;
      }
      return row;
    }),
  );
  return { found: rows.some((r) => r.text === true), frames: rows, hung: rows.filter((r) => r.shown === 'hung' || r.shown === 'unknown').length };
}
