/**
 * @file packages/capability-runtime/tests/unit/page-text.spec.ts
 * @description I-048 (release 0.6.2): page-text windowing, totals, marker, explicit read errors, PDF.
 *
 * No browser. The fake page's `evaluate` EXECUTES the function it is given against a fake
 * `document` (so the real in-page window code runs, not a re-implementation of it).
 */

import { vi } from 'vitest';

const pdfParseState: { text: string; throws: boolean } = { text: '', throws: false };
vi.mock('pdf-parse', () => ({
  PDFParse: class {
    async getText() {
      if (pdfParseState.throws === ('domMatrix' as any)) throw new Error('DOMMatrix is not defined');
      if (pdfParseState.throws) throw new Error('bad pdf');
      return { text: pdfParseState.text };
    }
    async destroy() {}
  },
}));

import {
  SutradharRuntime,
  DEFAULT_PAGE_TEXT_MAX_CHARS,
  MAX_PAGE_TEXT_CHARS,
  MCP_MAX_PAGE_TEXT_CHARS,
  PageTextReadError,
  formatPageTextMarker,
  windowPageText,
  pageWindowInPage,
  validatePageTextOptions,
} from '../../src/index.js';

interface FakeDoc {
  contentType: string;
  body: { innerText: string } | null;
}

/** Fake page: evaluate() runs the passed function with `document` set to `doc`. Dispatch by arity:
 *  0 args = the contentType probe, 2 args = the window read, 1 string arg = the PDF byte fetch. */
function fakePage(doc: FakeDoc, opts: { evalThrows?: boolean; throwOn?: 'probe' | 'window'; pdfBase64?: string; pdfFetchThrows?: boolean } = {}) {
  const calls = { contentType: 0, window: 0, pdfFetch: 0 };
  const page = {
    url: () => 'https://x.test/doc',
    evaluate: vi.fn(async (fn: (...a: any[]) => any, ...args: any[]) => {
      if (args.length === 1 && typeof args[0] === 'string') {
        calls.pdfFetch++;
        if (opts.pdfFetchThrows) throw new Error('fetch failed');
        return opts.pdfBase64 ?? '';
      }
      if (args.length === 2) calls.window++;
      else calls.contentType++;
      if (opts.evalThrows) throw new Error('Execution context was destroyed');
      if (opts.throwOn === 'probe' && args.length === 0) throw new Error('Execution context was destroyed');
      if (opts.throwOn === 'window' && args.length === 2) throw new Error('Execution context was destroyed');
      (globalThis as any).document = doc;
      try {
        return await fn(...args);
      } finally {
        delete (globalThis as any).document;
      }
    }),
  };
  return { page, calls };
}

function runtimeWith(page: any) {
  const runtime = new SutradharRuntime();
  const tab = { id: 'tab_1', url: 'https://x.test/doc', title: 'T' };
  vi.spyOn(runtime as any, 'resolveTab').mockReturnValue({ tab });
  vi.spyOn(runtime as any, 'requirePage').mockReturnValue(page);
  return { runtime, tab };
}

const TEXT_10K = Array.from({ length: 250 }, (_, i) => `L${String(i).padStart(6, '0')} ${'abcdefghijklmnopqrstuvwxyz0123456'}`).join('\n'); // 10 499 chars
const HI = '\u{1F600}'.charAt(0);
const LO = '\u{1F600}'.charAt(1);

describe('constants', () => {
  it('exports the documented defaults and ceilings', () => {
    expect(DEFAULT_PAGE_TEXT_MAX_CHARS).toBe(4000);
    expect(MAX_PAGE_TEXT_CHARS).toBe(100_000);
    expect(MCP_MAX_PAGE_TEXT_CHARS).toBe(40_000);
  });
});

