/**
 * @file packages/contracts/src/dto/browser-dto.ts
 * @description Canonical DTOs for the Browser Domain.
 */

import { SessionId, TabId } from '../shared/identifiers.js';
import { Timestamp } from '../shared/primitives.js';

export interface BrowserTabDto {
  readonly id: TabId;
  readonly url: string;
  readonly title: string;
  readonly isActive: boolean;
  /** @deprecated use isActive; retained for transition. */
  readonly active?: boolean;
  readonly loading?: boolean;
  readonly canGoBack?: boolean;
  readonly canGoForward?: boolean;
  readonly historyStack?: readonly string[];
  readonly historyIndex?: number;
}

export interface BrowserSessionDto {
  readonly id: SessionId;
  readonly activeTabId?: TabId;
  readonly tabs: readonly BrowserTabDto[];
  readonly createdAt: Timestamp;
  readonly isIncognito: boolean;
}

export interface BrowserElementDto {
  readonly elementId: number;
  readonly tagName: string;
  readonly role?: string;
  readonly name?: string;
  readonly value?: string;
  readonly isClickable: boolean;
  readonly isVisible: boolean;
  readonly isEnabled: boolean;
}

export interface BrowserSnapshotDto {
  readonly sessionId: SessionId;
  readonly tabId: TabId;
  readonly url: string;
  readonly title: string;
  readonly elements: readonly BrowserElementDto[];
  readonly semanticTree: string;
  readonly timestamp: Timestamp;
}

export interface BrowserActionDto {
  /**
   * Action discriminator. The extended set below mirrors what the BrowserActionEngine
   * actually supports; the original narrow union is retained as a subset.
   */
  readonly type:
    | 'click'
    | 'type'
    | 'navigate'
    | 'scroll'
    | 'hover'
    | 'pressKey'
    | 'evaluate'
    | 'screenshot';
  /** Stable per-snapshot element id stamped as data-sd-node-id on the live DOM. */
  readonly targetElementId?: number;
  /** Free-form CSS selector (used when the action is built directly, not from a snapshot id). */
  readonly targetSelector?: string;
  /** Text to type into an input. */
  readonly textValue?: string;
  /** Legacy alias for {@link textValue}. */
  readonly textInput?: string;
  /** Optional id echoed back by callers to correlate results. */
  readonly id?: string;
  readonly url?: string;
  readonly key?: string;
  readonly expression?: string;
}

export interface BrowserActionResultDto {
  readonly success: boolean;
  readonly actionType: string;
  readonly executionTimeMs: number;
  readonly error?: string;
  readonly newUrl?: string;
  readonly resultOutput?: unknown;
  /** Optional id echoed from the request {@link BrowserActionDto.id}. */
  readonly actionId?: string;
  /** Optional structured payload (e.g. screenshot data URI, extracted data). */
  readonly data?: Record<string, unknown>;
}
