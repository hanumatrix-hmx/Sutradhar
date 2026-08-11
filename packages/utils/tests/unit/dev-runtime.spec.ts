/**
 * @file packages/utils/tests/unit/dev-runtime.spec.ts
 * @description Unit test suite for HanumatrixDevRuntime, EnvValidator, and HANUMATRIX_PORT_REGISTRY.
 */

import { HanumatrixDevRuntime, EnvValidator, HANUMATRIX_PORT_REGISTRY } from '../../src/index.js';

describe('@pinchtab/utils Hanumatrix Dev Runtime Engine', () => {
  it('1. should contain preferred port configurations for PinchTab, MitSu, Supamatrix, Estate Matrix, Fanuc SDK', () => {
    expect(HANUMATRIX_PORT_REGISTRY['PinchTab']?.frontendPreferredPort).toBe(5173);
    expect(HANUMATRIX_PORT_REGISTRY['MitSu']?.frontendPreferredPort).toBe(5180);
    expect(HANUMATRIX_PORT_REGISTRY['Supamatrix']?.frontendPreferredPort).toBe(5190);
    expect(HANUMATRIX_PORT_REGISTRY['EstateMatrix']?.frontendPreferredPort).toBe(5200);
    expect(HANUMATRIX_PORT_REGISTRY['FanucSDK']?.frontendPreferredPort).toBe(5210);
  });

  it('2. should allocate project ports before startup and find open fallback ports', async () => {
    const ports = await HanumatrixDevRuntime.allocateProjectPorts('PinchTab');
    expect(ports.frontendRequested).toBe(5173);
    expect(ports.frontendAssigned).toBeGreaterThan(0);
    expect(ports.backendRequested).toBe(3000);
    expect(ports.backendAssigned).toBeGreaterThan(0);
  });

  it('3. should generate structured startup summary with requested vs assigned ports', () => {
    const summary = HanumatrixDevRuntime.generateStartupSummary({
      projectName: 'PinchTab',
      host: 'localhost',
      ports: {
        frontendRequested: 5173,
        frontendAssigned: 5217,
        backendRequested: 3000,
        backendAssigned: 6810,
        websocketRequested: 3001,
        websocketAssigned: 6811,
      },
      frontendUrl: 'http://localhost:5217',
      backendUrl: 'http://localhost:6810',
      websocketUrl: 'ws://localhost:6811',
    });

    expect(summary).toContain('PinchTab Development Environment');
    expect(summary).toContain('http://localhost:5217');
    expect(summary).toContain('Requested : 5173');
    expect(summary).toContain('Assigned  : 5217');
    expect(summary).toContain('✓ READY');
  });

  it('4. should detect duplicate port collisions in environment validation', () => {
    const validation = EnvValidator.validatePorts({
      Frontend: 3000,
      Backend: 3000, // Intentional collision
    });

    expect(validation.isValid).toBe(false);
    expect(validation.errors[0]).toContain('Duplicate port collision');
  });

  it('5. should reject invalid out-of-range port bounds', () => {
    const validation = EnvValidator.validatePorts({
      Frontend: 80, // Under 1024 privileged bound
      Backend: 70000, // Over 65535 bound
    });

    expect(validation.isValid).toBe(false);
    expect(validation.errors.length).toBe(2);
  });
});
