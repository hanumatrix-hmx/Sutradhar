/**
 * @file packages/browser/tests/unit/dom-semantic-engine.spec.ts
 * @description Unit tests for formatGraphForLlm's interactive-element header/listing consistency.
 */

import { formatGraphForLlm, SemanticElementGraph, SemanticNode } from '../../src/index.js';

function node(overrides: Partial<SemanticNode>): SemanticNode {
  return {
    id: 1,
    tagName: 'BUTTON',
    confidence: 0.8,
    isVisible: true,
    isEnabled: true,
    ...overrides,
  };
}

describe('@sutradhar/browser formatGraphForLlm', () => {
  it('reports a header count that matches the number of listed elements', () => {
    const nodes: SemanticNode[] = [
      node({ id: 1, tagName: 'INPUT', accessibleName: 'Username' }),
      node({ id: 2, tagName: 'INPUT', accessibleName: 'Password' }),
      node({ id: 3, tagName: 'BUTTON', accessibleName: 'Login' }),
      // Non-interactive tags: stamped/counted by buildGraph but must not appear in the listing.
      node({ id: 4, tagName: 'H1', accessibleName: 'Login Page' }),
      node({ id: 5, tagName: 'P', accessibleName: 'Enter your credentials' }),
      node({ id: 6, tagName: 'A', accessibleName: 'Elemental Selenium' }),
    ];
    const graph = new SemanticElementGraph(nodes, 'https://example.com/login', 'Login');

    const formatted = formatGraphForLlm(graph);
    const listedCount = formatted
      .split('\n')
      .filter((line) => /^\[#\d+\]/.test(line)).length;

    const headerMatch = formatted.match(/Interactive elements \((\d+)\):/);
    expect(headerMatch).not.toBeNull();
    const headerCount = Number(headerMatch![1]);

    expect(headerCount).toBe(listedCount);
    expect(headerCount).toBe(4); // INPUT, INPUT, BUTTON, A — not H1/P
  });

  it('excludes elements that are not both nonzero-width and nonzero-height from the listing', () => {
    const nodes: SemanticNode[] = [
      node({ id: 1, tagName: 'BUTTON', accessibleName: 'Visible', isVisible: true }),
      node({ id: 2, tagName: 'BUTTON', accessibleName: 'Degenerate', isVisible: false }),
    ];
    const graph = new SemanticElementGraph(nodes, 'https://example.com', 'Test');

    const formatted = formatGraphForLlm(graph);

    expect(formatted).toContain('"Visible"');
    expect(formatted).not.toContain('"Degenerate"');
  });

  it('includes non-native-tag elements carrying one of the newly-covered ARIA widget roles', () => {
    const nodes: SemanticNode[] = [
      // A <div role="checkbox"> — not a native interactive tag, only discoverable via role.
      node({ id: 1, tagName: 'DIV', role: 'checkbox', accessibleName: 'Accept terms' }),
      node({ id: 2, tagName: 'DIV', role: 'combobox', accessibleName: 'Country' }),
      node({ id: 3, tagName: 'SPAN', role: 'switch', accessibleName: 'Dark mode' }),
      // A plain, non-interactive div with no role — must stay excluded.
      node({ id: 4, tagName: 'DIV', accessibleName: 'Just a wrapper' }),
    ];
    const graph = new SemanticElementGraph(nodes, 'https://example.com', 'Test');

    const formatted = formatGraphForLlm(graph);

    expect(formatted).toContain('"Accept terms"');
    expect(formatted).toContain('"Country"');
    expect(formatted).toContain('"Dark mode"');
    expect(formatted).not.toContain('"Just a wrapper"');

    const headerMatch = formatted.match(/Interactive elements \((\d+)\):/);
    expect(Number(headerMatch![1])).toBe(3);
  });

  it('includes label, summary, role=option, and the synthetic "clickable" role — the field-report remediation Phase 3 additions', () => {
    // Fixes A3: previously only a fixed tag/ARIA-role allowlist reached this listing at all, so
    // even when dom-semantic-engine.ts's scrape selector was extended to catch `<label>`,
    // `<summary>`, `[role="option"]`, and elements matched only via `[onclick]`/`[tabindex]`/the
    // cursor:pointer fallback (tagged with the synthetic "clickable" role), they would have been
    // scraped and stamped but then silently dropped by this exact filter — the real bug the plan
    // calls out to re-check.
    const nodes: SemanticNode[] = [
      node({ id: 1, tagName: 'LABEL', accessibleName: 'Username' }),
      node({ id: 2, tagName: 'SUMMARY', accessibleName: 'More details' }),
      node({ id: 3, tagName: 'DIV', role: 'option', accessibleName: 'Option A' }),
      // A <div onclick="..."> or a cursor:pointer-detected element — no native tag, no ARIA
      // role, so dom-semantic-engine.ts tags it with the synthetic "clickable" role.
      node({ id: 4, tagName: 'DIV', role: 'clickable', accessibleName: 'Archive item' }),
    ];
    const graph = new SemanticElementGraph(nodes, 'https://example.com', 'Test');

    const formatted = formatGraphForLlm(graph);

    expect(formatted).toContain('"Username"');
    expect(formatted).toContain('"More details"');
    expect(formatted).toContain('"Option A"');
    expect(formatted).toContain('"Archive item"');

    const headerMatch = formatted.match(/Interactive elements \((\d+)\):/);
    expect(Number(headerMatch![1])).toBe(4);
  });

  it('still excludes a plain, role-less div even after the Phase 3 additions — the synthetic "clickable" role must be explicitly assigned upstream, not inferred here', () => {
    const nodes: SemanticNode[] = [
      node({ id: 1, tagName: 'DIV', accessibleName: 'Not actually interactive' }),
    ];
    const graph = new SemanticElementGraph(nodes, 'https://example.com', 'Test');

    const formatted = formatGraphForLlm(graph);

    expect(formatted).not.toContain('"Not actually interactive"');
    const headerMatch = formatted.match(/Interactive elements \((\d+)\):/);
    expect(Number(headerMatch![1])).toBe(0);
  });

  describe('verbosity dial (noText / idsOnly)', () => {
    const nodes: SemanticNode[] = [
      node({ id: 7, tagName: 'BUTTON', role: 'button', accessibleName: 'Submit', label: 'Submit the form' }),
      node({ id: 8, tagName: 'INPUT', accessibleName: 'Email', placeholder: 'you@example.com', value: 'x@y.com' }),
    ];
    const graph = new SemanticElementGraph(nodes, 'https://example.com', 'Test');

    it('default (neither option) includes full text/label/placeholder/value', () => {
      const formatted = formatGraphForLlm(graph);
      expect(formatted).toContain('"Submit"');
      expect(formatted).toContain('placeholder="you@example.com"');
      expect(formatted).toContain('value="x@y.com"');
    });

    it('noText: keeps tag+role+id, drops name/label/placeholder/value text', () => {
      const formatted = formatGraphForLlm(graph, 60, { noText: true });
      expect(formatted).toContain('[#7] button');
      expect(formatted).toContain('[#8] input');
      expect(formatted).not.toContain('"Submit"');
      expect(formatted).not.toContain('placeholder=');
      expect(formatted).not.toContain('value=');
      // Header count is unaffected — noText only changes per-line detail, not which/how many
      // elements are listed.
      const headerMatch = formatted.match(/Interactive elements \((\d+)\):/);
      expect(Number(headerMatch![1])).toBe(2);
    });

    it('idsOnly: keeps only the bracketed id, nothing else', () => {
      const formatted = formatGraphForLlm(graph, 60, { idsOnly: true });
      const lines = formatted.split('\n').filter((l) => /^\[#\d+\]/.test(l));
      expect(lines).toEqual(['[#7]', '[#8]']);
      expect(formatted).not.toContain('button');
      expect(formatted).not.toContain('"Submit"');
    });

    it('idsOnly takes precedence when both options are somehow set', () => {
      const formatted = formatGraphForLlm(graph, 60, { noText: true, idsOnly: true });
      const lines = formatted.split('\n').filter((l) => /^\[#\d+\]/.test(l));
      expect(lines).toEqual(['[#7]', '[#8]']);
    });
  });
});
