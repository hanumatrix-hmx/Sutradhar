/**
 * @file packages/utils/src/formatters/dom-cleaner.ts
 * @description HTML DOM pruning and cleaning utility for LLM context optimization.
 */

export interface DomCleanerOptions {
  readonly removeScripts?: boolean;
  readonly removeStyles?: boolean;
  readonly removeComments?: boolean;
  readonly removeSvgPaths?: boolean;
  readonly maxAttributeLength?: number;
}

/**
 * Prunes heavy HTML tags (scripts, styles, SVGs, comments) to clean DOM representation for LLMs.
 */
export function cleanHtmlDom(rawHtml: string, options: DomCleanerOptions = {}): string {
  const removeScripts = options.removeScripts ?? true;
  const removeStyles = options.removeStyles ?? true;
  const removeComments = options.removeComments ?? true;
  const removeSvgPaths = options.removeSvgPaths ?? true;

  let cleaned = rawHtml;

  if (removeComments) {
    cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, '');
  }

  if (removeScripts) {
    cleaned = cleaned.replace(/<script[\s\S]*?<\/script>/gi, '');
  }

  if (removeStyles) {
    cleaned = cleaned.replace(/<style[\s\S]*?<\/style>/gi, '');
    cleaned = cleaned.replace(/style="[^"]*"/gi, '');
  }

  if (removeSvgPaths) {
    cleaned = cleaned.replace(/<svg[\s\S]*?<\/svg>/gi, '<svg>[SVG Icon]</svg>');
  }

  // Remove multiple consecutive blank lines or whitespace spaces
  cleaned = cleaned.replace(/[ \t]+/g, ' ');
  cleaned = cleaned.replace(/\s+>/g, '>');
  cleaned = cleaned.replace(/\n\s*\n/g, '\n');

  return cleaned.trim();
}
