/**
 * @file packages/browser/tests/unit/selector-dialect.spec.ts
 * @description FR2-06 unit tests for the Playwright-dialect detector, the browser-side syntax
 * probe helpers, and the small selector-prefix utilities.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  detectForeignSelectorDialect,
  assertSupportedSelectorDialect,
  invalidSelectorSyntaxError,
  toPuppeteerQuery,
  selectorProbeTarget,
  selectorSyntaxProbeInPage,
  InvalidSelectorError,
  SELECTOR_SYNTAX_HINT,
} from '../../src/actions/selector-dialect.js';

// Same list ERROR_HINTS uses in packages/mcp-server/src/tools.ts — duplicated here (not
// imported) so this test doesn't create a cross-package dependency just to assert an invariant.
const ERROR_HINT_PATTERNS = [
  'no element found',
  'timed out',
  'stale snapshot',
  'occluded',
  'no browser session',
  'no live browser page',
  'but none is visible',
  'waiting for state=hidden',
  'outside the allowed download directories',
  'no visible element found',
];

function expectNoErrorHintCollision(message: string): void {
  const lower = message.toLowerCase();
  for (const pattern of ERROR_HINT_PATTERNS) {
    expect(lower).not.toContain(pattern);
  }
  expect(message).not.toContain('SyntaxError');
  expect(message).not.toContain('is not a valid selector');
}

describe('FR2-06 selector-dialect', () => {
  describe('D1: every Playwright form is detected', () => {
    const cases: Array<[string, string]> = [
      ['text=Submit', 'engine-prefix'],
      ['text="Submit"i', 'engine-prefix'],
      ['text=/Sub.*/', 'engine-prefix'],
      ['  text=Submit  ', 'engine-prefix'],
      ['TEXT=Submit', 'engine-prefix'],
      ['role=button[name="Submit"]', 'engine-prefix'],
      ['Role = button', 'engine-prefix'],
      ['button >> text=OK', 'chain'],
      ['div>>span', 'chain'],
      ['pierce/div >> span', 'chain'],
      ['div:has-text("x")', 'pseudo'],
      [':text("x")', 'pseudo'],
      ['button:text-is("OK")', 'pseudo'],
      ['a:text-matches("x")', 'pseudo'],
      [':nth-match(li, 2)', 'pseudo'],
      ['button:visible', 'pseudo'],
      ["getByRole('button')", 'locator-method'],
      ['getByText("x")', 'locator-method'],
      ["page.getByLabel('Email')", 'locator-method'],
      ['getByTestId("go")', 'locator-method'],
      ['internal:has-text="x"', 'internal'],
      ['internal:role=button', 'internal'],
      ['div >> internal:text="x"i', 'internal'], // internal (order 4) matches before chain (order 6)
      ['css=button', 'engine-prefix'],
      ['xpath=//button', 'engine-prefix'],
      ['aria=Submit', 'engine-prefix'],
      ['pierce=#x', 'engine-prefix'],
      ['id=main', 'engine-prefix'],
      ['data-testid=go', 'engine-prefix'],
      ['pierce/text=Submit', 'engine-prefix'],
      // GAP-213: a stray space right after "pierce/" must not defeat detection.
      ['pierce/ text=Submit', 'engine-prefix'],
      ['pierce/  role=button', 'engine-prefix'],
      ['//button[@id="x"]', 'bare-xpath'],
      ['(//a)[1]', 'bare-xpath'],
      ['.//span', 'bare-xpath'],
      ['../div', 'bare-xpath'],
      ['#12', 'node-id-syntax'],
      ['[#12]', 'node-id-syntax'],
      ['"Submit"', 'quoted-text'],
      ["'Submit'", 'quoted-text'],
    ];
    it.each(cases)('%s -> %s', (input, rule) => {
      const match = detectForeignSelectorDialect(input);
      expect(match).not.toBeNull();
      expect(match!.rule).toBe(rule);
    });

    it('#12 reason names the number', () => {
      expect(detectForeignSelectorDialect('#12')!.reason).toContain('"12"');
      expect(detectForeignSelectorDialect('[#12]')!.reason).toContain('"12"');
    });
  });

  describe('GAP-205: engine-prefix reason strings are pinned exactly, for every "="-suffixed prefix', () => {
    // audit-1 found engineReason() doubled the trailing "=" for every =-suffixed prefix (the
    // regex match already includes it, and the message-builder appended ANOTHER "=" or "/"),
    // producing self-contradictory output like `"xpath==" is not supported; use the slash form
    // "xpath=/"` — a hint that would itself be rejected by the same detector. No test pinned the
    // exact reason text, which is why a mutation replacing the message with literal garbage
    // passed all 99 tests (mutation-results.json). These pin the exact spec §2.1 text.
    const cases: Array<[string, string]> = [
      ['xpath=//button', '"xpath=" is not supported; use the slash form "xpath/".'],
      ['aria=Submit', '"aria=" is not supported; use the slash form "aria/".'],
      ['pierce=#x', '"pierce=" is not supported; use the slash form "pierce/".'],
      ['id=main', '"id=" is a Playwright attribute-engine prefix; use a CSS attribute selector such as [id="…"].'],
      [
        'data-testid=go',
        '"data-testid=" is a Playwright attribute-engine prefix; use a CSS attribute selector such as [data-testid="…"].',
      ],
      [
        'DATA-TESTID=go',
        '"data-testid=" is a Playwright attribute-engine prefix; use a CSS attribute selector such as [data-testid="…"].',
      ],
      ['Xpath = //a', '"xpath=" is not supported; use the slash form "xpath/".'],
      ['css=button', '"css=" is Playwright\'s explicit CSS-engine prefix; drop it and pass the CSS itself.'],
      [
        'text=Submit',
        '"text=" is Playwright selector-engine syntax (Puppeteer\'s own text query is spelled "text/").',
      ],
      ['role=button', '"role=" is Playwright selector-engine syntax.'],
    ];
    it.each(cases)('%s -> exact reason %#', (input, expectedReason) => {
      const match = detectForeignSelectorDialect(input);
      expect(match).not.toBeNull();
      expect(match!.reason).toBe(expectedReason);
      // The advised form itself must never contain a doubled "=" or "=/" — a self-contradictory
      // hint that the detector would itself reject.
      expect(match!.reason).not.toContain('==');
      expect(match!.reason).not.toContain('=/');
    });
  });

  describe('D2: false-positive guards — valid CSS returns null', () => {
    const valid: string[] = [
      '#plain-btn',
      '.btn.primary',
      'div > span',
      'a + b ~ c',
      'div:has(> span)',
      ':is(a, b)',
      'input[type="text" i]',
      '[data-sd-node-id="7"]',
      '[data-text="text=Submit"]',
      "[data-a='role=x']",
      '[data-x="a >> b"]',
      '[href*=">>"]',
      '[title="internal:role=button"]',
      '[data-q="getByRole(\'x\')"]',
      'a[title=":has-text(x)"]',
      '.a\\>\\>b',
      '#a\\:has-text\\(x\\)',
      '#getByRole',
      'button.internal:not(.nope)',
      'internal:first-child',
      '.has-text',
      '.text-is',
      'button:focus-visible',
      '[data-visible]',
      'div /* >> text=x */ span',
      'text',
      'text[x="1"]',
      'svg text',
      'role',
      'div >>> span',
      'div >>>> span',
      'div::-p-text(x)',
      'xpath///*[text()="text=Submit"]',
      'xpath//a[contains(., ">>")]',
      'aria/text=Submit',
      'aria/Submit order[role="button"]',
      'text/text=Submit',
      'text/a >> b',
      'pierce/#x',
      'pierce/[data-x="a >> b"]',
      '12',
      ' 7 ',
      '',
      '   ',
    ];
    it.each(valid)('%s -> null', (input) => {
      expect(detectForeignSelectorDialect(input)).toBeNull();
    });
  });

  describe('D3: error shape', () => {
    it('throws InvalidSelectorError synchronously with the right shape', () => {
      let thrown: unknown;
      try {
        assertSupportedSelectorDialect('text=Submit');
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(InvalidSelectorError);
      const err = thrown as InvalidSelectorError;
      expect(err.name).toBe('InvalidSelectorError');
      expect(err.selector).toBe('text=Submit');
      expect(err.kind).toBe('foreign-dialect');
      expect(err.message.startsWith('Invalid selector "text=Submit" — "text="')).toBe(true);
      expect(err.message.endsWith(SELECTOR_SYNTAX_HINT)).toBe(true);
      expect(err.message).toContain('click_by_text');
      expect(err.message).toContain('click_by_role');
      expect(err.message).toContain('type_by_label');
      expect(err.message).toContain('Playwright-style');
      expectNoErrorHintCollision(err.message);
    });

    it('every rule family avoids ERROR_HINTS collisions', () => {
      const perRule = ['text=Submit', 'role=button', 'button >> text=OK', ':has-text("x")', "getByRole('x')", 'internal:role=button', 'css=button', '//a', '#12', '"x"'];
      for (const input of perRule) {
        expect(() => assertSupportedSelectorDialect(input)).toThrow(InvalidSelectorError);
        try {
          assertSupportedSelectorDialect(input);
        } catch (e) {
          expectNoErrorHintCollision((e as InvalidSelectorError).message);
        }
      }
    });
  });

  describe('D4: speed and sync', () => {
    it('is synchronous', () => {
      const result = detectForeignSelectorDialect('text=Submit');
      expect(result).not.toBeInstanceOf(Promise);
    });

    it('runs the full D1+D2 list 1000x plus a 10000-char selector in < 100ms', () => {
      const inputs = ['text=Submit', '#plain-btn', 'div > span', ':has-text("x")', '//a', '#12'];
      const long = 'a'.repeat(10000);
      const start = Date.now();
      for (let i = 0; i < 1000; i++) {
        for (const input of inputs) detectForeignSelectorDialect(input);
      }
      detectForeignSelectorDialect(long);
      expect(Date.now() - start).toBeLessThan(100);
    });
  });

  describe('D5: SELECTOR_SYNTAX_HINT', () => {
    it('contains the required substrings', () => {
      for (const s of ['Playwright-style', 'click_by_text', 'click_by_role', 'type_by_label', 'snapshot', 'pierce/']) {
        expect(SELECTOR_SYNTAX_HINT).toContain(s);
      }
    });
  });

  describe('D6: toPuppeteerQuery', () => {
    it('adds pierce/ to plain CSS and leaves already-prefixed selectors unchanged', () => {
      expect(toPuppeteerQuery('#x')).toBe('pierce/#x');
      expect(toPuppeteerQuery('pierce/#x')).toBe('pierce/#x');
      expect(toPuppeteerQuery('xpath///a')).toBe('xpath///a');
      expect(toPuppeteerQuery('aria/X[role="button"]')).toBe('aria/X[role="button"]');
      expect(toPuppeteerQuery('text/Hi')).toBe('text/Hi');
      expect(toPuppeteerQuery(' xpath//a')).toBe('xpath//a');
      expect(toPuppeteerQuery('[data-sd-node-id="3"]')).toBe('pierce/[data-sd-node-id="3"]');
    });
  });

  describe('D7: selectorProbeTarget', () => {
    it('classifies each selector shape', () => {
      expect(selectorProbeTarget('#x')).toEqual({ kind: 'css', expr: '#x' });
      expect(selectorProbeTarget('pierce/#x')).toEqual({ kind: 'css', expr: '#x' });
      expect(selectorProbeTarget('xpath//[')).toEqual({ kind: 'xpath', expr: '/[' });
      expect(selectorProbeTarget('aria/Submit[role="button"]')).toBeNull();
      expect(selectorProbeTarget('text/Hi')).toBeNull();
      expect(selectorProbeTarget('[data-sd-node-id="12"]')).toBeNull();
      expect(selectorProbeTarget('[data-sd-node-id="12"], .x')).toEqual({
        kind: 'css',
        expr: '[data-sd-node-id="12"], .x',
      });
    });
  });

  describe('D8: selectorSyntaxProbeInPage', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('returns null for valid CSS and calls querySelector with expr', () => {
      const querySelector = vi.fn().mockReturnValue(null);
      const fragment = { querySelector };
      vi.stubGlobal('document', { createDocumentFragment: () => fragment });
      const result = selectorSyntaxProbeInPage('css', '#ok');
      expect(result).toBeNull();
      expect(querySelector).toHaveBeenCalledWith('#ok');
    });

    it('returns the message for a SyntaxError', () => {
      const err = Object.assign(new Error("'div[' is not a valid selector."), { name: 'SyntaxError' });
      vi.stubGlobal('document', {
        createDocumentFragment: () => ({
          querySelector: () => {
            throw err;
          },
        }),
      });
      expect(selectorSyntaxProbeInPage('css', 'div[')).toBe(err.message);
    });

    it('returns null for a NamespaceError', () => {
      const err = Object.assign(new Error('ns'), { name: 'NamespaceError' });
      vi.stubGlobal('document', {
        createDocumentFragment: () => ({
          querySelector: () => {
            throw err;
          },
        }),
      });
      expect(selectorSyntaxProbeInPage('css', 'x|y')).toBeNull();
    });

    it('returns null for a TypeError', () => {
      vi.stubGlobal('document', {
        createDocumentFragment: () => ({
          querySelector: () => {
            throw new TypeError('boom');
          },
        }),
      });
      expect(selectorSyntaxProbeInPage('css', 'x')).toBeNull();
    });

    it('xpath calls createExpression, and its SyntaxError returns the message', () => {
      const createExpression = vi.fn().mockImplementation(() => {
        const err = Object.assign(new Error("The string '//[' is not a valid XPath expression."), {
          name: 'SyntaxError',
        });
        throw err;
      });
      vi.stubGlobal('document', { createExpression });
      const result = selectorSyntaxProbeInPage('xpath', '/[');
      expect(createExpression).toHaveBeenCalledWith('/[');
      expect(result).toBe("The string '//[' is not a valid XPath expression.");
    });

    it('is self-contained (survives re-construction from its own toString())', () => {
      const querySelector = vi.fn().mockReturnValue(null);
      vi.stubGlobal('document', { createDocumentFragment: () => ({ querySelector }) });
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const rebuilt = new Function('return (' + selectorSyntaxProbeInPage.toString() + ')')() as typeof selectorSyntaxProbeInPage;
      expect(rebuilt('css', '#ok')).toBe(selectorSyntaxProbeInPage('css', '#ok'));
    });
  });

  describe('D9: invalidSelectorSyntaxError', () => {
    it('builds the right message shape', () => {
      const err = invalidSelectorSyntaxError(
        'div[',
        "Failed to execute 'querySelector' on 'DocumentFragment': 'div[' is not a valid selector.",
      );
      expect(err.message).toMatch(/^Invalid selector "div\[" — Failed to execute 'querySelector'/);
      expect(err.message.endsWith(SELECTOR_SYNTAX_HINT)).toBe(true);
      expect(err.kind).toBe('invalid-syntax');
    });

    it('strips a leading SyntaxError: prefix', () => {
      const err = invalidSelectorSyntaxError('div[', "SyntaxError: 'div[' is not a valid selector.");
      expect(err.message).not.toMatch(/^Invalid selector "div\[" — SyntaxError/);
      expect(err.message).toContain("'div[' is not a valid selector.");
    });

    it('appends the D11 note only with enginePath and a P-selector', () => {
      const withEnginePath = invalidSelectorSyntaxError('#h >>> #b', 'not a valid selector', { enginePath: true });
      expect(withEnginePath.message).toContain('>>> and ::-p-*()');
      const withoutEnginePath = invalidSelectorSyntaxError('#h >>> #b', 'not a valid selector');
      expect(withoutEnginePath.message).not.toContain('>>> and ::-p-*()');
    });
  });
});
