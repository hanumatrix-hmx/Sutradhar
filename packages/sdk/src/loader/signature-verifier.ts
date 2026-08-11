/**
 * @file packages/sdk/src/loader/signature-verifier.ts
 * @description Real ed25519 signature verification for plugin manifests, replacing the
 * previous `sig_valid_` string-prefix fake.
 *
 * Signature format: the manifest's `signature` field is `ed25519:<base64-signature>`,
 * where the signed payload is the manifest JSON serialized with the `signature` field
 * removed (so the signature does not sign itself). The public key is supplied by the host
 * (a trusted-publisher key set).
 *
 * For local development, an unsigned manifest (no `signature` field) is allowed to load
 * when the host opts in via PluginLoaderOptions.allowUnsigned — the verifier then returns
 * `{ valid: false, reason: 'unsigned' }` and the loader decides whether to proceed.
 */

import { createPublicKey, verify, KeyObject } from 'node:crypto';
import type { PluginManifest } from '../manifest/plugin-manifest.js';

export interface SignatureVerifyResult {
  valid: boolean;
  /** Present when valid is false: 'unsigned' | 'malformed' | 'no-key' | 'bad-signature'. */
  reason?: string;
}

/** A trusted public key for verifying plugin signatures. */
export interface TrustedKey {
  /** A stable id for this key (e.g. publisher name + key fingerprint). */
  id: string;
  /** The public key. Accepts PEM, DER base64, or a JWK object. */
  publicKey: string | Buffer | KeyObject | Record<string, unknown>;
}

/**
 * Verify a manifest's signature against a set of trusted public keys.
 *
 * - No signature field → `{ valid: false, reason: 'unsigned' }` (loader may allow this).
 * - Signature present but no trusted keys supplied → `{ valid: false, reason: 'no-key' }`.
 * - Signature present and matches a trusted key → `{ valid: true }`.
 */
export async function verifyManifestSignature(
  manifest: PluginManifest,
  _manifestPath: string,
  trustedKeys: readonly TrustedKey[] = [],
): Promise<SignatureVerifyResult> {
  if (!manifest.signature) {
    return { valid: false, reason: 'unsigned' };
  }

  const parsed = parseSignature(manifest.signature);
  if (!parsed) {
    return { valid: false, reason: 'malformed' };
  }

  if (trustedKeys.length === 0) {
    // A signature is present but the host has no trusted keys to verify against.
    // Treat as unverifiable rather than silently trusting.
    return { valid: false, reason: 'no-key' };
  }

  const payload = signedPayload(manifest);
  const payloadBuf = Buffer.from(payload, 'utf8');
  const sigBuf = Buffer.from(parsed.signature, 'base64');
  for (const tk of trustedKeys) {
    const keyObj = toKeyObject(tk.publicKey);
    if (!keyObj) continue;
    try {
      // Ed25519 is a pure signature scheme — no hash algorithm, so pass null. RSA/ECDSA keys
      // would need 'sha256' here, but the signature format pins the algorithm via the prefix
      // (e.g. "ed25519:...") and only ed25519 is currently produced by signManifest().
      if (parsed.algorithm === 'ed25519') {
        if (verify(null, payloadBuf, keyObj, sigBuf)) return { valid: true };
      } else {
        // Unknown algorithm — skip this key rather than guessing.
        continue;
      }
    } catch {
      // Key didn't match the algorithm / wrong key type — try the next trusted key.
    }
  }
  return { valid: false, reason: 'bad-signature' };
}

/**
 * The canonical signed payload: the manifest JSON with the `signature` field removed,
 * with stable key ordering. This is what {@link signManifest} (the author-side companion)
 * hashes and signs.
 */
export function signedPayload(manifest: PluginManifest): string {
  const { signature: _sig, ...rest } = manifest;
  return JSON.stringify(rest, Object.keys(rest).sort());
}

/** Parse a `ed25519:<base64>` signature string. Returns null if malformed. */
export function parseSignature(signature: string): { algorithm: string; signature: string } | null {
  const idx = signature.indexOf(':');
  if (idx <= 0) return null;
  const algorithm = signature.slice(0, idx);
  const sig = signature.slice(idx + 1);
  if (!algorithm || !sig) return null;
  return { algorithm, signature: sig };
}

/** Coerce the various accepted key formats into a Node KeyObject (or null if invalid). */
function toKeyObject(key: TrustedKey['publicKey']): KeyObject | null {
  try {
    if (typeof key === 'object' && key instanceof KeyObject) return key;
    if (typeof key === 'string') {
      if (key.includes('BEGIN PUBLIC KEY') || key.includes('BEGIN PRIVATE KEY')) {
        return createPublicKey(key);
      }
      // Assume raw base64 DER — wrap so createPublicKey can parse it.
      return createPublicKey({ key: Buffer.from(key, 'base64'), format: 'der', type: 'spki' });
    }
    if (Buffer.isBuffer(key)) {
      return createPublicKey({ key, format: 'der', type: 'spki' });
    }
    if (typeof key === 'object') {
      return createPublicKey({ key: key as Record<string, unknown>, format: 'jwk' });
    }
  } catch {
    return null;
  }
  return null;
}
