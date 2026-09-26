/**
 * @file packages/browser/tests/unit/dialog-warden.spec.ts
 * @description FR2-04 Branch W: unit tests for DialogWarden — a fake `connect` returning fake
 * CDP targets/sessions (EventEmitter-shaped), but a REAL `http` server (the warden's actual HTTP
 * API), hit with real `fetch` calls against 127.0.0.1.
 */
import { EventEmitter } from 'node:events';
import { DialogWarden } from '../../src/session/dialog-warden.js';

function fakeSession(targetId: string) {
  const emitter = new EventEmitter();
  const send = vi.fn().mockResolvedValue(undefined);
  return {
    targetId,
    send,
    on: (event: string, cb: (...args: any[]) => void) => emitter.on(event, cb),
    off: (event: string, cb: (...args: any[]) => void) => emitter.off(event, cb),
    detach: vi.fn().mockResolvedValue(undefined),
    emitOpening: (payload: { type: string; message: string; defaultPrompt?: string }) =>
      emitter.emit('Page.javascriptDialogOpening', payload),
    emitClosed: () => emitter.emit('Page.javascriptDialogClosed', {}),
  };
}

function fakeTarget(targetId: string, url: string, session: ReturnType<typeof fakeSession>) {
  return {
    type: () => 'page',
    url: () => url,
    _targetId: targetId,
    createCDPSession: vi.fn().mockResolvedValue(session),
  };
}

function fakeBrowser(targets: any[]) {
  const emitter = new EventEmitter();
  let connected = true;
  return {
    targets: () => targets,
    on: (event: string, cb: (...args: any[]) => void) => emitter.on(event, cb),
    get connected() {
      return connected;
    },
    disconnect: vi.fn().mockImplementation(async () => {
      connected = false;
    }),
    _emit: (event: string, ...args: any[]) => emitter.emit(event, ...args),
  };
}

