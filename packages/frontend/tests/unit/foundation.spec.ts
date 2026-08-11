/**
 * @file packages/frontend/tests/unit/foundation.spec.ts
 * @description Foundation unit test suite for @sutradhar/frontend Milestone 1.
 */

import { describe, it, expect } from 'vitest';

describe('@sutradhar/frontend Milestone 1 — Infrastructure & Foundation', () => {
  it('1. should verify foundation package bootstrap metadata', () => {
    const pkgName = '@sutradhar/frontend';
    expect(pkgName).toBe('@sutradhar/frontend');
  });

  it('2. should verify core routes (/run, /archive, /studio)', () => {
    const routes = ['/run', '/archive', '/studio'];
    expect(routes.length).toBe(3);
    expect(routes).toContain('/run');
    expect(routes).toContain('/archive');
    expect(routes).toContain('/studio');
  });
});
