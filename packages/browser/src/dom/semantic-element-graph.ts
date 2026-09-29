/**
 * @file packages/browser/src/dom/semantic-element-graph.ts
 * @description SemanticElementGraph and element node models for rich DOM accessibility understanding.
 */

import { ElementCandidate, CandidateMatchResult, MatchingStrategy } from './element-candidate.js';

export interface BoundingBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Where a non-main-frame node lives. ABSENT on a {@link SemanticNode} ⇔ the node is in the
 * main frame (whose URL is `SemanticElementGraph.url`) — omitted there so main-frame-only
 * pages keep a byte-identical text listing and JSON payload (FR2-09 D1).
 */
export interface SemanticFrameRef {
  /** 1-based position among the non-main frames this snapshot traversed (main frame first,
   *  then `page.frames()` order). Stable within ONE snapshot only — use `url`/`name` as
   *  durable identity across snapshots. Absent only when the frame could not be matched (the
   *  event-listener pass, rare). */
  readonly index?: number;
  /** Full frame URL (the text listing shows a shortened form via `displayFrameUrl`). */
  readonly url: string;
  /** `frame.name()` — the iframe's `name` attribute / `window.name` at navigation. Omitted
   *  when empty. */
  readonly name?: string;
  /** Index of the parent frame when the parent is itself an iframe; absent when the parent is
   *  the main frame. */
  readonly parentIndex?: number;
}

export type SkippedFrameReason = 'timeout' | 'navigated' | 'error' | 'error-page' | 'frame-limit';

/** A child frame whose content is NOT in this snapshot — listed rather than silently
 *  dropped (FR2-09 D6). */
export interface SkippedFrame {
  readonly index: number;
  readonly url: string;
  /** `frameOrigin(url)` — what the text placeholder shows. */
  readonly origin: string;
  readonly name?: string;
  readonly reason: SkippedFrameReason;
  /** `timeout`: the limit in ms as a string; `error`: first line of the message (≤80 chars). */
  readonly detail?: string;
  /**
   * GAP-154 (FR2-09 fix-3): for `reason: 'error-page'` only, when a real blocked-frame URL was
   * recovered (rather than just Chrome's unhelpful `chrome-error://chromewebdata/`), how much to
   * trust it. `'confirmed'`: read directly from Chrome DevTools Protocol's own
   * `Page.getFrameTree` `unreachableUrl` field via the frame's own CDP session — this is the
   * actual signal Chrome records for "the URL I failed to load here," live-verified correct
   * across a server redirect, an in-frame script redirect, a `target=` navigation, and a direct
   * load. `'likely'`: a fallback used only when `unreachableUrl` wasn't available for this frame
   * — inferred from the parent `<iframe>` element's `src` attribute, which reports the URL the
   * frame was TOLD to load rather than the URL that actually got blocked, and can be wrong after
   * a redirect or `target=` navigation (this was fix-2's GAP-150 remedy, on its own, before this
   * confidence marker existed). Absent when no URL could be recovered at all (both signals
   * failed) — callers then fall back to `frame.url()`'s raw `chrome-error://` value as before.
   */
  readonly urlConfidence?: 'confirmed' | 'likely';
}

export interface SemanticNode {
  readonly id: number;
  readonly tagName: string;
  readonly role?: string;
  readonly accessibleName?: string;
  readonly label?: string;
  readonly placeholder?: string;
  readonly nearbyText?: string;
  readonly value?: string;
  readonly confidence: number;
  readonly boundingBox?: BoundingBox;
  readonly isVisible: boolean;
  readonly isEnabled: boolean;
  /** Present only for nodes inside an iframe — see {@link SemanticFrameRef}. */
  readonly frame?: SemanticFrameRef;
  /** Open-shadow-root host descriptors, outermost → innermost (e.g.
   *  `["app-shell", "card-field#cvc"]`). Display-only descriptors (tag + `#id` or
   *  `.firstClass`), not guaranteed selectors. Absent in light DOM. */
  readonly shadowHosts?: readonly string[];
}

export class SemanticElementGraph {
  public readonly nodes: readonly SemanticNode[];
  public readonly url: string;
  public readonly title: string;
  /** Child frames whose content could not be read this snapshot (timed out, navigated,
   *  errored, browser error page) or that exceeded the frame cap. Empty on a normal page. */
  public readonly skippedFrames: readonly SkippedFrame[];

  public constructor(
    nodes: readonly SemanticNode[] = [],
    url = '',
    title = '',
    skippedFrames: readonly SkippedFrame[] = [],
  ) {
    this.nodes = nodes;
    this.url = url;
    this.title = title;
    this.skippedFrames = skippedFrames;
  }

  public findByRole(role: string, name?: string): SemanticNode | undefined {
    return this.findCandidateByRole(role, name).candidate?.node;
  }

  public findByText(text: string): SemanticNode | undefined {
    return this.findCandidatesByText(text).candidate?.node;
  }

  public findInputByLabel(label: string): SemanticNode | undefined {
    return this.findCandidateInputByLabel(label).candidate?.node;
  }

