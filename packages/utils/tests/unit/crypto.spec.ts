/**
 * @file packages/utils/tests/unit/crypto.spec.ts
 * @description Unit tests for cryptographic hashing and AES-256-GCM encryption utilities.
 */

import {
  hashString,
  generateUuid,
  generateRandomToken,
  encryptSecret,
  decryptSecret,
  EncryptedPayload,
} from '../../src/index.js';

describe('Cryptographic & Token Utilities', () => {
  const sampleKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  it('should compute SHA-256 hash string correctly', () => {
    const hash = hashString('hello-world');
    expect(typeof hash).toBe('string');
    expect(hash.length).toBe(64);
  });

  it('should generate valid UUID v4', () => {
    const uuid = generateUuid();
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('should generate random hex token of specified byte length', () => {
    const token = generateRandomToken(16);
    expect(token.length).toBe(32);
  });

  it('should encrypt and decrypt secret using AES-256-GCM', () => {
    const secretText = 'super-secret-api-key-12345';
    const encrypted: EncryptedPayload = encryptSecret(secretText, sampleKey);

    expect(encrypted.ciphertext).not.toBe(secretText);
    expect(encrypted.iv.length).toBe(24); // 12 bytes hex
    expect(encrypted.authTag.length).toBe(32); // 16 bytes hex

    const decrypted = decryptSecret(encrypted, sampleKey);
    expect(decrypted).toBe(secretText);
  });

  it('should throw error when key is not 32 bytes', () => {
    expect(() => encryptSecret('secret', 'short-key')).toThrow(
      'Encryption key must be exactly 32 bytes',
    );
  });
});
