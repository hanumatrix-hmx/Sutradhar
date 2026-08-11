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

describe('@pinchtab/browser formatGraphForLlm', () => {
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
});
