/**
 * @file packages/capability-runtime/src/snapshot/ax-snapshot.ts
 * @description Accessibility-tree-based page snapshot — an ADDITIVE alternative to
 * `SutradharRuntime.snapshot()`'s `data-sd-node-id` DOM-attribute grounding, not a replacement.
 *
 * The existing snapshot()/click(nodeId) workflow stamps an attribute onto elements at
 * snapshot time and resolves it by that stamp later — if the DOM re-renders between snapshot
 * and action (a very common case: React/Vue re-render, content reflow, a list re-sorting), the
 * stamped id can point at nothing, or worse, a different element that reused the position. This
 * is the real, structural reason the codebase carries generation-stamp/staleness checks
 * (`assertNotStale`) instead of avoiding the problem outright.
 *
 * This snapshot has no such id to go stale — it's read-only. The pairing that actually
 * survives mutation is: read this listing, then act via `clickByRole`/`clickByText`/
 * `typeByLabel`, which already re-resolve by role/text/label AT CALL TIME rather than a stored
 * reference (see the click_by_role fix that made this pairing actually work for implicit
 * roles too, not just explicit role="..." attributes).
 *
 * FR2-09: iframe content (including cross-origin) is now included, via Puppeteer's public
 * `includeIframes` option, grouped under an indented `[iframe "name" (url)]` header at the
 * iframe's position in document order. Bounded by {@link AX_IFRAMES_TIMEOUT_MS} so a busy
 * frame can't stall this the way it used to stall the DOM snapshot (T2/D7's sibling problem) —
 * on timeout or rejection this falls back to the iframe-free read plus an honest note line
 * rather than silently returning nothing or hanging indefinitely. This snapshot carries no
 * shadow-host context and no "not inspectable" placeholders for a failed iframe read (D12):
 * the AX tree is shadow-transparent by design, and Puppeteer's public API swallows a
 * per-iframe AX read failure rather than surfacing it (logged as GAP-new-3/GAP-new-4).
 */
import { orderSnapshotFrames, frameDesignator, displayFrameUrl, sanitizeFrameName } from '@sutradhar/browser';

// A minimal duck-typed view of Puppeteer's Frame/Page — capability-runtime doesn't depend on
// puppeteer-core directly (that's @sutradhar/browser's job); this avoids adding it just for a
// type annotation when the actual `page` object always comes from `requirePage()`.
interface FrameLike {
  url(): string;
  name(): string;
  isDetached(): boolean;
}

interface PageLike {
  accessibility: { snapshot(options?: { interestingOnly?: boolean; includeIframes?: boolean }): Promise<unknown> };
  title(): Promise<string | undefined>;
  url(): string;
  /** Optional so existing duck-typed test pages keep working; real Puppeteer pages have both. */
  frames?(): FrameLike[];
  mainFrame?(): FrameLike;
}

export interface AxNode {
  readonly role: string;
  readonly name: string;
  readonly level?: number;
}

export interface AxSnapshotResult {
  readonly url: string;
  readonly title: string;
  /** Compact, LLM-ready text listing — pair with clickByRole(role, name)/clickByText(name)/
   *  typeByLabel(name, value) to act on what's listed. No ids: nothing here can go stale.
   *  Iframe content is grouped under `[iframe "name" (url)]` headers, indented per nesting
   *  depth; a frame whose iframe-inclusive read timed out or failed adds a trailing note
   *  instead of silently returning main-frame-only content with no explanation. */
  readonly listing: string;
  readonly nodeCount: number;
}

const INTERESTING_ROLES = new Set([
  'button',
  'link',
  'textbox',
  'checkbox',
  'radio',
  'combobox',
  'listbox',
  'option',
  'menuitem',
  'tab',
  'switch',
  'slider',
  'searchbox',
  'heading',
]);

interface AxElementHandleLike {
  contentFrame?(): Promise<FrameLike | null>;
  dispose?(): Promise<void>;
}

interface RawAxNode {
  role?: string;
  name?: string;
  level?: number;
  children?: readonly RawAxNode[];
  /** Present only when the tree was read with `includeIframes: true` and this node's role is
   *  `'Iframe'` — resolves to the frame the iframe embeds (public Puppeteer API). */
  elementHandle?(): Promise<AxElementHandleLike | null>;
}

/** D11 bound on the `includeIframes: true` read. Each iframe's full AX tree is fetched with no
 *  built-in timeout, so a busy OOPIF (the same class of problem the DOM snapshot's
 *  `FRAME_SCRAPE_TIMEOUT_MS` guards against) could otherwise stall this indefinitely. */
export const AX_IFRAMES_TIMEOUT_MS = 5000;

const AX_TIMEOUT_SENTINEL = Symbol('ax-iframes-timeout');

