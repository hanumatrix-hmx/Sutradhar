/**
 * @file packages/utils/src/formatters/token-estimator.ts
 * @description Fast non-blocking token count estimator and truncation helpers.
 */

/**
 * Estimates the token count of a given text string.
 * Uses standard heuristic (~4 characters per BPE token for English/code).
 */
export function estimateTokenCount(text: string): number {
  if (!text || text.length === 0) {
    return 0;
  }
  return Math.ceil(text.length / 4);
}

/**
 * Safely truncates a text string to fit within a specified maximum token budget.
 */
export function truncateToTokenLimit(text: string, maxTokens: number): string {
  if (maxTokens <= 0) {
    return '';
  }

  const estimatedTokens = estimateTokenCount(text);
  if (estimatedTokens <= maxTokens) {
    return text;
  }

  const maxChars = maxTokens * 4;
  return text.substring(0, maxChars) + '... [Truncated]';
}
