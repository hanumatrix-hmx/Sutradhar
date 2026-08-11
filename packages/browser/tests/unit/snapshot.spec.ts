/**
 * @file packages/browser/tests/unit/snapshot.spec.ts
 * @description Unit tests for SnapshotGenerator, element DTO conversion, and SemanticTreeBuilder.
 */

import {
  SnapshotGenerator,
  SemanticTreeBuilder,
  RawElementNode,
  createBrowserElementDto,
} from '../../src/index.js';
import { createSessionId, createTabId } from '@pinchtab/contracts';

describe('@pinchtab/browser Snapshot Engine', () => {
  it('should transform RawElementNode into BrowserElementDto', () => {
    const raw: RawElementNode = {
      tagName: 'BUTTON',
      name: 'Submit Form',
      role: 'button',
      isClickable: true,
      isVisible: true,
    };

    const dto = createBrowserElementDto(raw, 10);

    expect(dto.elementId).toBe(10);
    expect(dto.tagName).toBe('button');
    expect(dto.name).toBe('Submit Form');
    expect(dto.role).toBe('button');
    expect(dto.isClickable).toBe(true);
  });

  it('should build formatted semantic tree from element DTOs', () => {
    const elements = [
      createBrowserElementDto({ tagName: 'input', name: 'Search', value: 'query' }, 1),
      createBrowserElementDto({ tagName: 'button', name: 'Submit', role: 'button' }, 2),
    ];

    const tree = SemanticTreeBuilder.buildTree(elements);

    expect(tree).toContain('--- Interactive Page Elements ---');
    expect(tree).toContain('[1] input "Search" value="query"');
    expect(tree).toContain('[2] button role="button" "Submit"');
  });

  it('should generate BrowserSnapshotDto filtering interactive nodes', async () => {
    const generator = new SnapshotGenerator();
    const nodes: RawElementNode[] = [
      { tagName: 'div', name: 'Container', isVisible: true }, // Non-interactive
      { tagName: 'button', name: 'Login', isVisible: true }, // Interactive
      { tagName: 'a', name: 'Link', isVisible: false }, // Hidden interactive
      { tagName: 'input', name: 'Email', value: 'test@example.com', isVisible: true }, // Interactive
    ];

    const snapshot = await generator.generateSnapshot(
      createSessionId('sess_1'),
      createTabId('tab_1'),
      'https://app.local/login',
      'Login Page',
      nodes,
      '<html><body><button>Login</button></body></html>',
    );

    expect(snapshot.sessionId).toBe('sess_1');
    expect(snapshot.tabId).toBe('tab_1');
    expect(snapshot.elements.length).toBe(2); // Only visible button and input
    expect(snapshot.elements[0]?.elementId).toBe(1);
    expect(snapshot.elements[0]?.name).toBe('Login');
    expect(snapshot.elements[1]?.elementId).toBe(2);
    expect(snapshot.elements[1]?.name).toBe('Email');
    expect(snapshot.semanticTree).toContain('[1] button "Login"');
  });
});
