/**
 * @file packages/capability-runtime/tests/unit/extract-data.spec.ts
 * @description Unit tests for the FR2-02 extract_data planning/in-page logic:
 * `planExtractFields`, `extractFieldsInPage`, `invalidExtractSelectorsError`. No browser.
 */

import {
  planExtractFields,
  extractFieldsInPage,
  invalidExtractSelectorsError,
  type ExtractPlanEntry,
} from '../../src/extract/extract-data.js';

describe('planExtractFields', () => {
  it('P1: no attribute or "" defaults to auto', () => {
    const plan = planExtractFields({ a: { selector: 'h1' }, b: { selector: 'h2', attribute: '' } });
    expect(plan[0].read).toEqual({ kind: 'auto' });
    expect(plan[1].read).toEqual({ kind: 'auto' });
  });

  it('P2: "value"/"checked"/"selected" (any case) become live reads, lowercased', () => {
    const plan = planExtractFields({
      a: { selector: '#a', attribute: 'value' },
      b: { selector: '#b', attribute: 'checked' },
      c: { selector: '#c', attribute: 'selected' },
      d: { selector: '#d', attribute: 'Value' },
      e: { selector: '#e', attribute: 'CHECKED' },
    });
    expect(plan[0].read).toEqual({ kind: 'live', prop: 'value' });
    expect(plan[1].read).toEqual({ kind: 'live', prop: 'checked' });
    expect(plan[2].read).toEqual({ kind: 'live', prop: 'selected' });
    expect(plan[3].read).toEqual({ kind: 'live', prop: 'value' });
    expect(plan[4].read).toEqual({ kind: 'live', prop: 'checked' });
  });

  it('P3: "attr:<name>" reads the raw attribute with the prefix stripped', () => {
    const plan = planExtractFields({
      a: { selector: '#a', attribute: 'attr:value' },
      b: { selector: '#b', attribute: 'attr:data-x' },
    });
    expect(plan[0].read).toEqual({ kind: 'attr', name: 'value' });
    expect(plan[1].read).toEqual({ kind: 'attr', name: 'data-x' });
  });

  it('P4: any other attribute name reads the raw attribute unchanged', () => {
    const plan = planExtractFields({
      a: { selector: '#a', attribute: 'href' },
      b: { selector: '#b', attribute: 'data-id' },
      c: { selector: '#c', attribute: 'aria-label' },
    });
    expect(plan[0].read).toEqual({ kind: 'attr', name: 'href' });
    expect(plan[1].read).toEqual({ kind: 'attr', name: 'data-id' });
    expect(plan[2].read).toEqual({ kind: 'attr', name: 'aria-label' });
  });

  it('P5: "attr:" or "attr:   " with no name throws, naming the field', () => {
    expect(() => planExtractFields({ bad: { selector: '#a', attribute: 'attr:' } })).toThrow(
      /attribute "attr:" needs an attribute name/,
    );
    expect(() => planExtractFields({ bad: { selector: '#a', attribute: 'attr:' } })).toThrow(/"bad"/);
    expect(() => planExtractFields({ bad2: { selector: '#a', attribute: 'attr:   ' } })).toThrow(
      /attribute "attr:" needs an attribute name/,
    );
  });

  it('P6: numeric selectors are normalized to a snapshot-node-id attribute selector; others unchanged', () => {
    const plan = planExtractFields({
      a: { selector: '12' },
      b: { selector: ' 7 ' },
      c: { selector: '.a > b' },
    });
    expect(plan[0].selector).toBe('[data-sd-node-id="12"]');
    expect(plan[1].selector).toBe('[data-sd-node-id="7"]');
    expect(plan[2].selector).toBe('.a > b');
  });

  it('P7: visibleOnly resolves field override, else call-level option, else false', () => {
    expect(planExtractFields({ a: { selector: '#a' } }, { visibleOnly: true })[0].visibleOnly).toBe(true);
    expect(
      planExtractFields({ a: { selector: '#a', visibleOnly: false } }, { visibleOnly: true })[0].visibleOnly,
    ).toBe(false);
    expect(planExtractFields({ a: { selector: '#a', visibleOnly: true } })[0].visibleOnly).toBe(true);
    expect(planExtractFields({ a: { selector: '#a' } })[0].visibleOnly).toBe(false);
  });

  it('P8: output preserves field insertion order', () => {
    const plan = planExtractFields({ z: { selector: '#z' }, a: { selector: '#a' }, m: { selector: '#m' } });
    expect(plan.map((p) => p.name)).toEqual(['z', 'a', 'm']);
  });
});

