/**
 * @file packages/agent/src/kernel/kernel-types.ts
 * @description Interfaces and state models for the Sutradhar Runtime Kernel.
 */

export type ServiceState =
  | 'INITIALISING'
  | 'STARTING'
  | 'RUNNING'
  | 'PAUSED'
  | 'STOPPING'
  | 'STOPPED'
  | 'FAILED';

export interface ServiceHealth {
  readonly status: 'healthy' | 'degraded' | 'unhealthy';
  readonly details?: Record<string, unknown>;
}

export interface IRuntimeService {
  readonly serviceId: string;
  /** Mutable runtime state; the kernel updates this as services start/stop/fail. */
  state: ServiceState;
  initialize(): Promise<void>;
  start(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<void>;
  health(): Promise<ServiceHealth>;
  metrics(): Promise<Record<string, number | string>>;
}

export interface KernelMetrics {
  readonly registeredServicesCount: number;
  readonly runningServicesCount: number;
  readonly failedServicesCount: number;
  readonly totalExecutions: number;
}
