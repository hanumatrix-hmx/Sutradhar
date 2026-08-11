/**
 * @file packages/contracts/src/events/event-map.ts
 * @description Strongly typed event map mapping event type names to payloads.
 */

import {
  BrowserSessionCreatedEventPayload,
  BrowserSessionClosedEventPayload,
  BrowserPageNavigatedEventPayload,
  BrowserActionExecutedEventPayload,
  BrowserDialogOpenedEventPayload,
  BrowserPopupOpenedEventPayload,
  BrowserSessionCrashedEventPayload,
  BrowserConsoleMessageEventPayload,
  BrowserPageErrorEventPayload,
  BrowserNetworkRequestEventPayload,
  BrowserNetworkResponseEventPayload,
  AgentGoalStartedEventPayload,
  AgentStepExecutedEventPayload,
  AgentStateChangedEventPayload,
  SessionBlockedEventPayload,
  LlmStreamChunkEventPayload,
  LlmCompletionGeneratedEventPayload,
  ToolExecutionStartedEventPayload,
  ToolExecutionCompletedEventPayload,
  KernelServiceStartedEventPayload,
  KernelServiceFailedEventPayload,
  KernelServiceStoppedEventPayload,
  WorkflowExecutionStartedEventPayload,
  WorkflowExecutionCompletedEventPayload,
  WorkflowExecutionFailedEventPayload,
} from './domain-events.js';

export interface DomainEventMap {
  'browser:session:created': BrowserSessionCreatedEventPayload;
  'browser:session:closed': BrowserSessionClosedEventPayload;
  'browser:session:crashed': BrowserSessionCrashedEventPayload;
  'browser:page:navigated': BrowserPageNavigatedEventPayload;
  'browser:action:executed': BrowserActionExecutedEventPayload;
  'browser:dialog:opened': BrowserDialogOpenedEventPayload;
  'browser:popup:opened': BrowserPopupOpenedEventPayload;
  'browser:console:message': BrowserConsoleMessageEventPayload;
  'browser:page:error': BrowserPageErrorEventPayload;
  'browser:network:request': BrowserNetworkRequestEventPayload;
  'browser:network:response': BrowserNetworkResponseEventPayload;
  'agent:goal:started': AgentGoalStartedEventPayload;
  'agent:step:executed': AgentStepExecutedEventPayload;
  'agent:state:changed': AgentStateChangedEventPayload;
  'session:blocked': SessionBlockedEventPayload;
  'llm:stream:chunk': LlmStreamChunkEventPayload;
  'llm:completion:generated': LlmCompletionGeneratedEventPayload;
  'tool:execution:started': ToolExecutionStartedEventPayload;
  'tool:execution:completed': ToolExecutionCompletedEventPayload;
  'kernel:service:started': KernelServiceStartedEventPayload;
  'kernel:service:failed': KernelServiceFailedEventPayload;
  'kernel:service:stopped': KernelServiceStoppedEventPayload;
  'workflow:execution:started': WorkflowExecutionStartedEventPayload;
  'workflow:execution:completed': WorkflowExecutionCompletedEventPayload;
  'workflow:execution:failed': WorkflowExecutionFailedEventPayload;
}

export type EventType = keyof DomainEventMap;
