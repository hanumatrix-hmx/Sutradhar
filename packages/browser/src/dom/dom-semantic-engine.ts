/**
 * @file packages/browser/src/dom/dom-semantic-engine.ts
 * @description DOMSemanticEngine analyzing page DOM and producing structured
 * SemanticElementGraph instances.
 *
 * Each interactive element is stamped with a durable `data-sd-node-id` attribute
 * on the live DOM so that an agent (human or LLM) can later target it by id via
 * {@link selectorForNodeId}. This closes the "node id → element" loop that the
 * previous implementation lacked.
 *
 * Scrapes across every frame Puppeteer attaches to (main frame + same-process iframes +
 * out-of-process iframes/OOPIFs, at any nesting depth) and pierces open shadow roots within
 * each frame's document, so elements embedded in third-party widgets, cross-origin embeds
 * (e.g. Stripe Elements), or shadow-DOM-based component libraries are discoverable. Node ids
 * stay globally unique across all frames combined; each node embedded in a non-main frame
 * additionally carries a `frame` reference (see {@link SemanticFrameRef}) so a caller can tell
 * which frame an id came from without needing to — {@link selectorForNodeId}'s output is
 * resolved back to the right frame (and through any shadow roots) at action time by
 * `BrowserActionEngine`.
 *
 * Known limitation: closed shadow roots are fundamentally inaccessible from outside the page's
 * own script (by design — that's what "closed" means), so elements inside one are invisible to
 * this scraper. Cross-origin iframes are NOT skipped as a class — Puppeteer auto-attaches
 * out-of-process iframes and this engine scrapes them like any other frame. What actually gets
 * skipped (and reported as a `skippedFrame` placeholder rather than silently dropped — see
 * {@link SkippedFrame}) is a frame whose scrape timed out, navigated away mid-scrape, threw, or
 * resolved to a browser error page, plus any frame past the {@link MAX_FRAMES} cap.
 */

import { Page, CDPSession, Frame } from 'puppeteer-core';
import { IBrowserTab } from '../session/browser-tab.js';
import { SemanticElementGraph, SemanticFrameRef, SkippedFrame, SkippedFrameReason } from './semantic-element-graph.js';
import {
  orderSnapshotFrames,
  frameOrigin,
  frameDesignator,
  displayFrameUrl,
  formatShadowChain,
  formatSkippedFrameLines,
  sanitizeFrameName,
} from './frame-labels.js';

/** The data attribute stamped on elements to map node ids back to DOM nodes. */
export const SD_NODE_ID_ATTR = 'data-sd-node-id';

/**
 * Stamped on every interactive element alongside {@link SD_NODE_ID_ATTR}, and mirrored onto
 * each frame's `document.documentElement` as that frame's "current generation". Lets an
 * action verify a node id it's about to act on actually belongs to the most recent snapshot
 * rather than an older one whose ids may since have been reassigned to different elements.
 */
export const SD_GENERATION_ATTR = 'data-sd-gen';

/** The attribute on `document.documentElement` holding the page's current stamp generation. */
export const SD_CURRENT_GENERATION_ATTR = 'data-sd-current-gen';

/**
 * A short snapshot-time text fingerprint stamped alongside {@link SD_NODE_ID_ATTR}. The
 * generation check alone (`SD_GENERATION_ATTR`) only catches staleness caused by a NEW
 * snapshot being taken — it says nothing about a virtualized/windowed list (react-window,
 * MUI DataGrid, etc.) recycling the same DOM node for a different logical row via scroll,
 * with no new snapshot involved at all. Found live (PROB-036): a node id captured for "Row 0"
 * silently and confidently clicked "Row 50" after a scroll, because the recycled DOM node kept
 * its original id/generation attributes untouched — only its text content changed. Comparing
 * this fingerprint against the element's live text at act time catches that case without
 * needing any virtualization-specific detection.
 */
export const SD_FINGERPRINT_ATTR = 'data-sd-fp';

/**
 * ARIA/tag combination treated as "interactive" for both scraping and the LLM-facing listing.
 * `[onclick]`, `[tabindex]:not([tabindex="-1"])`, and `[contenteditable]` (excluding an explicit
 * `contenteditable="false"`) catch elements whose only signal of interactivity is a DOM attribute
 * rather than a native tag or ARIA role — e.g. a `<div onclick="...">` acting as a button. `label`
 * and `summary` are natively actionable (a label focuses/activates its associated control; a
 * `<summary>` toggles its parent `<details>`) but neither is a native form control nor carries an
 * ARIA widget role, so both were previously invisible to this selector.
 */
const INTERACTIVE_SELECTOR =
  'a, button, input, select, textarea, label, summary, ' +
  '[role="button"], [role="link"], [role="textbox"], [role="combobox"], [role="tab"], ' +
  '[role="menuitem"], [role="checkbox"], [role="radio"], [role="switch"], [role="dialog"], ' +
  '[role="option"], ' +
  '[onclick], [tabindex]:not([tabindex="-1"]), [contenteditable]:not([contenteditable="false"]), ' +
  'h1, h2, h3, p';

/** Elements matched only by `[onclick]`/`[tabindex]`/cursor-pointer-fallback (no native tag or
 *  explicit ARIA role) are tagged with this synthetic role — not a real ARIA role, but a clear
 *  signal to a listing consumer that the element is clickable without overclaiming what kind of
 *  control it is. */
const SYNTHETIC_CLICKABLE_ROLE = 'clickable';

/** ARIA roles counted as interactive regardless of tag name (e.g. a `<div role="checkbox">`). */
const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'textbox',
  'combobox',
  'tab',
  'menuitem',
  'checkbox',
  'radio',
  'switch',
  'option',
  SYNTHETIC_CLICKABLE_ROLE,
]);

/** Hard cap on frames scraped per snapshot, guarding against runaway cost on ad-heavy pages. */
const MAX_FRAMES = 20;