describe('validatePageTextOptions (S2-2)', () => {
  it('accepts undefined and valid values', () => {
    expect(validatePageTextOptions(undefined)).toEqual({ offset: 0, maxChars: 4000 });
    expect(validatePageTextOptions({ offset: 5, maxChars: 100000 })).toEqual({ offset: 5, maxChars: 100000 });
    expect(validatePageTextOptions({ maxChars: 1 })).toEqual({ offset: 0, maxChars: 1 });
  });
  it.each([
    [{ maxChars: 0 }, /maxChars/],
    [{ maxChars: 100001 }, /maxChars/],
    [{ maxChars: 1.5 }, /maxChars/],
    [{ maxChars: NaN }, /maxChars/],
    [{ offset: -1 }, /offset/],
    [{ offset: 1.5 }, /offset/],
    [{ offset: NaN }, /offset/],
  ])('rejects %j with a TypeError naming the parameter', (o, re) => {
    expect(() => validatePageTextOptions(o as any)).toThrow(TypeError);
    expect(() => validatePageTextOptions(o as any)).toThrow(re);
  });
});

describe('readTextWindow validation never reaches the browser (S2-2)', () => {
  it.each([{ maxChars: 0 }, { maxChars: 100001 }, { offset: -1 }, { maxChars: 1.5 }, { maxChars: NaN }])(
    'rejects %j with TypeError and evaluate call count 0',
    async (o) => {
      const { page } = fakePage({ contentType: 'text/html', body: { innerText: TEXT_10K } });
      const { runtime } = runtimeWith(page);
      await expect(runtime.readTextWindow('s1', undefined, o as any)).rejects.toThrow(TypeError);
      expect(page.evaluate).toHaveBeenCalledTimes(0);
    },
  );
});

describe('readTextWindow DOM windows (S2-1 logic)', () => {
  it('default window of a 10 499-char text: 4000 chars, totalChars 10499, truncated', async () => {
    const { page } = fakePage({ contentType: 'text/html', body: { innerText: TEXT_10K } });
    const { runtime } = runtimeWith(page);
    const r = await runtime.readTextWindow('s1');
    expect(TEXT_10K.length).toBe(10499);
    expect(r).toMatchObject({
      sessionId: 's1', tabId: 'tab_1', url: 'https://x.test/doc', offset: 0, returnedChars: 4000, totalChars: 10499, truncated: true, source: 'dom',
    });
    expect(r.text).toBe(TEXT_10K.slice(0, 4000));
  });

  it('windows at 0/4000/8000/... concatenate to exactly the full text and differ', async () => {
    const { page } = fakePage({ contentType: 'text/html', body: { innerText: TEXT_10K } });
    const { runtime } = runtimeWith(page);
    let acc = '';
    const seen = new Set<string>();
    for (let off = 0; ; ) {
      const r = await runtime.readTextWindow('s1', undefined, { offset: off });
      seen.add(r.text);
      acc += r.text;
      off += r.returnedChars;
      if (off >= r.totalChars) break;
    }
    expect(acc).toBe(TEXT_10K);
    expect(seen.size).toBe(3);
  });

  it('honours offset and maxChars; last window is not truncated-at-end but is truncated (offset > 0)', async () => {
    const { page } = fakePage({ contentType: 'text/html', body: { innerText: TEXT_10K } });
    const { runtime } = runtimeWith(page);
    const r = await runtime.readTextWindow('s1', undefined, { offset: 100, maxChars: 50 });
    expect(r.text).toBe(TEXT_10K.slice(100, 150));
    expect(r).toMatchObject({ offset: 100, returnedChars: 50, totalChars: 10499, truncated: true });
    const last = await runtime.readTextWindow('s1', undefined, { offset: 8000 });
    expect(last.text).toBe(TEXT_10K.slice(8000));
    expect(last.truncated).toBe(true);
    expect(last.offset + last.returnedChars).toBe(last.totalChars);
  });

  it('maxChars covering everything: not truncated', async () => {
    const { page } = fakePage({ contentType: 'text/html', body: { innerText: TEXT_10K } });
    const { runtime } = runtimeWith(page);
    const r = await runtime.readTextWindow('s1', undefined, { maxChars: 100000 });
    expect(r.text).toBe(TEXT_10K);
    expect(r.truncated).toBe(false);
  });

  it('totalChars is the FULL length, not the window length', async () => {
    const { page } = fakePage({ contentType: 'text/html', body: { innerText: 'x'.repeat(500) } });
    const { runtime } = runtimeWith(page);
    const r = await runtime.readTextWindow('s1', undefined, { maxChars: 10 });
    expect(r.returnedChars).toBe(10);
    expect(r.totalChars).toBe(500);
  });

  it('offset >= total: empty window, truncated true when total > 0, not an error', async () => {
    const { page } = fakePage({ contentType: 'text/html', body: { innerText: 'abc' } });
    const { runtime } = runtimeWith(page);
    const r = await runtime.readTextWindow('s1', undefined, { offset: 10 });
    expect(r).toMatchObject({ text: '', offset: 10, returnedChars: 0, totalChars: 3, truncated: true });
    const e = await runtime.readTextWindow('s1', undefined, { offset: 3 });
    expect(e).toMatchObject({ text: '', offset: 3, returnedChars: 0, totalChars: 3, truncated: true });
  });

  it('empty page (no body / empty text): empty window, not truncated, even with an offset', async () => {
    const { page } = fakePage({ contentType: 'text/html', body: null });
    const { runtime } = runtimeWith(page);
    expect(await runtime.readTextWindow('s1')).toMatchObject({ text: '', totalChars: 0, truncated: false, source: 'dom' });
    expect(await runtime.readTextWindow('s1', undefined, { offset: 5 })).toMatchObject({ text: '', totalChars: 0, truncated: false });
  });
});

