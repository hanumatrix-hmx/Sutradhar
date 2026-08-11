/**
 * @file packages/agent/tests/unit/agent-core.spec.ts
 * @description Unit tests for AgentStateMachine, transition validation, and
 * AgentCore dependency guards.
 *
 * AgentCore now runs the REAL agent loop, which requires a real LLM provider
 * and a real browser session manager. End-to-end execution is therefore proven
 * by the run-agent.ts script against live Ollama + Chrome, not by a unit test
 * that fakes its dependencies. These unit tests cover the deterministic parts:
 * the state machine and the "fail loud when dependencies are missing" contract.
 */

import { describe, it, expect } from 'vitest';
import { AgentStateMachine, AgentCore, AGENT_VERSION } from '../../src/index.js';
import { EventBus } from '@pinchtab/events';
import { createAgentId } from '@pinchtab/contracts';

describe('@pinchtab/agent Execution Core & State Machine', () => {
  it('should export correct package version constant', () => {
    expect(AGENT_VERSION).toBe('0.1.0');
  });

  it('should enforce allowed state transitions and throw error on invalid jumps', async () => {
    const sm = new AgentStateMachine(createAgentId('ag_1'));

    expect(sm.getState()).toBe('idle');
    expect(sm.canTransitionTo('planning')).toBe(true);
    expect(sm.canTransitionTo('completed')).toBe(false);

    await sm.transitionTo('planning');
    expect(sm.getState()).toBe('planning');

    await expect(sm.transitionTo('idle')).rejects.toThrow(
      "Invalid Agent state transition from 'planning' to 'idle'",
    );
  });

  it('should FAIL LOUDLY when no LLM provider is configured (no silent faking)', async () => {
    const agent = new AgentCore({ agentId: createAgentId('ag_no_llm') });
    await expect(agent.executeGoal('Do something')).rejects.toThrow(/no LLM provider/i);
  });

  it('should FAIL LOUDLY when no browser session manager is configured', async () => {
    const agent = new AgentCore({
      agentId: createAgentId('ag_no_browser'),
      // Provide a stub LLM so the LLM guard passes and we reach the browser guard.
      llmProvider: {
        providerId: 'stub',
        capabilities: { providerId: 'stub', capabilities: [] },
        generateCompletion: async () => ({
          id: 'x',
          modelId: 'x' as never,
          message: { role: 'assistant', content: '' },
          finishReason: 'stop',
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          executionTimeMs: 0,
        }),
        generateStream: async function* () {
          yield { id: 'x', textDelta: '', isFinal: true };
        },
      },
    });
    await expect(agent.executeGoal('Do something')).rejects.toThrow(/browser session manager/i);
  });

  it('should publish agent:state:changed events on valid transitions', async () => {
    const bus = new EventBus();
    const stateChanges: string[] = [];
    bus.subscribe('agent:state:changed', (e) => {
      stateChanges.push(`${e.payload.previousState}->${e.payload.newState}`);
    });

    const sm = new AgentStateMachine(createAgentId('ag_bus'), bus, undefined);
    await sm.transitionTo('planning');
    await sm.transitionTo('executing');

    expect(stateChanges).toEqual(['idle->planning', 'planning->executing']);
  });
});