/**
 * Hard cap on interactive elements stamped with an id per frame per snapshot. Elements beyond
 * this never get a `data-sd-node-id` at all, so they're unreachable via numeric-id targeting
 * (only via a raw CSS selector) no matter what `maxElements` is passed to
 * {@link formatGraphForLlm} — that only controls how many of the *stamped* elements are listed
 * in the text a caller reads. Content-heavy real pages routinely exceed the old default of 150
 * (e.g. a single Hacker News front page has 227 interactive elements) — 300 gives real headroom
 * while still bounding the cost of stamping a pathological page.
 */
const MAX_STAMPED_ELEMENTS_PER_FRAME = 300;

/**
 * Bound on how long a single CHILD frame's scrape may take (FR2-09 D7). The main frame is
 * never timed out — if the main document hangs, no listing is useful anyway. A real child-frame
 * scrape takes milliseconds (the repo's own measurement: `snapshot()` ~3ms), so 5s is 100x+
 * headroom for even a heavy iframe app, while bounding what used to be an unbounded stall on a
 * busy renderer (e.g. a busy out-of-process iframe).
 */
const FRAME_SCRAPE_TIMEOUT_MS = 5000;

/** Sentinel rejection reason used by {@link raceFrameTimeout} to signal "the frame's scrape did
 *  not finish in time", distinguishable from a real evaluate() rejection. */
const FRAME_TIMEOUT = Symbol('frame-scrape-timeout');

/**
 * Races `promise` against a timeout, rejecting with the {@link FRAME_TIMEOUT} sentinel if the
 * timeout wins. The original `promise` is left running — the caller attaches its own
 * `.catch(() => {})` before racing so a late rejection never becomes an unhandled rejection.
 */
function raceFrameTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(FRAME_TIMEOUT), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** GAP-154 (fix-3) bound on the CDP `Page.getFrameTree` round-trip used to read a blocked
 *  frame's real target via `unreachableUrl`. Live measurement (audit-4, see
 *  `.ai/loop/field-report-2/evidence/FR2-09/audit-4/live-busy-parent-timing.txt` and
 *  `live-audit4-normal.txt`) found this resolves in ~15ms for 3 blocked children under a busy
 *  parent and ~28ms for 7 blocked frames overall, for both the isolated-OOPIF-session case and
 *  the same-process (whole-tree) case, but it still crosses a real CDP IPC boundary, so — same
 *  reasoning as fix-2's original bound — it gets a short, generous timeout rather than none at
 *  all. Kept at fix-2's original 1000ms value since measurement didn't show a need to change it.
 */
const BLOCKED_FRAME_URL_TIMEOUT_MS = 1000;

/** GAP-150 bound on {@link recoverBlockedFrameSrc}'s `frameElement()`/`el.src` read — this runs
 *  entirely in the PARENT frame's realm (never touches the blocked frame itself), and live
 *  measurement found it resolves in 2-5ms, but it still awaits a CDP round-trip, so it gets a
 *  short, generous timeout rather than none at all. Only used as GAP-154's fallback now, when
 *  {@link recoverBlockedFrameUnreachableUrl} can't produce a confirmed answer. */
const BLOCKED_FRAME_SRC_TIMEOUT_MS = 1000;

/** Minimal structural shape of a CDP `Page.getFrameTree` response node — just the fields this
 *  module reads, so it doesn't need to import `devtools-protocol` types directly. The real
 *  response (whatever `CDPSession.send('Page.getFrameTree')` resolves to) satisfies this. */
interface CdpFrameTreeNode {
  readonly frame: { readonly id: string; readonly unreachableUrl?: string };
  readonly childFrames?: readonly CdpFrameTreeNode[];
}

/** Depth-first search for the tree node whose CDP frame id matches `frameId`. A frame's own
 *  isolated CDP session (the common case for a cross-origin/OOPIF blocked frame — see
 *  `probe-unreachableUrl.mjs` evidence) returns a single-node tree that already IS the match; a
 *  same-process blocked frame's session is the whole page's session, whose tree has the match
 *  somewhere among the children — this walks either shape. */
function findFrameTreeNode(tree: CdpFrameTreeNode, frameId: string): CdpFrameTreeNode | undefined {
  if (tree.frame.id === frameId) return tree;
  for (const child of tree.childFrames ?? []) {
    const found = findFrameTreeNode(child, frameId);
    if (found) return found;
  }
  return undefined;
}

/**
 * GAP-154 (fix-3, the primary signal): recover a blocked child frame's real intended URL from
 * Chrome's own CDP `unreachableUrl` field — "the URL I failed to load here," recorded by Chrome
 * itself, not inferred from a DOM attribute. Reads `Page.getFrameTree` on the frame's OWN CDP
 * session (`frame.client`), which for an isolated (OOPIF) blocked frame returns just that one
 * frame as the tree's root, and for a same-process blocked frame returns the whole page's tree
 * — {@link findFrameTreeNode} handles both by matching on the frame's CDP id (`frame._id`,
 * Puppeteer's internal mirror of the same id CDP uses). Live-confirmed correct in all 4 tested
 * cases (fix-3 verification): a direct load, a server 302 redirect, an in-frame script
 * redirect, and a `target=` link navigation — see
 * `.ai/loop/field-report-2/evidence/FR2-09/fix-3/live-fix3-cdp-cases.txt`. Returns `undefined`
 * (never throws) if the field is absent, the read times out, or anything else goes wrong —
 * callers fall back to {@link recoverBlockedFrameSrc}.
 */
