/**
 * @file packages/browser/src/snapshot/snapshot-generator.ts
 * @description SnapshotGenerator service creating BrowserSnapshotDto with interactive element filtering and semantic tree building.
 */

import { SessionId, TabId, BrowserSnapshotDto, BrowserElementDto } from '@pinchtab/contracts';
import { RawElementNode, createBrowserElementDto } from './dom-element.js';
import { SemanticTreeBuilder } from './semantic-tree-builder.js';

export interface ISnapshotGenerator {
  generateSnapshot(
    sessionId: SessionId,
    tabId: TabId,
    url: string,
    title: string,
    nodes?: readonly RawElementNode[],
    rawHtml?: string,
  ): Promise<BrowserSnapshotDto>;
}

export class SnapshotGenerator implements ISnapshotGenerator {
  /**
   * Filters interactive elements, assigns element IDs, builds semantic tree, and returns BrowserSnapshotDto.
   */
  public async generateSnapshot(
    sessionId: SessionId,
    tabId: TabId,
    url: string,
    title: string,
    nodes: readonly RawElementNode[] = [],
    _rawHtml = '',
  ): Promise<BrowserSnapshotDto> {
    const interactiveElements: BrowserElementDto[] = [];
    let elementIdCounter = 1;

    for (const node of nodes) {
      if (this.isInteractiveNode(node)) {
        const dto = createBrowserElementDto(node, elementIdCounter);
        interactiveElements.push(dto);
        elementIdCounter++;
      }
    }

    const semanticTree = SemanticTreeBuilder.buildTree(interactiveElements);

    return {
      sessionId,
      tabId,
      url,
      title,
      elements: interactiveElements,
      semanticTree,
      timestamp: new Date().toISOString(),
    };
  }

  private isInteractiveNode(node: RawElementNode): boolean {
    if (node.isVisible === false) {
      return false;
    }

    const tag = node.tagName.toLowerCase();
    const interactiveTags = ['a', 'button', 'input', 'select', 'textarea', 'option', 'details'];
    if (interactiveTags.includes(tag)) {
      return true;
    }

    if (
      node.isClickable ||
      node.role === 'button' ||
      node.role === 'link' ||
      node.role === 'checkbox'
    ) {
      return true;
    }

    return false;
  }
}
