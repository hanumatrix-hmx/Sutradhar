// Signature verification smoke test: prove the real ed25519 verifier works round-trip and
// that a bad signature / wrong key is rejected. Run: node packages/sdk/scripts/smoke-signature.mjs

import { generateKeyPairSync, sign } from 'node:crypto';
import { verifyManifestSignature, signedPayload } from '../dist/loader/signature-verifier.js';

const log = (m) => console.log(`[${new Date().toISOString().slice(11, 23)}] ${m}`);

// 1. Generate a real ed25519 keypair.
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const pubPem = publicKey.export({ type: 'spki', format: 'pem' });

const manifest = {
  id: 'test-plugin',
  name: 'Test',
  version: '0.1.0',
  author: 'test',
  description: 'sig test',
  type: 'skill',
  permissions: [],
  dependencies: [],
  runtimeCompatibility: '*',
  entrypoint: 'index.js',
};

// 2. Sign the manifest payload with the private key (ed25519 is pure: algorithm = null).
const payload = signedPayload(manifest);
const sigBytes = sign(null, Buffer.from(payload, 'utf8'), privateKey);
const signedManifest = { ...manifest, signature: `ed25519:${sigBytes.toString('base64')}` };

log('[1] verify a correctly-signed manifest with the trusted public key ...');
let r = await verifyManifestSignature(signedManifest, 'x', [{ id: 'test', publicKey: pubPem }]);
log(`    valid=${r.valid} reason=${r.reason ?? 'ok'}`);
if (!r.valid) throw new Error('expected valid signature');

log('[2] verify a tampered manifest (id changed) with the same key ...');
const tampered = { ...signedManifest, id: 'evil-plugin' };
r = await verifyManifestSignature(tampered, 'x', [{ id: 'test', publicKey: pubPem }]);
log(`    valid=${r.valid} reason=${r.reason}`);
if (r.valid) throw new Error('expected tampered signature to fail');

log('[3] verify a signed manifest with NO trusted keys ...');
r = await verifyManifestSignature(signedManifest, 'x', []);
log(`    valid=${r.valid} reason=${r.reason}`);
if (r.valid) throw new Error('expected no-key rejection');

log('[4] verify an unsigned manifest ...');
r = await verifyManifestSignature(manifest, 'x', [{ id: 'test', publicKey: pubPem }]);
log(`    valid=${r.valid} reason=${r.reason}`);
if (r.valid) throw new Error('expected unsigned=false');

log('[5] reject the old sig_valid_ fake-prefix scheme ...');
r = await verifyManifestSignature({ ...manifest, signature: 'sig_valid_123' }, 'x', [{ id: 'test', publicKey: pubPem }]);
log(`    valid=${r.valid} reason=${r.reason}`);
if (r.valid) throw new Error('the old sig_valid_ prefix must NOT be accepted');

log('✅ REAL SIGNATURE VERIFICATION WORKS: signs, verifies, rejects tampering/missing-key/fake-prefix.');
process.exit(0);
