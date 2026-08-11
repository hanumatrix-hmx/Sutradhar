/**
 * @file packages/sdk/tests/unit/plugin-sdk.spec.ts
 * @description Unit test suite for @pinchtab/sdk verifying plugin lifecycle, sandboxing, dependency resolution, upgrading, and marketplace registry.
 */

import {
  PluginManager,
  PluginSandbox,
  MarketplaceRegistry,
  IPinchTabPlugin,
  PluginContext,
} from '../../src/index.js';

class DummySkillPlugin implements IPinchTabPlugin {
  public state: any = 'UNINSTALLED';

  public manifest = {
    id: 'plugin-dummy-skill',
    name: 'Dummy Skill Plugin',
    version: '1.0.0',
    author: 'PinchTab Team',
    description: 'A test skill plugin',
    type: 'skill' as const,
    permissions: ['network' as const],
    dependencies: [],
    runtimeCompatibility: '*',
    entrypoint: 'index.js',
    signature: 'sig_valid_123',
  };

  public async initialize(_context: PluginContext): Promise<void> {}
  public async enable(): Promise<void> {}
  public async disable(): Promise<void> {}
  public async unload(): Promise<void> {}
}

class DummyDependentPlugin implements IPinchTabPlugin {
  public state: any = 'UNINSTALLED';

  public manifest = {
    id: 'plugin-dependent',
    name: 'Dependent Plugin',
    version: '1.0.0',
    author: 'PinchTab Team',
    description: 'Requires dummy skill',
    type: 'action' as const,
    permissions: ['browser' as const],
    dependencies: [{ pluginId: 'plugin-dummy-skill', minVersion: '1.0.0' }],
    runtimeCompatibility: '*',
    entrypoint: 'index.js',
  };

  public async initialize(_context: PluginContext): Promise<void> {}
  public async enable(): Promise<void> {}
  public async disable(): Promise<void> {}
  public async unload(): Promise<void> {}
}

describe('@pinchtab/sdk Platform SDK Suite', () => {
  let manager: PluginManager;
  let registry: MarketplaceRegistry;

  beforeEach(() => {
    manager = new PluginManager();
    registry = new MarketplaceRegistry();
  });

  it('1. should install, initialize, and enable a valid plugin', async () => {
    const plugin = new DummySkillPlugin();
    await manager.installPlugin(plugin);
    expect(plugin.state).toBe('INSTALLED');

    await manager.initializePlugin(plugin.manifest.id);
    expect(plugin.state).toBe('INITIALIZED');

    await manager.enablePlugin(plugin.manifest.id);
    expect(plugin.state).toBe('ENABLED');
  });

  it('2. should enforce PluginSandbox permission boundaries', () => {
    const sandbox = new PluginSandbox(['network']);

    expect(sandbox.hasPermission('network')).toBe(true);
    expect(sandbox.hasPermission('filesystem')).toBe(false);

    expect(() => sandbox.assertPermission('network', 'Fetch API call')).not.toThrow();
    expect(() => sandbox.assertPermission('filesystem', 'Read local file')).toThrow(
      'Security Violation',
    );
  });

  it('3. should enforce dependency resolution on installation', async () => {
    const depPlugin = new DummyDependentPlugin();

    // Installation should fail when dependency is missing
    await expect(manager.installPlugin(depPlugin)).rejects.toThrow('Missing dependency');

    // Install required dependency first
    const basePlugin = new DummySkillPlugin();
    await manager.installPlugin(basePlugin);

    // Now dependent installation succeeds
    await expect(manager.installPlugin(depPlugin)).resolves.not.toThrow();
  });

  it('4. should upgrade plugin gracefully', async () => {
    const pluginV1 = new DummySkillPlugin();
    await manager.installPlugin(pluginV1);
    await manager.initializePlugin(pluginV1.manifest.id);
    await manager.enablePlugin(pluginV1.manifest.id);

    const pluginV2 = new DummySkillPlugin();
    pluginV2.manifest = { ...pluginV1.manifest, version: '2.0.0' };

    await manager.upgradePlugin(pluginV2);
    const loaded = manager.getPlugin(pluginV1.manifest.id);
    expect(loaded?.manifest.version).toBe('2.0.0');
    expect(loaded?.state).toBe('ENABLED');
  });

  it('5. should uninstall plugin cleanly', async () => {
    const plugin = new DummySkillPlugin();
    await manager.installPlugin(plugin);
    await manager.initializePlugin(plugin.manifest.id);
    await manager.enablePlugin(plugin.manifest.id);

    await manager.uninstallPlugin(plugin.manifest.id);
    expect(manager.getPlugin(plugin.manifest.id)).toBeUndefined();
    expect(plugin.state).toBe('UNINSTALLED');
  });

  it('6. should discover plugins and verify signatures in MarketplaceRegistry', () => {
    const plugin = new DummySkillPlugin();
    registry.registerPluginEntry({
      manifest: plugin.manifest,
      downloadUrl: 'https://marketplace.pinchtab.io/plugins/dummy.zip',
      publishedAt: new Date().toISOString(),
      isVerified: true,
    });

    const results = registry.discoverPlugins('Dummy');
    expect(results.length).toBe(1);
    // The sync verifySignature is intentionally conservative (returns false for any signature;
    // full ed25519 verification is async — see loader/signature-verifier.ts). The old
    // `sig_valid_` prefix-affirmative behavior was removed as dishonest; this asserts the new
    // contract: a manifest carrying the legacy prefix is NOT trusted by the sync method.
    expect(registry.verifySignature(plugin.manifest)).toBe(false);
    expect(registry.isCompatible(plugin.manifest, '1.0.0')).toBe(true);
  });
});
