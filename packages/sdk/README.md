# @sutradhar/sdk

The plugin/extension SDK for Sutradhar. Two layers:

- **Author plugins** — the `ISutradharPlugin` contract, manifest schema, and the host
  capability API a plugin uses to contribute to Sutradhar.
- **Host plugins** — load plugins from disk, manage their lifecycle, verify signatures, and
  consume the providers they register.

## What works in this release (MVP)

This SDK was previously a stubbed scaffold (the `PROJECT_DEEP_DIVE.md` "stubs" claim was
correct). The following are now **real and verified end-to-end**:

| Capability | Status |
|---|---|
| Plugin loader (manifest on disk → dynamic import → instantiate → lifecycle) | ✅ Real |
| `llm_provider` extension point (register a provider the host can query + call) | ✅ Real |
| `PluginManager` lifecycle (install / initialize / enable / disable / uninstall / upgrade) | ✅ Real |
| `PluginManifestValidator` | ✅ Real (presence checks) |
| `PluginHost` + `ProviderRegistry` (the capability bridge to the runtime) | ✅ Real |
| Ed25519 signature verification (replaces the old `sig_valid_` prefix fake) | ✅ Real |
| Unsigned plugins allowed in local dev (`allowUnsigned`) | ✅ Real |
| Example plugin (`examples/echo-llm-provider`) | ✅ Works |
| Execution isolation (worker_threads / vm) | ❌ Deferred — plugins run in-process |
| Marketplace registry transport (HTTP discovery / download) | ❌ Deferred — in-memory map only |
| Wiring into `apps/server` (admin REST APIs) | ❌ Deferred |
| Persistence of install/enable state | ❌ Deferred |
| Other extension points (skill, memory_provider, vector_store, …) | ❌ Deferred (types defined; no per-type contract yet) |

## Quick start: host plugins

```ts
import { PluginManager, PluginLoader, PluginHost } from '@sutradhar/sdk';

const manager = new PluginManager();
const host = new PluginHost({ manager });
manager.setCapabilitiesProvider((id) => host.capabilitiesFor(id));

const loader = new PluginLoader({ allowUnsigned: true });
const result = await loader.load('./plugins/my-provider', manager);
if (result.initialized) {
  const provider = host.getLlmProvider('my-provider-id');
  const reply = await provider.complete('Hello');
}
```

To load every plugin under a directory: `await loader.loadAll('./plugins', manager)`.

## Author a plugin

A plugin is a directory containing a manifest (`sutradhar-plugin.json`) and an entrypoint
(referenced by the manifest). The entrypoint default-exports a constructor of
`ISutradharPlugin`.

### `sutradhar-plugin.json`

```json
{
  "id": "echo-llm-provider",
  "name": "Echo LLM Provider",
  "version": "0.1.0",
  "author": "You",
  "description": "A trivial LLM provider that echoes its prompt.",
  "type": "llm_provider",
  "permissions": [],
  "dependencies": [],
  "runtimeCompatibility": "*",
  "entrypoint": "index.js"
}
```

| Field | Required | Notes |
|---|---|---|
| `id` | yes | Unique plugin id. |
| `name` / `version` / `author` / `description` | yes | Metadata. |
| `type` | yes | One of the 11 plugin types (only `llm_provider` has a real extension point today). |
| `permissions` | — | `'filesystem' \| 'network' \| 'credentials' \| 'browser'` (advisory today; enforced when isolation lands). |
| `dependencies` | — | `{ pluginId, minVersion }[]`; the loader checks each is already installed. |
| `runtimeCompatibility` | — | `'*'` or an exact runtime version (semver ranges: future). |
| `entrypoint` | yes | Path to the JS entrypoint, relative to the manifest dir. |
| `signature` | — | `ed25519:<base64>`. Absent = unsigned (allowed when `allowUnsigned`). |

### `index.js` (entrypoint)

```js
export class MyProviderPlugin {
  constructor() {
    this.manifest = { /* must match sutradhar-plugin.json, esp. id */ };
    this.state = 'UNINSTALLED';
  }
  async initialize(context) {
    // The extension point: register a provider into the host.
    context.host?.providers.registerLlmProvider({
      id: 'my-model',
      label: 'My Model',
      complete: async (prompt, opts) => { /* call your model, return a string */ },
    });
  }
  async enable() { this.state = 'ENABLED'; }
  async disable() { this.state = 'DISABLED'; }
  async unload() { this.state = 'UNINSTALLED'; }
}
export default MyProviderPlugin;
```

See `examples/echo-llm-provider/` for a complete, working example.

## Signing plugins

To ship a signed plugin (so a host requiring signatures will accept it):

```js
import { generateKeyPairSync, sign } from 'node:crypto';
import { signedPayload } from '@sutradhar/sdk';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
// payload = manifest JSON with `signature` removed, stable key order
const sig = sign(null, Buffer.from(signedPayload(manifest), 'utf8'), privateKey);
const signed = { ...manifest, signature: `ed25519:${sig.toString('base64')}` };
```

The host supplies the matching public key via `new PluginLoader({ trustedKeys: [{ id, publicKey }] })`.
Verification rejects tampered manifests, untrusted keys, and the old `sig_valid_` prefix.

## How it fits together

```
plugin dir ─▶ PluginLoader ─▶ PluginManager ─▶ Plugin.initialize(context)
                   │                                  │
                   │  verifies                        │  context.host.providers
                   │  signature                       ▼
                   │                          ProviderRegistry (on PluginHost)
                   │                                  ▲
                   └──────────────────────────────────┘  host.getLlmProvider(id)
                                                          (the runtime queries this)
```

## Deferred work (not in this release)

These are the remaining gaps to a full plugin platform, in priority order:

1. **Execution isolation** — plugins currently run in-process. Wrap plugin execution in
   `worker_threads` (or `isolated-vm`) with a capability bridge so plugin code is contained.
2. **Server wiring + admin API** — instantiate `PluginHost` in `apps/server` boot, expose
   install/list/enable/disable REST endpoints, and have the agent loop consult contributed
   `llm_provider`s via the host.
3. **Marketplace transport** — HTTP discovery + download + integrity check over the existing
   `MarketplaceRegistry` (GitHub-repo-backed index, free).
4. **Persistence** — store install/enable state in `@sutradhar/storage` so it survives restarts.
5. **More extension points** — define per-type contracts for `skill`, `memory_provider`,
   `vector_store`, etc. (today only `llm_provider` does something).
6. **Semver ranges** for `runtimeCompatibility` and `dependencies.minVersion`.
