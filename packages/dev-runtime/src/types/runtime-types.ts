/**
 * @file packages/dev-runtime/src/types/runtime-types.ts
 * @description Generic product-agnostic types for @hanumatrix/dev-runtime.
 */

export type ServiceStatus = 'RUNNING' | 'STOPPED' | 'NOT_CONFIGURED' | 'FAILED';

export interface ServiceDescriptor {
  readonly serviceName: string;
  readonly preferredPort?: number;
  readonly assignedPort?: number;
  readonly protocol?: 'http' | 'https' | 'ws' | 'wss' | 'redis' | 'tcp';
  readonly healthEndpoint?: string;
  readonly status: ServiceStatus;
  readonly url?: string;
}

export interface RuntimeConfig {
  readonly projectName: string;
  readonly host: string;
  readonly services: readonly ServiceDescriptor[];
  readonly envVars?: Record<string, string>;
}

export interface ValidationReport {
  readonly isValid: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}
