/**
 * @file apps/server/src/runtime/dependency-container.ts
 * @description Single Composition Root instantiating all platform dependencies across Epics 1 through 6.
 */

import { ConfigurationProvider, EnvironmentConfigurationProvider } from '@pinchtab/config';
import { StructuredLogger } from '@pinchtab/observability';
import { EventBus } from '@pinchtab/events';
import {
  LocalFileStorage,
  SqliteClient,
  SessionRepository,
  EventRepository,
} from '@pinchtab/storage';
import { BrowserSessionManager, BrowserLauncher } from '@pinchtab/browser';
import { OpenRouterAdapter, OllamaAdapter } from '@pinchtab/llm';
import { MultiTierMemoryManager } from '@pinchtab/memory';
import { AgentCore } from '@pinchtab/agent';
import { WorkflowRunner } from '@pinchtab/workflow';
import { ServerApp } from '../gateway/server-app.js';
import { SessionApplicationService } from '../application/session-app-service.js';
import { AgentApplicationService } from '../application/agent-app-service.js';
import { WorkflowApplicationService } from '../application/workflow-app-service.js';
import { MemoryApplicationService } from '../application/memory-app-service.js';
import { StorageApplicationService } from '../application/storage-app-service.js';
import { RunManager } from '../application/run-manager.js';
import { RunRepository } from '../application/run-repository.js';
import { LlmConfigService } from '../application/llm-config-service.js';
import { registerAllRoutes } from '../routes/route-registry.js';

export class DependencyContainer {
  public readonly configProvider: ConfigurationProvider;
  public readonly logger: StructuredLogger;
  public readonly eventBus: EventBus;
  public readonly fileStorage: LocalFileStorage;
  public readonly sqliteClient: SqliteClient;
  public readonly sessionRepository: SessionRepository;
  public readonly eventRepository: EventRepository;
  public readonly browserLauncher: BrowserLauncher;
  public readonly sessionManager: BrowserSessionManager;
  public readonly memoryManager: MultiTierMemoryManager;
  /** Legacy adapters retained for compatibility; the agent uses llmConfigService below. */
  public readonly openRouterAdapter: OpenRouterAdapter;
  public readonly ollamaAdapter: OllamaAdapter;
  /** Runtime-reconfigurable LLM provider service (Phase 6 honest-settings fix). */
  public readonly llmConfigService: LlmConfigService;
  public readonly agentCore: AgentCore;
  public readonly workflowRunner: WorkflowRunner;

  // Application Services
  public readonly sessionAppService: SessionApplicationService;
  public readonly agentAppService: AgentApplicationService;
  public readonly workflowAppService: WorkflowApplicationService;
  public readonly memoryAppService: MemoryApplicationService;
  public readonly storageAppService: StorageApplicationService;
  /** Async agent runs with live SSE frames + end-to-end cancel (Phase 4),
   *  persisted indefinitely for multi-day history (Phase 5). */
  public readonly runRepository: RunRepository;
  public readonly runManager: RunManager;

  // Server Gateway App
  public readonly serverApp: ServerApp;