async function recoverBlockedFrameUnreachableUrl(frame: Frame): Promise<string | undefined> {
  try {
    // `frame.client` (a per-frame CDPSession) and `frame._id` (the CDP frame id Puppeteer
    // mirrors internally) are both real, stable getters/fields on Puppeteer's Frame class —
    // confirmed live by audit-3's probe-unreachableUrl.mjs — but both are tagged `@internal` in
    // Puppeteer's source and so are stripped from the ROLLED-UP public `.d.ts` this project's
    // tsc resolves against (they're still present in Puppeteer's own per-file declarations).
    // There is no supported public-API equivalent: `page.createCDPSession()` attaches to the
    // main page's target only, not an out-of-process child frame's own target, which is exactly
    // the case (a cross-origin/OOPIF blocked frame) this recovery most needs to handle. The
    // cast below is a narrow, defensively-guarded reach for a real runtime API that just isn't
    // in the public type surface — every failure mode (property missing, wrong shape, send()
    // throwing) is caught and falls back to {@link recoverBlockedFrameSrc}, never surfaced.
    const { client, _id: frameId } = frame as unknown as { client?: CDPSession; _id?: string };
    if (!client || !frameId) return undefined;
    const result = await raceFrameTimeout(
      client.send('Page.getFrameTree') as Promise<{ frameTree: CdpFrameTreeNode }>,
      BLOCKED_FRAME_URL_TIMEOUT_MS,
    );
    const node = findFrameTreeNode(result.frameTree, frameId);
    const url = node?.frame.unreachableUrl;
    return typeof url === 'string' && url ? url : undefined;
  } catch {
    return undefined;
  }
}

/**
 * GAP-150 (fix-2)'s original remedy, kept only as GAP-154 (fix-3)'s FALLBACK when
 * {@link recoverBlockedFrameUnreachableUrl} can't produce a CDP-confirmed answer (older Chrome
 * without the field, or the CDP read itself failing). Recovers a blocked child frame's URL from
 * the PARENT page's `<iframe>` element's `src` attribute, without touching the blocked frame's
 * own (inaccessible) realm. This is the URL the frame was TOLD to load, NOT necessarily the URL
 * that actually got blocked — after a server redirect, an in-frame script redirect, or a
 * `target=` link navigation, it can report a false origin (live-reproduced by audit-3, 3/3).
 * Callers MUST mark a result from this path with lower confidence (`urlConfidence: 'likely'`)
 * rather than presenting it with the same certainty as a CDP-confirmed URL. Returns `undefined`
 * (never throws) if the frame has no element handle (already detached), the read times out, or
 * anything else goes wrong — callers fall back to `frame.url()` as before.
 */
async function recoverBlockedFrameSrc(frame: Frame): Promise<string | undefined> {
  try {
    const handle = await raceFrameTimeout(frame.frameElement(), BLOCKED_FRAME_SRC_TIMEOUT_MS);
    if (!handle) return undefined;
    try {
      const src = await raceFrameTimeout(handle.evaluate((el: { src?: string }) => el.src), BLOCKED_FRAME_SRC_TIMEOUT_MS);
      return typeof src === 'string' && src ? src : undefined;
    } finally {
      await handle.dispose().catch(() => {});
    }
  } catch {
    return undefined;
  }
}

/** Result of {@link recoverBlockedFrameUrl}: a recovered URL plus how much to trust it. */
interface RecoveredFrameUrl {
  readonly url: string;
  readonly confidence: 'confirmed' | 'likely';
}

/**
 * GAP-154 (fix-3): the combined recovery used by {@link DOMSemanticEngine.buildGraph} for a
 * blocked child frame. Tries the CDP `unreachableUrl` signal first (confirmed); only when that
 * produces nothing falls back to the `frameElement()`/`src` read (likely, may be stale — see
 * {@link recoverBlockedFrameSrc}). Returns `undefined` when neither signal produces a URL.
 */
async function recoverBlockedFrameUrl(frame: Frame): Promise<RecoveredFrameUrl | undefined> {
  const confirmed = await recoverBlockedFrameUnreachableUrl(frame);
  if (confirmed) return { url: confirmed, confidence: 'confirmed' };
  const likely = await recoverBlockedFrameSrc(frame);
  if (likely) return { url: likely, confidence: 'likely' };
  return undefined;
}

/**
 * CSS selector for candidates considered by the opt-in event-listener-based fallback scan (see
 * {@link BuildGraphOptions.scanEventListeners}) — plausible containers for a JS-library-driven
 * widget (a sortable list item, a custom drag handle, a virtualized-grid row) that carries none
 * of `INTERACTIVE_SELECTOR`'s signals. `:not([${SD_NODE_ID_ATTR}])` excludes anything the
 * primary pass already stamped, so the two passes never double-count the same element.
 */
const EVENT_LISTENER_CANDIDATE_TAGS = ['div', 'span', 'li', 'td', 'tr', 'ul', 'ol', 'section', 'article', 'img'];

/** Real DOM event types treated as "this element is genuinely interactive", checked against
 *  `DOMDebugger.getEventListeners`' real, attached listeners — not a proxy or a guess. */
const INTERACTION_LISTENER_TYPES = new Set(['click', 'mousedown', 'pointerdown', 'touchstart', 'dragstart']);

/** Hard cap on `DOMDebugger.getEventListeners` CDP round trips per snapshot — each is a real
 *  IPC call to the browser process, meaningfully slower than the primary in-page-JS pass, so
 *  this bounds the cost on a page with thousands of candidate elements rather than checking
 *  every one of them. */
const MAX_EVENT_LISTENER_CANDIDATES = 150;

/** Returns the CSS selector that uniquely targets the element stamped with `nodeId`. */
export function selectorForNodeId(nodeId: number): string {
  return `[${SD_NODE_ID_ATTR}="${nodeId}"]`;
}

export interface BuildGraphOptions {
  /**
   * Opt-in: also run a CDP `DOMDebugger.getEventListeners`-based pass to find elements whose
   * ONLY interactivity signal is a JS `addEventListener`-attached handler — no `onclick=`,
   * ARIA role, `tabindex`, or `cursor:pointer` styling (PROB-013's exact, previously-deferred
   * gap). Real libraries exist that attach raw `pointerdown`/`mousedown`/`dragstart` handlers
   * with zero CSS/ARIA signal at all (found live: SortableJS-based drag lists, a real, common
   * pattern behind admin dashboards and kanban boards). Off by default — each candidate costs
   * a real CDP round trip, so this is meaningfully slower than the primary pass and should be
   * reached for only when the default snapshot doesn't find what's needed.
   */
  scanEventListeners?: boolean;
}

