/**
 * @file packages/sdk/src/marketplace/marketplace-registry.ts
 * @description MarketplaceRegistry handling plugin discovery, versioning, compatibility, and signature verification.
 */

import { PluginManifest } from '../manifest/plugin-manifest.js';

export interface RegistryEntry {
  readonly manifest: PluginManifest;
  readonly downloadUrl: string;
  readonly publishedAt: string;
  readonly isVerified: boolean;
}

export class MarketplaceRegistry {
  private readonly catalog = new Map<string, RegistryEntry>();

  public registerPluginEntry(entry: RegistryEntry): void {
    this.catalog.set(entry.manifest.id, entry);
  }

  public discoverPlugins(query?: string): readonly RegistryEntry[] {
    const entries = Array.from(this.catalog.values());
    if (!query) return entries;
    const lower = query.toLowerCase();
    return entries.filter(
      (e) =>
        e.manifest.name.toLowerCase().includes(lower) ||
        e.manifest.description.toLowerCase().includes(lower) ||
        e.manifest.type.toLowerCase().includes(lower),
    );
  }

  /**
   * Verify a manifest's signature against the registry's trusted keys.
   *
   * NOTE: this is synchronous-best-effort and returns false for any signature that requires
   * async key parsing. For full verification use {@link verifyManifestSignature} (async)
   * directly — the loader does. This method is retained for API compatibility and for the
   * trivial unsigned case.
   */
  public verifySignature(manifest: PluginManifest): boolean {
    // No signature → not verified (callers decide whether to allow unsigned).
    if (!manifest.signature) return false;
    // A real verification requires the async verifier + trusted keys. Mark as "not verified
    // here" rather than the previous `sig_valid_` fake-affirmative lie. Callers that need a
    // definitive answer must use the async path in loader/signature-verifier.ts.
    return false;
  }

  public isCompatible(manifest: PluginManifest, targetRuntimeVersion: string): boolean {
    return (
      manifest.runtimeCompatibility === '*' ||
      manifest.runtimeCompatibility === targetRuntimeVersion
    );
  }
}