describe('surrogate rules', () => {
  // 'a' x 3999, then a pair at 3999/4000, then 'b' x 100
  const T = 'a'.repeat(3999) + HI + LO + 'b'.repeat(100);

  it('window ending between a pair is extended by one (returnedChars = maxChars + 1)', async () => {
    const { page } = fakePage({ contentType: 'text/html', body: { innerText: T } });
    const { runtime } = runtimeWith(page);
    const r = await runtime.readTextWindow('s1');
    expect(r.returnedChars).toBe(4001);
    expect(r.text.endsWith(HI + LO)).toBe(true);
    expect(r.text.charCodeAt(r.text.length - 1)).toBe(LO.charCodeAt(0));
  });

  it('maxChars:1 at a pair returns 2 code units, never 0', async () => {
    const { page } = fakePage({ contentType: 'text/html', body: { innerText: T } });
    const { runtime } = runtimeWith(page);
    const r = await runtime.readTextWindow('s1', undefined, { offset: 3999, maxChars: 1 });
    expect(r.text).toBe(HI + LO);
    expect(r.returnedChars).toBe(2);
    expect(r.offset).toBe(3999);
  });

  it('offset on a low surrogate starts one earlier (effective offset reported)', async () => {
    const { page } = fakePage({ contentType: 'text/html', body: { innerText: T } });
    const { runtime } = runtimeWith(page);
    const r = await runtime.readTextWindow('s1', undefined, { offset: 4000, maxChars: 5 });
    expect(r.offset).toBe(3999);
    expect(r.text.startsWith(HI + LO)).toBe(true);
    expect(r.text.charCodeAt(0)).toBe(HI.charCodeAt(0));
  });

  it('maxChars:1 with the offset on a low surrogate returns the whole pair', async () => {
    const { page } = fakePage({ contentType: 'text/html', body: { innerText: T } });
    const { runtime } = runtimeWith(page);
    const r = await runtime.readTextWindow('s1', undefined, { offset: 4000, maxChars: 1 });
    expect(r.text).toBe(HI + LO);
    expect(r.returnedChars).toBe(2);
  });

  it('paging by returnedChars never splits a pair and concatenates to the full text', async () => {
    const { page } = fakePage({ contentType: 'text/html', body: { innerText: T } });
    const { runtime } = runtimeWith(page);
    let acc = '';
    for (let off = 0; off < T.length; ) {
      const r = await runtime.readTextWindow('s1', undefined, { offset: off, maxChars: 1000 });
      expect(r.returnedChars).toBeGreaterThan(0);
      const first = r.text.charCodeAt(0);
      const last = r.text.charCodeAt(r.text.length - 1);
      expect(first >= 0xdc00 && first <= 0xdfff).toBe(false);
      expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
      acc += r.text;
      off += r.returnedChars;
    }
    expect(acc).toBe(T);
  });

  it('the in-page window function and the Node-side windowPageText agree on every (offset, maxChars) over a surrogate-rich text', () => {
    const text = 'ab' + HI + LO + 'c' + HI + LO + HI + LO + 'de';
    (globalThis as any).document = { body: { innerText: text } };
    try {
      for (let o = 0; o <= text.length + 2; o++) {
        for (let m = 1; m <= text.length + 2; m++) {
          expect(pageWindowInPage(o, m)).toEqual(windowPageText(text, o, m));
        }
      }
    } finally {
      delete (globalThis as any).document;
    }
  });
});

