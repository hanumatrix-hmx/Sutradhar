/**
 * @file packages/capability-runtime/tests/unit/ax-snapshot.spec.ts
 * @description Unit tests for buildAxSnapshot's flattening/filtering logic against a mocked
 * page.accessibility.snapshot() tree (the real end-to-end behavior against actual Chrome,
 * including the mutation-survival property this exists for, was verified live — see the
 * session's manual smoke test comparing it against the old snapshot()+click(nodeId) path).
 */
import { buildAxSnapshot, AX_IFRAMES_TIMEOUT_MS } from '../../src/snapshot/ax-snapshot.js';

function mockPage(tree: unknown, url = 'https://example.com', title = 'Example') {
  return {
    accessibility: { snapshot: async () => tree },
    url: () => url,
    title: async () => title,
  };
}

describe('@sutradhar/capability-runtime buildAxSnapshot', () => {
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

describe('@sutradhar/capability-runtime buildAxSnapshot — FR2-09 iframes', () => {
  it('A1: reads with includeIframes: true first', async () => {
    const snapshot = vi.fn(async () => ({ role: 'RootWebArea', name: '', children: [] }));
    const page = { accessibility: { snapshot }, url: () => 'https://x.test', title: async () => 'T' };

    await buildAxSnapshot(page);

    expect(snapshot.mock.calls[0]![0]).toEqual({ interestingOnly: true, includeIframes: true });
  });

  it('A2: groups iframe content under a header line at the iframe\'s position, disposing the handle', async () => {
    const dispose = vi.fn(async () => {});
    const fPay = { url: () => 'https://pay.test/f?x', name: () => 'pay', isDetached: () => false };
    const main = { url: () => 'https://x.test', name: () => '', isDetached: () => false };

    const tree = {
      role: 'RootWebArea',
      name: '',
      children: [
        { role: 'button', name: 'Checkout' },
        {
          role: 'Iframe',
          name: '',
          elementHandle: async () => ({ contentFrame: async () => fPay, dispose }),
          children: [
            {
              role: 'RootWebArea',
              name: '',
              children: [
                { role: 'heading', name: 'Card', level: 2 },
                { role: 'textbox', name: 'Card number' },
              ],
            },
          ],
        },
        { role: 'link', name: 'Help' },
      ],
    };
    const snapshot = vi.fn(async () => tree);
    const page = {
      accessibility: { snapshot },
      url: () => 'https://x.test',
      title: async () => 'T',
      frames: () => [main, fPay],
      mainFrame: () => main,
    };

    const result = await buildAxSnapshot(page);

    expect(result.listing).toBe(
      '[button] "Checkout"\n[iframe "pay" (https://pay.test/f)]\n  ## Card\n  [textbox] "Card number"\n[link] "Help"',
    );
    expect(result.nodeCount).toBe(4);
    expect(dispose).toHaveBeenCalled();
  });

  it('A3: a nested, unnamed iframe uses its numeric index and indents one level deeper', async () => {
    const outer = { url: () => 'https://pay.test', name: () => 'pay', isDetached: () => false };
    const inner = { url: () => 'about:srcdoc', name: () => '', isDetached: () => false };
    const main = { url: () => 'https://x.test', name: () => '', isDetached: () => false };

    const tree = {
      role: 'RootWebArea',
      name: '',
      children: [
        {
          role: 'Iframe',
          name: '',
          elementHandle: async () => ({ contentFrame: async () => outer, dispose: async () => {} }),
          children: [
            {
              role: 'RootWebArea',
              name: '',
              children: [
                { role: 'button', name: 'Pay' },
                {
                  role: 'Iframe',
                  name: '',
                  elementHandle: async () => ({ contentFrame: async () => inner, dispose: async () => {} }),
                  children: [{ role: 'RootWebArea', name: '', children: [{ role: 'button', name: 'Nested' }] }],
                },
              ],
            },
          ],
        },
      ],
    };
    const page = {
      accessibility: { snapshot: async () => tree },
      url: () => 'https://x.test',
      title: async () => 'T',
      frames: () => [main, outer, inner],
      mainFrame: () => main,
    };

    const result = await buildAxSnapshot(page);

    expect(result.listing).toContain('  [iframe 2 (about:srcdoc)]');
    expect(result.listing).toContain('    [button] "Nested"');
  });

  // GAP-149 (fix-2): the previous version of this test only exercised two frame names that
  // COLLIDE after sanitization (identical 30-char prefixes) — a case the UNFIXED code (which
  // built its uniqueness list from RAW names) also happens to pass by coincidence, because two
  // raw names that are already distinct never collide regardless of which name list is used to
  // check uniqueness. Reverting the GAP-146 fix left all these tests green (see
  // .ai/loop/field-report-2/evidence/FR2-09/audit-2/gap146-mutant-run.txt), i.e. zero actual
  // regression protection despite the comment's claim. Replaced with audit-2's verified case
  // (.ai/loop/field-report-2/evidence/FR2-09/audit-2/gap146-fixed/tests/unit/gap146-killer.spec.ts.txt):
  // a single, UNIQUE frame name that sanitizing itself changes (over 30 chars, or containing a
  // sanitized character). Unfixed code compares this name against the RAW `allNames` list, where
  // it never collides with anything -> renders numeric. Fixed code compares the SANITIZED form
  // against a sanitized `allNames` list, where it's still unique -> renders quoted. This
  // actually distinguishes fixed from unfixed behavior (see fix-2 evidence
  // .ai/loop/field-report-2/evidence/FR2-09/fix-2/gap149-revert-and-confirm.txt for the
  // revert-and-confirm proof).
  for (const raw of ['c'.repeat(45), 'pay[1]', 'my "card"']) {
    it(`GAP-146/GAP-149 regression: unique frame name ${JSON.stringify(raw)} that sanitizing itself changes renders quoted (sanitized), not numeric`, async () => {
      const frame = { url: () => 'about:srcdoc', name: () => raw, isDetached: () => false };
      const main = { url: () => 'https://x.test', name: () => '', isDetached: () => false };
      const tree = {
        role: 'RootWebArea',
        name: '',
        children: [
          {
            role: 'Iframe',
            name: '',
            elementHandle: async () => ({ contentFrame: async () => frame, dispose: async () => {} }),
            children: [{ role: 'RootWebArea', name: '', children: [{ role: 'button', name: 'One' }] }],
          },
        ],
      };
      const page = {
        accessibility: { snapshot: async () => tree },
        url: () => 'https://x.test',
        title: async () => 'T',
        frames: () => [main, frame],
        mainFrame: () => main,
      };

      const result = await buildAxSnapshot(page);

      expect(result.listing).not.toContain('[iframe 1 (about:srcdoc)]');
      expect(result.listing).toMatch(/\[iframe "/);
    });
  }

  it('A4: an iframe with no interesting content produces no header at all', async () => {
    const tree = {
      role: 'RootWebArea',
      name: '',
      children: [
        { role: 'button', name: 'OK' },
        {
          role: 'Iframe',
          name: '',
          elementHandle: async () => null,
          children: [{ role: 'RootWebArea', name: '', children: [{ role: 'generic', name: '' }] }],
        },
      ],
    };
    const page = { accessibility: { snapshot: async () => tree }, url: () => 'https://x.test', title: async () => 'T' };

    const result = await buildAxSnapshot(page);

    expect(result.listing).toBe('[button] "OK"');
  });

  it('A5: an unresolvable iframe (no elementHandle, no page.frames) still shows a "?" header and never throws', async () => {
    const tree = {
      role: 'RootWebArea',
      name: '',
      children: [
        {
          role: 'Iframe',
          name: '',
          children: [{ role: 'RootWebArea', name: '', children: [{ role: 'button', name: 'X' }] }],
        },
      ],
    };
    const page = { accessibility: { snapshot: async () => tree }, url: () => 'https://x.test', title: async () => 'T' };

    const result = await buildAxSnapshot(page);

    expect(result.listing).toContain('[iframe ?]');
    expect(result.listing).not.toContain('(http');
  });

  it('A6: a busy includeIframes read times out after 5000ms and falls back, appending a note', async () => {
    vi.useFakeTimers();
    try {
      const flatTree = { role: 'RootWebArea', name: '', children: [{ role: 'button', name: 'OK' }] };
      const calls: unknown[] = [];
      const snapshot = vi.fn((opts?: unknown) => {
        calls.push(opts);
        if (calls.length === 1) return new Promise(() => {}); // never resolves
        return Promise.resolve(flatTree);
      });
      const page = { accessibility: { snapshot }, url: () => 'https://x.test', title: async () => 'T' };

      const resultPromise = buildAxSnapshot(page);
      await vi.advanceTimersByTimeAsync(AX_IFRAMES_TIMEOUT_MS);
      const result = await resultPromise;

      expect(result.listing).toBe(
        `[button] "OK"\n[iframes not included — reading an iframe's accessibility tree timed out after ${AX_IFRAMES_TIMEOUT_MS}ms]`,
      );
      expect(calls[1]).toEqual({ interestingOnly: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it('A7: a rejected includeIframes read falls back and appends a failure note; a double failure rejects', async () => {
    const flatTree = { role: 'RootWebArea', name: '', children: [{ role: 'button', name: 'OK' }] };
    let call = 0;
    const snapshot = vi.fn(async () => {
      call++;
      if (call === 1) throw new Error('boom');
      return flatTree;
    });
    const page = { accessibility: { snapshot }, url: () => 'https://x.test', title: async () => 'T' };

    const result = await buildAxSnapshot(page);
    expect(result.listing).toBe(
      '[button] "OK"\n[iframes not included — reading an iframe\'s accessibility tree failed: boom]',
    );

    const bothFail = vi.fn(async () => {
      throw new Error('always fails');
    });
    const failingPage = { accessibility: { snapshot: bothFail }, url: () => 'https://x.test', title: async () => 'T' };
    await expect(buildAxSnapshot(failingPage)).rejects.toThrow('always fails');
  });
});
