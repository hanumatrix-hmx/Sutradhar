/**
 * @file packages/cli/tests/unit/session-flow.spec.ts
 * @description FR2-04 GAP-006: withSessionFlow's control-flow tests, with injected deps and
 * call-order recording — no real runtime/Chrome involved.
 */
import {
  withSessionFlow,
  isLaunchCapable,
  noSessionMessage,
  NoSessionError,
  type SessionFlowDeps,
} from '../../src/session-flow.js';

// I-051: the two new REQUIRED deps. The pre-existing W1..W5 tests keep their assertions untouched; their literals only gained
// one spread line each: W1 has no prior state and is launch-capable (the old behaviour), W2..W5 have prior state, where
// `mayLaunch` must make no difference (so they use `false`, the strictest value).
const MAY_LAUNCH = { mayLaunch: true, noSession: () => new Error('unused: launch-capable') } as const;
const STATE_PRESENT = { mayLaunch: false, noSession: () => new Error('unused: state present') } as const;

function recorder() {
  const calls: string[] = [];
  return { calls, push: (name: string) => calls.push(name) };
}

describe('@sutradhar/cli withSessionFlow (FR2-04, GAP-006)', () => {
  it('W1: no prior state — spawnFresh, afterAttach(sid,true), then fn; gate never called', async () => {
    const { calls, push } = recorder();
    const deps: SessionFlowDeps<string> = {
      ...MAY_LAUNCH,
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
      ...STATE_PRESENT,
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
      ...STATE_PRESENT,
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
      ...STATE_PRESENT,
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
      ...STATE_PRESENT,
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

describe('@sutradhar/cli withSessionFlow no-session guard (I-051)', () => {
  function counted(opts: { state: unknown; mayLaunch: boolean }) {
    const calls: string[] = [];
    const deps: SessionFlowDeps<string> = {
      mayLaunch: opts.mayLaunch,
      noSession: () => {
        calls.push('noSession');
        return new NoSessionError('snap');
      },
      readState: async () => {
        calls.push('readState');
        return opts.state;
      },
      spawnFresh: async () => {
        calls.push('spawnFresh');
        return 'sid-fresh';
      },
      gate: async () => {
        calls.push('gate');
      },
      reattach: async () => {
        calls.push('reattach');
        return 'sid-re';
      },
      selfHeal: async () => {
        calls.push('selfHeal');
        return 'sid-heal';
      },
      afterAttach: async (sid, fresh) => {
        calls.push(`afterAttach(${sid},${fresh})`);
      },
      fn: async (sid) => {
        calls.push(`fn(${sid})`);
        return sid;
      },
    };
    return { calls, deps };
  }

  it('N1: no state + mayLaunch:false rejects with the NoSessionError; spawnFresh, afterAttach, gate, reattach, selfHeal and fn are never called', async () => {
    const { calls, deps } = counted({ state: undefined, mayLaunch: false });
    const err = await withSessionFlow(deps).then(
      () => undefined,
      (e: unknown) => e as Error,
    );
    expect(err).toBeInstanceOf(NoSessionError);
    expect(err?.name).toBe('NoSessionError');
    expect(calls).toEqual(['readState', 'noSession']);
    for (const never of ['spawnFresh', 'gate', 'reattach', 'selfHeal']) expect(calls).not.toContain(never);
    expect(calls.filter((c) => c.startsWith('afterAttach') || c.startsWith('fn('))).toHaveLength(0);
  });

  it('N2: no state + mayLaunch:true keeps the existing order (W5 shape): readState < spawnFresh < afterAttach(true) < fn', async () => {
    const { calls, deps } = counted({ state: undefined, mayLaunch: true });
    await expect(withSessionFlow(deps)).resolves.toBe('sid-fresh');
    expect(calls).toEqual(['readState', 'spawnFresh', 'afterAttach(sid-fresh,true)', 'fn(sid-fresh)']);
  });

  it('N3: state present + mayLaunch:false is the unchanged reattach path (gate, reattach, afterAttach(false), fn); noSession never consulted', async () => {
    const { calls, deps } = counted({ state: { wsEndpoint: 'ws://x' }, mayLaunch: false });
    await expect(withSessionFlow(deps)).resolves.toBe('sid-re');
    expect(calls).toEqual(['readState', 'gate', 'reattach', 'afterAttach(sid-re,false)', 'fn(sid-re)']);
  });

  it('N4: state present + mayLaunch:false + dead session still self-heals (the 0.6.1 behaviour is unchanged by the guard)', async () => {
    const { calls, deps } = counted({ state: { wsEndpoint: 'ws://x' }, mayLaunch: false });
    const dead: SessionFlowDeps<string> = { ...deps, reattach: async () => { calls.push('reattach'); throw new Error('dead'); } };
    await expect(withSessionFlow(dead)).resolves.toBe('sid-heal');
    expect(calls).toEqual(['readState', 'gate', 'reattach', 'selfHeal', 'afterAttach(sid-heal,false)', 'fn(sid-heal)']);
  });

  it('N5: the NoSessionError message is the exact documented line (em dash), and names the verb', () => {
    expect(noSessionMessage('snap')).toBe(
      'no active browser session \u2014 "snap" needs an open page and does not start one. Start a session with: sutradhar nav <url>',
    );
    expect(new NoSessionError('text').message).toBe(noSessionMessage('text'));
    expect(new NoSessionError('text').name).toBe('NoSessionError');
  });
});

describe('@sutradhar/cli isLaunchCapable (I-051, plan 2.4 table)', () => {
  const U = 'https://example.com';
  it('only nav <url>, newtab <url>, audit <url> and compare <a> <b> may start a session', () => {
    expect(isLaunchCapable('nav', [U])).toBe(true);
    expect(isLaunchCapable('newtab', [U])).toBe(true);
    expect(isLaunchCapable('audit', [U])).toBe(true);
    expect(isLaunchCapable('audit', [U, 'out'])).toBe(true);
    expect(isLaunchCapable('compare', [U, U])).toBe(true);
  });

  it('the same verbs without their url are NOT launch-capable (newtab/audit without url, nav/compare short of args)', () => {
    expect(isLaunchCapable('nav', [])).toBe(false);
    expect(isLaunchCapable('nav', [''])).toBe(false);
    expect(isLaunchCapable('newtab', [])).toBe(false);
    expect(isLaunchCapable('newtab', [''])).toBe(false);
    expect(isLaunchCapable('audit', [])).toBe(false);
    expect(isLaunchCapable('audit', [''])).toBe(false);
    expect(isLaunchCapable('compare', [U])).toBe(false);
    expect(isLaunchCapable('compare', [])).toBe(false);
  });

  it('every other withSession verb is not launch-capable, with and without args', () => {
    const others = [
      'snap', 'axsnap', 'text', 'click', 'clicktext', 'clickrole', 'type', 'press', 'screenshot', 'select', 'wait', 'waitfor',
      'eval', 'hover', 'scroll', 'upload', 'drag', 'clickpoint', 'dragpoints', 'setclipboard', 'getclipboard', 'grant', 'tabs',
      'focustab', 'closetab', 'download', 'back', 'forward', 'reload',
    ];
    for (const v of others) {
      expect(isLaunchCapable(v, [])).toBe(false);
      expect(isLaunchCapable(v, [U, U, U])).toBe(false);
    }
    expect(isLaunchCapable(undefined, [U])).toBe(false);
  });
});
