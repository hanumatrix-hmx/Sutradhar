/**
 * @file packages/sutradhar/tests/unit/page-text.spec.ts
 * @description I-048 (release 0.6.2): `page.text()` delegation and the page-text exports of the SDK entry point.
 * No browser: a stub runtime records what the Page passes to it.
 */
import * as sdk from '../../src/index.js';
import { Page, PageTextReadError, formatPageTextMarker, DEFAULT_PAGE_TEXT_MAX_CHARS, MAX_PAGE_TEXT_CHARS } from '../../src/index.js';
import type { PageTextResult } from '../../src/index.js';

const result: PageTextResult = {
  sessionId: 'sess_1', tabId: 'tab_7', url: 'https://x.test/', text: 'abc', offset: 0, returnedChars: 3, totalChars: 9, truncated: true, source: 'dom',
};

function pageWith(readTextWindow: (...a: any[]) => Promise<PageTextResult>) {
  return new Page({ readTextWindow } as any, 'sess_1', 'tab_7');
}

describe('page.text()', () => {
  it('delegates to runtime.readTextWindow with the session id, THIS page tab id and the exact options (M-048n: tabId must not be dropped)', async () => {
    const readTextWindow = vi.fn(async () => result);
    const r = await pageWith(readTextWindow).text({ offset: 4000, maxChars: 2000 });
    expect(readTextWindow).toHaveBeenCalledTimes(1);
    expect(readTextWindow).toHaveBeenCalledWith('sess_1', 'tab_7', { offset: 4000, maxChars: 2000 });
    expect(r).toBe(result);
  });

  it('with no options passes undefined (the runtime default window applies)', async () => {
    const readTextWindow = vi.fn(async () => result);
    await pageWith(readTextWindow).text();
    expect(readTextWindow).toHaveBeenCalledWith('sess_1', 'tab_7', undefined);
  });

  it('propagates a rejection unchanged (PageTextReadError, TypeError for invalid options)', async () => {
    const err = Object.assign(new Error('the page text could not be read: boom'), { name: 'PageTextReadError' });
    await expect(pageWith(async () => { throw err; }).text()).rejects.toBe(err);
    const te = new TypeError('maxChars must be an integer from 1 to 100000 (got 0)');
    await expect(pageWith(async () => { throw te; }).text({ maxChars: 0 })).rejects.toBe(te);
  });
});

describe('page-text exports (M-048o)', () => {
  it('exports PageTextReadError, formatPageTextMarker and the constants from the SDK entry point', () => {
    expect(typeof PageTextReadError).toBe('function');
    expect(typeof formatPageTextMarker).toBe('function');
    expect(DEFAULT_PAGE_TEXT_MAX_CHARS).toBe(4000);
    expect(MAX_PAGE_TEXT_CHARS).toBe(100000);
    for (const k of ['PageTextReadError', 'formatPageTextMarker', 'DEFAULT_PAGE_TEXT_MAX_CHARS', 'MAX_PAGE_TEXT_CHARS']) {
      expect(Object.keys(sdk)).toContain(k);
    }
  });

  it('PageTextReadError is identified by name and carries the source', () => {
    const e = new PageTextReadError('pdf', 'x');
    expect(e.name).toBe('PageTextReadError');
    expect(e.source).toBe('pdf');
    expect(e).toBeInstanceOf(Error);
  });

  it('formatPageTextMarker renders the shared marker (SDK form: no continue hint)', () => {
    expect(formatPageTextMarker(result)).toBe('[page text truncated: showing characters 0-3 of 9.]');
    expect(formatPageTextMarker({ ...result, truncated: false, returnedChars: 9, totalChars: 9 })).toBeNull();
  });
});
