/**
 * @file packages/config/src/provider/config-provider.ts
 * @description Centralized ConfigurationProvider service managing config sources and fail-fast validation.
 */

import { AppEnv, MasterEnvSchema } from '../schema/env-schema.js';
import { maskSecret } from './secret-masker.js';

export interface IConfigurationSource {
  readonly name: string;
  load(): Record<string, unknown>;
}

export class EnvConfigSource implements IConfigurationSource {
  public readonly name = 'EnvironmentVariableSource';

  public load(): Record<string, unknown> {
    return { ...process.env };
  }
}

export class ConfigurationProvider {
  private readonly sources: readonly IConfigurationSource[];
  private cachedConfig?: AppEnv;

  public constructor(sources?: readonly IConfigurationSource[]) {
    this.sources = sources ?? [new EnvConfigSource()];
  }

  /**
   * Merges config sources and validates against MasterEnvSchema.
   */
  public getAppConfig(): AppEnv {
    if (this.cachedConfig) {
      return this.cachedConfig;
    }

    let mergedRaw: Record<string, unknown> = {};
    for (const source of this.sources) {
      mergedRaw = { ...mergedRaw, ...source.load() };
    }

    const parseResult = MasterEnvSchema.safeParse(mergedRaw);
    if (!parseResult.success) {
      const errorFormatted = parseResult.error.format();
      throw new Error(
        `Configuration Validation Failed: ${JSON.stringify(errorFormatted, null, 2)}`,
      );
    }

    this.cachedConfig = parseResult.data;
    return this.cachedConfig;
  }

  /**
   * Retrieves a secret value from configuration by key.
   */
  public getSecret(key: keyof AppEnv): string | undefined {
    const config = this.getAppConfig();
    const val = config[key];
    return typeof val === 'string' ? val : undefined;
  }

  /**
   * Retrieves a masked secret value for safe logging.
   */
  public getMaskedSecret(key: keyof AppEnv): string {
    const secret = this.getSecret(key);
    return maskSecret(secret);
  }
}

export class EnvironmentConfigurationProvider extends ConfigurationProvider {}
