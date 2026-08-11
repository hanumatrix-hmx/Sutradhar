/**
 * @file packages/agent/tests/unit/agent-loop.spec.ts
 * @description Targeted unit tests for runAgentLoop's bootstrap failure path — this is the
 * one part of the loop that doesn't need a real LLM or real browser to exercise, since it
 * throws before the main observe/reason/act loop ever starts. The full end-to-end loop is
 * proven live via scripts/run-agent.ts, per the established convention for this package.
 */

import { runAgentLoop } from '../../src/core/agent-loop.js';
import { createAgentId, createSessionId } from '@pinchtab/contracts';

function stubLlmProvider() {
  return { providerId: 'stub', generateCompletion: vi.fn(), generateStream: vi.fn() } as any;
}

describe('@pinchtab/agent runAgentLoop bootstrap failure path', () => {
  it('closes an owned session it just created if the resulting tab has no live Page', async () => {
    const fakeTab = { isActive: true, page: undefined };
    const fakeSession = { id: createSessionId('sess_1'), getTabs: () => [fakeTab] };
    const closeSession = vi.fn().mockResolvedValue(undefined);
    const sessionManager = {
      getSession: vi.fn().mockReturnValue(undefined),
      createSession: vi.fn().mockResolvedValue(fakeSession),
      closeSession,
    } as any;

    await expect(
      runAgentLoop({
        agentId: createAgentId('agent_1'),
        objective: 'test objective',
        llmProvider: stubLlmProvider(),
        sessionManager,
      }),
    ).rejects.toThrow('browser tab has no real Page');

    expect(closeSession).toHaveBeenCalledTimes(1);
    expect(closeSession).toHaveBeenCalledWith(fakeSession.id, expect.any(String));
  });

  it('does NOT close a caller-owned session (sessionId supplied) even when bootstrap fails', async () => {
    const fakeTab = { isActive: true, page: undefined };
    const fakeSession = { id: createSessionId('sess_caller_owned'), getTabs: () => [fakeTab] };
    const closeSession = vi.fn().mockResolvedValue(undefined);
    const sessionManager = {
      getSession: vi.fn().mockReturnValue(fakeSession), // caller-owned: already exists
      createSession: vi.fn(),
      closeSession,
    } as any;

    await expect(
      runAgentLoop({
        agentId: createAgentId('agent_1'),
        objective: 'test objective',
        llmProvider: stubLlmProvider(),
        sessionManager,
        sessionId: 'sess_caller_owned',
      }),
    ).rejects.toThrow('browser tab has no real Page');

    expect(closeSession).not.toHaveBeenCalled();
  });

  it('propagates a createSession failure and does not attempt to close anything (no session was ever created)', async () => {
    const closeSession = vi.fn();
    const sessionManager = {
      getSession: vi.fn().mockReturnValue(undefined),
      createSession: vi.fn().mockRejectedValue(new Error('launch failed: no Chrome found')),
      closeSession,
    } as any;

    await expect(
      runAgentLoop({
        agentId: createAgentId('agent_1'),
        objective: 'test objective',
        llmProvider: stubLlmProvider(),
        sessionManager,
      }),
    ).rejects.toThrow('launch failed: no Chrome found');

    expect(closeSession).not.toHaveBeenCalled();
  });
});
