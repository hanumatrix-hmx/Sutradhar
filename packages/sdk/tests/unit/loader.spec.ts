/**
 * @file packages/sdk/tests/unit/loader.spec.ts
 * @description Unit tests for the real plugin loader + ed25519 signature verifier + the
 * llm_provider extension point. These were the pieces that were previously stubbed; these
 * tests lock in that they're genuinely real.
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync, sign } from 'node:crypto';
import {
  PluginLoader,
  PluginManager,
  PluginHost,
  verifyManifestSignature,
  signedPayload,
  SDK_VERSION,
} from '../../src/index.js';

describe('@pinchtab/sdk loader + signature + extension point', () => {
  it('exports SDK version 0.2.0 (bumped from the stubbed 0.1.0)', () => {
    expect(SDK_VERSION).toBe('0.2.0');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Signature verifier — the piece that was the `sig_valid_` fake
  // ─────────────────────────────────────────────────────────────────────────
  describe('verifyManifestSignature (real ed25519)', () => {
    const manifest = {
      id: 'test-plugin',
      name: 'Test',
      version: '0.1.0',
      author: 'test',
      description: 'sig test',
      type: 'skill' as const,
      permissions: [],
      dependencies: [],
      runtimeCompatibility: '*',
      entrypoint: 'index.js',
    };
    let pubPem: string;
    let privateKey: ReturnType<typeof generateKeyPairSync<'ed25519'>>['privateKey'];

    beforeAll(() => {
      const kp = generateKeyPairSync('ed25519');
      pubPem = kp.publicKey.export({ type: 'spki', format: 'pem' });
      privateKey = kp.privateKey;
    });

    it('verifies a correctly-signed manifest against the trusted key', async () => {
      const sig = sign(null, Buffer.from(signedPayload(manifest), 'utf8'), privateKey);
      const signed = { ...manifest, signature: `ed25519:${sig.toString('base64')}` };
      const r = await verifyManifestSignature(signed, 'x', [{ id: 'test', publicKey: pubPem }]);
      expect(r.valid).toBe(true);
    });

    it('rejects a tampered manifest', async () => {
      const sig = sign(null, Buffer.from(signedPayload(manifest), 'utf8'), privateKey);
      const tampered = { ...manifest, id: 'evil', signature: `ed25519:${sig.toString('base64')}` };
      const r = await verifyManifestSignature(tampered, 'x', [{ id: 'test', publicKey: pubPem }]);
      expect(r.valid).toBe(false);
      expect(r.reason).toBe('bad-signature');
    });

    it('reports unsigned when no signature is present', async () => {
      const r = await verifyManifestSignature(manifest, 'x', [{ id: 'test', publicKey: pubPem }]);
      expect(r.valid).toBe(false);
      expect(r.reason).toBe('unsigned');
    });

    it('reports no-key when a signature is present but no trusted keys are supplied', async () => {
      const r = await verifyManifestSignature(
        { ...manifest, signature: 'ed25519:abc' },
        'x',
        [],
      );
      expect(r.valid).toBe(false);
      expect(r.reason).toBe('no-key');
    });

    it('rejects the legacy sig_valid_ prefix scheme (the old fake)', async () => {
      const r = await verifyManifestSignature(
        { ...manifest, signature: 'sig_valid_123' },
        'x',
        [{ id: 'test', publicKey: pubPem }],
      );
      expect(r.valid).toBe(false);
      // sig_valid_123 parses as algorithm=sig, signature=valid_123 → malformed (no ':' split) OR
      // parsed but not ed25519 → either way, NOT valid. The key assertion: the prefix no longer
      // grants trust.
      expect(r.valid).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Loader + extension point — end-to-end from a plugin dir on disk
  // ─────────────────────────────────────────────────────────────────────────
  describe('PluginLoader end-to-end', () => {
    let pluginDir: string;

    beforeEach(() => {
      pluginDir = mkdtempSync(join(tmpdir(), 'pinchtab-plugin-test-'));
    });
    afterEach(() => {
      rmSync(pluginDir, { recursive: true, force: true });
    });

    const writePlugin = (id: string, entryJs: string) => {
      mkdirSync(pluginDir, { recursive: true });
      writeFileSync(
        join(pluginDir, 'pinchtab-plugin.json'),
        JSON.stringify({
          id,
          name: id,
          version: '0.1.0',
          author: 'test',
          description: 'test plugin',
          type: 'llm_provider',
          permissions: [],
          dependencies: [],
          runtimeCompatibility: '*',
          entrypoint: 'index.js',
        }),
      );
      writeFileSync(join(pluginDir, 'index.js'), entryJs);
    };

    it('loads a plugin from disk, runs its lifecycle, and the provider is callable from the host', async () => {
      writePlugin(
        'echo-provider',
        `export class P {
          constructor() { this.manifest = { id:'echo-provider', name:'echo-provider', version:'0.1.0', author:'t', description:'d', type:'llm_provider', permissions:[], dependencies:[], runtimeCompatibility:'*', entrypoint:'index.js' }; this.state='UNINSTALLED'; }
          async initialize(c){ this.c=c; c.host?.providers.registerLlmProvider({ id:'echo', complete: async(p)=>\`[echo] \${p}\` }); }
          async enable(){ this.state='ENABLED'; }
          async disable(){ this.state='DISABLED'; }
          async unload(){ this.state='UNINSTALLED'; }
        }
        export default P;`,
      );

      const manager = new PluginManager();
      const host = new PluginHost({ manager });
      manager.setCapabilitiesProvider((id) => host.capabilitiesFor(id));
      const loader = new PluginLoader({ allowUnsigned: true });

      const result = await loader.load(pluginDir, manager);
      expect(result.installed).toBe(true);
      expect(result.initialized).toBe(true);
      expect(result.error).toBeUndefined();

      const provider = host.getLlmProvider('echo');
      expect(provider).toBeDefined();
      expect(await provider!.complete('hello')).toBe('[echo] hello');
    });

    it('reports a clear error when the manifest is missing', async () => {
      mkdirSync(pluginDir, { recursive: true }); // empty dir, no manifest
      const loader = new PluginLoader();
      const result = await loader.load(pluginDir, new PluginManager());
      expect(result.installed).toBe(false);
      expect(result.error).toMatch(/manifest/);
    });

    it('reports a clear error when the entrypoint does not exist', async () => {
      mkdirSync(pluginDir, { recursive: true });
      writeFileSync(
        join(pluginDir, 'pinchtab-plugin.json'),
        JSON.stringify({
          id: 'no-entry',
          name: 'no-entry',
          version: '0.1.0',
          author: 't',
          description: 'd',
          type: 'skill',
          permissions: [],
          dependencies: [],
          runtimeCompatibility: '*',
          entrypoint: 'missing.js',
        }),
      );
      const loader = new PluginLoader({ allowUnsigned: true });
      const result = await loader.load(pluginDir, new PluginManager());
      expect(result.installed).toBe(false);
      expect(result.error).toMatch(/entrypoint/);
    });

    it('rejects an unsigned plugin when allowUnsigned is false', async () => {
      writePlugin(
        'unsigned',
        `export class P { constructor(){ this.manifest={id:'unsigned',name:'unsigned',version:'0.1.0',author:'t',description:'d',type:'llm_provider',permissions:[],dependencies:[],runtimeCompatibility:'*',entrypoint:'index.js'}; this.state='UNINSTALLED'; } async initialize(){} async enable(){} async disable(){} async unload(){} } export default P;`,
      );
      const loader = new PluginLoader({ allowUnsigned: false });
      const result = await loader.load(pluginDir, new PluginManager());
      expect(result.installed).toBe(false);
      expect(result.error).toMatch(/signature/);
    });
  });
});
