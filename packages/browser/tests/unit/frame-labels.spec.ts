/**
 * @file packages/browser/tests/unit/frame-labels.spec.ts
 * @description Unit tests for the pure frame/shadow-label helpers (FR2-09).
 */

import {
  displayFrameUrl,
  frameOrigin,
  sanitizeFrameName,
  frameDesignator,
  formatShadowChain,
  orderSnapshotFrames,
  formatSkippedFrameLines,
  SKIPPED_REASON_TEXT,
  type SkippedFrame,
} from '../../src/dom/frame-labels.js';

describe('@sutradhar/browser frame-labels displayFrameUrl (L1)', () => {
  it('drops query and fragment for http(s) URLs', () => {
    expect(displayFrameUrl('https://pay.test/a/b?sid=1#x')).toBe('https://pay.test/a/b');
  });

  it('leaves a short http URL unchanged', () => {
    expect(displayFrameUrl('http://localhost:5173/frame')).toBe('http://localhost:5173/frame');
  });

  it('leaves about: URLs unchanged', () => {
    expect(displayFrameUrl('about:srcdoc')).toBe('about:srcdoc');
    expect(displayFrameUrl('about:blank')).toBe('about:blank');
  });

  it('collapses data: URIs', () => {
    expect(displayFrameUrl('data:text/html,<b>x')).toBe('data:…');
  });

  it('shows only the inner origin for blob: URLs', () => {
    expect(displayFrameUrl('blob:https://x.test/uuid')).toBe('blob:https://x.test');
  });

  it('keeps a short file: URL as-is', () => {
    expect(displayFrameUrl('file:///E:/a/b/c.html')).toBe('file:///E:/a/b/c.html');
  });

  it('middle-truncates a long https URL to 80 chars, keeping the tail', () => {
    const long = 'https://example.test/' + 'a'.repeat(200);
    const out = displayFrameUrl(long);
    expect(out.length).toBe(80);
    expect(out).toContain('…');
    expect(out.endsWith(long.slice(long.length - 41))).toBe(true);
  });

  it('returns "(no url)" for an empty string', () => {
    expect(displayFrameUrl('')).toBe('(no url)');
  });

  it('FR2-09 fix-1 (GAP-144 remedy): a file: URL long enough to need truncation shows only the file name, not a middle-truncated absolute path', () => {
    const deep = 'file:///E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041/tools/engine-comparison/hard-fixtures/nested-shadow-in-iframe-inner.html';
    expect(displayFrameUrl(deep)).toBe('file://nested-shadow-in-iframe-inner.html');
  });

  it('a short file: URL is completely unaffected by the long-path remedy', () => {
    expect(displayFrameUrl('file:///E:/a/b/c.html')).toBe('file:///E:/a/b/c.html');
  });

  it('returns the raw string unchanged for unparsable input, never throwing', () => {
    expect(() => displayFrameUrl('not a url')).not.toThrow();
    expect(displayFrameUrl('not a url')).toBe('not a url');
  });
});

describe('@sutradhar/browser frame-labels frameOrigin (L2)', () => {
  it('returns origin only for http(s)', () => {
    expect(frameOrigin('https://pay.test/a?b')).toBe('https://pay.test');
  });
  it('returns "file://" for a file: URL', () => {
    expect(frameOrigin('file:///x')).toBe('file://');
  });
  it('returns the about: URL unchanged', () => {
    expect(frameOrigin('about:srcdoc')).toBe('about:srcdoc');
  });
  it('returns "chrome-error://" for a browser error page URL', () => {
    expect(frameOrigin('chrome-error://chromewebdata/')).toBe('chrome-error://');
  });
  it('returns "(no url)" for an empty string', () => {
    expect(frameOrigin('')).toBe('(no url)');
  });
});

describe('@sutradhar/browser frame-labels sanitizeFrameName (L3, D14/N7)', () => {
  it('strips characters that could forge a line or close a bracket', () => {
    const evil = 'evil"]\n[#1] button "Pay';
    const out = sanitizeFrameName(evil);
    expect(out).not.toContain('"');
    expect(out).not.toContain(']');
    expect(out).not.toContain('[');
    expect(out).not.toContain('\n');
    expect(out.length).toBeLessThanOrEqual(30);
  });
  it('trims surrounding whitespace', () => {
    expect(sanitizeFrameName('  pay ')).toBe('pay');
  });
  it('returns an empty string for undefined', () => {
    expect(sanitizeFrameName(undefined)).toBe('');
  });
});

describe('@sutradhar/browser frame-labels frameDesignator (L4)', () => {
  it('quotes the name when unique among the graph\'s frame names', () => {
    expect(frameDesignator({ name: 'pay', index: 1 }, ['pay'])).toBe('"pay"');
  });
  it('falls back to the bare index when the name is duplicated', () => {
    expect(frameDesignator({ name: 'dup', index: 4 }, ['dup', 'dup'])).toBe('4');
  });
  it('falls back to the bare index when there is no name', () => {
    expect(frameDesignator({ index: 3 }, [])).toBe('3');
  });
  it('falls back to "?" when neither name nor index is known', () => {
    expect(frameDesignator({}, [])).toBe('?');
  });
  it('falls back to "?" for a whitespace-only name with no index', () => {
    expect(frameDesignator({ name: '  ' }, [])).toBe('?');
  });
});

