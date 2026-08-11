/**
 * @file packages/dev-runtime/src/health/health-checker.ts
 * @description HealthChecker verifying status across registered services.
 */

import { ServiceDescriptor, ServiceStatus } from '../types/runtime-types.js';
import { ServiceRegistry } from '../registry/service-registry.js';

export class HealthChecker {
  public static async checkServiceHealth(
    service: ServiceDescriptor,
    host = '127.0.0.1',
  ): Promise<ServiceStatus> {
    if (service.status === 'NOT_CONFIGURED') {
      return 'NOT_CONFIGURED';
    }

    if (!service.assignedPort) {
      return 'STOPPED';
    }

    const available = await ServiceRegistry.isPortAvailable(service.assignedPort, host);
    // If port is occupied (available = false), something is listening on it -> RUNNING
    // If port is free (available = true), service is not listening -> STOPPED
    return available ? 'STOPPED' : 'RUNNING';
  }
}
