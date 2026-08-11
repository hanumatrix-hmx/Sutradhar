/**
 * @file packages/agent/tests/unit/runtime-kernel.spec.ts
 * @description Unit test suite verifying RuntimeKernel service registration, topological dependency ordering, graceful shutdown, health aggregation, and events.
 */

import { RuntimeKernel } from '../../src/kernel/runtime-kernel.js';
import {
  BaseRuntimeService,
  PlannerService,
  BrowserService,
  MemoryService,
} from '../../src/kernel/runtime-services.js';
import { EventBus } from '@pinchtab/events';

describe('Engineering Iteration 7 — Runtime Kernel Unit Tests', () => {
  let kernel: RuntimeKernel;

  beforeEach(() => {
    kernel = new RuntimeKernel();
  });

  it('1. should register services and retrieve by serviceId', () => {
    const plannerSvc = new PlannerService();
    kernel.registerService(plannerSvc);

    const retrieved = kernel.getService<PlannerService>('PlannerService');
    expect(retrieved.serviceId).toBe('PlannerService');
    expect(retrieved.state).toBe('STOPPED');
  });

  it('2. should start services in topological dependency order and stop in reverse order', async () => {
    const startOrder: string[] = [];
    const stopOrder: string[] = [];

    class ServiceA extends BaseRuntimeService {
      public constructor() {
        super('ServiceA');
      }
      public override async start(): Promise<void> {
        await super.start();
        startOrder.push('ServiceA');
      }
      public override async stop(): Promise<void> {
        await super.stop();
        stopOrder.push('ServiceA');
      }
    }

    class ServiceB extends BaseRuntimeService {
      public constructor() {
        super('ServiceB');
      }
      public override async start(): Promise<void> {
        await super.start();
        startOrder.push('ServiceB');
      }
      public override async stop(): Promise<void> {
        await super.stop();
        stopOrder.push('ServiceB');
      }
    }

    kernel.registerService(new ServiceB(), ['ServiceA']);
    kernel.registerService(new ServiceA());

    await kernel.start();
    expect(startOrder).toEqual(['ServiceA', 'ServiceB']);

    await kernel.stop();
    expect(stopOrder).toEqual(['ServiceB', 'ServiceA']);
  });

  it('3. should aggregate service health and report kernel metrics', async () => {
    kernel.registerService(new BrowserService());
    kernel.registerService(new MemoryService());

    await kernel.start();
    const health = await kernel.getAggregatedHealth();
    expect(health['BrowserService']?.status).toBe('healthy');
    expect(health['MemoryService']?.status).toBe('healthy');

    const metrics = kernel.getKernelMetrics();
    expect(metrics.registeredServicesCount).toBe(2);
    expect(metrics.runningServicesCount).toBe(2);
    expect(metrics.failedServicesCount).toBe(0);
  });

  it('4. should publish lifecycle events to EventBus during service startup and shutdown', async () => {
    const eventBus = new EventBus();
    const publishedEvents: string[] = [];

    await eventBus.subscribe('kernel:service:started', async (evt) => {
      publishedEvents.push(`started:${evt.payload.serviceId}`);
    });

    const eventKernel = new RuntimeKernel(eventBus);
    eventKernel.registerService(new PlannerService());

    await eventKernel.start();
    expect(publishedEvents).toContain('started:PlannerService');
  });
});