describe('@sutradhar/browser frame-labels formatShadowChain (L5, D2)', () => {
  it('renders a chain of 1 as-is', () => {
    expect(formatShadowChain(['a'])).toBe('a');
  });
  it('renders a chain of 2 as "a > b"', () => {
    expect(formatShadowChain(['a', 'b'])).toBe('a > b');
  });
  it('renders a chain of 3 as first " > … > " last', () => {
    expect(formatShadowChain(['a', 'b', 'c'])).toBe('a > … > c');
  });
  it('renders a chain of 4+ the same way (outermost plus innermost only)', () => {
    expect(formatShadowChain(['a', 'b', 'c', 'd'])).toBe('a > … > d');
  });
});

interface MockFrame {
  isDetached(): boolean;
}

function mkFrame(detached = false): MockFrame {
  return { isDetached: () => detached };
}

describe('@sutradhar/browser frame-labels orderSnapshotFrames (L6, D3)', () => {
  it('puts main first, then the remaining frames in their given order', () => {
    const main = mkFrame();
    const c1 = mkFrame();
    const c2 = mkFrame();
    expect(orderSnapshotFrames([c1, main, c2], main)).toEqual([main, c1, c2]);
  });

  it('drops detached children', () => {
    const main = mkFrame();
    const c1 = mkFrame(true);
    const c2 = mkFrame();
    expect(orderSnapshotFrames([main, c1, c2], main)).toEqual([main, c2]);
  });

  it('keeps a detached main frame first regardless', () => {
    const main = mkFrame(true);
    const c1 = mkFrame();
    expect(orderSnapshotFrames([main, c1], main)).toEqual([main, c1]);
  });
});

describe('@sutradhar/browser frame-labels formatSkippedFrameLines (L7, D6)', () => {
  function skipped(overrides: Partial<SkippedFrame>): SkippedFrame {
    return { index: 1, url: 'https://ads.example/x', origin: 'https://ads.example', reason: 'timeout', ...overrides };
  }

  it('renders each reason exactly per the D6 table', () => {
    expect(
      formatSkippedFrameLines(
        [skipped({ name: 'ads', reason: 'timeout', detail: '5000', origin: 'https://ads.example' })],
        20,
      ),
    ).toEqual(['[iframe "ads" https://ads.example — not inspectable] (timed out after 5000ms)']);

    expect(
      formatSkippedFrameLines([skipped({ reason: 'navigated', url: 'http://localhost:5173', origin: 'http://localhost:5173' })], 20),
    ).toEqual(['[iframe http://localhost:5173 — not inspectable] (navigated during snapshot)']);

    expect(
      formatSkippedFrameLines(
        [skipped({ reason: 'error', detail: 'Protocol error: boom', origin: 'http://x.test' })],
        20,
      ),
    ).toEqual(['[iframe http://x.test — not inspectable] (error: Protocol error: boom)']);

    expect(
      formatSkippedFrameLines(
        [skipped({ reason: 'error-page', url: 'http://localhost:5173', origin: 'http://localhost:5173' })],
        20,
      ),
    ).toEqual(['[iframe http://localhost:5173 — not inspectable] (browser error page: blocked or failed to load)']);
  });

  it('aggregates frame-limit entries into a single line, pluralized correctly', () => {
    const four = [1, 2, 3, 4].map((i) => skipped({ index: i, reason: 'frame-limit' }));
    expect(formatSkippedFrameLines(four, 20)).toEqual(['[4 more iframes not scanned — frame limit 20]']);

    const one = [skipped({ reason: 'frame-limit' })];
    expect(formatSkippedFrameLines(one, 20)).toEqual(['[1 more iframe not scanned — frame limit 20]']);
  });

  it('orders per-frame lines first (input order), then the aggregate line', () => {
    const lines = formatSkippedFrameLines(
      [
        skipped({ index: 1, reason: 'frame-limit' }),
        skipped({ index: 2, reason: 'timeout', detail: '5000' }),
        skipped({ index: 3, reason: 'frame-limit' }),
      ],
      20,
    );
    expect(lines).toEqual([
      expect.stringContaining('timed out after 5000ms'),
      expect.stringContaining('2 more iframes not scanned'),
    ]);
  });

  it('SKIPPED_REASON_TEXT covers every reason except frame-limit', () => {
    expect(SKIPPED_REASON_TEXT.timeout('5000')).toBe('timed out after 5000ms');
    expect(SKIPPED_REASON_TEXT.navigated()).toBe('navigated during snapshot');
    expect(SKIPPED_REASON_TEXT.error('boom')).toBe('error: boom');
    expect(SKIPPED_REASON_TEXT['error-page']()).toBe('browser error page: blocked or failed to load');
  });
});
