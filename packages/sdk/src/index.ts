/**
 * @file packages/sdk/src/index.ts
 * @description Package entry point for @sutradhar/sdk — the plugin/extension SDK for Sutradhar.
 *
 * Two layers:
 *   - Plugin authoring: types, manifest schema, the ISutradharPlugin contract.
 *   - Plugin hosting: PluginManager (lifecycle), PluginLoader (disk→instance), PluginHost
 *     (capability registry), and real signature verification.
 *
 * The author-facing surface (what a plugin imports) is just the types + manifest. The
 * host-facing surface (what the Sutradhar runtime imports) is the manager/loader/host.
 */

export const SDK_VERSION = '0.2.0';

// Plugin authoring contracts
export * from './types/plugin-types.js';
export * from './manifest/plugin-manifest.js';

// Host-side runtime
export * from './sandbox/plugin-sandbox.js';
export * from './manager/plugin-manager.js';
export * from './marketplace/marketplace-registry.js';
export * from './loader/plugin-loader.js';
export * from './loader/signature-verifier.js';
export * from './host/provider-registry.js';
export * from './host/plugin-host.js';