export interface IDOMSemanticEngine {
  buildGraph(tab: IBrowserTab, options?: BuildGraphOptions): Promise<SemanticElementGraph>;
}

export class DOMSemanticEngine implements IDOMSemanticEngine {
  public async buildGraph(tab: IBrowserTab, options: BuildGraphOptions = {}): Promise<SemanticElementGraph> {
    const page: Page | undefined = tab.page;

    if (!page) {
      // No real page available (e.g. a mock tab in unit tests). Return an empty
      // graph rather than fabricated elements so callers fail loudly.
      return new SemanticElementGraph([], tab.url, tab.title);
    }

    try {
      const generation = String(Date.now());
      const main = page.mainFrame();
      // D3: main frame always first, then page.frames() order, filtered of detached frames
      // (the main frame is never filtered even if isDetached() would say otherwise).
      const ordered = orderSnapshotFrames(page.frames(), main);
      const indexOf = new Map<Frame, number>();
      ordered.forEach((f, i) => {
        if (i > 0) indexOf.set(f, i);
      });
      const refOf = (frame: Frame): SemanticFrameRef => {
        const parent = frame.parentFrame();
        const parentIndex = parent ? indexOf.get(parent) : undefined;
        const name = frame.name() || undefined;
        return {
          index: indexOf.get(frame),
          url: frame.url(),
          ...(name ? { name } : {}),
          ...(parentIndex !== undefined ? { parentIndex } : {}),
        };
      };
      const skippedOf = (
        frame: Frame,
        reason: SkippedFrameReason,
        detail?: string,
        urlOverride?: string,
        urlConfidence?: 'confirmed' | 'likely',
      ): SkippedFrame => {
        const name = frame.name() || undefined;
        // GAP-150/GAP-154: when the caller recovered the frame's real intended URL (see
        // recoverBlockedFrameUrl), use it for both `url` and the displayed `origin` instead of
        // Chrome's own unhelpful chrome-error:// value — `urlConfidence` records whether that
        // recovery is CDP-confirmed or just a likely guess from the parent's iframe src.
        const url = urlOverride ?? frame.url();
        return {
          index: indexOf.get(frame) ?? 0,
          url,
          origin: frameOrigin(url),
          ...(name ? { name } : {}),
          reason,
          ...(detail !== undefined ? { detail } : {}),
          ...(urlConfidence ? { urlConfidence } : {}),
        };
      };
      const firstLine = (e: unknown): string => {
        const msg = e instanceof Error ? e.message : String(e);
        return msg.split('\n')[0]!.slice(0, 80);
      };

      const allNodes: ScrapedNode[] = [];
      const skipped: SkippedFrame[] = [];
      let nextId = 1;

      for (const frame of ordered.slice(0, MAX_FRAMES)) {
        const isMain = frame === main;
        const scrape = frame.evaluate(scrapeFrame, {
          attrName: SD_NODE_ID_ATTR,
          genAttr: SD_GENERATION_ATTR,
          currentGenAttr: SD_CURRENT_GENERATION_ATTR,
          fpAttr: SD_FINGERPRINT_ATTR,
          selector: INTERACTIVE_SELECTOR,
          generation,
          startId: nextId,
          maxStamped: MAX_STAMPED_ELEMENTS_PER_FRAME,
          syntheticClickableRole: SYNTHETIC_CLICKABLE_ROLE,
        });
        // An abandoned (timed-out) scrape must never surface as an unhandled rejection once it
        // eventually settles (the PROB-015 pattern).
        scrape.catch(() => {});
        try {
          const frameNodes = isMain ? await scrape : await raceFrameTimeout(scrape, FRAME_SCRAPE_TIMEOUT_MS);
          // D8: a child frame that resolved to a browser error page (X-Frame-Options, etc.) —
          // discard its nodes but keep the ids reserved (nextId already needs to advance).
          if (!isMain && frame.url().startsWith('chrome-error://')) {
            nextId += frameNodes.length;
            // GAP-154 (fix-3): try to recover the real intended URL — first via Chrome's own
            // CDP unreachableUrl signal (confirmed), falling back to the parent page's
            // iframe-src read (likely, may be stale) only if that fails — before falling back
            // further to the unhelpful chrome-error:// value. See recoverBlockedFrameUrl.
            const recovered = await recoverBlockedFrameUrl(frame);
            skipped.push(skippedOf(frame, 'error-page', undefined, recovered?.url, recovered?.confidence));
            continue;
          }
          const ref = isMain ? undefined : refOf(frame);
          allNodes.push(...(ref ? frameNodes.map((n) => ({ ...n, frame: ref })) : frameNodes));
          nextId += frameNodes.length;
        } catch (e) {
          if (e === FRAME_TIMEOUT) {
            // D7: reserve this frame's whole id range so a late-completing scrape can't stamp
            // ids that collide with anything else in this snapshot.
            nextId += MAX_STAMPED_ELEMENTS_PER_FRAME;
            skipped.push(skippedOf(frame, 'timeout', String(FRAME_SCRAPE_TIMEOUT_MS)));
            continue;
          }
          // The main frame keeps today's behavior: a failure there skips silently rather than
          // failing the whole snapshot. A frame that's detached by now is simply gone — listing
          // it as "not inspectable" would be false, so it's dropped silently too (D6).
          if (isMain || frame.isDetached()) continue;
          const msg = firstLine(e);
          const reason: SkippedFrameReason = /Execution context was destroyed|Cannot find context|navigat/i.test(
            msg,
          )
            ? 'navigated'
            : 'error';
          skipped.push(skippedOf(frame, reason, msg));
        }
      }
      for (const frame of ordered.slice(MAX_FRAMES)) {
        skipped.push(skippedOf(frame, 'frame-limit'));
      }

      if (options.scanEventListeners) {
        const listenerNodes = await this.scanForEventListenerElements(page, nextId, generation, ordered, indexOf);
        allNodes.push(...listenerNodes);
      }

      // Read `document.title` live rather than `tab.title` (a cache kept in sync only by the
      // page's 'load' event) — an SPA route change via `history.pushState` never fires 'load',
      // and neither does a bare `document.title = ...` assignment, so the cache goes stale for
      // any title update outside a real full navigation. Found live: after two SPA-style title
      // changes with no real navigation, `snapshot()` still reported the page's very first,
      // long-outdated title. `tab.url` already reads live the same way; title now matches.
      const liveTitle = await page.title().catch(() => tab.title);
      return new SemanticElementGraph(allNodes, tab.url, liveTitle, skipped);
    } catch {
      return new SemanticElementGraph([], tab.url, tab.title);
    }
  }

