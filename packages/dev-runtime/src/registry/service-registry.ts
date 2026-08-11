/**
 * @file packages/dev-runtime/src/registry/service-registry.ts
 * @description Product-agnostic ServiceRegistry for arbitrary service management.
 */

import net from 'net';
import { ServiceDescriptor } from '../types/runtime-types.js';

export class ServiceRegistry {
  private readonly services = new Map<string, ServiceDescriptor>();

  public registerService(service: ServiceDescriptor): void {
    this.services.set(service.serviceName, service);
  }

  public getService(name: string): ServiceDescriptor | undefined {
    return this.services.get(name);
  }

  public listServices(): readonly ServiceDescriptor[] {
    return Array.from(this.services.values());
  }

  public static async isPortAvailable(port: number, host = '127.0.0.1'): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        const server = net.createServer();
        server.once('error', () => resolve(false));
        server.once('listening', () => server.close(() => resolve(true)));
        server.listen(port, host);
      } catch {
        resolve(true);
      }
    });
  }

  public static async resolveAvailablePort(
    startPort = 3000,
    maxAttempts = 50,
    host = '127.0.0.1',
  ): Promise<number> {
    let current = startPort;
    for (let i = 0; i < maxAttempts; i++) {
      if (await this.isPortAvailable(current, host)) {
        return current;
      }
      current++;
    }
    return startPort + maxAttempts;
  }
}
