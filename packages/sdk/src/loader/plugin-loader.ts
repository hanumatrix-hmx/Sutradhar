/**
 * @file packages/sdk/src/loader/plugin-loader.ts
 * @description Real plugin loader — the piece that was missing.
 *
 * Goes from "a plugin directory on disk" to "a running IPinchTabPlugin instance" by:
 *   1. Reading `pinchtab-plugin.json` (the manifest) from a plugin directory.
 *   2. Validating the manifest.
 *   3. Verifying the manifest signature (real ed25519, or skipped when unsigned & allowed).
 *   4. Dynamically `import()`ing the entrypoint module.
 *   5. Instantiating the plugin (the module's default export must be a constructor of
 *      IPinchTabPlugin, or the module must default-export an IPinchTabPlugin instance).
 *   6. Installing + initializing it via the existing PluginManager.
 *
 * This closes the gap the deep-dive identified: PluginManager previously required a
 * caller-constructed instance; now the manager can be driven from files on disk.
 */

import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { PluginManifest } from '../manifest/plugin-manifest.js';
import { PluginManifestValidator } from '../manifest/plugin-manifest.js';
import type { IPinchTabPlugin } from '../types/plugin-types.js';
import { verifyManifestSignature, type TrustedKey } from './signature-verifier.js';

/** Result of loading a single plugin from disk. */
export interface LoadResult {
  pluginId: string;
  installed: boolean;
  initialized: boolean;
  /** Why loading failed (installed/initialized will be false). */
  error?: string;
}

/** A factory that produces an IPinchTabPlugin. The entrypoint module's default export. */
export type PluginModule =
  | { default: NewablePlugin }
  | { default: IPinchTabPlugin }
  | NewablePlugin
  | IPinchTabPlugin;

/** A constructor returning an IPinchTabPlugin. */
export type NewablePlugin = new () => IPinchTabPlugin;

/** Options for {@link PluginLoader}. */
export interface PluginLoaderOptions {
  /** Manifest file name within each plugin directory. Default `pinchtab-plugin.json`. */
  manifestFileName?: string;
  /**
   * Whether to allow loading plugins with no signature (local dev / self-authored plugins).
   * Default true. Set false for a marketplace/production install path that requires signed
   * plugins only.
   */
  allowUnsigned?: boolean;
  /**
   * Trusted public keys for signature verification. When a manifest carries a signature,
   * it must verify against one of these keys. If empty and a signature is present, the
   * signature is treated as unverifiable (load fails unless allowUnsigned bypasses it —
   * but a present-and-invalid signature is never silently accepted).
   */
  trustedKeys?: readonly TrustedKey[];
}

/**
 * Loads plugins from the filesystem into a {@link PluginManager} (provided at load time).
 * Stateless beyond its options — pass the manager to each load call.
 *
 * @example
 * const loader = new PluginLoader();
 * const manager = new PluginManager();
 * const result = await loader.load('./plugins/my-llm-provider', manager);
 * if (result.initialized) console.log('plugin ready:', result.pluginId);
 */
export class PluginLoader {
  private readonly manifestFileName: string;
  private readonly allowUnsigned: boolean;
  private readonly trustedKeys: readonly TrustedKey[];

  public constructor(options: PluginLoaderOptions = {}) {
    this.manifestFileName = options.manifestFileName ?? 'pinchtab-plugin.json';
    this.allowUnsigned = options.allowUnsigned ?? true;
    this.trustedKeys = options.trustedKeys ?? [];
  }

  /**
   * Load a single plugin from a directory containing `pinchtab-plugin.json`.
   * Resolves the entrypoint relative to the manifest directory.
   */
  public async load(pluginDir: string, manager: PluginManagerLike): Promise<LoadResult> {
    const dir = resolve(pluginDir);
    const pluginId = '<unknown>';
    try {
      const manifestPath = join(dir, this.manifestFileName);
      const manifest = await this.readManifest(manifestPath);
      const id = manifest.id;

      // Signature verification (real crypto when a signature is present).
      const sig = await verifyManifestSignature(manifest, manifestPath, this.trustedKeys);
      if (!sig.valid) {
        if (!this.allowUnsigned || manifest.signature) {
          // Either an explicit signature failed, or unsigned plugins are disallowed.
          return this.fail(id, `signature verification failed: ${sig.reason}`);
        }
        // Unsigned + allowed: continue (local-dev path).
      }

      const plugin = await this.instantiate(manifest, dir);
      await manager.installPlugin(plugin);
      await manager.initializePlugin(id);
      return { pluginId: id, installed: true, initialized: true };
    } catch (e) {
      return this.fail(pluginId, (e as Error).message);
    }
  }