  /**
   * Real event-listener introspection via CDP, as a bounded, opt-in fallback for elements the
   * primary attribute/style-based pass structurally cannot see (see {@link BuildGraphOptions}).
   * Runs entirely within one CDP session so `Runtime.RemoteObject` ids stay valid throughout —
   * `DOM.getDocument({pierce:true})` + `DOM.querySelectorAll` (which also crosses same-process
   * iframes and open shadow roots in one call, unlike the per-frame Puppeteer loop above) find
   * candidates, `DOM.resolveNode` gets each a real object id, `DOMDebugger.getEventListeners`
   * checks for a genuine interaction listener, and `Runtime.callFunctionOn` stamps + extracts
   * fields for real matches — the CDP-native equivalent of `ElementHandle.evaluate()`, without
   * needing a Puppeteer handle (whose `objectId` would belong to a different session).
   */
  private async scanForEventListenerElements(
    page: Page,
    startId: number,
    generation: string,
    orderedFrames: readonly Frame[] = [],
    indexOf: ReadonlyMap<Frame, number> = new Map(),
  ): Promise<ScrapedNode[]> {
    const results: ScrapedNode[] = [];
    let client: CDPSession | undefined;
    try {
      client = await page.target().createCDPSession();
      await client.send('DOM.enable');
      await client.send('Runtime.enable');

      const { root } = await client.send('DOM.getDocument', { depth: -1, pierce: true });
      const selector = EVENT_LISTENER_CANDIDATE_TAGS.map((tag) => `${tag}:not([${SD_NODE_ID_ATTR}])`).join(', ');
      const { nodeIds } = await client.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector });

      let nextId = startId;
      for (const nodeId of nodeIds.slice(0, MAX_EVENT_LISTENER_CANDIDATES)) {
        try {
          const { object } = await client.send('DOM.resolveNode', { nodeId });
          if (!object.objectId) continue;

          const { listeners } = await client.send('DOMDebugger.getEventListeners', { objectId: object.objectId });
          const hasInteractionListener = listeners.some((l) => INTERACTION_LISTENER_TYPES.has(l.type));
          if (!hasInteractionListener) continue;

          const extracted = await client.send('Runtime.callFunctionOn', {
            objectId: object.objectId,
            functionDeclaration: extractAndStampEventListenerElement.toString(),
            arguments: [
              { value: nextId },
              { value: generation },
              { value: SD_NODE_ID_ATTR },
              { value: SD_GENERATION_ATTR },
              { value: SD_FINGERPRINT_ATTR },
              { value: SYNTHETIC_CLICKABLE_ROLE },
            ],
            returnByValue: true,
          });
          const raw = extracted.result.value as
            | (ScrapedNode & { frameUrl: string; frameName: string; isTopFrame: boolean })
            | null;
          if (raw) {
            const { frameUrl, frameName, isTopFrame, ...node } = raw;
            const frame = isTopFrame
              ? undefined
              : (() => {
                  const match = orderedFrames.find((f) => f.url() === frameUrl && (f.name() || '') === frameName);
                  if (match) {
                    const idx = indexOf.get(match);
                    const name = match.name() || undefined;
                    return { index: idx, url: frameUrl, ...(name ? { name } : {}) };
                  }
                  return frameUrl || frameName ? { url: frameUrl, ...(frameName ? { name: frameName } : {}) } : undefined;
                })();
            results.push(frame ? { ...node, frame } : node);
            nextId++;
          }
        } catch {
          // This one candidate failed to resolve/inspect (detached mid-scan, cross-origin,
          // etc.) — skip it, not the whole pass.
        }
      }
    } catch {
      // No CDP session / DOM domain unavailable for this page (e.g. a mock tab in tests) —
      // return whatever was found before the failure (normally nothing).
    } finally {
      if (client) await client.detach().catch(() => {});
    }
    return results;
  }
}

/** Shape returned per element by {@link scrapeFrame}, matching {@link SemanticNode}. */
interface ScrapedNode {
  id: number;
  tagName: string;
  role: string;
  accessibleName?: string;
  label?: string;
  placeholder?: string;
  nearbyText?: string;
  value?: string;
  confidence: number;
  boundingBox: { x: number; y: number; width: number; height: number };
  isVisible: boolean;
  isEnabled: boolean;
  /** Open-shadow-root host descriptors, outermost → innermost. Absent in light DOM. */
  shadowHosts?: string[];
  /** Attached by `buildGraph` after `scrapeFrame` returns (frame identity isn't knowable
   *  in-page) — absent for main-frame nodes. See {@link SemanticFrameRef}. */
  frame?: SemanticFrameRef;
}

/**
 * Runs inside the page (via `frame.evaluate`) — collects interactive elements including
 * those nested inside open shadow roots, stamps them, and extracts the fields the LLM-facing
 * listing needs. Kept as a standalone top-level function (rather than inline in buildGraph) so
 * its whole closure serializes cleanly across the CDP boundary with the params object below.
 *
 * @internal exported for unit tests; runs in-page, must stay self-contained (no closure over
 * anything outside this function — see the FR2-06 D8 precedent for why: it's serialized via
 * `.toString()` and re-run inside the page, so any outer reference would be `undefined` there).
 */