  public findPrimaryButton(name?: string): SemanticNode | undefined {
    return this.nodes.find((n) => {
      const isBtn = n.tagName === 'BUTTON' || n.role === 'button' || n.tagName === 'A';
      if (!isBtn) return false;
      if (!name) return true;
      return n.accessibleName?.toLowerCase().includes(name.toLowerCase());
    });
  }

  public findCandidatesByText(text: string): CandidateMatchResult {
    const query = text.toLowerCase().trim();
    const candidates: ElementCandidate[] = [];

    for (const n of this.nodes) {
      let score = 0;
      let strategy: MatchingStrategy = 'partial_text';
      let evidence = '';

      if (n.accessibleName?.toLowerCase() === query) {
        score = 0.95;
        strategy = 'exact_accessible_name';
        evidence = `Exact accessible name match: "${n.accessibleName}"`;
      } else if (n.accessibleName?.toLowerCase().includes(query)) {
        score = 0.75;
        strategy = 'partial_text';
        evidence = `Partial accessible name match: "${n.accessibleName}"`;
      } else if (n.label?.toLowerCase().includes(query)) {
        score = 0.7;
        strategy = 'label_attribute';
        evidence = `Label attribute match: "${n.label}"`;
      } else if (n.placeholder?.toLowerCase().includes(query)) {
        score = 0.65;
        strategy = 'placeholder_match';
        evidence = `Placeholder match: "${n.placeholder}"`;
      } else if (n.nearbyText?.toLowerCase().includes(query)) {
        score = 0.55;
        strategy = 'nearby_text_match';
        evidence = `Nearby text match: "${n.nearbyText}"`;
      }

      if (score > 0) {
        const selector = n.accessibleName
          ? `[aria-label="${n.accessibleName}"]`
          : `${n.tagName.toLowerCase()}`;
        candidates.push({
          node: n,
          selector,
          role: n.role,
          accessibleName: n.accessibleName,
          confidence: Math.min(1.0, score * n.confidence),
          evidence,
          matchingStrategy: strategy,
        });
      }
    }

    candidates.sort((a, b) => b.confidence - a.confidence);

    const top = candidates[0];
    return {
      candidate: top,
      alternatives: candidates.slice(1),
      confidence: top?.confidence ?? 0,
      reasoning: top
        ? `Selected top candidate with score ${top.confidence.toFixed(2)} via strategy "${top.matchingStrategy}": ${top.evidence}`
        : `No element candidate found for text "${text}"`,
    };
  }

  public findCandidateByRole(role: string, name?: string): CandidateMatchResult {
    const candidates: ElementCandidate[] = [];

    for (const n of this.nodes) {
      const roleMatch = n.role?.toLowerCase() === role.toLowerCase();
      if (!roleMatch) continue;

      let score = 0.7;
      let evidence = `Role match: ${role}`;

      if (name && n.accessibleName?.toLowerCase().includes(name.toLowerCase())) {
        score = 0.92;
        evidence += ` with name "${n.accessibleName}"`;
      }

      candidates.push({
        node: n,
        selector: `[role="${role}"]`,
        role: n.role,
        accessibleName: n.accessibleName,
        confidence: score * n.confidence,
        evidence,
        matchingStrategy: 'role_match',
      });
    }

    candidates.sort((a, b) => b.confidence - a.confidence);

    const top = candidates[0];
    return {
      candidate: top,
      alternatives: candidates.slice(1),
      confidence: top?.confidence ?? 0,
      reasoning: top
        ? `Selected candidate with confidence ${top.confidence.toFixed(2)} for role "${role}": ${top.evidence}`
        : `No candidate found for role "${role}"`,
    };
  }

  public findCandidateInputByLabel(label: string): CandidateMatchResult {
    const query = label.toLowerCase();
    const candidates: ElementCandidate[] = [];

    for (const n of this.nodes) {
      const isInput = n.tagName === 'INPUT' || n.tagName === 'TEXTAREA' || n.role === 'textbox';
      if (!isInput) continue;

      let score = 0;
      let strategy: MatchingStrategy = 'label_attribute';
      let evidence = '';

      if (n.label?.toLowerCase().includes(query)) {
        score = 0.92;
        strategy = 'label_attribute';
        evidence = `Input label match: "${n.label}"`;
      } else if (n.placeholder?.toLowerCase().includes(query)) {
        score = 0.82;
        strategy = 'placeholder_match';
        evidence = `Input placeholder match: "${n.placeholder}"`;
      } else if (n.accessibleName?.toLowerCase().includes(query)) {
        score = 0.78;
        strategy = 'exact_accessible_name';
        evidence = `Input accessible name match: "${n.accessibleName}"`;
      }

      if (score > 0) {
        candidates.push({
          node: n,
          selector: n.label ? `input[aria-label="${n.label}"]` : 'input',
          role: n.role,
          accessibleName: n.accessibleName,
          confidence: score * n.confidence,
          evidence,
          matchingStrategy: strategy,
        });
      }
    }

    candidates.sort((a, b) => b.confidence - a.confidence);
    const top = candidates[0];

    return {
      candidate: top,
      alternatives: candidates.slice(1),
      confidence: top?.confidence ?? 0,
      reasoning: top
        ? `Selected input candidate with confidence ${top.confidence.toFixed(2)}: ${top.evidence}`
        : `No input candidate found for label "${label}"`,
    };
  }
}
