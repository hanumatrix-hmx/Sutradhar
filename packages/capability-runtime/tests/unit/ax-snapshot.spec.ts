/**
 * @file packages/capability-runtime/tests/unit/ax-snapshot.spec.ts
 * @description Unit tests for buildAxSnapshot's flattening/filtering logic against a mocked
 * page.accessibility.snapshot() tree (the real end-to-end behavior against actual Chrome,
 * including the mutation-survival property this exists for, was verified live — see the
 * session's manual smoke test comparing it against the old snapshot()+click(nodeId) path).
 */
import { buildAxSnapshot } from '../../src/snapshot/ax-snapshot.js';

function mockPage(tree: unknown, url = 'https://example.com', title = 'Example') {
  return {
    accessibility: { snapshot: async () => tree },
    url: () => url,
    title: async () => title,
  };
}

describe('@pinchtab/capability-runtime buildAxSnapshot', () => {
  it('flattens interesting roles (button/link/textbox/...) from a nested tree', async () => {
    const tree = {
      role: 'RootWebArea',
      name: 'Example',
      children: [
        { role: 'heading', name: 'Login Page', level: 2 },
        {
          role: 'form',
          name: '',
          children: [
            { role: 'textbox', name: 'Username' },
            { role: 'textbox', name: 'Password' },
            { role: 'button', name: 'Login' },
          ],
        },
      ],
    };

    const result = await buildAxSnapshot(mockPage(tree));

    expect(result.nodeCount).toBe(4);
    expect(result.listing).toContain('[textbox] "Username"');
    expect(result.listing).toContain('[textbox] "Password"');
    expect(result.listing).toContain('[button] "Login"');
    expect(result.listing).toContain('Login Page'); // heading rendered as markdown-style heading
  });

  it('excludes uninteresting roles (StaticText, generic, RootWebArea) from the listing', async () => {
    const tree = {
      role: 'RootWebArea',
      name: 'Example',
      children: [
        { role: 'StaticText', name: 'Some paragraph text' },
        { role: 'generic', name: '' },
        { role: 'button', name: 'OK' },
      ],
    };

    const result = await buildAxSnapshot(mockPage(tree));

    expect(result.nodeCount).toBe(1);
    expect(result.listing).not.toContain('Some paragraph text');
    expect(result.listing).toBe('[button] "OK"');
  });

  it('excludes interesting-role nodes with no accessible name (nothing to reference them by)', async () => {
    const tree = {
      role: 'RootWebArea',
      name: '',
      children: [
        { role: 'button', name: '' },
        { role: 'button', name: 'Named Button' },
      ],
    };

    const result = await buildAxSnapshot(mockPage(tree));

    expect(result.nodeCount).toBe(1);
    expect(result.listing).toBe('[button] "Named Button"');
  });

  it('handles a null tree (e.g. a blank/about:blank page) without throwing', async () => {
    const result = await buildAxSnapshot(mockPage(null));

    expect(result.nodeCount).toBe(0);
    expect(result.listing).toBe('');
  });

  it('includes the page url and title', async () => {
    const result = await buildAxSnapshot(mockPage({ role: 'RootWebArea', name: '', children: [] }, 'https://a.test/page', 'A Page'));

    expect(result.url).toBe('https://a.test/page');
    expect(result.title).toBe('A Page');
  });
});