  /** Load every plugin found one level deep under a plugins root directory. */
  public async loadAll(pluginsRoot: string, manager: PluginManagerLike): Promise<LoadResult[]> {
    const { readdir } = await import('node:fs/promises');
    const root = resolve(pluginsRoot);
    let entries: import('node:fs').Dirent[];
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch {
      return []; // no plugins root / not a directory — nothing to load
    }
    const dirs = entries.filter((e) => e.isDirectory());
    const results: LoadResult[] = [];
    for (const d of dirs) {
      results.push(await this.load(join(root, d.name), manager));
    }
    return results;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Internals
  // ─────────────────────────────────────────────────────────────────────────

  private async readManifest(manifestPath: string): Promise<PluginManifest> {
    let raw: string;
    try {
      raw = await readFile(manifestPath, 'utf8');
    } catch {
      throw new Error(`manifest not found at ${manifestPath}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new Error(`manifest is not valid JSON: ${(e as Error).message}`);
    }
    const manifest = parsed as PluginManifest;
    const validation = PluginManifestValidator.validate(manifest);
    if (!validation.isValid) {
      throw new Error(`manifest validation failed: ${validation.errors.join(', ')}`);
    }
    return manifest;
  }

  private async instantiate(manifest: PluginManifest, dir: string): Promise<IPinchTabPlugin> {
    // Resolve entrypoint relative to the plugin directory (allow absolute paths too).
    const entryPath = isAbsolute(manifest.entrypoint)
      ? manifest.entrypoint
      : resolve(dir, manifest.entrypoint);

    // Confirm the file exists — fail with a clear message before the dynamic import.
    try {
      const s = await stat(entryPath);
      if (!s.isFile()) throw new Error('not a file');
    } catch {
      throw new Error(`entrypoint not found: ${entryPath}`);
    }

    // Dynamic import (ESM). pathToFileURL is required on Windows.
    const mod = (await import(pathToFileURL(entryPath).href)) as PluginModule;
    const plugin = this.extractPlugin(mod);
    // Belt-and-braces: the instance's manifest should match the on-disk one.
    if (plugin.manifest.id !== manifest.id) {
      throw new Error(
        `entrypoint plugin id "${plugin.manifest.id}" does not match manifest id "${manifest.id}"`,
      );
    }
    return plugin;
  }

  /** Accept several common module shapes and return an IPinchTabPlugin instance. */
  private extractPlugin(mod: PluginModule): IPinchTabPlugin {
    const candidate = (mod as { default?: unknown }).default ?? mod;
    if (this.isPlugin(candidate)) return candidate;
    if (typeof candidate === 'function') {
      const constructed = new (candidate as NewablePlugin)();
      if (this.isPlugin(constructed)) return constructed;
    }
    throw new Error(
      "entrypoint must default-export an IPinchTabPlugin instance or a constructor that produces one",
    );
  }

  private isPlugin(v: unknown): v is IPinchTabPlugin {
    return (
      !!v &&
      typeof v === 'object' &&
      typeof (v as IPinchTabPlugin).initialize === 'function' &&
      typeof (v as IPinchTabPlugin).enable === 'function' &&
      typeof (v as IPinchTabPlugin).disable === 'function' &&
      typeof (v as IPinchTabPlugin).unload === 'function' &&
      !!(v as IPinchTabPlugin).manifest
    );
  }

  private fail(pluginId: string, error: string): LoadResult {
    return { pluginId, installed: false, initialized: false, error };
  }
}

/**
 * The slice of {@link PluginManager} the loader depends on. Kept as an interface so the
 * loader is testable with a stub and so future host integrations can supply their own.
 */
export interface PluginManagerLike {
  installPlugin(plugin: IPinchTabPlugin): Promise<void>;
  initializePlugin(pluginId: string): Promise<void>;
}