describe('extractFieldsInPage', () => {
  const originalDocument = (globalThis as any).document;
  const originalGetComputedStyle = (globalThis as any).getComputedStyle;

  afterEach(() => {
    vi.unstubAllGlobals();
    (globalThis as any).document = originalDocument;
    (globalThis as any).getComputedStyle = originalGetComputedStyle;
  });

  function stubDom(elementsBySelector: Record<string, any[]>, computedStyleFn?: (el: any) => any) {
    const querySelectorAll = vi.fn((sel: string) => {
      const found = elementsBySelector[sel];
      if (found === undefined) {
        // default: no matches for a selector no test cared about
        return [];
      }
      if (found instanceof Error) throw found;
      return found;
    });
    vi.stubGlobal('document', { querySelectorAll });
    vi.stubGlobal('getComputedStyle', computedStyleFn ?? (() => ({ visibility: 'visible' })));
    return querySelectorAll;
  }

  function entry(overrides: Partial<ExtractPlanEntry>): ExtractPlanEntry {
    return { name: 'f', selector: '#f', read: { kind: 'auto' }, visibleOnly: false, ...overrides };
  }

  it('I1: input auto reads the live .value untrimmed', () => {
    const input = { localName: 'input', value: '  typed ', getAttribute: () => 'markup' };
    stubDom({ '#i': [input] });
    const result = extractFieldsInPage([entry({ name: 'a', selector: '#i' })]);
    expect(result).toEqual({ ok: true, data: { a: ['  typed '] } });
  });

  it('I2: select/textarea auto reads .value', () => {
    const select = { localName: 'select', value: 'opt2' };
    const textarea = { localName: 'textarea', value: 'notes text' };
    stubDom({ '#s': [select], '#t': [textarea] });
    const result = extractFieldsInPage([
      entry({ name: 'a', selector: '#s' }),
      entry({ name: 'b', selector: '#t' }),
    ]);
    expect(result).toEqual({ ok: true, data: { a: ['opt2'], b: ['notes text'] } });
  });

  it('I3: option auto reads .text, not innerText', () => {
    const option = { localName: 'option', text: 'Alpha', innerText: 'NOT THIS' };
    stubDom({ '#o': [option] });
    const result = extractFieldsInPage([entry({ name: 'a', selector: '#o' })]);
    expect(result).toEqual({ ok: true, data: { a: ['Alpha'] } });
  });

  it('I4: any other element auto reads innerText.trim(), falling back to textContent.trim()', () => {
    const div = { localName: 'div', innerText: '  hello  ', textContent: 'ignored' };
    const svg = { localName: 'svg', innerText: undefined, textContent: '  fallback  ' };
    stubDom({ '#d': [div], '#g': [svg] });
    const result = extractFieldsInPage([
      entry({ name: 'a', selector: '#d' }),
      entry({ name: 'b', selector: '#g' }),
    ]);
    expect(result).toEqual({ ok: true, data: { a: ['hello'], b: ['fallback'] } });
  });

  it('I5: live "value" on a non-form element falls back to the raw attribute; null attribute -> ""', () => {
    const div1 = { localName: 'div', value: 42, getAttribute: () => 'x' };
    const div2 = { localName: 'div', value: 42, getAttribute: () => null };
    stubDom({ '#d1': [div1], '#d2': [div2] });
    const result = extractFieldsInPage([
      entry({ name: 'a', selector: '#d1', read: { kind: 'live', prop: 'value' } }),
      entry({ name: 'b', selector: '#d2', read: { kind: 'live', prop: 'value' } }),
    ]);
    expect(result).toEqual({ ok: true, data: { a: ['x'], b: [''] } });
  });

  it('I6: live "checked"/"selected" stringify booleans; non-boolean falls back to attribute', () => {
    const cbTrue = { localName: 'input', checked: true, getAttribute: () => null };
    const cbFalse = { localName: 'input', checked: false, getAttribute: () => null };
    const nonBool = { localName: 'input', checked: 'weird', getAttribute: () => 'fallback-attr' };
    const optSelected = { localName: 'option', selected: true, getAttribute: () => null };
    stubDom({ '#cb1': [cbTrue], '#cb2': [cbFalse], '#cb3': [nonBool], '#o': [optSelected] });
    const result = extractFieldsInPage([
      entry({ name: 'a', selector: '#cb1', read: { kind: 'live', prop: 'checked' } }),
      entry({ name: 'b', selector: '#cb2', read: { kind: 'live', prop: 'checked' } }),
      entry({ name: 'c', selector: '#cb3', read: { kind: 'live', prop: 'checked' } }),
      entry({ name: 'd', selector: '#o', read: { kind: 'live', prop: 'selected' } }),
    ]);
    expect(result).toEqual({
      ok: true,
      data: { a: ['true'], b: ['false'], c: ['fallback-attr'], d: ['true'] },
    });
  });

  it('I7: "attr:" reads the raw attribute even when a live value differs; null -> ""', () => {
    const el1 = { localName: 'input', value: 'live', getAttribute: () => 'markup' };
    const el2 = { localName: 'input', value: 'live', getAttribute: () => null };
    stubDom({ '#a': [el1], '#b': [el2] });
    const result = extractFieldsInPage([
      entry({ name: 'a', selector: '#a', read: { kind: 'attr', name: 'value' } }),
      entry({ name: 'b', selector: '#b', read: { kind: 'attr', name: 'value' } }),
    ]);
    expect(result).toEqual({ ok: true, data: { a: ['markup'], b: [''] } });
  });

  it('I8: numeric live "value" on a non-form element (e.g. li) falls back to the raw attribute, not String(value)', () => {
    const li = { localName: 'li', value: 3, getAttribute: () => '3' };
    const liNoAttr = { localName: 'li', value: 3, getAttribute: () => null };
    stubDom({ '#li1': [li], '#li2': [liNoAttr] });
    const result = extractFieldsInPage([
      entry({ name: 'a', selector: '#li1', read: { kind: 'live', prop: 'value' } }),
      entry({ name: 'b', selector: '#li2', read: { kind: 'live', prop: 'value' } }),
    ]);
    expect(result).toEqual({ ok: true, data: { a: ['3'], b: [''] } });
  });

  it('I9: visibleOnly drops hidden/collapsed/zero-size elements; opacity is ignored', () => {
    const mk = (style: any, rect: any) => ({
      localName: 'div',
      innerText: 'x',
      getBoundingClientRect: () => rect,
      __style: style,
    });
    const hiddenVis = mk({ visibility: 'hidden' }, { width: 10, height: 10 });
    const collapsed = mk({ visibility: 'collapse' }, { width: 10, height: 10 });
    const zeroW = mk({ visibility: 'visible' }, { width: 0, height: 10 });
    const zeroH = mk({ visibility: 'visible' }, { width: 10, height: 0 });
    const opacityZero = mk({ visibility: 'visible', opacity: '0' }, { width: 10, height: 10 });
    const els = [hiddenVis, collapsed, zeroW, zeroH, opacityZero];
    stubDom(
      { '#all': els },
      (el: any) => el.__style,
    );
    const withFilter = extractFieldsInPage([entry({ name: 'a', selector: '#all', visibleOnly: true })]);
    expect(withFilter).toEqual({ ok: true, data: { a: ['x'] } });
    const withoutFilter = extractFieldsInPage([entry({ name: 'a', selector: '#all', visibleOnly: false })]);
    expect((withoutFilter as any).data.a).toHaveLength(5);
  });

  it('I10: an <option> is judged by its owning <select>; no owning select -> dropped', () => {
    const visibleSelect = {
      __style: { visibility: 'visible' },
      getBoundingClientRect: () => ({ width: 100, height: 20 }),
    };
    const optionInVisibleSelect = {
      localName: 'option',
      text: 'kept',
      getBoundingClientRect: () => ({ width: 0, height: 0 }), // own rect is 0x0 (closed dropdown)
      closest: () => visibleSelect,
    };
    const optionNoSelect = {
      localName: 'option',
      text: 'dropped',
      getBoundingClientRect: () => ({ width: 0, height: 0 }),
      closest: () => null,
    };
    stubDom(
      { '#opts': [optionInVisibleSelect, optionNoSelect] },
      (target: any) => target.__style ?? { visibility: 'visible' },
    );
    const result = extractFieldsInPage([entry({ name: 'a', selector: '#opts', visibleOnly: true })]);
    expect(result).toEqual({ ok: true, data: { a: ['kept'] } });
  });

  it('I11: an invalid selector is collected without touching element accessors on any field, and multiple invalid fields are all listed', () => {
    const throwingGetter = () => {
      throw new Error('should never be called — validation must happen before any read');
    };
    const badError = new Error(
      "Failed to execute 'querySelectorAll' on 'Document': '.p[' is not a valid selector.",
    );
    const goodEl = { localName: 'div', get innerText(): string { throwingGetter(); return ''; } };
    stubDom({ '.good': [goodEl], '.p[': badError, '.q[': badError });
    const result = extractFieldsInPage([
      entry({ name: 'ok', selector: '.good' }),
      entry({ name: 'bad', selector: '.p[' }),
    ]);
    expect(result).toEqual({
      ok: false,
      invalid: [{ name: 'bad', selector: '.p[', message: badError.message }],
    });

    const twoInvalid = extractFieldsInPage([
      entry({ name: 'bad1', selector: '.p[' }),
      entry({ name: 'bad2', selector: '.q[' }),
    ]);
    expect(twoInvalid).toEqual({
      ok: false,
      invalid: [
        { name: 'bad1', selector: '.p[', message: badError.message },
        { name: 'bad2', selector: '.q[', message: badError.message },
      ],
    });
  });

  it('I12: the exported function is self-contained — running its own re-parsed source gives the same result', () => {
    const input = { localName: 'input', value: '  typed ', getAttribute: () => 'markup' };
    stubDom({ '#i': [input] });
    // eslint-disable-next-line no-new-func
    const rebuilt = new Function('return (' + extractFieldsInPage.toString() + ')')() as typeof extractFieldsInPage;
    const result = rebuilt([entry({ name: 'a', selector: '#i' })]);
    expect(result).toEqual({ ok: true, data: { a: ['  typed '] } });
  });

  it('I13: a field named "__proto__" becomes its own property with an array value, not a prototype reassignment', () => {
    const div = { localName: 'div', innerText: 'hi' };
    stubDom({ '#p': [div] });
    const result = extractFieldsInPage([entry({ name: '__proto__', selector: '#p' })]);
    expect(result.ok).toBe(true);
    const data = (result as any).data;
    expect(Object.prototype.hasOwnProperty.call(data, '__proto__')).toBe(true);
    expect(data.__proto__).toEqual(['hi']);
    expect(Array.isArray(data.__proto__)).toBe(true);
  });
});

