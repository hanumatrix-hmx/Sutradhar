/**
 * @file packages/config/src/provider/secret-masker.ts
 * @description Secret masking and sanitization helper for safe logging.
 */

/**
 * Masks sensitive API keys or passwords, showing only a small prefix/suffix.
 */
export function maskSecret(secret?: string, visibleChars = 4): string {
  if (!secret || secret.length === 0) {
    return '[EMPTY]';
  }

  if (secret.length <= visibleChars * 2) {
    return '***masked***';
  }

  const prefix = secret.slice(0, visibleChars);
  const suffix = secret.slice(-visibleChars);
  const maskedLength = Math.max(6, secret.length - visibleChars * 2);

  return `${prefix}${'*'.repeat(maskedLength)}${suffix}`;
}
