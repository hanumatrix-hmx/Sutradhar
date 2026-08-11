/**
 * @file apps/server/src/routes/route-registry.ts
 * @description Centralized route registry binding Application Services to ApiRouter instances.
 */

import { ApiRouter } from '../gateway/api-router.js';
import { SessionApplicationService } from '../application/session-app-service.js';
import { AgentApplicationService } from '../application/agent-app-service.js';
import { WorkflowApplicationService } from '../application/workflow-app-service.js';
import { MemoryApplicationService } from '../application/memory-app-service.js';
import { StorageApplicationService } from '../application/storage-app-service.js';
import { RunManager } from '../application/run-manager.js';
import { LlmConfigService } from '../application/llm-config-service.js';
import { BrowserSessionManager } from '@pinchtab/browser';
import { registerSessionRoutes } from './session-routes.js';
import { registerAgentRoutes } from './agent-routes.js';
import { registerWorkflowRoutes } from './workflow-routes.js';
import { registerMemoryRoutes } from './memory-routes.js';
import { registerStorageRoutes } from './storage-routes.js';
import { registerBrowserRoutes } from './browser-routes.js';
import { registerRunRoutes } from './run-routes.js';
import { registerLlmConfigRoutes } from './llm-config-routes.js';

export interface AppServices {
  readonly sessionAppService?: SessionApplicationService;
  readonly agentAppService?: AgentApplicationService;
  readonly workflowAppService?: WorkflowApplicationService;
  readonly memoryAppService?: MemoryApplicationService;
  readonly storageAppService?: StorageApplicationService;
  readonly browserSessionManager?: BrowserSessionManager;
  readonly runManager?: RunManager;
  readonly llmConfigService?: LlmConfigService;
}

export function registerAllRoutes(router: ApiRouter, services: AppServices = {}): void {
  if (services.sessionAppService) {
    registerSessionRoutes(router, services.sessionAppService);
  }
  if (services.agentAppService) {
    registerAgentRoutes(router, services.agentAppService);
  }
  if (services.workflowAppService) {
    registerWorkflowRoutes(router, services.workflowAppService);
  }
  if (services.memoryAppService) {
    registerMemoryRoutes(router, services.memoryAppService);
  }
  if (services.storageAppService) {
    registerStorageRoutes(router, services.storageAppService);
  }
  if (services.browserSessionManager) {
    registerBrowserRoutes(router, services.browserSessionManager);
  }
  if (services.runManager) {
    registerRunRoutes(router, services.runManager);
  }
  if (services.llmConfigService) {
    registerLlmConfigRoutes(router, services.llmConfigService);
  }
}
