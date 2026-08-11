/**
 * @file packages/browser/src/snapshot/semantic-tree-builder.ts
 * @description Builder for transforming element DTO arrays into human/LLM readable indented semantic trees.
 */

import { BrowserElementDto } from '@sutradhar/contracts';

export class SemanticTreeBuilder {
  /**
   * Renders an array of interactive element DTOs into a concise formatted string for LLM context windows.
   */
  public static buildTree(elements: readonly BrowserElementDto[]): string {
    if (elements.length === 0) {
      return '[No interactive elements detected on page]';
    }

    const lines: string[] = [];
    lines.push('--- Interactive Page Elements ---');

    for (const el of elements) {
      const parts: string[] = [];
      parts.push(`[${el.elementId}]`);
      parts.push(el.tagName);

      if (el.role) {
        parts.push(`role="${el.role}"`);
      }
      if (el.name) {
        parts.push(`"${el.name}"`);
      }
      if (el.value) {
        parts.push(`value="${el.value}"`);
      }
      if (!el.isEnabled) {
        parts.push('(disabled)');
      }

      lines.push(parts.join(' '));
    }

    return lines.join('\n');
  }
}
