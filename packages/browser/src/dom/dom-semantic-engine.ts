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
 * Scrapes across every same-process-accessible frame (main frame + iframes, at any
 * nesting depth) and pierces open shadow roots within each frame's document, so
 * elements embedded in third-party widgets or shadow-DOM-based component libraries
 * are discoverable. Node ids stay globally unique across all frames combined —
 * callers never need to know which frame an id came from; {@link selectorForNodeId}'s
 * output is resolved back to the right frame (and through any shadow roots) at
 * action time by `BrowserActionEngine`.
 *
 * Known limitation: closed shadow roots are fundamentally inaccessible from outside
 * the page's own script (by design — that's what "closed" means), so elements inside
 * one are invisible to this scraper. Cross-origin iframes that Chrome's site-isolation
 * blocks script access to are skipped rather than failing the whole snapshot.
 */

import { Page, CDPSession } from 'puppeteer-core';
import { IBrowserTab } from '../session/browser-tab.js';
import { SemanticElementGraph } from './semantic-element-graph.js';

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
      const frames = page
        .frames()
        .filter((f) => !f.isDetached())
        .slice(0, MAX_FRAMES);

      const allNodes: ScrapedNode[] = [];
      let nextId = 1;

      for (const frame of frames) {
        try {
          const frameNodes = await frame.evaluate(scrapeFrame, {
            attrName: SD_NODE_ID_ATTR,
            genAttr: SD_GENERATION_ATTR,
            currentGenAttr: SD_CURRENT_GENERATION_ATTR,
            selector: INTERACTIVE_SELECTOR,
            generation,
            startId: nextId,
            maxStamped: MAX_STAMPED_ELEMENTS_PER_FRAME,
            syntheticClickableRole: SYNTHETIC_CLICKABLE_ROLE,
          });
          allNodes.push(...frameNodes);
          nextId += frameNodes.length;
        } catch {
          // Cross-origin-restricted (site-isolated) or navigated-away-mid-scrape frame —
          // skip it rather than failing the whole snapshot over one inaccessible frame.
        }
      }

      if (options.scanEventListeners) {
        const listenerNodes = await this.scanForEventListenerElements(page, nextId, generation);
        allNodes.push(...listenerNodes);
      }

      return new SemanticElementGraph(allNodes, tab.url, tab.title);
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
              { value: SYNTHETIC_CLICKABLE_ROLE },
            ],
            returnByValue: true,
          });
          const node = extracted.result.value as ScrapedNode | null;
          if (node) {
            results.push(node);
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
}

/**
 * Runs inside the page (via `frame.evaluate`) — collects interactive elements including
 * those nested inside open shadow roots, stamps them, and extracts the fields the LLM-facing
 * listing needs. Kept as a standalone top-level function (rather than inline in buildGraph) so
 * its whole closure serializes cleanly across the CDP boundary with the params object below.
 */
function scrapeFrame(params: {
  attrName: string;
  genAttr: string;
  currentGenAttr: string;
  selector: string;
  generation: string;
  startId: number;
  maxStamped: number;
  syntheticClickableRole: string;
}): ScrapedNode[] {
  const { attrName, genAttr, currentGenAttr, selector, generation, startId, maxStamped, syntheticClickableRole } =
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
 */
function extractAndStampEventListenerElement(
  this: Element,
  id: number,
  generation: string,
  attrName: string,
  genAttr: string,
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
} | null {
  const el = this as HTMLElement;
  if (!el || !el.getBoundingClientRect) return null;

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

  let confidence = 0.4; // lower base than the primary pass — a real listener, but no known semantics
  if (name) confidence += 0.3;
  if (hasSize) confidence += 0.05;

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

  const lines: string[] = [];
  for (const n of interactive.slice(0, maxElements)) {
    if (options.idsOnly) {
      lines.push(`[#${n.id}]`);
      continue;
    }
    const tag = n.tagName.toLowerCase();
    const role = n.role && n.role !== tag ? ` role=${n.role}` : '';
    if (options.noText) {
      lines.push(`[#${n.id}] ${tag}${role}`);
      continue;
    }
    const namePart = n.accessibleName ? ` "${n.accessibleName}"` : '';
    const labelPart = n.label && n.label !== n.accessibleName ? ` label="${n.label}"` : '';
    const placeholderPart = n.placeholder ? ` placeholder="${n.placeholder}"` : '';
    const valuePart = n.value ? ` value="${n.value.slice(0, 40)}"` : '';
    lines.push(
      `[#${n.id}] ${tag}${namePart}${role}${labelPart}${placeholderPart}${valuePart}`,
    );
  }
  if (interactive.length > maxElements) {
    lines.push(`... (${interactive.length - maxElements} more elements not shown)`);
  }
  return `${header}\n${lines.join('\n')}`;
}