describe('formatPageTextMarker (exact strings)', () => {
  it('A: more follows', () => {
    expect(formatPageTextMarker({ offset: 0, returnedChars: 4000, totalChars: 10249, truncated: true }, 'Continue with: sutradhar text --offset 4000')).toBe(
      '[page text truncated: showing characters 0-4000 of 10249. Continue with: sutradhar text --offset 4000]',
    );
  });
  it('A without a hint (SDK renderers)', () => {
    expect(formatPageTextMarker({ offset: 0, returnedChars: 4000, totalChars: 10249, truncated: true })).toBe(
      '[page text truncated: showing characters 0-4000 of 10249.]',
    );
  });
  it('B: last window of a paged read', () => {
    expect(formatPageTextMarker({ offset: 8000, returnedChars: 2249, totalChars: 10249, truncated: true })).toBe(
      '[page text: showing characters 8000-10249 of 10249 (end)]',
    );
  });
  it('C: offset past the end', () => {
    expect(formatPageTextMarker({ offset: 20000, returnedChars: 0, totalChars: 10249, truncated: true })).toBe(
      '[page text: offset 20000 is past the end; the page text has 10249 characters]',
    );
  });
  it('null when not truncated (marker never emitted for a complete read)', () => {
    expect(formatPageTextMarker({ offset: 0, returnedChars: 300, totalChars: 300, truncated: false })).toBeNull();
    expect(formatPageTextMarker({ offset: 0, returnedChars: 0, totalChars: 0, truncated: false })).toBeNull();
  });
  it('is ASCII only', () => {
    for (const m of [
      formatPageTextMarker({ offset: 0, returnedChars: 4, totalChars: 9, truncated: true }, 'h'),
      formatPageTextMarker({ offset: 5, returnedChars: 4, totalChars: 9, truncated: true }),
      formatPageTextMarker({ offset: 50, returnedChars: 0, totalChars: 9, truncated: true }),
    ]) {
      expect(/^[\x20-\x7e]+$/.test(m!)).toBe(true);
    }
  });
});

