/**
 * @file packages/dev-runtime/src/index.ts
 * @description Generic product-agnostic development runtime barrel export for @hanumatrix/dev-runtime.
 */

export const DEV_RUNTIME_VERSION = '0.1.0';

export * from './types/runtime-types.js';
export * from './registry/service-registry.js';
export * from './health/health-checker.js';
export * from './engine/dev-runtime.js';
