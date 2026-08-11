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
 */
// A minimal duck-typed view of Puppeteer's Page — capability-runtime doesn't depend on
// puppeteer-core directly (that's @sutradhar/browser's job); this avoids adding it just for a
// type annotation when the actual `page` object always comes from `requirePage()`.
interface PageLike {
  accessibility: { snapshot(options?: { interestingOnly?: boolean }): Promise<unknown> };
  title(): Promise<string | undefined>;
  url(): string;
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
   *  typeByLabel(name, value) to act on what's listed. No ids: nothing here can go stale. */
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

interface RawAxNode {
  role?: string;
  name?: string;
  level?: number;
  children?: readonly RawAxNode[];
}

function flatten(node: RawAxNode | null, out: AxNode[]): void {
  if (!node) return;
  if (node.role && INTERESTING_ROLES.has(node.role) && node.name?.trim()) {
    out.push({ role: node.role, name: node.name.trim(), level: node.level });
  }
  for (const child of node.children ?? []) {
    flatten(child, out);
  }
}

/** Puppeteer's built-in `page.accessibility.snapshot()` — real computed accessibility tree,
 *  including implicit roles (a plain `<button>` reports role "button" without ever declaring
 *  it), unlike the DOM-attribute approach the rest of the codebase's snapshot() uses. */
export async function buildAxSnapshot(page: PageLike): Promise<AxSnapshotResult> {
  const tree = (await page.accessibility.snapshot({ interestingOnly: true })) as RawAxNode | null;
  const nodes: AxNode[] = [];
  flatten(tree, nodes);

  const lines = nodes.map((n) => {
    if (n.role === 'heading') return `${'#'.repeat(Math.min(n.level ?? 2, 6))} ${n.name}`;
    return `[${n.role}] "${n.name}"`;
  });

  return {
    url: page.url(),
    title: (await page.title().catch(() => '')) ?? '',
    listing: lines.join('\n'),
    nodeCount: nodes.length,
  };
}
