/**
 * @file packages/mcp-server/tests/unit/server.spec.ts
 * @description Unit tests for createSutradharServer's idle-session-reaper default wiring —
 * regression coverage for a gap where the reaper capability existed (proven correct by
 * packages/browser/tests/unit/session.spec.ts's dedicated reaper tests) but was never
 * actually enabled by the shipped MCP server, since `idleTimeoutMs` was never passed to
 * `SutradharRuntime`'s constructor. Mocks `SutradharRuntime` itself to inspect exactly what
 * constructor options `createSutradharServer` actually builds it with.
 */

const capabilityRuntimeMock = vi.hoisted(() => ({
  SutradharRuntimeMock: vi.fn().mockImplementation(() => ({
    getSessionManager: () => ({}),
    getEventBus: () => ({ subscribe: vi.fn(), publish: vi.fn() }),
  })),
}));

vi.mock('@sutradhar/capability-runtime', () => ({
  SutradharRuntime: capabilityRuntimeMock.SutradharRuntimeMock,
}));

import { createSutradharServer } from '../../src/server.js';

describe('@sutradhar/mcp-server createSutradharServer idle-reaper default wiring', () => {
  beforeEach(() => {
    capabilityRuntimeMock.SutradharRuntimeMock.mockClear();
    delete process.env['SUTRADHAR_IDLE_TIMEOUT_MS'];
  });

  it('constructs SutradharRuntime with the 30-minute default idleTimeoutMs when nothing overrides it', async () => {
    await createSutradharServer({ disableAgent: true });

    expect(capabilityRuntimeMock.SutradharRuntimeMock).toHaveBeenCalledTimes(1);
    const optionsArg = capabilityRuntimeMock.SutradharRuntimeMock.mock.calls[0][0];
    expect(optionsArg.idleTimeoutMs).toBe(30 * 60 * 1000);
  });

  it('honors SUTRADHAR_IDLE_TIMEOUT_MS when set', async () => {
    process.env['SUTRADHAR_IDLE_TIMEOUT_MS'] = '5000';
    await createSutradharServer({ disableAgent: true });

    const optionsArg = capabilityRuntimeMock.SutradharRuntimeMock.mock.calls[0][0];
    expect(optionsArg.idleTimeoutMs).toBe(5000);
  });

  it('honors an explicit idleTimeoutMs option over the env var and default', async () => {
    process.env['SUTRADHAR_IDLE_TIMEOUT_MS'] = '5000';
    await createSutradharServer({ disableAgent: true, idleTimeoutMs: 42 });

    const optionsArg = capabilityRuntimeMock.SutradharRuntimeMock.mock.calls[0][0];
    expect(optionsArg.idleTimeoutMs).toBe(42);
  });

  it('idleTimeoutMs:0 disables the reaper (passed through as undefined, matching SutradharRuntime\'s "unset = disabled" contract)', async () => {
    await createSutradharServer({ disableAgent: true, idleTimeoutMs: 0 });

    const optionsArg = capabilityRuntimeMock.SutradharRuntimeMock.mock.calls[0][0];
    expect(optionsArg.idleTimeoutMs).toBeUndefined();
  });

  it('does not construct a new SutradharRuntime at all when the caller supplies one directly', async () => {
    const suppliedRuntime = {
      getSessionManager: () => ({}),
      getEventBus: () => ({ subscribe: vi.fn(), publish: vi.fn() }),
    } as any;

    await createSutradharServer({ disableAgent: true, runtime: suppliedRuntime });

    expect(capabilityRuntimeMock.SutradharRuntimeMock).not.toHaveBeenCalled();
  });
});

describe('@sutradhar/mcp-server createSutradharServer restrictNavigationToLocal wiring', () => {
  beforeEach(() => {
    capabilityRuntimeMock.SutradharRuntimeMock.mockClear();
    delete process.env['SUTRADHAR_RESTRICT_NAVIGATION_TO_LOCAL'];
  });

  it('defaults to false (unrestricted) when nothing overrides it', async () => {
    await createSutradharServer({ disableAgent: true });

    const optionsArg = capabilityRuntimeMock.SutradharRuntimeMock.mock.calls[0][0];
    expect(optionsArg.restrictNavigationToLocal).toBe(false);
  });

  it('honors SUTRADHAR_RESTRICT_NAVIGATION_TO_LOCAL=1', async () => {
    process.env['SUTRADHAR_RESTRICT_NAVIGATION_TO_LOCAL'] = '1';
    await createSutradharServer({ disableAgent: true });

    const optionsArg = capabilityRuntimeMock.SutradharRuntimeMock.mock.calls[0][0];
    expect(optionsArg.restrictNavigationToLocal).toBe(true);
  });

  it('honors an explicit restrictNavigationToLocal option over the env var', async () => {
    process.env['SUTRADHAR_RESTRICT_NAVIGATION_TO_LOCAL'] = '1';
    await createSutradharServer({ disableAgent: true, restrictNavigationToLocal: false });

    const optionsArg = capabilityRuntimeMock.SutradharRuntimeMock.mock.calls[0][0];
    expect(optionsArg.restrictNavigationToLocal).toBe(false);
  });
});

describe('@sutradhar/mcp-server createSutradharServer allowedDomains wiring', () => {
  beforeEach(() => {
    capabilityRuntimeMock.SutradharRuntimeMock.mockClear();
    delete process.env['SUTRADHAR_ALLOWED_DOMAINS'];
  });

  it('defaults to undefined (unrestricted) when nothing overrides it', async () => {
    await createSutradharServer({ disableAgent: true });

    const optionsArg = capabilityRuntimeMock.SutradharRuntimeMock.mock.calls[0][0];
    expect(optionsArg.allowedDomains).toBeUndefined();
  });

  it('honors SUTRADHAR_ALLOWED_DOMAINS as a comma-separated list, trimmed', async () => {
    process.env['SUTRADHAR_ALLOWED_DOMAINS'] = ' example.com , internal.corp ';
    await createSutradharServer({ disableAgent: true });

    const optionsArg = capabilityRuntimeMock.SutradharRuntimeMock.mock.calls[0][0];
    expect(optionsArg.allowedDomains).toEqual(['example.com', 'internal.corp']);
  });

  it('honors an explicit allowedDomains option over the env var', async () => {
    process.env['SUTRADHAR_ALLOWED_DOMAINS'] = 'example.com';
    await createSutradharServer({ disableAgent: true, allowedDomains: ['override.com'] });

    const optionsArg = capabilityRuntimeMock.SutradharRuntimeMock.mock.calls[0][0];
    expect(optionsArg.allowedDomains).toEqual(['override.com']);
  });
});
