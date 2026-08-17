/**
 * @file packages/agent/src/kernel/runtime-kernel.ts
 * @description RuntimeKernel orchestrating service lifecycles, dependency graph startup/shutdown, health monitoring, and event propagation.
 *
 * @experimental Not wired into any real run — `agent-app-service.ts`/`run-manager.ts`/
 * `bootstrap.ts` (the actual execution path this package ships) never reference this kernel or
 * its services. Real, tested code, kept intentionally rather than deleted pending a deliberate
 * decision on its future — see `.ai/known-problems.md` `PROB-010`. Do not assume anything here
 * runs in production; the real per-step agent loop lives in `agent-loop.ts`.
 */

import { IRuntimeService, KernelMetrics, ServiceHealth } from './kernel-types.js';
import { EventBus } from '@sutradhar/events';
import { StructuredLogger } from '@sutradhar/observability';

export interface RegisteredServiceRecord {
  readonly service: IRuntimeService;
  readonly dependencies: readonly string[];
}

export class RuntimeKernel {
  private readonly servicesMap = new Map<string, RegisteredServiceRecord>();
  private readonly eventBus?: EventBus;
  private readonly logger: StructuredLogger;
  private executionCount = 0;

  public constructor(eventBus?: EventBus, logger?: StructuredLogger) {
    this.eventBus = eventBus;
    this.logger = logger ?? new StructuredLogger({ minLevel: 'info' });
  }

  public registerService(service: IRuntimeService, dependencies: string[] = []): void {
    if (this.servicesMap.has(service.serviceId)) {
      throw new Error(`Service ${service.serviceId} is already registered in RuntimeKernel`);
    }

    this.servicesMap.set(service.serviceId, { service, dependencies });
    this.logger.info(
      `[RuntimeKernel] Registered service ${service.serviceId} with dependencies: [${dependencies.join(', ')}]`,
    );
  }

  public getService<T extends IRuntimeService>(serviceId: string): T {
    const record = this.servicesMap.get(serviceId);
    if (!record) {
      throw new Error(`Service ${serviceId} not found in RuntimeKernel`);
    }
    return record.service as T;
  }

  public async start(): Promise<void> {
    this.logger.info(
      `[RuntimeKernel] Starting runtime kernel across ${this.servicesMap.size} registered services`,
    );
    const ordered = this.computeTopologicalOrder();

    for (const record of ordered) {
      try {
        await record.service.initialize();
        await record.service.start();
        this.logger.info(`[RuntimeKernel] Started service ${record.service.serviceId}`);
        if (this.eventBus) {
          await this.eventBus.publish('kernel:service:started', {
            serviceId: record.service.serviceId,
          });
        }
      } catch (err) {
        record.service.state = 'FAILED';
        this.logger.error(
          `[RuntimeKernel] Failed to start service ${record.service.serviceId}: ${(err as Error).message}`,
        );
        if (this.eventBus) {
          await this.eventBus.publish('kernel:service:failed', {
            serviceId: record.service.serviceId,
            error: (err as Error).message,
          });
        }
        throw err;
      }
    }
  }

  public async stop(): Promise<void> {
    this.logger.info('[RuntimeKernel] Stopping runtime kernel gracefully...');
    const reversed = this.computeTopologicalOrder().reverse();

    for (const record of reversed) {
      try {
        await record.service.stop();
        this.logger.info(`[RuntimeKernel] Stopped service ${record.service.serviceId}`);
        if (this.eventBus) {
          await this.eventBus.publish('kernel:service:stopped', {
            serviceId: record.service.serviceId,
          });
        }
      } catch (err) {
        this.logger.warn(
          `[RuntimeKernel] Error stopping service ${record.service.serviceId}: ${(err as Error).message}`,
        );
      }
    }
  }

  public async getAggregatedHealth(): Promise<Record<string, ServiceHealth>> {
    const healthMap: Record<string, ServiceHealth> = {};
    for (const [id, record] of this.servicesMap.entries()) {
      healthMap[id] = await record.service.health();
    }
    return healthMap;
  }

  public getKernelMetrics(): KernelMetrics {
    const services = Array.from(this.servicesMap.values());
    const running = services.filter((s) => s.service.state === 'RUNNING').length;
    const failed = services.filter((s) => s.service.state === 'FAILED').length;

    return {
      registeredServicesCount: services.length,
      runningServicesCount: running,
      failedServicesCount: failed,
      totalExecutions: this.executionCount,
    };
  }

  public incrementExecutionCount(): void {
    this.executionCount++;
  }

  private computeTopologicalOrder(): RegisteredServiceRecord[] {
    const records = Array.from(this.servicesMap.values());
    const visited = new Set<string>();
    const order: RegisteredServiceRecord[] = [];

    const visit = (rec: RegisteredServiceRecord) => {
      if (visited.has(rec.service.serviceId)) return;
      visited.add(rec.service.serviceId);

      for (const depId of rec.dependencies) {
        const depRec = this.servicesMap.get(depId);
        if (depRec) visit(depRec);
      }

      order.push(rec);
    };

    for (const rec of records) {
      visit(rec);
    }

    return order;
  }
}
