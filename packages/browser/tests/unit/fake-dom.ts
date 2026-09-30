/**
 * @file packages/browser/tests/unit/fake-dom.ts
 * @description A tiny fake DOM + rendering model for FR2-07 `expect.text` unit tests. It models ONLY the
 * platform primitives the contract relies on, exactly as the Chrome spike (evidence/FR2-07/fix-2/spike*.log)
 * observed them, so the in-page function can be exercised without a browser:
 *   - Range client rects: none under display:none (and for unslotted light DOM); NON-empty for
 *     content-visibility:hidden and closed-<details> content (the spike found this); zero-area for font-size:0.
 *   - computed visibility is inherited through the FLAT tree (slot, then parent, then shadow host).
 *   - checkVisibility(): false for display:contents itself, for anything with a display:none flat ancestor
 *     and for anything below an element that skips its contents (content-visibility:hidden / closed details).
 * The REAL browser behaviour is proven by the live matrix (tools/scenario-suite/verify-fr2-07-verification.mjs).
 */

export interface Sty {
  display?: string;
  visibility?: string;
  contentVisibility?: string;
  textTransform?: string;
}
export interface FNode {
  nodeType: 1 | 3 | 9 | 11;
  tagName?: string;
  data?: string;
  childNodes: FNode[];
  parentNode: FNode | null;
  own: Sty;
  /** closed-<details> analogue / content-visibility:hidden: descendants are skipped */
  skipsContents?: boolean;
  /** font-size:0 analogue (text rects have zero area) or a 0x0 frame element */
  zeroArea?: boolean;
  shadowRoot?: FNode | null;
  host?: FNode;
  ownerDocument: FDoc;
  [k: string]: any;
}
export interface FDoc extends FNode {
  defaultView: { getComputedStyle: (e: FNode) => Record<string, string> };
  createRange: () => { n?: FNode; selectNodeContents: (n: FNode) => void; getClientRects: () => Array<{ width: number; height: number }> };
}

const INLINE = new Set(['SPAN', 'B', 'I', 'A', 'EM', 'STRONG']);

const flatParentOf = (n: FNode): FNode | null => {
  const slot = assignedSlotOf(n);
  if (slot) return slot;
  if (n.parentNode && n.parentNode.nodeType === 1) return n.parentNode;
  const root = rootOf(n);
  return root && root.host ? root.host : null;
};
function rootOf(n: FNode): FNode {
  let c = n;
  while (c.parentNode) c = c.parentNode;
  return c;
}
function firstSlot(root: FNode): FNode | null {
  const stack = [...root.childNodes].reverse();
  while (stack.length > 0) {
    const c = stack.pop() as FNode;
    if (c.nodeType !== 1) continue;
    if (c.tagName === 'SLOT') return c;
    for (let i = c.childNodes.length - 1; i >= 0; i--) stack.push(c.childNodes[i]!);
  }
  return null;
}
function assignedSlotOf(n: FNode): FNode | null {
  const p = n.parentNode;
  if (!p || p.nodeType !== 1 || !p.shadowRoot) return null;
  return firstSlot(p.shadowRoot);
}
const displayOf = (e: FNode): string => e.own.display ?? (e.tagName === 'SLOT' ? 'contents' : INLINE.has(e.tagName ?? '') ? 'inline' : 'block');
function visibilityOf(e: FNode): string {
  let c: FNode | null = e;
  while (c) {
    if (c.own.visibility) return c.own.visibility;
    c = flatParentOf(c);
  }
  return 'visible';
}
/** has a layout box chain: no display:none flat ancestor, and never an unslotted light child of a shadow host */
function boxed(n: FNode): boolean {
  let c: FNode | null = n;
  while (c) {
    if (c.nodeType === 1 && displayOf(c) === 'none') return false;
    if (c.parentNode && c.parentNode.nodeType === 1 && c.parentNode.shadowRoot && !assignedSlotOf(c)) return false;
    c = flatParentOf(c);
  }
  return true;
}
function checkVisibility(e: FNode): boolean {
  if (!boxed(e) || displayOf(e) === 'contents') return false;
  let c = flatParentOf(e);
  while (c) {
    if (c.skipsContents || c.own.contentVisibility === 'hidden') return false;
    c = flatParentOf(c);
  }
  return true;
}
function hasZeroAreaAncestor(n: FNode): boolean {
  let c: FNode | null = n;
  while (c) {
    if (c.zeroArea) return true;
    c = flatParentOf(c);
  }
  return false;
}

