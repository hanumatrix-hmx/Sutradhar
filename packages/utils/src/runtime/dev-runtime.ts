/**
 * @file packages/utils/src/runtime/dev-runtime.ts
 * @description HanumatrixDevRuntime implementing pre-startup port allocation, startup summaries, and environment resolution.
 */

import { PortResolver } from '../network/port-resolver.js';
import { HANUMATRIX_PORT_REGISTRY, ProjectPortConfig } from './port-registry.js';
import { EnvValidator, ValidationResult } from './env-validator.js';

export interface AllocatedPorts {
  readonly frontendRequested: number;
  readonly frontendAssigned: number;
  readonly backendRequested: number;
  readonly backendAssigned: number;
  readonly websocketRequested?: number;
  readonly websocketAssigned?: number;
}

export interface HanumatrixRuntimeContext {
  readonly projectName: string;
  readonly host: string;
  readonly ports: AllocatedPorts;
  readonly frontendUrl: string;
  readonly backendUrl: string;
  readonly websocketUrl: string;
}

export class HanumatrixDevRuntime {
  public static async allocateProjectPorts(
    projectName: string,
    overrideConfig?: Partial<ProjectPortConfig>,
    host = '127.0.0.1',
  ): Promise<AllocatedPorts> {
    const defaultConfig = HANUMATRIX_PORT_REGISTRY[projectName] || {
      projectName,
      frontendPreferredPort: 5173,
      backendPreferredPort: 3000,
      websocketPreferredPort: 3001,
    };

    const config = { ...defaultConfig, ...overrideConfig };

    const frontendAssigned = await PortResolver.findAvailablePort(
      config.frontendPreferredPort,
      50,
      host,
    );
    const backendAssigned = await PortResolver.findAvailablePort(
      config.backendPreferredPort,
      50,
      host,
    );

    let websocketAssigned: number | undefined;
    if (config.websocketPreferredPort) {
      websocketAssigned = await PortResolver.findAvailablePort(
        config.websocketPreferredPort,
        50,
        host,
      );
    }

    return {
      frontendRequested: config.frontendPreferredPort,
      frontendAssigned,
      backendRequested: config.backendPreferredPort,
      backendAssigned,
      websocketRequested: config.websocketPreferredPort,
      websocketAssigned,
    };
  }

  public static generateStartupSummary(context: HanumatrixRuntimeContext): string {
    const lines = [
      '====================================================',
      `${context.projectName} Development Environment`,
      '====================================================',
      '',
      `Frontend`,
      context.frontendUrl,
      '',
      `Backend`,
      context.backendUrl,
      '',
      `WebSocket`,
      context.websocketUrl,
      '',
      '----------------------------------------------------',
      'Port Allocation',
      '',
      `Frontend`,
      `Requested : ${context.ports.frontendRequested}`,
      `Assigned  : ${context.ports.frontendAssigned}`,
      '',
      `Backend`,
      `Requested : ${context.ports.backendRequested}`,
      `Assigned  : ${context.ports.backendAssigned}`,
    ];

    if (context.ports.websocketRequested && context.ports.websocketAssigned) {
      lines.push(
        '',
        `WebSocket`,
        `Requested : ${context.ports.websocketRequested}`,
        `Assigned  : ${context.ports.websocketAssigned}`,
      );
    }

    lines.push(
      '',
      '----------------------------------------------------',
      'Environment',
      '',
      `HOST=${context.host}`,
      `VITE_API_BASE_URL=${context.backendUrl}`,
      `VITE_WS_URL=${context.websocketUrl}`,
      '====================================================',
      '✓ READY',
      '====================================================',
    );

    return lines.join('\n');
  }

  public static validateEnvironment(context: HanumatrixRuntimeContext): ValidationResult {
    const portsToValidate: Record<string, number> = {
      Frontend: context.ports.frontendAssigned,
      Backend: context.ports.backendAssigned,
    };

    if (context.ports.websocketAssigned) {
      portsToValidate['WebSocket'] = context.ports.websocketAssigned;
    }

    return EnvValidator.validatePorts(portsToValidate);
  }
}
