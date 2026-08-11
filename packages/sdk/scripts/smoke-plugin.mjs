// Plugin system smoke test: load the example llm_provider plugin from disk and verify the
// full path works end-to-end (manifest → dynamic import → lifecycle → provider registers).
// Run directly (no pipe): node packages/sdk/scripts/smoke-plugin.mjs

import { resolve } from 'node:path';
import { PluginManager } from '../dist/manager/plugin-manager.js';
import { PluginLoader } from '../dist/loader/plugin-loader.js';
import { PluginHost } from '../dist/host/plugin-host.js';

const log = (m) => console.log(`[${new Date().toISOString().slice(11, 23)}] ${m}`);

const manager = new PluginManager();
const host = new PluginHost({ manager });
// Wire the manager to hand plugins real capabilities via the host.
manager.setCapabilitiesProvider((pluginId) => host.capabilitiesFor(pluginId));

const loader = new PluginLoader({ allowUnsigned: true });
const exampleDir = resolve('packages/sdk/examples/echo-llm-provider');

log('[1] load plugin from disk ...');
const result = await loader.load(exampleDir, manager);
log(`    pluginId=${result.pluginId} installed=${result.installed} initialized=${result.initialized} error=${result.error ?? 'none'}`);

if (!result.initialized) {
  console.error('\n❌ PLUGIN LOAD FAILED');
  process.exit(1);
}

log('[2] verify plugin state in manager ...');
const plugin = manager.getPlugin('echo-llm-provider');
log(`    state=${plugin.state}`);
if (plugin.state !== 'INITIALIZED') throw new Error('expected INITIALIZED');

log('[3] query the registered provider from the host ...');
const providers = host.listLlmProviders();
log(`    registered providers: ${providers.map((p) => p.id).join(', ')}`);
const echo = host.getLlmProvider('echo');
if (!echo) throw new Error('provider "echo" not registered by the plugin');

log('[4] call the contributed provider ...');
const reply = await echo.complete('hello world');
log(`    complete("hello world") => ${JSON.stringify(reply)}`);
if (reply !== '[echo] hello world') throw new Error(`unexpected reply: ${reply}`);

log('[5] enable + disable lifecycle ...');
await manager.enablePlugin('echo-llm-provider');
log(`    state after enable=${plugin.state}`);
await manager.disablePlugin('echo-llm-provider');
log(`    state after disable=${plugin.state}`);

log('✅ PLUGIN SYSTEM WORKS END-TO-END: load → initialize → register provider → callable.');
process.exit(0);
