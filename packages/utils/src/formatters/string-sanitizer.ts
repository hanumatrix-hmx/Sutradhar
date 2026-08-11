/**
 * @file packages/utils/src/formatters/string-sanitizer.ts
 * @description String sanitization helpers for prompt injection defense and logging.
 */

/**
 * Sanitizes untrusted text before injecting into prompt context windows.
 */
export function sanitizePromptText(text: string): string {
  if (!text) {
    return '';
  }

  // Remove null bytes and non-printable control characters (except newlines & tabs)
  // eslint-disable-next-line no-control-regex
  let sanitized = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // Normalize Unicode spaces
  sanitized = sanitized.replace(/[\u200B-\u200D\uFEFF]/g, '');

  return sanitized.trim();
}
