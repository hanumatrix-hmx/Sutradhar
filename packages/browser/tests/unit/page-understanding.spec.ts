/**
 * @file packages/browser/tests/unit/page-understanding.spec.ts
 * @description Unit test suite verifying PageUnderstandingEngine classification across 6 target website categories.
 */

import { PageUnderstandingEngine } from '../../src/page/page-understanding-engine.js';
import { SemanticElementGraph, SemanticNode } from '../../src/dom/semantic-element-graph.js';

describe('Engineering Iteration 4 — Page Understanding Engine Unit Tests', () => {
  let engine: PageUnderstandingEngine;

  beforeEach(() => {
    engine = new PageUnderstandingEngine();
  });

  it('1. should classify GitHub login page as Authentication type', () => {
    const nodes: SemanticNode[] = [
      {
        id: 1,
        tagName: 'INPUT',
        role: 'textbox',
        label: 'Username or email address',
        confidence: 0.95,
        isVisible: true,
        isEnabled: true,
      },
      {
        id: 2,
        tagName: 'INPUT',
        role: 'textbox',
        label: 'Password',
        confidence: 0.95,
        isVisible: true,
        isEnabled: true,
      },
      {
        id: 3,
        tagName: 'BUTTON',
        role: 'button',
        accessibleName: 'Sign in',
        confidence: 0.98,
        isVisible: true,
        isEnabled: true,
      },
    ];

    const graph = new SemanticElementGraph(
      nodes,
      'https://github.com/login',
      'Sign in to GitHub · GitHub',
    );
    const pageModel = engine.analyzePage(graph);

    expect(pageModel.pageType).toBe('Authentication');
    expect(pageModel.primaryIntent).toContain('authentication');
    expect(pageModel.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('2. should classify Google search page as Search type', () => {
    const nodes: SemanticNode[] = [
      {
        id: 1,
        tagName: 'TEXTAREA',
        role: 'textbox',
        label: 'Search',
        confidence: 0.95,
        isVisible: true,
        isEnabled: true,
      },
    ];

    const graph = new SemanticElementGraph(nodes, 'https://www.google.com', 'Google');
    const pageModel = engine.analyzePage(graph);

    expect(pageModel.pageType).toBe('Search');
    expect(pageModel.primaryIntent).toContain('search');
  });

  it('3. should classify GitHub repository page as Repository type', () => {
    const nodes: SemanticNode[] = [
      {
        id: 1,
        tagName: 'A',
        role: 'link',
        accessibleName: 'README.md',
        confidence: 0.9,
        isVisible: true,
        isEnabled: true,
      },
    ];

    const graph = new SemanticElementGraph(
      nodes,
      'https://github.com/microsoft/TypeScript/releases',
      'Releases · microsoft/TypeScript',
    );
    const pageModel = engine.analyzePage(graph);

    expect(pageModel.pageType).toBe('Repository');
    expect(pageModel.primaryIntent).toContain('repository');
  });

  it('4. should classify Wikipedia article page as Article type', () => {
    const nodes: SemanticNode[] = [
      {
        id: 1,
        tagName: 'H1',
        role: 'heading',
        accessibleName: 'Alan Turing',
        confidence: 0.99,
        isVisible: true,
        isEnabled: true,
      },
    ];

    const graph = new SemanticElementGraph(
      nodes,
      'https://en.wikipedia.org/wiki/Alan_Turing',
      'Alan Turing - Wikipedia',
    );
    const pageModel = engine.analyzePage(graph);

    expect(pageModel.pageType).toBe('Article');
    expect(pageModel.primaryIntent).toContain('knowledge');
  });

  it('5. should classify Node.js documentation page as Documentation type', () => {
    const nodes: SemanticNode[] = [
      {
        id: 1,
        tagName: 'H1',
        role: 'heading',
        accessibleName: 'Node.js v20.0.0 Documentation',
        confidence: 0.95,
        isVisible: true,
        isEnabled: true,
      },
    ];

    const graph = new SemanticElementGraph(
      nodes,
      'https://nodejs.org/docs/latest/api/',
      'Node.js Documentation',
    );
    const pageModel = engine.analyzePage(graph);

    expect(pageModel.pageType).toBe('Documentation');
  });

  it('6. should classify Dashboard analytics page as Dashboard type', () => {
    const nodes: SemanticNode[] = [
      {
        id: 1,
        tagName: 'DIV',
        role: 'generic',
        accessibleName: 'Total Users 12,450',
        confidence: 0.85,
        isVisible: true,
        isEnabled: true,
      },
    ];

    const graph = new SemanticElementGraph(
      nodes,
      'https://example.com/dashboard/analytics',
      'System Analytics Dashboard',
    );
    const pageModel = engine.analyzePage(graph);

    expect(pageModel.pageType).toBe('Dashboard');
    expect(pageModel.primaryIntent).toContain('dashboard');
  });
});