export function makeDoc(): FDoc {
  const doc = {
    nodeType: 9,
    childNodes: [],
    parentNode: null,
    own: {},
    ownerDocument: undefined as unknown as FDoc,
  } as unknown as FDoc;
  doc.ownerDocument = doc;
  doc.defaultView = {
    getComputedStyle: (e: FNode) => ({
      display: displayOf(e),
      visibility: visibilityOf(e),
      contentVisibility: e.own.contentVisibility ?? 'visible',
      textTransform: e.own.textTransform ?? 'none',
    }),
  };
  doc.createRange = () => {
    const r = {
      n: undefined as FNode | undefined,
      selectNodeContents(n: FNode) {
        r.n = n;
      },
      getClientRects() {
        const n = r.n as FNode;
        const c = flatParentOf(n);
        if (!c || !boxed(n) || (n.nodeType === 3 && !boxed(c))) return [];
        return [{ width: hasZeroAreaAncestor(n) ? 0 : 40, height: 10 }];
      },
    };
    return r;
  };
  return doc;
}

export function el(doc: FDoc, tag: string, own: Sty = {}, kids: FNode[] = [], extra: Partial<FNode> = {}): FNode {
  const n = { nodeType: 1, tagName: tag.toUpperCase(), own, childNodes: [], parentNode: null, shadowRoot: null, ownerDocument: doc, ...extra } as FNode;
  Object.defineProperty(n, 'parentElement', { get: () => (n.parentNode && n.parentNode.nodeType === 1 ? n.parentNode : null) });
  Object.defineProperty(n, 'assignedSlot', { get: () => assignedSlotOf(n) });
  n.getRootNode = () => rootOf(n);
  n.checkVisibility = () => checkVisibility(n);
  n.assignedNodes = () => {
    const root = rootOf(n);
    const host = root.host;
    return host && firstSlot(root) === n ? [...host.childNodes] : [];
  };
  n.getBoundingClientRect = () => ({ width: !boxed(n) || hasZeroAreaAncestor(n) ? 0 : 100, height: !boxed(n) || hasZeroAreaAncestor(n) ? 0 : 50 });
  n.getClientRects = () => (boxed(n) ? [{}] : []);
  for (const k of kids) append(n, k);
  return n;
}
export function text(doc: FDoc, data: string): FNode {
  const n = { nodeType: 3, data, childNodes: [], parentNode: null, own: {}, ownerDocument: doc } as unknown as FNode;
  Object.defineProperty(n, 'parentElement', { get: () => (n.parentNode && n.parentNode.nodeType === 1 ? n.parentNode : null) });
  Object.defineProperty(n, 'assignedSlot', { get: () => assignedSlotOf(n) });
  n.getRootNode = () => rootOf(n);
  return n;
}
export function append(parent: FNode, kid: FNode): FNode {
  kid.parentNode = parent;
  parent.childNodes.push(kid);
  return kid;
}
/** Attach an open shadow root holding `kids` to `host`. */
export function attachShadow(host: FNode, kids: FNode[]): FNode {
  const sr = { nodeType: 11, childNodes: [], parentNode: null, own: {}, host, ownerDocument: host.ownerDocument } as unknown as FNode;
  sr.getRootNode = () => sr;
  host.shadowRoot = sr;
  for (const k of kids) append(sr, k);
  return sr;
}
/** A fresh document whose body holds `kids`. */
export function page(doc: FDoc, kids: FNode[]): FDoc {
  const html = el(doc, 'html', {}, [el(doc, 'body', {}, kids)]);
  append(doc, html);
  return doc;
}

/** Run an in-page function against `doc` (globals swapped for the call; the function is synchronous). */
export function runIn<A extends unknown[], R>(doc: FDoc, fn: (...a: A) => R, ...args: A): R {
  const g = globalThis as Record<string, unknown>;
  const prevDoc = g.document;
  const prevWin = g.window;
  g.document = doc;
  g.window = doc.defaultView;
  try {
    return fn(...args);
  } finally {
    g.document = prevDoc;
    g.window = prevWin;
  }
}
