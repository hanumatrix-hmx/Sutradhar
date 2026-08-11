/**
 * @file packages/sdk/src/manifest/plugin-manifest.ts
 * @description PluginManifest schema and validation functions.
 */

import { PluginType } from '../types/plugin-types.js';

export type PluginPermission = 'filesystem' | 'network' | 'credentials' | 'browser';

export interface PluginDependency {
  readonly pluginId: string;
  readonly minVersion: string;
}

export interface PluginManifest {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly author: string;
  readonly description: string;
  readonly type: PluginType;
  readonly permissions: readonly PluginPermission[];
  readonly dependencies: readonly PluginDependency[];
  readonly runtimeCompatibility: string;
  readonly entrypoint: string;
  readonly signature?: string;
}

export class PluginManifestValidator {
  public static validate(manifest: PluginManifest): {
    isValid: boolean;
    errors: readonly string[];
  } {
    const errors: string[] = [];

    if (!manifest.id || typeof manifest.id !== 'string')
      errors.push('Plugin manifest must declare a valid string "id"');
    if (!manifest.name) errors.push('Plugin manifest must declare a valid "name"');
    if (!manifest.version) errors.push('Plugin manifest must declare a valid "version"');
    if (!manifest.entrypoint) errors.push('Plugin manifest must declare an "entrypoint" file');
    if (!manifest.type) errors.push('Plugin manifest must declare a valid "type"');

    return {
      isValid: errors.length === 0,
      errors,
    };
  }
}
