/**
 * @file packages/cli/tests/unit/session-flow.spec.ts
 * @description FR2-04 GAP-006: withSessionFlow's control-flow tests, with injected deps and
 * call-order recording — no real runtime/Chrome involved.
 */
import { withSessionFlow, type SessionFlowDeps } from '../../src/session-flow.js';

function recorder() {
  const calls: string[] = [];
  return { calls, push: (name: string) => calls.push(name) };
}

describe('@sutradhar/cli withSessionFlow (FR2-04, GAP-006)', () => {
  it('W1: no prior state — spawnFresh, afterAttach(sid,true), then fn; gate never called', async () => {
    const { calls, push } = recorder();
    const deps: SessionFlowDeps<string> = {
      readState: async () => undefined,
      spawnFresh: async () => {
        push('spawnFresh');
        return 'sid-1';
      },
      gate: async () => {
        push('gate');
      },
      reattach: async () => {
        push('reattach');
        return 'sid-x';
      },
      selfHeal: async () => {
        push('selfHeal');
        return 'sid-y';
      },
      afterAttach: async (sid, isFresh) => {
        push(`afterAttach(${sid},${isFresh})`);
      },
      fn: async (sid) => {
        push(`fn(${sid})`);
        return sid;
      },
    };
    const result = await withSessionFlow(deps);
    expect(result).toBe('sid-1');
    expect(calls).toEqual(['spawnFresh', 'afterAttach(sid-1,true)', 'fn(sid-1)']);
  });

  it('W2: state present and reattach throws — selfHeal runs once, then fn runs with the healed sid', async () => {
    const { calls, push } = recorder();
    const deps: SessionFlowDeps<string> = {
      readState: async () => ({ wsEndpoint: 'ws://x' }),
      spawnFresh: async () => {
        push('spawnFresh');
        return 'never';
      },
      gate: async () => {
        push('gate');
      },
      reattach: async () => {
        push('reattach');
        throw new Error('dead session');
      },
      selfHeal: async () => {
        push('selfHeal');
        return 'sid-healed';
      },
      afterAttach: async (sid) => {
        push(`afterAttach(${sid})`);
      },
      fn: async (sid) => {
        push(`fn(${sid})`);
        return sid;
      },
    };
    const result = await withSessionFlow(deps);
    expect(result).toBe('sid-healed');
    expect(calls).toEqual(['gate', 'reattach', 'selfHeal', 'afterAttach(sid-healed)', 'fn(sid-healed)']);
  });

  it('W3: fn() throwing never triggers selfHeal (GAP-006) — the error propagates, reattach ran once', async () => {
    const { calls, push } = recorder();
    let selfHealCalls = 0;
    const deps: SessionFlowDeps<string> = {
      readState: async () => ({ wsEndpoint: 'ws://x' }),
      spawnFresh: async () => 'never',
      gate: async () => push('gate'),
      reattach: async () => {
        push('reattach');
        return 'sid-1';
      },
      selfHeal: async () => {
        selfHealCalls++;
        return 'sid-healed';
      },
      afterAttach: async () => push('afterAttach'),
      fn: async () => {
        push('fn');
        throw new Error('boom');
      },
    };
    await expect(withSessionFlow(deps)).rejects.toThrow('boom');
    expect(selfHealCalls).toBe(0);
    expect(calls.filter((c) => c === 'reattach')).toHaveLength(1);
  });

  it('W4: the gate throwing (DialogBlockedError-shaped) propagates before reattach/selfHeal/fn ever run', async () => {
    let reattachCalls = 0;
    let selfHealCalls = 0;
    let fnCalls = 0;
    const deps: SessionFlowDeps<string> = {
      readState: async () => ({ wsEndpoint: 'ws://x' }),
      spawnFresh: async () => 'never',
      gate: async () => {
        throw new Error('DialogBlockedError: blocked');
      },
      reattach: async () => {
        reattachCalls++;
        return 'sid';
      },
      selfHeal: async () => {
        selfHealCalls++;
        return 'sid';
      },
      afterAttach: async () => {},
      fn: async () => {
        fnCalls++;
        return 'sid';
      },
    };
    await expect(withSessionFlow(deps)).rejects.toThrow('DialogBlockedError: blocked');
    expect(reattachCalls).toBe(0);
    expect(selfHealCalls).toBe(0);
    expect(fnCalls).toBe(0);
  });

  it('W5: call order is readState < gate < reattach < afterAttach < fn', async () => {
    const { calls, push } = recorder();
    const deps: SessionFlowDeps<string> = {
      readState: async () => {
        push('readState');
        return { wsEndpoint: 'ws://x' };
      },
      spawnFresh: async () => 'never',
      gate: async () => push('gate'),
      reattach: async () => {
        push('reattach');
        return 'sid';
      },
      selfHeal: async () => 'never',
      afterAttach: async () => push('afterAttach'),
      fn: async () => {
        push('fn');
        return 'sid';
      },
    };
    await withSessionFlow(deps);
    expect(calls).toEqual(['readState', 'gate', 'reattach', 'afterAttach', 'fn']);
  });
});