describe('invalidExtractSelectorsError', () => {
  const badMessage = "Failed to execute 'querySelectorAll' on 'Document': '.p[' is not a valid selector.";

  it('X1: message names the field/selector, ends with the hint, is a plain Error not starting with SyntaxError', () => {
    const err = invalidExtractSelectorsError([{ name: 'bad', selector: '.p[', message: badMessage }]);
    expect(err.name).toBe('Error');
    expect(err.message).not.toMatch(/^SyntaxError/);
    expect(err.message).toMatch(
      /^Invalid selector for field "bad": "\.p\[" — Failed to execute 'querySelectorAll' on 'Document': '\.p\[' is not a valid selector\./,
    );
    // FR2-06 moved SELECTOR_SYNTAX_HINT into @sutradhar/browser and reworded it (spec §2.1) —
    // the exported name/shape this test cares about (a hint appended after the message) is
    // unchanged, so this assertion follows the new wording rather than pinning FR2-02's original
    // text verbatim.
    expect(err.message).toContain(
      'Use standard CSS or a snapshot node id (e.g. "12"); Puppeteer\'s pierce/, xpath/, aria/ and text/ ' +
        'prefixes also work for element actions. Playwright-style selectors (text=, role=, >>, :has-text(), ' +
        'getBy*(), internal:) are not supported',
    );
  });

  it('X2: a leading "SyntaxError: " prefix on the underlying message is stripped', () => {
    const err = invalidExtractSelectorsError([{ name: 'bad', selector: '.p[', message: `SyntaxError: ${badMessage}` }]);
    expect(err.message).toContain(`— ${badMessage}`);
    expect(err.message).not.toContain('SyntaxError:');
  });

  it('P9 (FR2-06): planExtractFields with a pierce/text= selector gets FR2-02\'s prefix note plus the dialect reason', () => {
    expect(() => planExtractFields({ bad: { selector: 'pierce/text=x' } })).toThrow(
      /Invalid selector for field "bad": "pierce\/text=x" — "text=".*does not support Puppeteer's pierce\//s,
    );
  });

  it('P10 (FR2-06): a non-InvalidSelectorError throw from normalizeTarget passes through UNCHANGED (the actual rethrow branch, not the unrelated "attr:" error)', () => {
    // GAP-210 (audit-1): the original version of this test asserted the "attr:" error, which is
    // thrown OUTSIDE the try/catch around normalizeTarget() entirely (that block only wraps the
    // `selector = normalizeTarget(spec.selector)` call) — so the actual `throw e` rethrow branch
    // in planExtractFields (extract-data.ts) was never exercised, and a mutation deleting it
    // would have survived. normalizeTarget's only real non-InvalidSelectorError failure mode is
    // a non-string selector, whose `target.trim()` throws a plain TypeError — that's used here
    // to genuinely exercise (and pin, by reference identity) the rethrow.
    const badSelector = null as unknown as string;
    let thrown: unknown;
    try {
      planExtractFields({ ok: { selector: 'h1' }, bad: { selector: badSelector } });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(TypeError);
    expect((thrown as Error).name).not.toBe('InvalidSelectorError');
    expect((thrown as Error).message).not.toContain('Invalid selector for field');
  });

  it('P10b (FR2-06): the unrelated "attr:" error (thrown outside the normalizeTarget try/catch) still surfaces as its own distinct error', () => {
    expect(() => planExtractFields({ bad: { selector: '#a', attribute: 'attr:' } })).toThrow(
      /needs an attribute name/,
    );
  });

  it('P11 (FR2-06): every Playwright-style field is collected and named, not just the first', () => {
    expect(() =>
      planExtractFields({ ok: { selector: 'h1' }, bad: { selector: 'text=Buy' }, bad2: { selector: 'button >> text=OK' } }),
    ).toThrow(/Invalid selector for field "bad": "text=Buy".*Invalid selector for field "bad2"/s);
  });

  it('X3: a pierce/ prefixed selector gets the extra prefix note', () => {
    const err = invalidExtractSelectorsError([{ name: 'bad', selector: 'pierce/#x', message: badMessage }]);
    expect(err.message).toContain("does not support Puppeteer's pierce/");
  });

  it('X4: two invalid entries produce two lines and exactly one copy of the hint', () => {
    const err = invalidExtractSelectorsError([
      { name: 'bad1', selector: '.p[', message: badMessage },
      { name: 'bad2', selector: '.q[', message: badMessage },
    ]);
    const lines = err.message.split('\n');
    expect(lines.filter((l) => l.startsWith('Invalid selector for field'))).toHaveLength(2);
    const hintOccurrences = err.message.split('Use standard CSS or a snapshot node id').length - 1;
    expect(hintOccurrences).toBe(1);
  });
});
