/**
 * @file packages/sdk/src/manager/plugin-manager.ts
 * @description PluginManager coordinating plugin lifecycles, dependency resolution, upgrading, and uninstallation.
 */

import { ISutradharPlugin, PluginContext, HostCapabilities } from '../types/plugin-types.js';
import { PluginSandbox } from '../sandbox/plugin-sandbox.js';
import { PluginManifestValidator } from '../manifest/plugin-manifest.js';

export class PluginManager {
  private readonly plugins = new Map<string, ISutradharPlugin>();
  private readonly sandboxes = new Map<string, PluginSandbox>();
  /**
   * Optional host that supplies real capabilities to plugins via PluginContext.host. When
   * unset, the context has no `host` (backward-compatible with original dummy plugins).
   * Set by the host integration before loading plugins.
   */
  private capabilitiesProvider: ((pluginId: string) => HostCapabilities) | undefined;

  /** Supply a capabilities provider so initialized plugins get real host capabilities. */
  public setCapabilitiesProvider(fn: (pluginId: string) => HostCapabilities): void {
    this.capabilitiesProvider = fn;
  }

  public async installPlugin(plugin: ISutradharPlugin): Promise<void> {
    const validation = PluginManifestValidator.validate(plugin.manifest);
    if (!validation.isValid) {
      throw new Error(
        `Plugin validation failed for ${plugin.manifest.id}: ${validation.errors.join(', ')}`,
      );
    }

    // Check dependency resolution
    for (const dep of plugin.manifest.dependencies) {
      if (!this.plugins.has(dep.pluginId)) {
        throw new Error(
          `Missing dependency ${dep.pluginId} (min version ${dep.minVersion}) required by ${plugin.manifest.id}`,
        );
      }
    }

    plugin.state = 'INSTALLED';
    this.plugins.set(plugin.manifest.id, plugin);
    this.sandboxes.set(plugin.manifest.id, new PluginSandbox(plugin.manifest.permissions));
  }

  public async initializePlugin(pluginId: string): Promise<void> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) throw new Error(`Plugin ${pluginId} not found`);

    const context: PluginContext = {
      pluginId,
      grantedPermissions: plugin.manifest.permissions,
      logger: {
        // eslint-disable-next-line no-console -- plugin callbacks deliberately surface host-visible progress.
        info: (msg) => console.log(`[Plugin:${pluginId}] ${msg}`),
        warn: (msg) => console.warn(`[Plugin:${pluginId}] ${msg}`),
        error: (msg) => console.error(`[Plugin:${pluginId}] ${msg}`),
      },
      host: this.capabilitiesProvider ? this.capabilitiesProvider(pluginId) : undefined,
    };

    try {
      await plugin.initialize(context);
      plugin.state = 'INITIALIZED';
    } catch (e) {
      // Previously the dead 'FAILED' state — now set when initialization throws, so callers
      // (loader, host) can report the failure and the plugin is not left in an ambiguous state.
      plugin.state = 'FAILED';
      throw new Error(`Plugin ${pluginId} initialization failed: ${(e as Error).message}`);
    }
  }

  public async enablePlugin(pluginId: string): Promise<void> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) throw new Error(`Plugin ${pluginId} not found`);

    await plugin.enable();
    plugin.state = 'ENABLED';
  }

  public async disablePlugin(pluginId: string): Promise<void> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) throw new Error(`Plugin ${pluginId} not found`);

    await plugin.disable();
    plugin.state = 'DISABLED';
  }

  public async upgradePlugin(updatedPlugin: ISutradharPlugin): Promise<void> {
    const pluginId = updatedPlugin.manifest.id;
    if (this.plugins.has(pluginId)) {
      await this.disablePlugin(pluginId);
      const oldPlugin = this.plugins.get(pluginId);
      await oldPlugin?.unload();
    }
    await this.installPlugin(updatedPlugin);
    await this.initializePlugin(pluginId);
    await this.enablePlugin(pluginId);
  }

  public async uninstallPlugin(pluginId: string): Promise<void> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) throw new Error(`Plugin ${pluginId} not found`);

    if (plugin.state === 'ENABLED') {
      await plugin.disable();
    }
    await plugin.unload();
    plugin.state = 'UNINSTALLED';
    this.plugins.delete(pluginId);
    this.sandboxes.delete(pluginId);
  }

  public getPlugin(pluginId: string): ISutradharPlugin | undefined {
    return this.plugins.get(pluginId);
  }

  public getSandbox(pluginId: string): PluginSandbox | undefined {
    return this.sandboxes.get(pluginId);
  }

  public listPlugins(): readonly ISutradharPlugin[] {
    return Array.from(this.plugins.values());
  }
}
