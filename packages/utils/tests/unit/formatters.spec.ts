/**
 * @file packages/utils/tests/unit/formatters.spec.ts
 * @description Unit tests for DOM cleaner, token estimator, and string sanitizer utilities.
 */

import {
  cleanHtmlDom,
  estimateTokenCount,
  truncateToTokenLimit,
  sanitizePromptText,
} from '../../src/index.js';

describe('Formatters & DOM Cleaning Utilities', () => {
  it('should clean DOM by pruning script, style, SVG tags and comments', () => {
    const rawHtml = `
      <html>
        <!-- Comment to remove -->
        <head>
          <style>body { color: red; }</style>
          <script>console.log("bad");</script>
        </head>
        <body>
          <h1 style="color: blue;">Title</h1>
          <svg><path d="M0 0h10v10H0z"/></svg>
        </body>
      </html>
    `;

    const cleaned = cleanHtmlDom(rawHtml);

    expect(cleaned).not.toContain('<script>');
    expect(cleaned).not.toContain('<style>');
    expect(cleaned).not.toContain('<!-- Comment');
    expect(cleaned).not.toContain('path d=');
    expect(cleaned).toContain('<h1>Title</h1>');
    expect(cleaned).toContain('<svg>[SVG Icon]</svg>');
  });

  it('should estimate token count correctly', () => {
    const text = '1234567890123456'; // 16 chars -> ~4 tokens
    expect(estimateTokenCount(text)).toBe(4);
    expect(estimateTokenCount('')).toBe(0);
  });

  it('should truncate text to token limit', () => {
    const longText = 'A'.repeat(100); // 100 chars -> 25 tokens
    const truncated = truncateToTokenLimit(longText, 5); // 5 tokens -> 20 chars limit

    expect(truncated.length).toBeLessThan(longText.length);
    expect(truncated).toContain('... [Truncated]');
  });

  it('should sanitize prompt text by removing non-printable control characters', () => {
    const dirtyText = 'Hello\x00 World\x07!\nLine 2';
    const clean = sanitizePromptText(dirtyText);

    expect(clean).toBe('Hello World!\nLine 2');
  });
});
