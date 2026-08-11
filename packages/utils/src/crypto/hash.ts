/**
 * @file packages/utils/src/crypto/hash.ts
 * @description Native cryptographic hashing, UUID generation, and token helpers.
 */

import { createHash, randomBytes, randomUUID } from 'node:crypto';

/**
 * Computes a cryptographic hash of string data.
 */
export function hashString(data: string, algorithm = 'sha256'): string {
  return createHash(algorithm).update(data, 'utf8').digest('hex');
}

/**
 * Generates a cryptographically secure random UUID (v4).
 */
export function generateUuid(): string {
  return randomUUID();
}

/**
 * Generates a secure random hex token string of a specified byte length.
 */
export function generateRandomToken(byteLength = 32): string {
  return randomBytes(byteLength).toString('hex');
}
