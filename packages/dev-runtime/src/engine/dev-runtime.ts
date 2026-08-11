/**
 * @file packages/dev-runtime/src/engine/dev-runtime.ts
 * @description HanumatrixDevRuntime engine implementing generic, product-agnostic runtime initialization.
 */

import { RuntimeConfig, ServiceDescriptor, ValidationReport } from '../types/runtime-types.js';
import { ServiceRegistry } from '../registry/service-registry.js';

export class HanumatrixDevRuntime {
  private readonly registry = new ServiceRegistry();

  public constructor(private readonly config: RuntimeConfig) {
    for (const service of config.services) {
      this.registry.registerService(service);
    }
  }

  public async allocatePorts(): Promise<readonly ServiceDescriptor[]> {
    const allocated: ServiceDescriptor[] = [];

    for (const service of this.registry.listServices()) {
      if (service.preferredPort) {
        const assigned = await ServiceRegistry.resolveAvailablePort(
          service.preferredPort,
          50,
          this.config.host,
        );
        const protocol = service.protocol || 'http';
        const url = `${protocol}://${this.config.host}:${assigned}`;
        const updated: ServiceDescriptor = {
          ...service,
          assignedPort: assigned,
          url,
        };
        this.registry.registerService(updated);
        allocated.push(updated);
      } else {
        allocated.push(service);
      }
    }

    return allocated;
  }

  public validateEnvironment(): ValidationReport {
    const errors: string[] = [];
    const warnings: string[] = [];
    const seenPorts = new Set<number>();

    if (!this.config.projectName) {
      errors.push('RuntimeConfig missing required "projectName" string.');
    }

    for (const service of this.registry.listServices()) {
      if (service.assignedPort) {
        if (service.assignedPort < 1024 || service.assignedPort > 65535) {
          errors.push(
            `Service "${service.serviceName}" port out of valid range (1024-65535): ${service.assignedPort}`,
          );
        }
        if (seenPorts.has(service.assignedPort)) {
          errors.push(
            `Duplicate port collision detected: Port ${service.assignedPort} assigned to multiple services.`,
          );
        }
        seenPorts.add(service.assignedPort);
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  public generateStartupSummary(): string {
    const lines = [
      '====================================================',
      `${this.config.projectName} Development Environment`,
      '====================================================',
      '',
      'Services',
      '',
    ];

    for (const service of this.registry.listServices()) {
      const statusIcon =
        service.status === 'RUNNING'
          ? '✓ Running'
          : service.status === 'NOT_CONFIGURED'
            ? 'Not Configured'
            : 'Stopped';
      lines.push(`${service.serviceName}`);
      lines.push(`${statusIcon}`);
      if (service.url && service.status !== 'NOT_CONFIGURED') {
        lines.push(service.url);
      }
      lines.push('');
    }

    lines.push('----------------------------------------------------', 'Port Allocation', '');

    for (const service of this.registry.listServices()) {
      if (service.preferredPort && service.assignedPort) {
        lines.push(`${service.serviceName}`);
        lines.push(`Requested: ${service.preferredPort}`);
        lines.push(`Assigned: ${service.assignedPort}`);
        lines.push('');
      }
    }

    lines.push(
      '----------------------------------------------------',
      'Environment',
      '',
      `HOST=${this.config.host}`,
    );

    if (this.config.envVars) {
      for (const [key, val] of Object.entries(this.config.envVars)) {
        lines.push(`${key}=${val}`);
      }
    }

    lines.push(
      '====================================================',
      'READY',
      '====================================================',
    );

    return lines.join('\n');
  }
}
