/**
 * @file packages/contracts/src/shared/brand.ts
 * @description Branded type utility for nominal type safety in TypeScript.
 */

declare const __brand: unique symbol;

/**
 * Nominal branding type utility.
 * Prevents accidental assignment between structurally identical primitive types (e.g. SessionId vs AgentId).
 */
export type Brand<T, B extends string> = T & { readonly [__brand]: B };
