/**
 * @file packages/contracts/src/requests/api-requests.ts
 * @description API Request payload interfaces.
 */

import { SessionId, TabId, AgentId } from '../shared/identifiers.js';
import { BrowserActionDto } from '../dto/browser-dto.js';

export interface CreateSessionRequest {
  readonly isIncognito?: boolean;
  readonly initialUrl?: string;
}

export interface CreateTabRequest {
  readonly sessionId: SessionId;
  readonly url?: string;
}

export interface ExecuteBrowserActionRequest {
  readonly sessionId: SessionId;
  readonly tabId: TabId;
  readonly action: BrowserActionDto;
}

export interface ExecuteAgentGoalRequest {
  readonly agentId: AgentId;
  readonly goal: string;
  readonly sessionId?: SessionId;
  readonly maxSteps?: number;
}
