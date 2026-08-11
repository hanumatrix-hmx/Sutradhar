/**
 * @file packages/utils/src/runtime/env-validator.ts
 * @description EnvValidator performing environment variable and runtime port validation.
 */

export interface ValidationResult {
  readonly isValid: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

export class EnvValidator {
  public static validatePorts(ports: Record<string, number>): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const seenPorts = new Set<number>();

    for (const [name, port] of Object.entries(ports)) {
      if (isNaN(port) || port < 1024 || port > 65535) {
        errors.push(`Invalid port for ${name}: ${port}. Must be between 1024 and 65535.`);
      }
      if (seenPorts.has(port)) {
        errors.push(
          `Duplicate port collision detected for ${name}: ${port} is already assigned to another service.`,
        );
      }
      seenPorts.add(port);
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  public static validateHost(host: string): boolean {
    if (!host) return false;
    return (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      /^[a-zA-Z0-9.-]+$/.test(host)
    );
  }
}
