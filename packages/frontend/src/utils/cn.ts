/**
 * @file packages/frontend/src/utils/cn.ts
 * @description Class name composition utility — merges conditional CSS class strings.
 */

/**
 * Joins class name strings, filtering out falsy values.
 * Usage: cn('pt-btn', isActive && 'pt-btn--active', className)
 */
export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ');
}