export function scrapeFrame(params: {
  attrName: string;
  genAttr: string;
  currentGenAttr: string;
  fpAttr: string;
  selector: string;
  generation: string;
  startId: number;
  maxStamped: number;
  syntheticClickableRole: string;
}): ScrapedNode[] {
  const { attrName, genAttr, currentGenAttr, fpAttr, selector, generation, startId, maxStamped, syntheticClickableRole } =
    params;

  // Recursively collect matches from `root` and from every open shadow root nested within it.
  // Closed shadow roots have no accessible `.shadowRoot` property from outside — genuinely
  // unreachable, not a bug.
  //
  // Also applies a `cursor: pointer` computed-style fallback for elements the attribute-based
  // `selector` still misses — the common remaining case being a handler attached purely via
  // `addEventListener` (no `onclick=`, `role=`, or `tabindex`). This is a pragmatic proxy, not a
  // real fix: genuinely detecting `addEventListener`-attached handlers needs CDP
  // `DOMDebugger.getEventListeners`, a materially larger change than this file's scope (logged as
  // PROB-013 in .ai/known-problems.md). `cursor:pointer` catches most real "this looks and acts
  // clickable" cases without it.
  // FR2-09 D2: display-only descriptor for a shadow host — tag name, plus #id or .firstClass
  // when present, sanitized to [A-Za-z0-9_-] and capped so a page-controlled id/class can't
  // grow the label unboundedly or inject stray characters into the listing.
  function describeHost(h: Element): string {
    const tag = h.tagName.toLowerCase();
    const id = (h.id || '').replace(/[^\w-]/g, '').slice(0, 30);
    const cls =
      typeof (h as HTMLElement).className === 'string'
        ? ((h as HTMLElement).className.trim().split(/\s+/)[0] || '').replace(/[^\w-]/g, '').slice(0, 30)
        : '';
    return (tag + (id ? `#${id}` : cls ? `.${cls}` : '')).slice(0, 40);
  }
  // Walks outward from `el` through every open shadow root it's nested in, collecting a host
  // descriptor at each level. Duck-typed on `.host` (a Document has none), so it stops at the
  // real document root. A closed shadow root's boundary is invisible from here (no `.host` on
  // its root) — that's a real, by-design limit, not a bug.
  function shadowHostsOf(el: Element): string[] | undefined {
    const chain: string[] = [];
    let root: Node = el.getRootNode();
    while (root && (root as ShadowRoot).host) {
      const host = (root as ShadowRoot).host;
      chain.unshift(describeHost(host));
      root = host.getRootNode();
    }
    return chain.length ? chain : undefined;
  }

  function collect(root: ParentNode, out: Element[]): void {
    const all = Array.from(root.querySelectorAll('*'));
    const matchedSet = new Set<Element>();
    const cursorPointerCandidates: Element[] = [];

    for (const el of all) {
      if (el.matches(selector)) {
        out.push(el);
        matchedSet.add(el);
      } else if (getComputedStyle(el).cursor === 'pointer') {
        cursorPointerCandidates.push(el);
      }
      const shadow = (el as HTMLElement).shadowRoot;
      if (shadow) collect(shadow, out);
    }

    // `cursor` is an inherited CSS property, so every descendant of a clickable container
    // (icons, text spans) also computes cursor:pointer — without pruning, each one would be
    // stamped as its own separate interactive element. Keep only the outermost cursor:pointer
    // element in a given subtree, and drop any already nested inside a selector-matched
    // element (its own click target already covers them).
    const cursorPointerSet = new Set(cursorPointerCandidates);
    for (const el of cursorPointerCandidates) {
      let ancestor = el.parentElement;
      let nested = false;
      while (ancestor) {
        if (matchedSet.has(ancestor) || cursorPointerSet.has(ancestor)) {
          nested = true;
          break;
        }
        ancestor = ancestor.parentElement;
      }
      if (!nested) out.push(el);
    }
  }

  const elements: Element[] = [];
  collect(document, elements);

  document.documentElement.setAttribute(currentGenAttr, generation);

  // Clear stale ids from a previous snapshot so ids never collide with old (potentially
  // detached, or now-shadow-nested-differently) elements.
  for (const el of elements) {
    el.removeAttribute(attrName);
    el.removeAttribute(genAttr);
    el.removeAttribute(fpAttr);
  }

  return elements.slice(0, maxStamped).map((elUntyped, idx) => {
    const el = elUntyped as HTMLElement;
    const inputEl = el as HTMLInputElement;
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    const id = startId + idx;

    // Stamp this element with a durable id so we can re-find it later, and the current
    // generation so a later action can detect it's targeting a stale (superseded) id.
    el.setAttribute(attrName, String(id));
    el.setAttribute(genAttr, generation);

    const parentText = el.parentElement?.innerText?.slice(0, 100) || undefined;
    // `h1`/`h2`/`h3`/`p` are matched by `selector` purely to carry page-structure context —
    // formatGraphForLlm deliberately excludes plain headings/paragraphs from the clickable
    // listing (they're prose, not targets). But a heading/paragraph CAN also be the real click
    // target, e.g. a modal's "Close" often IS a bare `<p>` styled with `cursor:pointer` and an
    // `addEventListener` handler (found live: the-internet.herokuapp.com/entry_ad's modal —
    // exactly GLM's original UC-06a report). Without this check, such an element would be
    // stamped (it matches the selector) yet silently excluded from the listing purely because
    // of its tag name — reproducing the same "modal blind spot" bug this phase set out to fix,
    // just moved one layer down. So: an explicit interaction signal on a context-only tag wins
    // over treating it as prose.
    const CONTEXT_ONLY_TAGS = new Set(['H1', 'H2', 'H3', 'P']);
    const hasExplicitInteractionSignal =
      el.hasAttribute('onclick') ||
      (el.hasAttribute('tabindex') && el.getAttribute('tabindex') !== '-1') ||
      (el.hasAttribute('contenteditable') && el.getAttribute('contenteditable') !== 'false') ||
      style.cursor === 'pointer';

    // Explicit ARIA role wins. Failing that, a contenteditable region's implicit ARIA role is
    // "textbox" per the HTML-AAM spec. Failing that: a genuine heading/paragraph (no interaction
    // signal) keeps its own tag name as a non-actionable context role; a heading/paragraph WITH
    // an interaction signal, or any other native tag from the selector's own fixed list
    // (a/button/input/select/textarea/label/summary), uses the appropriate role. Anything left
    // was matched only via `[onclick]`/`[tabindex]`/the cursor:pointer fallback — a real element
    // to act on, but not one with any actual ARIA semantics, so it's tagged with the synthetic
    // "clickable" marker instead of silently inheriting a misleading tag-name-as-role.
    let role: string;
    if (el.getAttribute('role')) {
      role = el.getAttribute('role')!;
    } else if (el.isContentEditable) {
      role = 'textbox';
    } else if (CONTEXT_ONLY_TAGS.has(el.tagName)) {
      role = hasExplicitInteractionSignal ? syntheticClickableRole : el.tagName.toLowerCase();
    } else if (el.matches('a, button, input, select, textarea, label, summary')) {
      role = el.tagName.toLowerCase();
    } else {
      role = syntheticClickableRole;
    }
    const name =
      el.getAttribute('aria-label') ||
      el.innerText?.slice(0, 100) ||
      inputEl.placeholder ||
      inputEl.value ||
      undefined;
    const label =
      inputEl.labels?.[0]?.innerText ||
      el.getAttribute('aria-label') ||
      inputEl.placeholder ||
      undefined;

    // Snapshot-time text fingerprint (see SD_FINGERPRINT_ATTR's doc comment) — lets a later
    // action detect that this exact DOM node now represents different content than it did at
    // snapshot time (virtualized-list row recycling), even though its id/generation attributes
    // never changed because no new snapshot was taken.
    el.setAttribute(fpAttr, (name || '').trim().slice(0, 60));

    // A nonzero bounding box alone is not "visible" — an element can occupy real layout space
    // while being `visibility:hidden` or `opacity:0`, both of which leave `rect` unchanged (only
    // `display:none` collapses it, which the rect check already catches). Fixes a real false
    // positive: a `visibility:hidden` element with no fallback rect used to be listed as if
    // clickable, and clicking it would silently miss (nothing there for the browser to hit).
    const hasSize = rect.width > 0 && rect.height > 0;
    const isVisible =
      hasSize &&
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.visibility !== 'collapse' &&
      parseFloat(style.opacity || '1') !== 0;

    // Confidence heuristic
    let confidence = 0.5;
    if (name) confidence += 0.3;
    if (label) confidence += 0.15;
    if (hasSize) confidence += 0.05;

    const hosts = shadowHostsOf(el);

    return {
      id,
      tagName: el.tagName,
      role,
      accessibleName: name ? name.trim() : undefined,
      label: label ? label.trim() : undefined,
      placeholder: inputEl.placeholder || undefined,
      nearbyText: parentText ? parentText.trim() : undefined,
      value: inputEl.value || undefined,
      confidence: Math.min(1.0, confidence),
      boundingBox: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      },
      isVisible,
      isEnabled: !inputEl.disabled,
      ...(hosts ? { shadowHosts: hosts } : {}),
    };
  });
}