describe('failure semantics (S2-4)', () => {
  it('a rejecting DOM evaluate makes readTextWindow reject PageTextReadError(dom), never an empty result', async () => {
    const { page } = fakePage({ contentType: 'text/html', body: { innerText: TEXT_10K } }, { evalThrows: true });
    const { runtime } = runtimeWith(page);
    const p = runtime.readTextWindow('s1');
    await expect(p).rejects.toMatchObject({ name: 'PageTextReadError', source: 'dom' });
    await expect(runtime.readTextWindow('s1')).rejects.toThrow(/Execution context was destroyed/);
    await expect(runtime.readTextWindow('s1')).rejects.toBeInstanceOf(PageTextReadError);
  });

  it.each(['probe', 'window'] as const)('only the %s evaluate rejecting still makes readTextWindow reject PageTextReadError(dom)', async (throwOn) => {
    const { page } = fakePage({ contentType: 'text/html', body: { innerText: TEXT_10K } }, { throwOn });
    const { runtime } = runtimeWith(page);
    await expect(runtime.readTextWindow('s1')).rejects.toMatchObject({ name: 'PageTextReadError', source: 'dom' });
    await expect(runtime.readTextWindow('s1')).rejects.toThrow(/Execution context was destroyed/);
  });

  it.each(['probe', 'window'] as const)('only the %s evaluate rejecting: snapshot() reports pageTextError, keeps the listing', async (throwOn) => {
    const { page } = fakePage({ contentType: 'text/html', body: { innerText: TEXT_10K } }, { throwOn });
    const { runtime } = runtimeWith(page);
    vi.spyOn((runtime as any).domEngine, 'buildGraph').mockResolvedValue({ nodes: [], url: 'https://x.test/doc', title: 'T' });
    const s = await runtime.snapshot('s1');
    expect(s.pageText).toBe('');
    expect(s.pageTextError).toMatch(/Execution context was destroyed/);
  });

  it('snapshot() stays tolerant: pageText "" + pageTextError, zero totals, not truncated', async () => {
    const { page } = fakePage({ contentType: 'text/html', body: { innerText: TEXT_10K } }, { evalThrows: true });
    const { runtime } = runtimeWith(page);
    vi.spyOn((runtime as any).domEngine, 'buildGraph').mockResolvedValue({ nodes: [], url: 'https://x.test/doc', title: 'T' });
    const s = await runtime.snapshot('s1');
    expect(s.pageText).toBe('');
    expect(s.pageTextTotalChars).toBe(0);
    expect(s.pageTextTruncated).toBe(false);
    expect(s.pageTextError).toMatch(/Execution context was destroyed/);
  });

  it('snapshot() success: window of 4000 by default, totals, no pageTextError key', async () => {
    const { page } = fakePage({ contentType: 'text/html', body: { innerText: TEXT_10K } });
    const { runtime } = runtimeWith(page);
    vi.spyOn((runtime as any).domEngine, 'buildGraph').mockResolvedValue({ nodes: [], url: 'https://x.test/doc', title: 'T' });
    const s = await runtime.snapshot('s1');
    expect(s.pageText).toBe(TEXT_10K.slice(0, 4000));
    expect(s.pageTextTotalChars).toBe(10499);
    expect(s.pageTextTruncated).toBe(true);
    expect('pageTextError' in s).toBe(false);
    const s2 = await runtime.snapshot('s1', undefined, undefined, { textMaxChars: 5000 });
    expect(s2.pageText).toBe(TEXT_10K.slice(0, 5000));
  });

  it('snapshot() of a short page: byte-identical text, not truncated', async () => {
    const { page } = fakePage({ contentType: 'text/html', body: { innerText: 'short text' } });
    const { runtime } = runtimeWith(page);
    vi.spyOn((runtime as any).domEngine, 'buildGraph').mockResolvedValue({ nodes: [], url: 'https://x.test/doc', title: 'T' });
    const s = await runtime.snapshot('s1');
    expect(s.pageText).toBe('short text');
    expect(s.pageTextTruncated).toBe(false);
    expect(s.pageTextTotalChars).toBe(10);
  });

  it('snapshot() rejects an invalid textMaxChars with TypeError', async () => {
    const { page } = fakePage({ contentType: 'text/html', body: { innerText: 'x' } });
    const { runtime } = runtimeWith(page);
    await expect(runtime.snapshot('s1', undefined, undefined, { textMaxChars: 0 })).rejects.toThrow(TypeError);
  });

  it('PDF detected + parse throws -> PageTextReadError(source:pdf), never a dom result', async () => {
    pdfParseState.throws = true;
    const { page, calls } = fakePage({ contentType: 'application/pdf', body: { innerText: '' } }, { pdfBase64: Buffer.from('%PDF').toString('base64') });
    const { runtime } = runtimeWith(page);
    await expect(runtime.readTextWindow('s1')).rejects.toMatchObject({ name: 'PageTextReadError', source: 'pdf' });
    expect(calls.window).toBe(0);
    pdfParseState.throws = false;
  });

  it('PDF byte fetch failing -> PageTextReadError(source:pdf), no DOM fallback', async () => {
    const { page, calls } = fakePage({ contentType: 'application/pdf', body: { innerText: 'viewer text' } }, { pdfFetchThrows: true });
    const { runtime } = runtimeWith(page);
    await expect(runtime.readTextWindow('s1')).rejects.toMatchObject({ name: 'PageTextReadError', source: 'pdf' });
    expect(calls.window).toBe(0);
  });
});