function indent(depth: number): string {
  return '  '.repeat(depth);
}

function raceTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(AX_TIMEOUT_SENTINEL), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

function firstLine(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.split('\n')[0]!.slice(0, 80);
}

interface WalkResult {
  lines: string[];
  count: number;
}

/** Puppeteer's built-in `page.accessibility.snapshot()` — real computed accessibility tree,
 *  including implicit roles (a plain `<button>` reports role "button" without ever declaring
 *  it), unlike the DOM-attribute approach the rest of the codebase's snapshot() uses. */
export async function buildAxSnapshot(page: PageLike): Promise<AxSnapshotResult> {
  let note: string | undefined;
  let tree: RawAxNode | null;

  const iframesPromise = page.accessibility.snapshot({
    interestingOnly: true,
    includeIframes: true,
  }) as Promise<RawAxNode | null>;
  iframesPromise.catch(() => {}); // never let a late-settling abandoned read become unhandled

  try {
    tree = await raceTimeout(iframesPromise, AX_IFRAMES_TIMEOUT_MS);
  } catch (e) {
    // Fallback rejection propagates exactly as today (D11) — no bare-frame content either way.
    tree = (await page.accessibility.snapshot({ interestingOnly: true })) as RawAxNode | null;
    note =
      e === AX_TIMEOUT_SENTINEL
        ? `[iframes not included — reading an iframe's accessibility tree timed out after ${AX_IFRAMES_TIMEOUT_MS}ms]`
        : `[iframes not included — reading an iframe's accessibility tree failed: ${firstLine(e)}]`;
  }

  const order: FrameLike[] =
    page.frames && page.mainFrame ? orderSnapshotFrames(page.frames(), page.mainFrame()) : [];
  const indexOf = new Map<FrameLike, number>();
  order.forEach((f, i) => {
    if (i > 0) indexOf.set(f, i);
  });
  // GAP-146: sanitized, matching frameDesignator's own uniqueness comparison (it sanitizes
  // `ref.name` before comparing) and matching how dom-semantic-engine.ts builds this same list
  // for the DOM snapshot. A raw, unsanitized list here made a frame name over 30 characters (or
  // containing a quote/bracket/newline) render inconsistently between `snapshot` and
  // `ax_snapshot` — unique-looking before sanitization but colliding after, or vice versa.
  const allNames = order
    .slice(1)
    .map((f) => sanitizeFrameName(f.name()))
    .filter(Boolean);

  const nodes: AxNode[] = [];

  async function walk(node: RawAxNode | null, depth: number): Promise<WalkResult> {
    if (!node) return { lines: [], count: 0 };

    if (node.role === 'Iframe') {
      let frame: FrameLike | null = null;
      try {
        const handle = await node.elementHandle?.();
        if (handle) {
          frame = (await handle.contentFrame?.()) ?? null;
          await handle.dispose?.();
        }
      } catch {
        // Unresolvable iframe element handle — fall through with frame = null. D9/D12: the
        // public API can't distinguish "this iframe's AX read failed" from "hidden/empty", so
        // no false placeholder is printed; the header just shows '?' if there's content.
      }

      const childLines: string[] = [];
      let childCount = 0;
      for (const child of node.children ?? []) {
        const r = await walk(child, depth + 1);
        childLines.push(...r.lines);
        childCount += r.count;
      }
      if (childLines.length === 0) {
        // Empty iframe (A4): no header, identical to the pre-FR2-09 listing without it.
        return { lines: [], count: 0 };
      }
      const designator = frame ? frameDesignator({ name: frame.name() || undefined, index: indexOf.get(frame) }, allNames) : '?';
      const urlPart = frame?.url() ? ` (${displayFrameUrl(frame.url())})` : '';
      return { lines: [`${indent(depth)}[iframe ${designator}${urlPart}]`, ...childLines], count: childCount };
    }

    const lines: string[] = [];
    let count = 0;
    if (node.role && INTERESTING_ROLES.has(node.role) && node.name?.trim()) {
      const name = node.name.trim();
      nodes.push({ role: node.role, name, level: node.level });
      count = 1;
      lines.push(
        node.role === 'heading'
          ? `${indent(depth)}${'#'.repeat(Math.min(node.level ?? 2, 6))} ${name}`
          : `${indent(depth)}[${node.role}] "${name}"`,
      );
    }
    for (const child of node.children ?? []) {
      const r = await walk(child, depth);
      lines.push(...r.lines);
      count += r.count;
    }
    return { lines, count };
  }

  const { lines } = await walk(tree, 0);
  if (note) lines.push(note);

  return {
    url: page.url(),
    title: (await page.title().catch(() => '')) ?? '',
    listing: lines.join('\n'),
    nodeCount: nodes.length,
  };
}
