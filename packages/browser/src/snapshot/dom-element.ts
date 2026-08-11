/**
 * @file packages/browser/src/snapshot/dom-element.ts
 * @description Raw element node definitions and DTO conversion utilities for DOM snapshotting.
 */

import { BrowserElementDto } from '@pinchtab/contracts';

export interface RawElementNode {
  readonly tagName: string;
  readonly role?: string;
  readonly name?: string;
  readonly value?: string;
  readonly isClickable?: boolean;
  readonly isVisible?: boolean;
  readonly isEnabled?: boolean;
  readonly children?: readonly RawElementNode[];
}

/**
 * Transforms a raw DOM node into a canonical BrowserElementDto with assigned integer elementId.
 */
export function createBrowserElementDto(
  node: RawElementNode,
  elementId: number,
): BrowserElementDto {
  return {
    elementId,
    tagName: node.tagName.toLowerCase(),
    ...(node.role ? { role: node.role } : {}),
    ...(node.name ? { name: node.name } : {}),
    ...(node.value ? { value: node.value } : {}),
    isClickable: node.isClickable ?? false,
    isVisible: node.isVisible ?? true,
    isEnabled: node.isEnabled ?? true,
  };
}
