/**
 * @file packages/utils/tests/unit/port-resolver.spec.ts
 * @description Unit test suite for PortResolver.
 */

import { PortResolver } from '../../src/network/index.js';

describe('@pinchtab/utils PortResolver & Environment Port Management Policy', () => {
  it('1. should resolve dynamic environment endpoints without hardcoded assumptions', () => {
    const endpoints = PortResolver.getEnvironmentEndpoints();
    expect(endpoints.backendPort).toBeGreaterThan(0);
    expect(endpoints.frontendPort).toBeGreaterThan(0);
    expect(endpoints.apiBaseUrl).toContain('http://');
    expect(endpoints.wsUrl).toContain('ws://');
  });

  it('2. should find available open port when scanning', async () => {
    const port = await PortResolver.findAvailablePort(45000, 10);
    expect(port).toBeGreaterThanOrEqual(45000);
  });
});
