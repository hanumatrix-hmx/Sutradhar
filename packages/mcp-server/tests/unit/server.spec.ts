/**
 * @file packages/mcp-server/tests/unit/server.spec.ts
 * @description Unit tests for createPinchTabServer's idle-session-reaper default wiring —
 * regression coverage for a gap where the reaper capability existed (proven correct by
 * packages/browser/tests/unit/session.spec.ts's dedicated reaper tests) but was never
 * actually enabled by the shipped MCP server, since `idleTimeoutMs` was never passed to
 * `PinchTabRuntime`'s constructor. Mocks `PinchTabRuntime` itself to inspect exactly what
 * constructor options `createPinchTabServer` actually builds it with.
 */

const capabilityRuntimeMock = vi.hoisted(() => ({
  PinchTabRuntimeMock: vi.fn().mockImplementation(() => ({
    getSessionManager: () => ({}),
    getEventBus: () => ({ subscribe: vi.fn(), publish: vi.fn() }),
  })),
}));

vi.mock('@pinchtab/capability-runtime', () => ({
  PinchTabRuntime: capabilityRuntimeMock.PinchTabRuntimeMock,
}));

import { createPinchTabServer } from '../../src/server.js';

describe('@pinchtab/mcp-server createPinchTabServer idle-reaper default wiring', () => {
  beforeEach(() => {
    capabilityRuntimeMock.PinchTabRuntimeMock.mockClear();
    delete process.env['PINCHTAB_IDLE_TIMEOUT_MS'];
  });

  it('constructs PinchTabRuntime with the 30-minute default idleTimeoutMs when nothing overrides it', async () => {
    await createPinchTabServer({ disableAgent: true });

    expect(capabilityRuntimeMock.PinchTabRuntimeMock).toHaveBeenCalledTimes(1);
    const optionsArg = capabilityRuntimeMock.PinchTabRuntimeMock.mock.calls[0][0];
    expect(optionsArg.idleTimeoutMs).toBe(30 * 60 * 1000);
  });

  it('honors PINCHTAB_IDLE_TIMEOUT_MS when set', async () => {
    process.env['PINCHTAB_IDLE_TIMEOUT_MS'] = '5000';
    await createPinchTabServer({ disableAgent: true });

    const optionsArg = capabilityRuntimeMock.PinchTabRuntimeMock.mock.calls[0][0];
    expect(optionsArg.idleTimeoutMs).toBe(5000);
  });

  it('honors an explicit idleTimeoutMs option over the env var and default', async () => {
    process.env['PINCHTAB_IDLE_TIMEOUT_MS'] = '5000';
    await createPinchTabServer({ disableAgent: true, idleTimeoutMs: 42 });

    const optionsArg = capabilityRuntimeMock.PinchTabRuntimeMock.mock.calls[0][0];
    expect(optionsArg.idleTimeoutMs).toBe(42);
  });

  it('idleTimeoutMs:0 disables the reaper (passed through as undefined, matching PinchTabRuntime\'s "unset = disabled" contract)', async () => {
    await createPinchTabServer({ disableAgent: true, idleTimeoutMs: 0 });

    const optionsArg = capabilityRuntimeMock.PinchTabRuntimeMock.mock.calls[0][0];
    expect(optionsArg.idleTimeoutMs).toBeUndefined();
  });

  it('does not construct a new PinchTabRuntime at all when the caller supplies one directly', async () => {
    const suppliedRuntime = {
      getSessionManager: () => ({}),
      getEventBus: () => ({ subscribe: vi.fn(), publish: vi.fn() }),
    } as any;

    await createPinchTabServer({ disableAgent: true, runtime: suppliedRuntime });

    expect(capabilityRuntimeMock.PinchTabRuntimeMock).not.toHaveBeenCalled();
  });
});

describe('@pinchtab/mcp-server createPinchTabServer restrictNavigationToLocal wiring', () => {
  beforeEach(() => {
    capabilityRuntimeMock.PinchTabRuntimeMock.mockClear();
    delete process.env['PINCHTAB_RESTRICT_NAVIGATION_TO_LOCAL'];
  });

  it('defaults to false (unrestricted) when nothing overrides it', async () => {
    await createPinchTabServer({ disableAgent: true });

    const optionsArg = capabilityRuntimeMock.PinchTabRuntimeMock.mock.calls[0][0];
    expect(optionsArg.restrictNavigationToLocal).toBe(false);
  });

  it('honors PINCHTAB_RESTRICT_NAVIGATION_TO_LOCAL=1', async () => {
    process.env['PINCHTAB_RESTRICT_NAVIGATION_TO_LOCAL'] = '1';
    await createPinchTabServer({ disableAgent: true });

    const optionsArg = capabilityRuntimeMock.PinchTabRuntimeMock.mock.calls[0][0];
    expect(optionsArg.restrictNavigationToLocal).toBe(true);
  });

  it('honors an explicit restrictNavigationToLocal option over the env var', async () => {
    process.env['PINCHTAB_RESTRICT_NAVIGATION_TO_LOCAL'] = '1';
    await createPinchTabServer({ disableAgent: true, restrictNavigationToLocal: false });

    const optionsArg = capabilityRuntimeMock.PinchTabRuntimeMock.mock.calls[0][0];
    expect(optionsArg.restrictNavigationToLocal).toBe(false);
  });
});
