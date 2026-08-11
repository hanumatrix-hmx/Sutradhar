/**
 * @file packages/agent/src/kernel/runtime-services.ts
 * @description RuntimeService implementations wrapping core PinchTab platform components.
 */

import { IRuntimeService, ServiceHealth, ServiceState } from './kernel-types.js';
import { GoalPlanner } from '../planner/goal-planner.js';
import { RecoveryEngine } from '../recovery/recovery-engine.js';
import { DecisionEvidenceEngine } from '../evidence/decision-evidence-engine.js';
import { TaskGraphEngine } from '../graph/task-graph-engine.js';
import { DOMSemanticEngine, BrowserActionEngine, PageUnderstandingEngine } from '@pinchtab/browser';
import { EpisodicMemoryManager } from '@pinchtab/memory';

export abstract class BaseRuntimeService implements IRuntimeService {
  public readonly serviceId: string;
  public state: ServiceState = 'STOPPED';

  public constructor(serviceId: string) {
    this.serviceId = serviceId;
  }

  public async initialize(): Promise<void> {
    this.state = 'INITIALISING';
  }

  public async start(): Promise<void> {
    this.state = 'RUNNING';
  }

  public async pause(): Promise<void> {
    this.state = 'PAUSED';
  }

  public async resume(): Promise<void> {
    this.state = 'RUNNING';
  }

  public async stop(): Promise<void> {
    this.state = 'STOPPED';
  }

  public async health(): Promise<ServiceHealth> {
    return { status: this.state === 'RUNNING' ? 'healthy' : 'unhealthy' };
  }

  public async metrics(): Promise<Record<string, number | string>> {
    return { state: this.state };
  }
}

export class PlannerService extends BaseRuntimeService {
  public readonly planner = new GoalPlanner();
  public constructor() {
    super('PlannerService');
  }
}

export class MemoryService extends BaseRuntimeService {
  public readonly episodicMemory = new EpisodicMemoryManager();
  public constructor() {
    super('MemoryService');
  }
}

export class BrowserService extends BaseRuntimeService {
  public readonly semanticEngine = new DOMSemanticEngine();
  public readonly actionEngine = new BrowserActionEngine();
  public constructor() {
    super('BrowserService');
  }
}

export class RecoveryService extends BaseRuntimeService {
  public readonly recoveryEngine = new RecoveryEngine();
  public constructor() {
    super('RecoveryService');
  }
}

export class TaskGraphService extends BaseRuntimeService {
  public readonly graphEngine = new TaskGraphEngine();
  public constructor() {
    super('TaskGraphService');
  }
}

export class DecisionService extends BaseRuntimeService {
  public readonly evidenceEngine = new DecisionEvidenceEngine();
  public constructor() {
    super('DecisionService');
  }
}

export class PageUnderstandingService extends BaseRuntimeService {
  public readonly pageEngine = new PageUnderstandingEngine();
  public constructor() {
    super('PageUnderstandingService');
  }
}
