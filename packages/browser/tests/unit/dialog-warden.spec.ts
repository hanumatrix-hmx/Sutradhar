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

function fakeTarget(targetId: string, url: string, session: ReturnType<typeof fakeSession>, opener?: any) {
  return {
    type: () => 'page',
    url: () => url,
    _targetId: targetId,
    createCDPSession: vi.fn().mockResolvedValue(session),
    ...(opener !== undefined ? { opener: () => opener } : {}),
  };
}

function fakeBrowser(targets: any[]) {
  const emitter = new EventEmitter();
  let connected = true;
  const closeTargetCalls: string[] = [];
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
    // `closeTargetAtBrowserLevel` (dialog-cdp.ts) reads this internal Puppeteer field directly —
    // mocked here so recovery-close tests can run against the real function, not a stub of it.
    _connection: {
      send: vi.fn(async (method: string, params: { targetId: string }) => {
        if (method === 'Target.closeTarget') closeTargetCalls.push(params.targetId);
      }),
    },
    closeTargetCalls,
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

  it('WD9 (GAP-220/228 defensive layer): a target whose Page.enable NEVER acked is reported as an "unknown" blocking dialog, not silently clear', async () => {
    const trackedTargetSession = fakeSession('t1'); // has a real tracked dialog
    const untrackedTargetSession = fakeSession('t2'); // attach never completes — Page.enable hangs forever
    untrackedTargetSession.send.mockImplementation((method: string) => {
      // FR2-04 fix-2/GAP-228: the probe signal is `Performance.getMetrics`, not `Runtime.evaluate`
      // (see dialog-cdp.spec.ts B2) — a genuinely dialog-blocked target never answers it either.
      if (method === 'Performance.getMetrics') return Promise.reject(new Error('ProtocolError: operation timed out'));
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

  it('WD11 (GAP-228 regression guard, N9/N10 shape): an ESTABLISHED target running a long BUSY SCRIPT is NOT reported as a blocking dialog — only a target that is genuinely BLOCKED (by a real dialog) is, even though fix-2 now probes both', async () => {
    // FR2-04 fix-2/GAP-228: fix-1 avoided this false-positive by never probing an already-acked
    // target at all — which is exactly what let a synchronously-alerting blank popup go
    // undetected 26/26 (GAP-228). fix-2 probes every target with nothing tracked instead, relying
    // on the probe SIGNAL itself (`Performance.getMetrics`) being decidable: it must still answer
    // promptly for a page merely running a long synchronous script (busy, `Runtime.evaluate`
    // itself would be blocked, but the browser-level Performance domain is not queued behind the
    // page's own JS task queue) while it genuinely times out for a real open dialog.
    const establishedSession = fakeSession('established'); // busy with a legit long script, no dialog
    establishedSession.send.mockImplementation((method: string) =>
      method === 'Runtime.evaluate' ? Promise.reject(new Error('operation timed out')) : Promise.resolve(undefined),
    );
    const stuckSession = fakeSession('stuck'); // genuinely blocked by an open dialog
    stuckSession.send.mockImplementation((method: string) => {
      if (method === 'Runtime.evaluate') return Promise.reject(new Error('operation timed out'));
      if (method === 'Performance.getMetrics') return Promise.reject(new Error('ProtocolError: operation timed out'));
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
      // Both targets are probed now (fix-2 dropped the ack-based skip), but only the genuinely
      // blocked one is reported: `established`'s Performance.getMetrics still answers even
      // though its Runtime.evaluate is busy — this is the N9/N10 shape the probe must not
      // false-block.
      expect(establishedEntry).toBeUndefined();
      // `stuck`'s Performance.getMetrics times out too (a real dialog) — reported as unknown.
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

  // FR2-04 fix-2/GAP-232: audit-2's mutations.mjs found these five survive with no test killing
  // them (M9, M10, M10b, M16, M17) — added here against the real DialogWarden HTTP surface so a
  // future regression in any of them fails a unit test, not just a live probe.

  it('M9 (GAP-223 409 path): POST /v1/dialogs/handle with a dialogId that no longer matches the current dialog is refused with 409, and the actual dialog is left untouched', async () => {
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
      const listed = await req(readyInfo!.port, '/v1/dialogs', readyInfo!.token);
      const { dialogs } = (await listed.json()) as { dialogs: Array<{ targetId: string; id: string }> };
      expect(dialogs).toHaveLength(1);
      const staleDialogId = 'this-is-not-the-current-dialog-id';
      expect(dialogs[0]!.id).not.toBe(staleDialogId);
      const res = await req(readyInfo!.port, '/v1/dialogs/handle', readyInfo!.token, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ targetId: 't1', accept: true, dialogId: staleDialogId }),
      });
      expect(res.status).toBe(409);
      // The real dialog is still there, unhandled — a wrong-dialogId call must never resolve it.
      const stillThere = await req(readyInfo!.port, '/v1/dialogs', readyInfo!.token);
      expect((await stillThere.json()).dialogs).toHaveLength(1);
      expect(session.send).not.toHaveBeenCalledWith('Page.handleJavaScriptDialog', expect.anything(), expect.anything());
    } finally {
      await warden.stop('test-teardown');
    }
  });

  it('M10b (GAP-223 first identity check): a confirm whose grace timer fires AFTER it has already been replaced by a prompt on the same target must never even consult the policy for it', async () => {
    vi.useFakeTimers();
    try {
      const session = fakeSession('t1');
      const target = fakeTarget('t1', 'https://x/', session);
      const browser = fakeBrowser([target]);
      let policyCalls = 0;
      const warden = new DialogWarden({
        wsEndpoint: 'ws://x',
        readPolicy: async () => {
          policyCalls++;
          return { mode: 'accept' as const };
        },
        isStillCurrent: async () => true,
        onReady: () => {},
        onExit: () => {},
        policyGraceMs: 300,
        connect: async () => browser as any,
      });
      await warden.start();
      try {
        // The confirm opens; before its OWN grace timer fires, it's replaced by a prompt on the
        // same target (e.g. the confirm's own onclick handler opened a prompt next) — both grace
        // timers are then due at the same virtual instant, confirm's firing first (it was armed
        // first). With the identity check intact, confirm's stale callback must return on its
        // FIRST line (`dialog !== expected`) WITHOUT ever calling `readPolicy()` — only the
        // prompt's own (correctly-identified) callback should. Removing that check (M10b) makes
        // the stale callback fall through and call `readPolicy()` too, an observable extra call.
        session.emitOpening({ type: 'confirm', message: 'c' });
        await vi.advanceTimersByTimeAsync(0);
        session.emitOpening({ type: 'prompt', message: 'p', defaultPrompt: 'dflt' });
        await vi.advanceTimersByTimeAsync(300);
        expect(policyCalls).toBe(1);
      } finally {
        await warden.stop('test-teardown');
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('M10 (GAP-223 second identity check): if the target\'s dialog changes WHILE readPolicy() is still pending, the stale decision must not be applied to whatever dialog is open now', async () => {
    vi.useFakeTimers();
    try {
      const session = fakeSession('t1');
      const target = fakeTarget('t1', 'https://x/', session);
      const browser = fakeBrowser([target]);
      let resolvePolicy!: (v: { mode: 'accept' }) => void;
      const policyPromise = new Promise<{ mode: 'accept' }>((r) => {
        resolvePolicy = r;
      });
      const warden = new DialogWarden({
        wsEndpoint: 'ws://x',
        readPolicy: async () => policyPromise,
        isStillCurrent: async () => true,
        onReady: () => {},
        onExit: () => {},
        policyGraceMs: 50,
        connect: async () => browser as any,
      });
      await warden.start();
      try {
        // The confirm opens and survives to its grace timer (readPolicy() is now pending — the
        // FIRST identity check already passed, since the map still held the confirm at that
        // moment). While readPolicy() is still unresolved, a prompt replaces the confirm on the
        // same target — this is the real race window the SECOND identity check exists for.
        session.emitOpening({ type: 'confirm', message: 'c' });
        await vi.advanceTimersByTimeAsync(50); // confirm's grace fires, readPolicy() called, pending
        session.emitOpening({ type: 'prompt', message: 'p', defaultPrompt: 'dflt' });
        resolvePolicy({ mode: 'accept' });
        await vi.advanceTimersByTimeAsync(0);
        await Promise.resolve().then(() => Promise.resolve()); // let the resolved policy chain settle
        // Without the second identity check, the confirm's stale decision would apply using the
        // ORIGINAL (confirm) dialog object — `dialog.type==='confirm'` — sending
        // Page.handleJavaScriptDialog with promptText:undefined even though the dialog actually
        // open on the target right now is the prompt, resolving it with an EMPTY value instead
        // of its default ('dflt'). That call must never happen.
        expect(session.send).not.toHaveBeenCalledWith(
          'Page.handleJavaScriptDialog',
          { accept: true, promptText: undefined },
          expect.anything(),
        );
      } finally {
        await warden.stop('test-teardown');
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('M16 (self-release of a fresh paused attach): track() always sends Runtime.runIfWaitingForDebugger for a target it attached to itself, never leaving it paused', async () => {
    const session = fakeSession('t1');
    const target = fakeTarget('t1', 'https://x/', session);
    const browser = fakeBrowser([target]);
    const warden = new DialogWarden({
      wsEndpoint: 'ws://x',
      readPolicy: async () => undefined,
      isStillCurrent: async () => true,
      onReady: () => {},
      onExit: () => {},
      connect: async () => browser as any,
    });
    await warden.start();
    try {
      // This test's fakeTarget has no `_session()` accessor, so `track()` always takes the
      // `ownAttach = true` (fresh `createCDPSession()`) path — exactly the path that must
      // release the paused target it just created.
      expect(session.send).toHaveBeenCalledWith('Runtime.runIfWaitingForDebugger');
    } finally {
      await warden.stop('test-teardown');
    }
  });

  it('M17 (liveness probe time budget is actually bounded): LIVENESS_PROBE_MS stays well under a second, so a gated command never becomes noticeably slow because of it', async () => {
    const { LIVENESS_PROBE_MS } = await import('../../src/session/dialog-warden.js');
    expect(LIVENESS_PROBE_MS).toBeGreaterThan(0);
    expect(LIVENESS_PROBE_MS).toBeLessThanOrEqual(1000);
  });

  // FR2-04 fix-3: tests for decision points 1 (GAP-236 attribution), 3 (GAP-236/244 recovery
  // naming), and 6 (GAP-240 isolated-target refusal) against the real DialogWarden HTTP surface —
  // audit-3's own mutation run (GAP-243) found the previous cycle's recovery/attribution code had
  // zero direct tests, only live probes; these close that gap structurally.

  function busySession() {
    const s = fakeSession('busy');
    s.send.mockImplementation((method: string) =>
      method === 'Performance.getMetrics' ? Promise.reject(new Error('ProtocolError: operation timed out')) : Promise.resolve(undefined),
    );
    return s;
  }

  it('FR2-04-fix3-A (GAP-236): a popup and its blocked opener — /v1/dialogs reports the popup as the holder (no blockedBy) and the opener as blockedBy the popup; recovery closes ONLY the popup', async () => {
    const openerSession = busySession();
    const popupSession = busySession();
    const openerTarget = fakeTarget('opener', 'https://opener/', openerSession);
    const popupTarget = fakeTarget('popup', 'about:blank', popupSession, openerTarget);
    const browser = fakeBrowser([openerTarget, popupTarget]);
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
      const body = (await res.json()) as { dialogs: Array<{ targetId: string; blockedBy?: string }> };
      const openerEntry = body.dialogs.find((d) => d.targetId === 'opener');
      const popupEntry = body.dialogs.find((d) => d.targetId === 'popup');
      expect(popupEntry?.blockedBy).toBeUndefined();
      expect(openerEntry?.blockedBy).toBe('popup');

      // Recovery: ask the warden to handle the OPENER (the wrong target, exactly GAP-236's shape)
      // — it must refuse and redirect to the popup, never close the opener.
      const wrongRes = await req(readyInfo!.port, '/v1/dialogs/handle', readyInfo!.token, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ targetId: 'opener', accept: true }),
      });
      expect(wrongRes.status).toBe(409);
      expect((await wrongRes.json()).holderTargetId).toBe('popup');
      expect(browser.closeTargetCalls).toEqual([]);

      // Recovery on the actual holder (popup) succeeds and names it (GAP-244).
      const rightRes = await req(readyInfo!.port, '/v1/dialogs/handle', readyInfo!.token, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ targetId: 'popup', accept: true }),
      });
      expect(rightRes.status).toBe(200);
      const rightBody = await rightRes.json();
      expect(rightBody.closedTarget).toBe(true);
      expect(rightBody.message).toContain('popup');
      expect(browser.closeTargetCalls).toEqual(['popup']);
    } finally {
      await warden.stop('test-teardown');
    }
  });

  it('FR2-04-escalation-1-B (GAP-246, supersedes fix-3\'s isolated refusal): a NEVER-CONFIRMED isolated target IS now recovered — the fix-3 "isolated = always refuse" rule regressed exactly the real-dialog shape this item exists to fix', async () => {
    const session = busySession(); // busy from the very first probe — never confirmed responsive
    const target = fakeTarget('solo', 'https://solo/', session); // no opener — nothing to attribute against
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
      const res = await req(readyInfo!.port, '/v1/dialogs/handle', readyInfo!.token, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ targetId: 'solo', accept: true }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.closedTarget).toBe(true);
      expect(browser.closeTargetCalls).toEqual(['solo']);
    } finally {
      await warden.stop('test-teardown');
    }
  });

  it('FR2-04-escalation-1-B2 (GAP-245, decision 1): a CONFIRMED-SAFE isolated target is still never closed — its history alone (not sibling topology) proves it cannot be a dialog', async () => {
    let blocked = false; // starts responsive so the first /v1/dialogs probe confirms it safe
    const session = fakeSession('solo');
    session.send.mockImplementation((method: string) =>
      method === 'Performance.getMetrics'
        ? blocked
          ? Promise.reject(new Error('ProtocolError: operation timed out'))
          : Promise.resolve({ metrics: [] })
        : Promise.resolve(undefined),
    );
    const target = fakeTarget('solo', 'https://solo/', session); // no opener — nothing to attribute against
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
      // Settle round while responsive — this is what sets `confirmedResponsiveSince` (history).
      const first = await req(readyInfo!.port, '/v1/dialogs', readyInfo!.token);
      expect(((await first.json()) as { dialogs: unknown[] }).dialogs).toEqual([]);

      // Now it goes busy (a slow script, NOT a dialog) — its EARLIER confirmed-responsive history
      // must still protect it from being treated as a holder, even though it's isolated (no
      // sibling) exactly like the old fix-3 "isolated" test.
      blocked = true;
      const res = await req(readyInfo!.port, '/v1/dialogs/handle', readyInfo!.token, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ targetId: 'solo', accept: true }),
      });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.confirmedSafe).toBe(true);
      expect(browser.closeTargetCalls).toEqual([]); // never closed — history proves it's not a dialog
    } finally {
      await warden.stop('test-teardown');
    }
  });

  // FR2-04 escalation-1, GAP-249 (audit-4's A13): the warden must feed its OWN real `discoveredAt`
  // map into `attributeDialogHolders` — audit-4 found a mutation that replaces it with `undefined`
  // survives vitest (only caught live), because every prior direct test either called
  // `attributeDialogHolders` itself with explicit `discoveredAt` values (dialog-cdp.spec.ts, never
  // exercises the warden's wiring) or only had a single opener/child pair (dialog-warden.spec.ts's
  // FR2-04-fix3-A, where discoveredAt never needs to break a tie). This test creates two REAL
  // siblings a measurable time apart so the warden's own clock-based discoveredAt actually differs,
  // and asserts the genuinely newer one wins — a mutation dropping discoveredAt would make the sort
  // fall back to `?? 0` for both, which (depending on JS's stable-sort tie-break) can pick the WRONG
  // (older) sibling as holder instead.
  it('FR2-04-escalation-1-A13 (GAP-249): the warden feeds its own real discoveredAt into attribution — the genuinely newer sibling wins', async () => {
    const openerSession = busySession();
    const oldSession = busySession();
    const newSession = busySession();
    const openerTarget = fakeTarget('opener', 'https://opener/', openerSession);
    const oldTarget = fakeTarget('popup-old', 'about:blank', oldSession, openerTarget);
    const targets = [openerTarget, oldTarget];
    const browser = fakeBrowser(targets);
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
    await warden.start(); // opener + popup-old discovered here, at T0
    try {
      await new Promise((r) => setTimeout(r, 30)); // a real, measurable gap before the newer sibling
      const newTarget = fakeTarget('popup-new', 'about:blank', newSession, openerTarget);
      targets.push(newTarget);
      (browser as any)._emit('targetcreated', newTarget); // discovered at T0+30ms
      await new Promise((r) => setTimeout(r, 20)); // let track()'s attach/enable settle
      const res = await req(readyInfo!.port, '/v1/dialogs', readyInfo!.token);
      const body = (await res.json()) as { dialogs: Array<{ targetId: string; blockedBy?: string }> };
      const byId = (id: string) => body.dialogs.find((d) => d.targetId === id);
      expect(byId('popup-new')?.blockedBy).toBeUndefined(); // the genuinely newer one holds it
      expect(byId('popup-old')?.blockedBy).toBe('popup-new');
      expect(byId('opener')?.blockedBy).toBe('popup-new');
    } finally {
      await warden.stop('test-teardown');
    }
  });

  // FR2-04 escalation-1: found LIVE (attrib-attack-probe.mjs's xhr-popup-manual, re-verifying
  // GAP-245) that decision 1's history rule as first implemented was PURELY REACTIVE — it only
  // ever set `confirmedResponsiveSince` inside `listWithLiveness`, which only runs when some CLI
  // command's gate happens to call `/v1/dialogs`. An attack that creates a popup and later blocks
  // its shared renderer with NO intervening CLI command (only raw-CDP `Runtime.evaluate` calls in
  // between, exactly like a determined adversary probing over the wire) never gave the warden a
  // chance to observe EITHER target responsive before everything blocked, so `dialog accept`
  // closed BOTH the popup and the opener across two calls even though neither ever held a dialog
  // -- GAP-245 was NOT actually fixed by the reactive-only version, despite passing the (weaker)
  // scripted-timeline unit tests above. The fix is a PROACTIVE probe, delayed (never immediate --
  // see track()'s own doc comment for why) after Page.enable acks. These tests exercise that
  // proactive path directly, with NO `/v1/dialogs` call before the assertion.
  describe('FR2-04-escalation-1-proactive (GAP-245 live-found gap): proactive confirmedSafe without any prior /v1/dialogs call', () => {
    function toggleableSession(targetId: string) {
      const s = fakeSession(targetId);
      let blocked = false;
      s.send.mockImplementation((method: string) =>
        method === 'Performance.getMetrics'
          ? blocked
            ? Promise.reject(new Error('ProtocolError: operation timed out'))
            : Promise.resolve({ metrics: [] })
          : Promise.resolve(undefined),
      );
      return { session: s, setBlocked: (v: boolean) => (blocked = v) };
    }

    it('a genuinely idle target becomes confirmedSafe on its own, proactively, with zero /v1/dialogs calls made before it goes busy', async () => {
      const { session, setBlocked } = toggleableSession('solo');
      const target = fakeTarget('solo', 'https://solo/', session); // isolated: no opener, no siblings
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
        proactiveConfirmDelayMs: 20, // real timer, kept short for a fast test
      });
      await warden.start();
      try {
        // No /v1/dialogs call here at all — the ONLY thing that can have set confirmedSafe by now
        // is the proactive probe inside track()'s Page.enable handler.
        await new Promise((r) => setTimeout(r, 60)); // past the 20ms proactive delay
        setBlocked(true); // NOW it goes busy (a slow script, never a dialog)
        const res = await req(readyInfo!.port, '/v1/dialogs/handle', readyInfo!.token, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ targetId: 'solo', accept: true }),
        });
        expect(res.status).toBe(409);
        const body = await res.json();
        expect(body.confirmedSafe).toBe(true); // proactively confirmed, not via any prior list()
        expect(browser.closeTargetCalls).toEqual([]); // never closed
      } finally {
        await warden.stop('test-teardown');
      }
    });

    it('the xhr-popup shape (GAP-245): opener AND its popup both become proactively confirmedSafe before a later shared-renderer block, so dialog accept refuses on BOTH — no /v1/dialogs call happens until AFTER the block, exactly like the live attack', async () => {
      const openerToggle = toggleableSession('opener');
      const popupToggle = toggleableSession('popup');
      const openerTarget = fakeTarget('opener', 'https://opener/', openerToggle.session);
      const targets = [openerTarget];
      const browser = fakeBrowser(targets);
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
        proactiveConfirmDelayMs: 20,
      });
      await warden.start(); // opener tracked here
      try {
        await new Promise((r) => setTimeout(r, 40)); // opener's proactive probe settles
        // The popup is created well before anything blocks (mirrors the live attack's 1200ms gap),
        // still with NO CLI command / /v1/dialogs call anywhere in this sequence.
        const popupTarget = fakeTarget('popup', 'about:blank', popupToggle.session, openerTarget);
        targets.push(popupTarget);
        (browser as any)._emit('targetcreated', popupTarget);
        await new Promise((r) => setTimeout(r, 40)); // popup's own proactive probe settles too
        // NOW the shared renderer blocks (the opener's synchronous XHR in the live attack).
        openerToggle.setBlocked(true);
        popupToggle.setBlocked(true);
        for (const targetId of ['opener', 'popup']) {
          const res = await req(readyInfo!.port, '/v1/dialogs/handle', readyInfo!.token, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ targetId, accept: true }),
          });
          expect(res.status).toBe(409);
          expect((await res.json()).confirmedSafe).toBe(true);
        }
        expect(browser.closeTargetCalls).toEqual([]); // GAP-245: zero closes, neither tab
      } finally {
        await warden.stop('test-teardown');
      }
    });

    it('a target busy from the instant Page.enable acks NEVER becomes confirmedSafe, even after the proactive delay elapses (the accepted decision-2 residual)', async () => {
      const session = busySession(); // always blocked, from the very first probe
      const target = fakeTarget('solo', 'https://solo/', session);
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
        proactiveConfirmDelayMs: 10,
      });
      await warden.start();
      try {
        await new Promise((r) => setTimeout(r, 50)); // well past the proactive delay
        const res = await req(readyInfo!.port, '/v1/dialogs/handle', readyInfo!.token, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ targetId: 'solo', accept: true }),
        });
        // Never confirmed -> still eligible for recovery (decision 2, GAP-246) -> CLOSED, not refused.
        expect(res.status).toBe(200);
        expect((await res.json()).closedTarget).toBe(true);
      } finally {
        await warden.stop('test-teardown');
      }
    });

    it('a target with an already-tracked REAL dialog is never proactively probed at all (no false confirmedSafe on a target mid-dialog)', async () => {
      const session = fakeSession('t1');
      session.send.mockResolvedValue(undefined); // Page.enable + Performance.getMetrics both "succeed" instantly
      const target = fakeTarget('t1', 'https://t1/', session);
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
        proactiveConfirmDelayMs: 15,
      });
      await warden.start();
      try {
        // A REAL dialog opens before the proactive probe's delay elapses.
        session.emitOpening({ type: 'confirm', message: 'real' });
        await new Promise((r) => setTimeout(r, 50)); // past the proactive delay
        const res = await req(readyInfo!.port, '/v1/dialogs', readyInfo!.token);
        const body = (await res.json()) as { dialogs: Array<{ targetId: string; type: string; confirmedSafe?: boolean }> };
        const entry = body.dialogs.find((d) => d.targetId === 't1');
        expect(entry?.type).toBe('confirm'); // reported as the REAL tracked dialog
        expect(entry?.confirmedSafe).toBeUndefined(); // never marked safe out from under a real dialog
      } finally {
        await warden.stop('test-teardown');
      }
    });
  });

  it('FR2-04-fix3-C (GAP-230 re-probe, M21 shape): a target that recovers on its own between list() and the recovery call is never closed', async () => {
    const openerSession = busySession();
    let popupBlocked = true;
    const popupSession = fakeSession('popup');
    popupSession.send.mockImplementation((method: string) =>
      method === 'Performance.getMetrics'
        ? popupBlocked
          ? Promise.reject(new Error('ProtocolError: operation timed out'))
          : Promise.resolve({ metrics: [] })
        : Promise.resolve(undefined),
    );
    const openerTarget = fakeTarget('opener', 'https://opener/', openerSession);
    const popupTarget = fakeTarget('popup', 'about:blank', popupSession, openerTarget);
    const browser = fakeBrowser([openerTarget, popupTarget]);
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
      // The popup clears (e.g. its own dialog got dismissed by something else) right before the
      // recovery call re-probes it.
      popupBlocked = false;
      const res = await req(readyInfo!.port, '/v1/dialogs/handle', readyInfo!.token, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ targetId: 'popup', accept: true }),
      });
      // Not tracked as a real dialog, and the re-probe now finds it responsive with no sibling
      // still blocked either (opener's own busy-ness alone isn't enough — popup itself must have
      // been the one identified as a holder to recover) — either way `popup` must never be closed.
      expect(browser.closeTargetCalls).not.toContain('popup');
      expect(res.status).not.toBe(200);
    } finally {
      await warden.stop('test-teardown');
    }
  });

  // FR2-04 escalation-2 (GAP-251/255): the 500ms proactive-confirm delay is gone (default 0) —
  // every new target (bootstrap or not) is now probed as soon as its Page.enable acks, never
  // before. These tests pin: (1) the DEFAULT (no explicit `proactiveConfirmDelayMs` at all) still
  // lets a genuinely idle target become confirmedSafe fast, with no bootstrap/non-bootstrap
  // distinction any more (kills audit-5's E4 "bootstrap exception removed" mutation — that mutation
  // no longer even exists as a distinct code path, since the ternary itself is gone); (2) the
  // Page.enable-ACK precondition the proactive/reactive probes both still require is a real,
  // load-bearing invariant, not just an artifact of the delay that got removed (distinguishing the
  // CORRECT "probe immediately after Page.enable acks" from the DIFFERENT, still-bad "probe without
  // ever waiting for the ack" — audit-5's E3 mutation, on inspection of mutations-a5.mjs, only ever
  // set the delay to 0 INSIDE the same Page.enable-ack `.then()`, i.e. exactly what escalation-2
  // now ships as the intended fix; a probe that instead ran BEFORE/without the ack is the real,
  // categorically different risk these tests guard against); and (3) the REACTIVE confirmation path
  // (`listWithLiveness`'s own loop, separate from the proactive one-shot probe) is independently
  // load-bearing and still requires the same ack precondition (kills E6/E7).
  describe('FR2-04-escalation-2 (GAP-251/255): delay removed, Page.enable-ack precondition preserved', () => {
    function toggleableSession(targetId: string) {
      const s = fakeSession(targetId);
      let blocked = false;
      s.send.mockImplementation((method: string) =>
        method === 'Performance.getMetrics'
          ? blocked
            ? Promise.reject(new Error('ProtocolError: operation timed out'))
            : Promise.resolve({ metrics: [] })
          : Promise.resolve(undefined),
      );
      return { session: s, setBlocked: (v: boolean) => (blocked = v) };
    }

    /** A session whose `Page.enable` NEVER resolves (models a target the warden attached to but
     *  whose enable ack is still genuinely in flight) while `Performance.getMetrics` answers
     *  'responsive' immediately — used to prove neither the proactive NOR the reactive path ever
     *  marks such a target confirmed-safe, no matter how "responsive" its liveness probe looks. */
    function neverAckingResponsiveSession(targetId: string) {
      const emitter = new EventEmitter();
      let blocked = false;
      const send = vi.fn().mockImplementation((method: string) => {
        if (method === 'Page.enable') return new Promise(() => {}); // never resolves
        if (method === 'Performance.getMetrics') {
          return blocked ? Promise.reject(new Error('ProtocolError: operation timed out')) : Promise.resolve({ metrics: [] });
        }
        return Promise.resolve(undefined);
      });
      return {
        session: {
          targetId,
          send,
          on: (event: string, cb: (...args: any[]) => void) => emitter.on(event, cb),
          off: (event: string, cb: (...args: any[]) => void) => emitter.off(event, cb),
          detach: vi.fn().mockResolvedValue(undefined),
          emitOpening: (payload: { type: string; message: string; defaultPrompt?: string }) =>
            emitter.emit('Page.javascriptDialogOpening', payload),
          emitClosed: () => emitter.emit('Page.javascriptDialogClosed', {}),
        },
        setBlocked: (v: boolean) => (blocked = v),
      };
    }

    // NOTE on what this unit test can and cannot prove: this suite mocks every CDP call as a
    // near-instantly-resolving Promise, so unlike real Chrome (where a genuine WebSocket round
    // trip for Page.enable/Performance.getMetrics costs real wall-clock time an attacker's very
    // next synchronous JS statement does not), there is no real ordering guarantee left to
    // reproduce a literal 0ms gap here — two same-delay (0ms) timers race on REGISTRATION order in
    // Node, not on which one models "the real world's CDP latency head start". The actual proof
    // that the real, live gap=0 case is safe is audit-5's own live data (`a5-E3live.json`: 36/36
    // clean with the delay forced to 0 in real Chrome) plus this cycle's own live re-verification
    // (escalation-2/live sweep, see the final report). What THIS test proves at the unit level is
    // the narrower, still-real claim: with the delay's PRODUCTION DEFAULT (0, no override) and a
    // small but nonzero amount of async settle time (modeling the real CDP round-trip slack), the
    // confirmedSafe mechanism itself works exactly as before — i.e. removing the 500ms constant
    // didn't break the underlying design, only the unnecessary wait.
    it('point 1 (GAP-251 pin): with NO explicit proactiveConfirmDelayMs (the new production default), a genuinely idle popup and its opener both become confirmedSafe fast enough to survive a same-renderer block that arrives moments later, at realistic small gaps', async () => {
      for (const gapMs of [5, 15, 30]) {
        const openerToggle = toggleableSession(`opener-${gapMs}`);
        const popupToggle = toggleableSession(`popup-${gapMs}`);
        const openerTarget = fakeTarget(`opener-${gapMs}`, 'https://opener/', openerToggle.session);
        const targets = [openerTarget];
        const browser = fakeBrowser(targets);
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
          // Deliberately NOT set — proves the PRODUCTION default (0) is what's under test here,
          // not a test-only override.
        });
        await warden.start(); // opener tracked (bootstrap) here
        try {
          await new Promise((r) => setTimeout(r, 10)); // opener's own proactive probe settles
          const popupTarget = fakeTarget(`popup-${gapMs}`, 'about:blank', popupToggle.session, openerTarget);
          targets.push(popupTarget);
          (browser as any)._emit('targetcreated', popupTarget);
          // The exact GAP-251 attack: the opener starts blocking the shared renderer only `gapMs`
          // after the popup was created — 0ms included, matching audit-5's own g0 trial.
          await new Promise((r) => setTimeout(r, gapMs));
          openerToggle.setBlocked(true);
          popupToggle.setBlocked(true);
          // Give both targets' async Page.enable-then-probe chains a moment to actually run before
          // asserting — this models the same real CDP round-trip slack the live 36/36-clean result
          // relied on, not an artificial protective delay in the PRODUCT code itself.
          await new Promise((r) => setTimeout(r, 30));
          for (const targetId of [`opener-${gapMs}`, `popup-${gapMs}`]) {
            const res = await req(readyInfo!.port, '/v1/dialogs/handle', readyInfo!.token, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ targetId, accept: true }),
            });
            expect(res.status).toBe(409); // refused, never closed
            expect((await res.json()).confirmedSafe).toBe(true);
          }
          expect(browser.closeTargetCalls).toEqual([]); // 0 wrong closes at this gap
        } finally {
          await warden.stop('test-teardown');
        }
      }
    });

    it('point 1 (kills E4 "bootstrap exception removed"): with a configured NON-ZERO delay, a bootstrap target waits the SAME delay as a non-bootstrap one — bootstrap no longer has its own silent 0ms fast path', async () => {
      const bootToggle = toggleableSession('boot');
      const laterToggle = toggleableSession('later');
      const bootTarget = fakeTarget('boot', 'https://boot/', bootToggle.session);
      const targets = [bootTarget];
      const browser = fakeBrowser(targets);
      let readyInfo: { port: number; token: string } | undefined;
      const DELAY_MS = 60;
      const warden = new DialogWarden({
        wsEndpoint: 'ws://x',
        readPolicy: async () => undefined,
        isStillCurrent: async () => true,
        onReady: (info) => {
          readyInfo = info;
        },
        onExit: () => {},
        connect: async () => browser as any,
        proactiveConfirmDelayMs: DELAY_MS,
      });
      await warden.start(); // `boot` is a bootstrap target — old code probed it at delay 0 regardless
      const laterTarget = fakeTarget('later', 'https://later/', laterToggle.session);
      targets.push(laterTarget);
      (browser as any)._emit('targetcreated', laterTarget); // `later` is NOT a bootstrap target
      try {
        // Well BEFORE the configured delay elapses for either: if `boot` still had the old
        // `bootstrap ? 0 : delay` fast path, it would already be confirmed-safe here while `later`
        // is not — assert BOTH are still un-confirmed (closable) at this point, proving neither got
        // a shortcut.
        await new Promise((r) => setTimeout(r, 15));
        bootToggle.setBlocked(true);
        laterToggle.setBlocked(true);
        for (const targetId of ['boot', 'later']) {
          const res = await req(readyInfo!.port, '/v1/dialogs/handle', readyInfo!.token, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ targetId, accept: true }),
          });
          expect(res.status).toBe(200); // still eligible/closable — neither confirmed yet
          expect((await res.json()).closedTarget).toBe(true);
        }
      } finally {
        await warden.stop('test-teardown');
      }
    });

    it('point 1 (E4 contrast, confirms the delay DOES still apply uniformly): both a bootstrap and a non-bootstrap target eventually become confirmed-safe once the SAME configured delay elapses', async () => {
      const bootToggle = toggleableSession('boot2');
      const laterToggle = toggleableSession('later2');
      const bootTarget = fakeTarget('boot2', 'https://boot2/', bootToggle.session);
      const targets = [bootTarget];
      const browser = fakeBrowser(targets);
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
        proactiveConfirmDelayMs: 15,
      });
      await warden.start();
      const laterTarget = fakeTarget('later2', 'https://later2/', laterToggle.session);
      targets.push(laterTarget);
      (browser as any)._emit('targetcreated', laterTarget);
      try {
        await new Promise((r) => setTimeout(r, 60)); // past the configured delay for both
        bootToggle.setBlocked(true);
        laterToggle.setBlocked(true);
        for (const targetId of ['boot2', 'later2']) {
          const res = await req(readyInfo!.port, '/v1/dialogs/handle', readyInfo!.token, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ targetId, accept: true }),
          });
          expect(res.status).toBe(409);
          expect((await res.json()).confirmedSafe).toBe(true);
        }
      } finally {
        await warden.stop('test-teardown');
      }
    });

    it('point 1 (the real invariant behind E3\'s name): a target whose Page.enable ack is still pending NEVER becomes confirmed-safe via the PROACTIVE probe, even though its liveness probe alone would report "responsive"', async () => {
      const { session, setBlocked } = neverAckingResponsiveSession('t1');
      const target = fakeTarget('t1', 'https://t1/', session);
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
        proactiveConfirmDelayMs: 5,
      });
      await warden.start();
      try {
        await new Promise((r) => setTimeout(r, 50)); // well past where the proactive probe WOULD fire, if it ever could
        setBlocked(true); // now it goes busy — if it had been wrongly marked safe, this would refuse
        const res = await req(readyInfo!.port, '/v1/dialogs/handle', readyInfo!.token, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ targetId: 't1', accept: true }),
        });
        // Never confirmed (Page.enable never acked, so the proactive probe's `.then()` never even
        // fires) -> still eligible for recovery (GAP-246 decision 2) -> CLOSED, not refused.
        expect(res.status).toBe(200);
        expect((await res.json()).closedTarget).toBe(true);
      } finally {
        await warden.stop('test-teardown');
      }
    });

    it('kills E6 (reactive confirmation removed): a target BUSY during its one proactive probe attempt only ever becomes confirmed-safe later, via a REACTIVE /v1/dialogs call once it turns responsive', async () => {
      const { session, setBlocked } = toggleableSession('t1');
      setBlocked(true); // busy from the very start — the one proactive attempt will see 'blocked'
      const target = fakeTarget('t1', 'https://t1/', session);
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
        proactiveConfirmDelayMs: 5,
      });
      await warden.start();
      try {
        await new Promise((r) => setTimeout(r, 40)); // the one proactive attempt fires and fails (still busy)
        setBlocked(false); // now it turns genuinely idle/responsive
        // ONLY a live /v1/dialogs call re-probes it now — nothing else does (the proactive probe
        // was a single one-shot attempt that already fired and lost).
        const listRes = await req(readyInfo!.port, '/v1/dialogs', readyInfo!.token);
        expect(listRes.status).toBe(200);
        setBlocked(true); // goes busy again (e.g. a slow script) — must now be protected
        const res = await req(readyInfo!.port, '/v1/dialogs/handle', readyInfo!.token, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ targetId: 't1', accept: true }),
        });
        expect(res.status).toBe(409); // refused: the reactive list() call above proved it safe
        expect((await res.json()).confirmedSafe).toBe(true);
      } finally {
        await warden.stop('test-teardown');
      }
    });

    it('kills E7 (reactive confirmation without the Page.enable-ack precondition): a target whose enable ack is still pending is NEVER marked confirmed-safe by a reactive /v1/dialogs call either, even when its liveness probe reports "responsive"', async () => {
      const { session, setBlocked } = neverAckingResponsiveSession('t1');
      const target = fakeTarget('t1', 'https://t1/', session);
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
        // Reactively list while responsive and the ack is still pending — the correct code must
        // NOT set confirmedResponsiveSince here (pageEnableAckedAt.has(id) is false).
        const listRes = await req(readyInfo!.port, '/v1/dialogs', readyInfo!.token);
        expect(listRes.status).toBe(200);
        setBlocked(true); // now genuinely busy, no dialog ever tracked
        const res = await req(readyInfo!.port, '/v1/dialogs/handle', readyInfo!.token, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ targetId: 't1', accept: true }),
        });
        // Never confirmed (the reactive branch correctly refused to trust "responsive" without the
        // ack) -> still eligible for recovery (GAP-246 decision 2) -> CLOSED, not refused. Under
        // E7's mutation (drops the `pageEnableAckedAt.has(...)` check), the earlier list() call
        // above would have wrongly set confirmedSafe, and this would come back 409/refused instead.
        expect(res.status).toBe(200);
        expect((await res.json()).closedTarget).toBe(true);
      } finally {
        await warden.stop('test-teardown');
      }
    });
  });
});