describe('PDF path', () => {
  it('g1/PROB-052: a bundled-build "DOMMatrix is not defined" failure is mapped to the documented limitation message (same error class)', async () => {
    const orig = pdfParseState.throws;
    pdfParseState.throws = 'domMatrix' as any;
    const { page } = fakePage({ contentType: 'application/pdf', body: { innerText: '' } }, { pdfBase64: Buffer.from('%PDF').toString('base64') });
    const { runtime } = runtimeWith(page);
    const p = runtime.readTextWindow('s1');
    await expect(p).rejects.toMatchObject({ name: 'PageTextReadError', source: 'pdf' });
    await expect(runtime.readTextWindow('s1')).rejects.toThrow(/PDF text extraction is not available in this build \(PROB-052\)/);
    await expect(runtime.readTextWindow('s1')).rejects.not.toThrow(/^DOMMatrix/);
    pdfParseState.throws = orig;
  });

  it('PDF ok (9000 chars mocked) is windowed with source:pdf; the 4000 cap is gone', async () => {
    pdfParseState.text = 'p'.repeat(9000);
    const { page, calls } = fakePage({ contentType: 'application/pdf', body: { innerText: '' } }, { pdfBase64: Buffer.from('%PDF').toString('base64') });
    const { runtime } = runtimeWith(page);
    const r = await runtime.readTextWindow('s1');
    expect(r).toMatchObject({ source: 'pdf', totalChars: 9000, returnedChars: 4000, truncated: true, offset: 0 });
    const r2 = await runtime.readTextWindow('s1', undefined, { offset: 4000, maxChars: 100000 });
    expect(r2).toMatchObject({ source: 'pdf', returnedChars: 5000, totalChars: 9000, offset: 4000, truncated: true });
    expect(r2.text).toBe('p'.repeat(5000));
    expect(calls.window).toBe(0);
  });

  it('PDF that parses to empty text: text "", totalChars 0, source pdf, no error, no DOM fallback', async () => {
    pdfParseState.text = '';
    const { page, calls } = fakePage({ contentType: 'application/pdf', body: { innerText: 'DOM TEXT MUST NOT BE USED' } }, { pdfBase64: Buffer.from('%PDF').toString('base64') });
    const { runtime } = runtimeWith(page);
    const r = await runtime.readTextWindow('s1');
    expect(r).toMatchObject({ text: '', totalChars: 0, returnedChars: 0, truncated: false, source: 'pdf', offset: 0 });
    expect(calls.window).toBe(0); // the DOM innerText evaluate was never run
  });

  it('snapshot() of a PDF windows the parsed text (source of pageText is the PDF, not the viewer DOM)', async () => {
    pdfParseState.text = 'q'.repeat(6000);
    const { page } = fakePage({ contentType: 'application/pdf', body: { innerText: '' } }, { pdfBase64: Buffer.from('%PDF').toString('base64') });
    const { runtime } = runtimeWith(page);
    vi.spyOn((runtime as any).domEngine, 'buildGraph').mockResolvedValue({ nodes: [], url: 'https://x.test/doc', title: 'T' });
    const s = await runtime.snapshot('s1');
    expect(s.pageText).toBe('q'.repeat(4000));
    expect(s.pageTextTotalChars).toBe(6000);
    expect(s.pageTextTruncated).toBe(true);
  });
});

describe('snapshot() calls pageTextWindow (the renamed private reader)', () => {
  it('fails if snapshot() stops using pageTextWindow(tab, {offset:0, maxChars})', async () => {
    const runtime = new SutradharRuntime();
    const tab = { id: 'tab_1', url: 'https://x.test', title: 'T' };
    vi.spyOn(runtime as any, 'resolveTab').mockReturnValue({ tab });
    vi.spyOn(runtime as any, 'requirePage').mockReturnValue({});
    vi.spyOn((runtime as any).domEngine, 'buildGraph').mockResolvedValue({ nodes: [], url: 'https://x.test', title: 'T' });
    const spy = vi.spyOn(runtime as any, 'pageTextWindow').mockResolvedValue({ text: 'MOCKED', offset: 0, totalChars: 6, source: 'dom' });
    const s = await runtime.snapshot('s1', undefined, undefined, { textMaxChars: 123 });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(tab, { offset: 0, maxChars: 123 });
    expect(s.pageText).toBe('MOCKED');
    expect(s.pageTextTotalChars).toBe(6);
    expect(s.pageTextTruncated).toBe(false);
  });
});