/**
 * Runs via CDP `Runtime.callFunctionOn` (`this` bound to the candidate element) — the
 * CDP-native equivalent of `elementHandle.evaluate()`, used because the candidate's real
 * `objectId` comes from a CDP session {@link DOMSemanticEngine.scanForEventListenerElements}
 * creates itself, not from a Puppeteer `ElementHandle` (whose `objectId` belongs to a
 * different session and wouldn't resolve here). Only called for elements already confirmed to
 * have a real interaction listener attached — this stamps + extracts the same fields
 * {@link scrapeFrame} does for its own matches, at a lower base confidence since a genuine
 * event listener existing says nothing about the element's semantic role, unlike a native tag
 * or explicit ARIA attribute.
 *
 * @internal exported for unit tests; runs via CDP `Runtime.callFunctionOn` with `this` bound to
 * the candidate element (see the call site) — must stay self-contained like {@link scrapeFrame}.
 */
export function extractAndStampEventListenerElement(
  this: Element,
  id: number,
  generation: string,
  attrName: string,
  genAttr: string,
  fpAttr: string,
  syntheticRole: string,
): {
  id: number;
  tagName: string;
  role: string;
  accessibleName?: string;
  value?: string;
  confidence: number;
  boundingBox: { x: number; y: number; width: number; height: number };
  isVisible: boolean;
  isEnabled: boolean;
  shadowHosts?: string[];
  /** In-page frame identity — resolved back to a {@link SemanticFrameRef} by the caller, since
   *  frame identity (index) isn't knowable from inside the page itself. */
  frameUrl: string;
  frameName: string;
  isTopFrame: boolean;
} | null {
  const el = this as HTMLElement;
  if (!el || !el.getBoundingClientRect) return null;

  // Duplicated from scrapeFrame's inner helpers of the same name (each function must
  // serialize on its own via .toString() — this is the same existing precedent as
  // scrapeFrame's own duplicated isVisible logic).
  function describeHost(h: Element): string {
    const tag = h.tagName.toLowerCase();
    const hid = (h.id || '').replace(/[^\w-]/g, '').slice(0, 30);
    const cls =
      typeof (h as HTMLElement).className === 'string'
        ? ((h as HTMLElement).className.trim().split(/\s+/)[0] || '').replace(/[^\w-]/g, '').slice(0, 30)
        : '';
    return (tag + (hid ? `#${hid}` : cls ? `.${cls}` : '')).slice(0, 40);
  }
  function shadowHostsOf(node: Element): string[] | undefined {
    const chain: string[] = [];
    let root: Node = node.getRootNode();
    while (root && (root as ShadowRoot).host) {
      const host = (root as ShadowRoot).host;
      chain.unshift(describeHost(host));
      root = host.getRootNode();
    }
    return chain.length ? chain : undefined;
  }

  const rect = el.getBoundingClientRect();
  const style = getComputedStyle(el);
  const hasSize = rect.width > 0 && rect.height > 0;
  const isVisible =
    hasSize &&
    style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    style.visibility !== 'collapse' &&
    parseFloat(style.opacity || '1') !== 0;

  el.setAttribute(attrName, String(id));
  el.setAttribute(genAttr, generation);

  const inputEl = el as HTMLInputElement;
  const name = el.getAttribute('aria-label') || el.innerText?.slice(0, 100) || inputEl.placeholder || inputEl.value || undefined;
  el.setAttribute(fpAttr, (name || '').trim().slice(0, 60));

  let confidence = 0.4; // lower base than the primary pass — a real listener, but no known semantics
  if (name) confidence += 0.3;
  if (hasSize) confidence += 0.05;

  const hosts = shadowHostsOf(el);

  return {
    id,
    tagName: el.tagName,
    role: el.getAttribute('role') || syntheticRole,
    accessibleName: name ? name.trim() : undefined,
    value: inputEl.value || undefined,
    confidence: Math.min(0.85, confidence), // capped below the primary pass's max — heuristic, not certain
    boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    isVisible,
    isEnabled: !inputEl.disabled,
    ...(hosts ? { shadowHosts: hosts } : {}),
    frameUrl: location.href,
    frameName: window.name,
    isTopFrame: window === window.top,
  };
}