  public constructor() {
    // 1. Foundational Context
    this.configProvider = new EnvironmentConfigurationProvider();
    this.logger = new StructuredLogger({ minLevel: 'info' });
    this.eventBus = new EventBus(this.logger);

    // 2. Storage & Persistence Context
    this.fileStorage = new LocalFileStorage({ logger: this.logger });
    this.sqliteClient = new SqliteClient(':memory:', this.logger);
    this.sessionRepository = new SessionRepository(this.sqliteClient, this.logger);
    this.eventRepository = new EventRepository(this.sqliteClient, this.logger);

    // Wire EventBus persistence listener (capture all domain events into the store)
    this.eventBus.subscribeAll(async (event) => {
      await this.eventRepository.saveEvent(event);
    });

    // 3. Core Domain Subsystems Context
    this.browserLauncher = new BrowserLauncher(this.logger);
    // A caller that never explicitly closes a session (crashed client, forgotten cleanup)
    // otherwise leaks its Chrome process for the life of this long-running server process —
    // mirrors the same default the MCP server applies in packages/mcp-server/src/server.ts.
    const idleTimeoutMs = process.env.PINCHTAB_IDLE_TIMEOUT_MS
      ? Number(process.env.PINCHTAB_IDLE_TIMEOUT_MS)
      : 30 * 60 * 1000;
    this.sessionManager = new BrowserSessionManager(
      this.browserLauncher,
      this.eventBus,
      this.logger,
      idleTimeoutMs > 0 ? idleTimeoutMs : undefined,
    );
    this.memoryManager = new MultiTierMemoryManager(this.logger);

    // Legacy adapters retained for compatibility/inspection.
    this.openRouterAdapter = new OpenRouterAdapter({ logger: this.logger });
    this.ollamaAdapter = new OllamaAdapter({ logger: this.logger });

    // Runtime-reconfigurable LLM provider service. Initial config from env vars
    // (OPENROUTER_API_KEY, PINCHTAB_MODEL, etc.) for backward compatibility.
    // Frontend can update this at runtime via POST /api/v1/llm/config.
    const initialProviderMode = process.env.OPENROUTER_API_KEY ? 'openrouter' : 'ollama';
    this.llmConfigService = new LlmConfigService(
      {
        providerMode: initialProviderMode as 'openrouter' | 'ollama',
        openrouterApiKey: process.env.OPENROUTER_API_KEY,
        openrouterModel: process.env.PINCHTAB_MODEL,
        openrouterBaseUrl: process.env.PINCHTAB_LLM_BASE ?? 'https://openrouter.ai/api/v1',
        ollamaEndpoint: 'http://localhost:11434',
        ollamaModel: process.env.PINCHTAB_MODEL ?? 'qwen3.5:9b',
      },
      this.logger,
    );

    this.agentCore = new AgentCore({
      llmProviderAccessor: () => this.llmConfigService.getProvider(),
      sessionManager: this.sessionManager,
      memoryManager: this.memoryManager,
      fileStorage: this.fileStorage,
      eventBus: this.eventBus,
      logger: this.logger,
    });

    this.workflowRunner = new WorkflowRunner({
      agentCore: this.agentCore,
      eventBus: this.eventBus,
      logger: this.logger,
    });

    // 4. Application Services Context
    this.sessionAppService = new SessionApplicationService(
      this.sessionManager,
      this.sessionRepository,
      this.logger,
    );
    this.agentAppService = new AgentApplicationService(this.agentCore, this.logger);
    this.workflowAppService = new WorkflowApplicationService(this.workflowRunner, this.logger);
    this.memoryAppService = new MemoryApplicationService(this.memoryManager, this.logger);
    this.storageAppService = new StorageApplicationService(this.fileStorage, this.logger);
    this.runRepository = new RunRepository(this.fileStorage, this.logger);
    this.runManager = new RunManager(this.agentCore, {
      repository: this.runRepository,
      llmProviderAccessor: () => this.llmConfigService.getProvider(),
      logger: this.logger,
    });

    // 5. Server Gateway Context
    const serverPort = parseInt(process.env.PORT || '8081', 10);
    this.serverApp = new ServerApp({
      port: serverPort,
      host: '127.0.0.1',
      eventBus: this.eventBus,
      logger: this.logger,
    });

    // Register all refactored routes onto the server gateway router
    registerAllRoutes(this.serverApp.router, {
      sessionAppService: this.sessionAppService,
      agentAppService: this.agentAppService,
      workflowAppService: this.workflowAppService,
      memoryAppService: this.memoryAppService,
      storageAppService: this.storageAppService,
      browserSessionManager: this.sessionManager,
      runManager: this.runManager,
      llmConfigService: this.llmConfigService,
    });
  }
}
