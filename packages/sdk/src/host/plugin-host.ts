/**
 * @file packages/sdk/src/host/plugin-host.ts
 * @description PluginHost — owns the {@link ProviderRegistry} and produces the enriched
 * {@link PluginContext} (with real host capabilities) that plugins receive.
 *
 * The host is the bridge between the plugin system and the PinchTab runtime: plugins
 * contribute providers through it, and the runtime queries the host's registry to discover
 * them. For the MVP the host is a thin holder around a PluginManager + ProviderRegistry.
 */

import type { PluginManager } from '../manager/plugin-manager.js';
import type { HostCapabilities } from '../types/plugin-types.js';
import { ProviderRegistry, type ContributedLlmProvider } from './provider-registry.js';

/** Constructor options for {@link PluginHost}. */
export interface PluginHostOptions {
  /** The manager this host drives. Required. */
  manager: PluginManager;
}

/**
 * The host-side façade for the plugin system. Holds the provider registry plugins write to,
 * and exposes a single read API (`getLlmProvider`) the PinchTab runtime calls.
 *
 * Wiring the host into the runtime (so the agent loop consults contributed providers) is a
 * documented next step — see the SDK README.
 */
export class PluginHost {
  private readonly manager: PluginManager;
  private readonly registry = new ProviderRegistry();

  public constructor(options: PluginHostOptions) {
    this.manager = options.manager;
  }

  /** The underlying manager. Loaders and admin APIs drive this. */
  public getManager(): PluginManager {
    return this.manager;
  }

  /** Capabilities handed to a plugin on its context. Each plugin gets its own view. */
  public capabilitiesFor(pluginId: string): HostCapabilities {
    return {
      pluginId,
      providers: {
        // The registry lives on the host; plugins register into it directly. The per-plugin
        // capability object is a typed handle — tagging registrations by plugin is a future
        // enhancement (see provider-registry.ts clearForPlugin note).
        registerLlmProvider: (provider: unknown) =>
          this.registry.registerLlmProvider(provider as ContributedLlmProvider),
      },
    };
  }

  /** Read API the runtime consumes. */
  public getLlmProvider(id: string): ContributedLlmProvider | undefined {
    return this.registry.getLlmProvider(id);
  }

  public listLlmProviders(): readonly ContributedLlmProvider[] {
    return this.registry.listLlmProviders();
  }
}
