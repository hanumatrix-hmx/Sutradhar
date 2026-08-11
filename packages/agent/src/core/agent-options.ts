/**
 * @file packages/agent/src/core/agent-options.ts
 * @description Configuration options and dependencies for AgentCore instances.
 */

import { AgentId } from '@pinchtab/contracts';
import { EventBus } from '@pinchtab/events';
import { StructuredLogger } from '@pinchtab/observability';
import { ILlmProvider } from '@pinchtab/llm';
import { BrowserSessionManager } from '@pinchtab/browser';

export interface AgentOptions {
  readonly agentId?: AgentId;
  readonly name?: string;
  readonly role?: string;
  readonly maxSteps?: number;
  readonly systemPromptTemplate?: string;
  readonly llmProvider?: ILlmProvider;
  /** Optional accessor for runtime-reconfigurable provider (Phase 6 fix). */
  readonly llmProviderAccessor?: () => ILlmProvider;
  /** Required for the real agent loop: produces live browser sessions/tabs. */
  readonly sessionManager?: BrowserSessionManager;
  readonly memoryManager?: unknown;
  readonly fileStorage?: unknown;
  readonly eventBus?: EventBus;
  readonly logger?: StructuredLogger;
}
