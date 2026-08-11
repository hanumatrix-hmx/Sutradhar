/**
 * @file packages/dev-runtime/tests/unit/dev-runtime.spec.ts
 * @description Unit test suite for @hanumatrix/dev-runtime package.
 */

import { describe, it, expect } from 'vitest';
import {
  HanumatrixDevRuntime,
  ServiceRegistry,
  HealthChecker,
  RuntimeConfig,
} from '../../src/index.js';

describe('@hanumatrix/dev-runtime Generic Ecosystem Runtime Suite', () => {
  const sampleConfig: RuntimeConfig = {
    projectName: 'GenericApp',
    host: 'localhost',
    services: [
      {
        serviceName: 'Frontend',
        preferredPort: 5173,
        status: 'RUNNING',
        protocol: 'http',
      },
      {
        serviceName: 'Backend',
        preferredPort: 3000,
        status: 'RUNNING',
        protocol: 'http',
      },
      {
        serviceName: 'WebSocket',
        preferredPort: 3001,
        status: 'RUNNING',
        protocol: 'ws',
      },
      {
        serviceName: 'Redis',
        status: 'NOT_CONFIGURED',
      },
      {
        serviceName: 'OCR',
        status: 'STOPPED',
      },
    ],
    envVars: {
      NODE_ENV: 'development',
    },
  };

  it('1. should register arbitrary services without product-specific hardcoding', () => {
    const runtime = new HanumatrixDevRuntime(sampleConfig);
    const validation = runtime.validateEnvironment();
    expect(validation.isValid).toBe(true);
  });

  it('2. should allocate ports before startup and generate dynamic summary', async () => {
    const runtime = new HanumatrixDevRuntime(sampleConfig);
    const allocated = await runtime.allocatePorts();

    expect(allocated.length).toBe(5);
    const frontend = allocated.find((s) => s.serviceName === 'Frontend');
    expect(frontend?.assignedPort).toBeGreaterThan(0);

    const summary = runtime.generateStartupSummary();
    expect(summary).toContain('GenericApp Development Environment');
    expect(summary).toContain('Frontend');
    expect(summary).toContain('✓ Running');
    expect(summary).toContain('Redis');
    expect(summary).toContain('Not Configured');
    expect(summary).toContain('READY');
  });

  it('3. should perform service health checks correctly', async () => {
    const statusNotConfigured = await HealthChecker.checkServiceHealth({
      serviceName: 'Redis',
      status: 'NOT_CONFIGURED',
    });
    expect(statusNotConfigured).toBe('NOT_CONFIGURED');

    const statusStopped = await HealthChecker.checkServiceHealth({
      serviceName: 'Backend',
      status: 'STOPPED',
    });
    expect(statusStopped).toBe('STOPPED');
  });

  it('4. should detect duplicate port collisions and invalid bounds in environment validation', () => {
    const runtime = new HanumatrixDevRuntime({
      projectName: 'TestApp',
      host: 'localhost',
      services: [
        { serviceName: 'ServiceA', assignedPort: 3000, status: 'RUNNING' },
        { serviceName: 'ServiceB', assignedPort: 3000, status: 'RUNNING' }, // Collision
      ],
    });

    const validation = runtime.validateEnvironment();
    expect(validation.isValid).toBe(false);
    expect(validation.errors[0]).toContain('Duplicate port collision');
  });
});