async function req(port: number, path: string, token: string, init?: RequestInit) {
  return fetch(`http://127.0.0.1:${port}${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), authorization: `Bearer ${token}` },
  });
}

describe('@sutradhar/browser DialogWarden (FR2-04 Branch W)', () => {
  it('WD1: an opening event makes GET /v1/dialogs return 1 entry; a closed event then gives 0', async () => {
    const session = fakeSession('t1');
    const target = fakeTarget('t1', 'https://x/', session);
    const browser = fakeBrowser([target]);
    let readyInfo: { port: number; token: string } | undefined;
    const warden = new DialogWarden({
      wsEndpoint: 'ws://x',
      readPolicy: async () => undefined,
      isStillCurrent: async () => true,
      onReady: (info) => {
        readyInfo = info;
      },
      onExit: () => {},
      connect: async () => browser as any,
    });
    await warden.start();
    try {
      session.emitOpening({ type: 'confirm', message: 'm' });
      const res = await req(readyInfo!.port, '/v1/dialogs', readyInfo!.token);
      const body = (await res.json()) as { dialogs: unknown[] };
      expect(body.dialogs).toHaveLength(1);

      session.emitClosed();
      const res2 = await req(readyInfo!.port, '/v1/dialogs', readyInfo!.token);
      expect(((await res2.json()) as { dialogs: unknown[] }).dialogs).toHaveLength(0);
    } finally {
      await warden.stop('test-teardown');
    }
  });

  it('WD2: readPolicy accept applies after policyGraceMs, not before; a closed dialog cancels the grace timer', async () => {
    vi.useFakeTimers();
    try {
      const session = fakeSession('t1');
      const target = fakeTarget('t1', 'https://x/', session);
      const browser = fakeBrowser([target]);
      const warden = new DialogWarden({
        wsEndpoint: 'ws://x',
        readPolicy: async () => ({ mode: 'accept' }),
        isStillCurrent: async () => true,
        onReady: () => {},
        onExit: () => {},
        policyGraceMs: 300,
        connect: async () => browser as any,
      });
      await warden.start();
      try {
        session.emitOpening({ type: 'confirm', message: 'm' });
        await vi.advanceTimersByTimeAsync(299);
        expect(session.send).not.toHaveBeenCalledWith('Page.handleJavaScriptDialog', expect.anything(), expect.anything());
        await vi.advanceTimersByTimeAsync(1);
        expect(session.send).toHaveBeenCalledWith(
          'Page.handleJavaScriptDialog',
          { accept: true, promptText: undefined },
          { timeout: 5000 },
        );

        session.send.mockClear();
        session.emitOpening({ type: 'confirm', message: 'm2' });
        await vi.advanceTimersByTimeAsync(100);
        session.emitClosed();
        await vi.advanceTimersByTimeAsync(300);
        expect(session.send).not.toHaveBeenCalledWith('Page.handleJavaScriptDialog', expect.anything(), expect.anything());
      } finally {
        await warden.stop('test-teardown');
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('WD3: a missing or wrong token gets 401, and no CDP handle call is made', async () => {
    const session = fakeSession('t1');
    const target = fakeTarget('t1', 'https://x/', session);
    const browser = fakeBrowser([target]);
    let readyInfo: { port: number; token: string } | undefined;
    const warden = new DialogWarden({
      wsEndpoint: 'ws://x',
      readPolicy: async () => undefined,
      isStillCurrent: async () => true,
      onReady: (info) => {
        readyInfo = info;
      },
      onExit: () => {},
      connect: async () => browser as any,
    });
    await warden.start();
    try {
      session.emitOpening({ type: 'confirm', message: 'm' });
      const res = await fetch(`http://127.0.0.1:${readyInfo!.port}/v1/dialogs/handle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer wrong' },
        body: JSON.stringify({ targetId: 't1', accept: true }),
      });
      expect(res.status).toBe(401);
      expect(session.send).not.toHaveBeenCalledWith('Page.handleJavaScriptDialog', expect.anything(), expect.anything());

      // GAP-225: WD3 only ever exercised a WRONG token before — a request with NO authorization
      // header at all must be rejected the same way, not merely fall through some other path
      // (found by the audit: this case had zero coverage).
      const resMissing = await fetch(`http://127.0.0.1:${readyInfo!.port}/v1/dialogs/handle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ targetId: 't1', accept: true }),
      });
      expect(resMissing.status).toBe(401);
      expect(session.send).not.toHaveBeenCalledWith('Page.handleJavaScriptDialog', expect.anything(), expect.anything());
    } finally {
      await warden.stop('test-teardown');
    }
  });

  it('WD4: handle with nothing pending -> 404; a CDP rejection -> 409 with its message', async () => {
    const session = fakeSession('t1');
    const target = fakeTarget('t1', 'https://x/', session);
    const browser = fakeBrowser([target]);
    let readyInfo: { port: number; token: string } | undefined;
    const warden = new DialogWarden({
      wsEndpoint: 'ws://x',
      readPolicy: async () => undefined,
      isStillCurrent: async () => true,
      onReady: (info) => {
        readyInfo = info;
      },
      onExit: () => {},
      connect: async () => browser as any,
    });
    await warden.start();
    try {
      const res404 = await req(readyInfo!.port, '/v1/dialogs/handle', readyInfo!.token, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ targetId: 't1', accept: true }),
      });
      expect(res404.status).toBe(404);
      expect((await res404.json()).error).toBe('No dialog is open on that tab');

      session.emitOpening({ type: 'confirm', message: 'm' });
      session.send.mockRejectedValueOnce(new Error('No dialog is showing'));
      const res409 = await req(readyInfo!.port, '/v1/dialogs/handle', readyInfo!.token, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ targetId: 't1', accept: true }),
      });
      expect(res409.status).toBe(409);
      expect((await res409.json()).error).toBe('No dialog is showing');
    } finally {
      await warden.stop('test-teardown');
    }
  });

  it('WD5 (R-D): browser "disconnected" makes the warden exit and stop serving', async () => {
    const session = fakeSession('t1');
    const target = fakeTarget('t1', 'https://x/', session);
    const browser = fakeBrowser([target]);
    let readyInfo: { port: number; token: string } | undefined;
    const onExit = vi.fn();
    const warden = new DialogWarden({
      wsEndpoint: 'ws://x',
      readPolicy: async () => undefined,
      isStillCurrent: async () => true,
      onReady: (info) => {
        readyInfo = info;
      },
      onExit,
      connect: async () => browser as any,
    });
    await warden.start();
    browser._emit('disconnected');
    await new Promise((r) => setTimeout(r, 20));
    expect(onExit).toHaveBeenCalledWith('browser-disconnected');
    await expect(fetch(`http://127.0.0.1:${readyInfo!.port}/v1/health`)).rejects.toThrow();
  });

  it('WD6 (R-D): isStillCurrent() returning false exits the warden within ~2 poll intervals', async () => {
    const session = fakeSession('t1');
    const target = fakeTarget('t1', 'https://x/', session);
    const browser = fakeBrowser([target]);
    const onExit = vi.fn();
    let current = true;
    const warden = new DialogWarden({
      wsEndpoint: 'ws://x',
      readPolicy: async () => undefined,
      isStillCurrent: async () => current,
      onReady: () => {},
      onExit,
      statePollMs: 50,
      connect: async () => browser as any,
    });
    await warden.start();
    current = false;
    await new Promise((r) => setTimeout(r, 150));
    expect(onExit).toHaveBeenCalledWith('state-changed');
  });

  it('WD7: the HTTP server binds to 127.0.0.1 (not 0.0.0.0 or any other interface)', async () => {
    const target = fakeTarget('t1', 'https://x/', fakeSession('t1'));
    const browser = fakeBrowser([target]);
    let readyInfo: { port: number; token: string } | undefined;
    const warden = new DialogWarden({
      wsEndpoint: 'ws://x',
      readPolicy: async () => undefined,
      isStillCurrent: async () => true,
      onReady: (info) => {
        readyInfo = info;
      },
      onExit: () => {},
      connect: async () => browser as any,
    });
    await warden.start();
    try {
      const res = await req(readyInfo!.port, '/v1/health', readyInfo!.token);
      expect(res.status).toBe(200);
      // GAP-225: a request succeeding against 127.0.0.1 alone doesn't prove the server ISN'T also
      // reachable on 0.0.0.0 — check the actual bound address, which a `0.0.0.0` mutation of
      // `listen()` would change and this assertion would then catch.
      expect(warden.address()?.address).toBe('127.0.0.1');
    } finally {
      await warden.stop('test-teardown');
    }
  });

  it('WD9 (GAP-220 defensive layer): a target whose Page.enable NEVER acked is reported as an "unknown" blocking dialog, not silently clear', async () => {
    const trackedTargetSession = fakeSession('t1'); // has a real tracked dialog
    const untrackedTargetSession = fakeSession('t2'); // attach never completes — Page.enable hangs forever
    untrackedTargetSession.send.mockImplementation((method: string) => {
      if (method === 'Runtime.evaluate') return Promise.reject(new Error('ProtocolError: operation timed out'));
      if (method === 'Page.enable') return new Promise(() => {}); // never resolves — attach stuck
      return Promise.resolve(undefined);
    });
    const target1 = fakeTarget('t1', 'https://x/', trackedTargetSession);
    const target2 = fakeTarget('t2', 'https://y/', untrackedTargetSession);
    const browser = fakeBrowser([target1, target2]);
    let readyInfo: { port: number; token: string } | undefined;
    const warden = new DialogWarden({
      wsEndpoint: 'ws://x',
      readPolicy: async () => undefined,
      isStillCurrent: async () => true,
      onReady: (info) => {
        readyInfo = info;
      },
      onExit: () => {},
      connect: async () => browser as any,
    });
    await warden.start();
    try {
      // t1 has a real, tracked dialog; t2's attach never finishes (Page.enable never acks).
      trackedTargetSession.emitOpening({ type: 'confirm', message: 'm' });
      const res = await req(readyInfo!.port, '/v1/dialogs', readyInfo!.token);
      const body = await res.json();
      expect(body.dialogs).toHaveLength(2);
      const t1Entry = body.dialogs.find((d: any) => d.targetId === 't1');
      const t2Entry = body.dialogs.find((d: any) => d.targetId === 't2');
      expect(t1Entry).toMatchObject({ type: 'confirm', message: 'm' });
      // The critical assertion: t2 (attach never completed) is NOT silently dropped — it's
      // reported as an unknown blocking dialog, exactly what makes the gate block instead of
      // letting `runtime.attach()` risk the GAP-017/GAP-220 hang + wrong-tab.
      expect(t2Entry).toMatchObject({ targetId: 't2', type: 'unknown', message: '' });
      expect(body.busy).toEqual(['t2']);
    } finally {
      await warden.stop('test-teardown');
    }
  });

  it('WD10 (GAP-220 defensive layer): a target with no tracked dialog that IS responsive is not reported at all', async () => {
    const session1 = fakeSession('t1');
    const target1 = fakeTarget('t1', 'https://x/', session1);
    const browser = fakeBrowser([target1]);
    let readyInfo: { port: number; token: string } | undefined;
    const warden = new DialogWarden({
      wsEndpoint: 'ws://x',
      readPolicy: async () => undefined,
      isStillCurrent: async () => true,
      onReady: (info) => {
        readyInfo = info;
      },
      onExit: () => {},
      connect: async () => browser as any,
    });
    await warden.start();
    try {
      const res = await req(readyInfo!.port, '/v1/dialogs', readyInfo!.token);
      const body = await res.json();
      expect(body.dialogs).toEqual([]);
      expect(body.busy).toEqual([]);
    } finally {
      await warden.stop('test-teardown');
    }
  });

  it('WD11 (GAP-220 regression guard): an ESTABLISHED target whose attach already ACKed is NOT reported as a blocking dialog even while busy — only a target whose attach never acked is', async () => {
    const establishedSession = fakeSession('established'); // Page.enable already acked; now busy with a legit script
    establishedSession.send.mockImplementation((method: string) =>
      method === 'Runtime.evaluate' ? Promise.reject(new Error('operation timed out')) : Promise.resolve(undefined),
    );
    const stuckSession = fakeSession('stuck'); // attach never completes
    stuckSession.send.mockImplementation((method: string) => {
      if (method === 'Runtime.evaluate') return Promise.reject(new Error('operation timed out'));
      if (method === 'Page.enable') return new Promise(() => {}); // never acks
      return Promise.resolve(undefined);
    });
    const establishedTarget = fakeTarget('established', 'https://established/', establishedSession);
    const stuckTarget = fakeTarget('stuck', 'https://stuck/', stuckSession);
    const browser = fakeBrowser([establishedTarget, stuckTarget]);
    let readyInfo: { port: number; token: string } | undefined;
    const warden = new DialogWarden({
      wsEndpoint: 'ws://x',
      readPolicy: async () => undefined,
      isStillCurrent: async () => true,
      onReady: (info) => {
        readyInfo = info;
      },
      onExit: () => {},
      connect: async () => browser as any,
    });
    await warden.start();
    try {
      // Give the established target's Page.enable a chance to actually ack (its mock resolves
      // immediately, but via a microtask) before checking — this is deliberately NOT a timing
      // window in the production code, just test setup letting the mock's promise settle.
      await new Promise((r) => setTimeout(r, 10));
      const res = await req(readyInfo!.port, '/v1/dialogs', readyInfo!.token);
      const body = await res.json();
      const establishedEntry = body.dialogs.find((d: any) => d.targetId === 'established');
      const stuckEntry = body.dialogs.find((d: any) => d.targetId === 'stuck');
      // The established, merely-busy target must NOT be reported — this is exactly what
      // regressed live against N9/N10 before this ack-based (not timing-based) condition existed.
      expect(establishedEntry).toBeUndefined();
      // The target whose attach never completed IS reported — this is GAP-220's decidable case.
      expect(stuckEntry).toMatchObject({ targetId: 'stuck', type: 'unknown' });
    } finally {
      await warden.stop('test-teardown');
    }
  });

  it('WD12 (regression guard): a tab that starts as about:blank at warden startup and later navigates is tracked from the start, not treated as permanently "brand new"', async () => {
    vi.useFakeTimers();
    try {
      const session = fakeSession('t1');
      session.send.mockImplementation((method: string) =>
        method === 'Runtime.evaluate' ? Promise.reject(new Error('operation timed out')) : Promise.resolve(undefined),
      );
      let currentUrl = 'about:blank';
      const target = {
        type: () => 'page',
        url: () => currentUrl,
        _targetId: 't1',
        createCDPSession: vi.fn().mockResolvedValue(session),
      };
      // The target exists (as about:blank) BEFORE the warden even starts — this is the real-world
      // shape: Chrome opens with a blank tab, the warden starts, THEN the first CLI command
      // navigates it. `listPageTargets` (used by the gate/DirectCdpBroker) filters out
      // about:blank, but the warden's OWN bootstrap must not skip it for that reason (that's the
      // exact bug this test guards against — see dialog-warden.ts `start()`'s doc comment).
      const browser = fakeBrowser([target]);
      let readyInfo: { port: number; token: string } | undefined;
      const warden = new DialogWarden({
        wsEndpoint: 'ws://x',
        readPolicy: async () => undefined,
        isStillCurrent: async () => true,
        onReady: (info) => {
          readyInfo = info;
        },
        onExit: () => {},
        connect: async () => browser as any,
      });
      await warden.start();
      try {
        // Now the tab navigates to its real URL (a URL change on the SAME target — no
        // `targetcreated` fires for this, by design; only the warden's own bootstrap loop can
        // have picked it up).
        currentUrl = 'https://real/';
        // Time passes well beyond the new-target liveness window...
        await vi.advanceTimersByTimeAsync(5000);
        // ...and the tab is now busy with a long-running (but legitimate) script, not a dialog.
        const res = await req(readyInfo!.port, '/v1/dialogs', readyInfo!.token);
        const body = await res.json();
        // Must NOT be reported as a blocking dialog — it was tracked from warden startup, so it's
        // long past the liveness-probe window by the time this check runs.
        expect(body.dialogs).toEqual([]);
        expect(body.busy).toEqual([]);
      } finally {
        await warden.stop('test-teardown');
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('WD8: prompt accept with no promptText uses the event\'s own defaultPrompt', async () => {
    vi.useFakeTimers();
    try {
      const session = fakeSession('t1');
      const target = fakeTarget('t1', 'https://x/', session);
      const browser = fakeBrowser([target]);
      const warden = new DialogWarden({
        wsEndpoint: 'ws://x',
        readPolicy: async () => ({ mode: 'accept' }),
        isStillCurrent: async () => true,
        onReady: () => {},
        onExit: () => {},
        policyGraceMs: 100,
        connect: async () => browser as any,
      });
      await warden.start();
      try {
        session.emitOpening({ type: 'prompt', message: 'q', defaultPrompt: 'fr2-default' });
        await vi.advanceTimersByTimeAsync(100);
        expect(session.send).toHaveBeenCalledWith(
          'Page.handleJavaScriptDialog',
          { accept: true, promptText: 'fr2-default' },
          { timeout: 5000 },
        );
      } finally {
        await warden.stop('test-teardown');
      }
    } finally {
      vi.useRealTimers();
    }
  });
});
