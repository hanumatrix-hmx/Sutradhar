/**
 * @file packages/sdk/src/types/plugin-types.ts
 * @description Plugin type definitions and lifecycle state machine for @sutradhar/sdk.
 */

import { PluginManifest } from '../manifest/plugin-manifest.js';

export type PluginType =
  | 'skill'
  | 'action'
  | 'memory_provider'
  | 'decision_policy'
  | 'browser_adapter'
  | 'auth_provider'
  | 'retrieval_provider'
  | 'vector_store'
  | 'llm_provider'
  | 'observability_ext'
  | 'studio_ext';

export type PluginLifecycleState =
  | 'UNINSTALLED'
  | 'INSTALLED'
  | 'LOADED'
  | 'INITIALIZED'
  | 'ENABLED'
  | 'DISABLED'
  | 'FAILED';

export interface PluginContext {
  readonly pluginId: string;
  readonly grantedPermissions: readonly string[];
  readonly logger: {
    info(msg: string, ctx?: Record<string, unknown>): void;
    warn(msg: string, ctx?: Record<string, unknown>): void;
    error(msg: string, ctx?: Record<string, unknown>): void;
  };
  /**
   * Host capabilities — the extension surface a plugin uses to actually contribute to
   * Sutradhar (register LLM providers, etc.). Optional for backward-compatibility with
   * plugins authored against the original context shape; new plugins should use it.
   */
  readonly host?: HostCapabilities;
}

/**
 * Capability surface the host exposes to plugins via PluginContext.host. Implemented by
 * PluginHost (see host/plugin-host.ts). A plugin uses this to register providers that the
 * Sutradhar runtime then consumes.
 */
export interface HostCapabilities {
  readonly pluginId: string;
  readonly providers: {
    registerLlmProvider(provider: unknown): void;
  };
}

export interface ISutradharPlugin {
  readonly manifest: PluginManifest;
  state: PluginLifecycleState;
  initialize(context: PluginContext): Promise<void>;
  enable(): Promise<void>;
  disable(): Promise<void>;
  unload(): Promise<void>;
}