/**
 * Renders a {@link SemanticElementGraph} into a compact, LLM-friendly text listing
 * of the interactive elements, capped to `maxElements` to stay within token budgets.
 *
 * Example line:
 *   [#7] button "Search"  (role=button)
 *   [#8] input[search] placeholder="Search Wikipedia"
 */
export interface FormatGraphOptions {
  /** Drop accessible-name/label/placeholder/value text from each line, keeping tag+role+id —
   *  for a caller that already knows what it's targeting (e.g. from a prior full snapshot or
   *  `axSnapshot`) and just needs fresh ids after a re-render, not to re-read every label's
   *  text again. Roughly halves listing size on a typical page. */
  readonly noText?: boolean;
  /** Drop everything except the bracketed id — `[#7]` with no tag/role/text at all. The
   *  minimum needed to target an element by numeric id; most aggressive token savings, at the
   *  cost of the listing no longer being self-describing (a caller needs another source, e.g.
   *  a prior full snapshot, to know what each id actually is). Implies `noText`. */
  readonly idsOnly?: boolean;
}

export function formatGraphForLlm(
  graph: SemanticElementGraph,
  maxElements = 60,
  options: FormatGraphOptions = {},
): string {
  const interactiveTags = new Set(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'OPTION', 'LABEL', 'SUMMARY']);
  const interactive = graph.nodes.filter(
    (n) =>
      n.isVisible &&
      n.isEnabled &&
      (interactiveTags.has(n.tagName) || (!!n.role && INTERACTIVE_ROLES.has(n.role))),
  );
  const header = `URL: ${graph.url}\nTitle: ${graph.title}\nInteractive elements (${interactive.length}):`;

  // FR2-09 D4: every SemanticFrameRef in the graph (listed nodes + skipped frames), for
  // computing whether a frame's name is unique enough to show instead of its bare index.
  const seenFrameKeys = new Set<string>();
  const allFrameNames: string[] = [];
  const addFrameName = (key: string, name: string | undefined) => {
    if (!name || seenFrameKeys.has(key)) return;
    seenFrameKeys.add(key);
    allFrameNames.push(name);
  };
  for (const n of graph.nodes) {
    if (n.frame) addFrameName(n.frame.index !== undefined ? `i${n.frame.index}` : `u${n.frame.url}`, n.frame.name);
  }
  for (const s of graph.skippedFrames ?? []) {
    addFrameName(`i${s.index}`, s.name);
  }
  const sanitizedNames = allFrameNames.map((n) => sanitizeFrameName(n)).filter(Boolean);

  // D4: the frame's URL is shown once — on the first LISTED node of that frame — keyed by
  // frame index when known, else by URL.
  const urlShown = new Set<string>();

  const lines: string[] = [];
  for (const n of interactive.slice(0, maxElements)) {
    if (options.idsOnly) {
      lines.push(`[#${n.id}]`);
      continue;
    }
    let where = '';
    if (n.frame) {
      where = ` in iframe ${frameDesignator(n.frame, sanitizedNames)}`;
      const key = n.frame.index !== undefined ? `i${n.frame.index}` : `u${n.frame.url}`;
      if (!options.noText && !urlShown.has(key)) {
        where += ` (${displayFrameUrl(n.frame.url)})`;
        urlShown.add(key);
      }
    }
    const idPart = `[#${n.id}${where}]`;
    const tag = n.tagName.toLowerCase();
    const role = n.role && n.role !== tag ? ` role=${n.role}` : '';
    if (options.noText) {
      lines.push(`${idPart} ${tag}${role}`);
      continue;
    }
    const namePart = n.accessibleName ? ` "${n.accessibleName}"` : '';
    const labelPart = n.label && n.label !== n.accessibleName ? ` label="${n.label}"` : '';
    const placeholderPart = n.placeholder ? ` placeholder="${n.placeholder}"` : '';
    const valuePart = n.value ? ` value="${n.value.slice(0, 40)}"` : '';
    const shadowPart = n.shadowHosts?.length ? ` (shadow: ${formatShadowChain(n.shadowHosts)})` : '';
    lines.push(
      `${idPart} ${tag}${namePart}${role}${labelPart}${placeholderPart}${valuePart}${shadowPart}`,
    );
  }
  if (interactive.length > maxElements) {
    lines.push(`... (${interactive.length - maxElements} more elements not shown)`);
  }
  lines.push(...formatSkippedFrameLines(graph.skippedFrames ?? [], MAX_FRAMES));
  return `${header}\n${lines.join('\n')}`;
}
