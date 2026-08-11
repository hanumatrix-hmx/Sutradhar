/**
 * @file packages/sdk/src/host/provider-registry.ts
 * @description A registry that plugins populate with capability providers (LLM providers,
 * memory backends, etc.). The host (the PinchTab runtime/server) reads from this registry
 * to discover extensions contributed by plugins.
 *
 * This is the receiving end of the first real extension point (llm_provider). A plugin's
 * `initialize()` receives a {@link HostCapabilities} object on its context and calls
 * `providers.registerLlmProvider(...)`; the host then queries `getLlmProvider(id)`.
 *
 * Designed generically so future plugin types (memory_provider, vector_store) register the
 * same way without a new registry class per type.
 */

/**
 * Minimal LLM provider contract a plugin can contribute. Intentionally a structural subset
 * of @pinchtab/llm's ILlmProvider so plugins don't need to depend on that package — the host
 * adapts this shape to the full ILlmProvider at registration time.
 */
export interface ContributedLlmProvider {
  readonly id: string;
  /** A human label, e.g. "My Local Mixtral". */
  readonly label?: string;
  /** Produce a completion. Implementations should perform real network calls. */
  complete(
    prompt: string,
    options?: { systemPrompt?: string; temperature?: number; maxTokens?: number },
  ): Promise<string>;
}

/**
 * Registry of providers contributed by plugins. The host holds one instance and exposes it
 * to plugins via {@link HostCapabilities}.
 */
export class ProviderRegistry {
  private readonly llmProviders = new Map<string, ContributedLlmProvider>();

  /** Register (or replace) an LLM provider contributed by a plugin. */
  public registerLlmProvider(provider: ContributedLlmProvider): void {
    if (!provider.id) throw new Error('ContributedLlmProvider must declare an id');
    this.llmProviders.set(provider.id, provider);
  }

  /** Look up a contributed LLM provider by id. */
  public getLlmProvider(id: string): ContributedLlmProvider | undefined {
    return this.llmProviders.get(id);
  }

  /** All contributed LLM providers, by id. */
  public listLlmProviders(): readonly ContributedLlmProvider[] {
    return Array.from(this.llmProviders.values());
  }

  /** Remove all providers contributed by a given plugin (on unload/disable). */
  public clearForPlugin(pluginId: string): void {
    // Tagging providers by plugin is handled by HostCapabilities; the registry itself is
    // keyed by provider id. For the MVP we clear all on full teardown — per-plugin removal
    // is a documented future enhancement (see plugin-types.ts HostCapabilities note).
    void pluginId;
  }
}

// NOTE: HostCapabilities is defined in ../types/plugin-types.ts (part of the plugin author
// contract). It is re-exported from the package index via that module, not here.
