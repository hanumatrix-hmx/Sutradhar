/**
 * @file packages/mcp-server/tests/unit/shutdown-hooks.spec.ts
 * @description FR2-03 H1-H7: MCP shutdown triggers, with a fake EventEmitter/process and
 * vitest's fake timers so `deadlineMs`/idle-time behavior is deterministic.
 */
import { EventEmitter } from 'node:events';
import { installShutdownHooks } from '../../src/shutdown-hooks.js';

function makeFakeProc() {
  const emitter = new EventEmitter();
  const exitCalls: number[] = [];
  const proc = {
    on: (ev: 'SIGINT' | 'SIGTERM', fn: () => void) => emitter.on(ev, fn),
    // Real process.exit() never returns, but the type signature says `never` -- for the fake,
    // just record the call and return normally (as any real caller here never reads the
    // "return value" of exit() anyway, so this doesn't change what's under test).
    exit: (code: number) => {
      exitCalls.push(code);
      return undefined as never;
    },
    emit: (ev: string) => emitter.emit(ev),
  };
  return { proc, exitCalls };
}

describe('installShutdownHooks', () => {
  it('H1: stdin end calls shutdownAll once, then exit(0)', async () => {
    const stdin = new EventEmitter();
    const { proc, exitCalls } = makeFakeProc();
    let calls = 0;
    installShutdownHooks({ runtime: { shutdownAll: async () => { calls++; } }, stdin, proc, log: () => {} });
    stdin.emit('end');
    await new Promise((r) => setImmediate(r));
    expect(calls).toBe(1);
    expect(exitCalls).toEqual([0]);
  });

  it('H2: end, close, SIGINT, SIGTERM in sequence -- shutdownAll and exit each exactly once', async () => {
    const stdin = new EventEmitter();
    const { proc, exitCalls } = makeFakeProc();
    let calls = 0;
    installShutdownHooks({ runtime: { shutdownAll: async () => { calls++; } }, stdin, proc, log: () => {} });
    stdin.emit('end');
    stdin.emit('close');
    proc.emit('SIGINT');
    proc.emit('SIGTERM');
    await new Promise((r) => setImmediate(r));
    expect(calls).toBe(1);
    expect(exitCalls).toEqual([0]);
  });

  it('H3: shutdownAll rejects -- log gets the error, then exit(0)', async () => {
    const stdin = new EventEmitter();
    const { proc, exitCalls } = makeFakeProc();
    const logged: unknown[] = [];
    installShutdownHooks({
      runtime: { shutdownAll: async () => { throw new Error('rejected'); } },
      stdin,
      proc,
      log: (msg, err) => logged.push([msg, err]),
    });
    stdin.emit('end');
    await new Promise((r) => setImmediate(r));
    expect(logged.some(([, err]) => (err as Error)?.message === 'rejected')).toBe(true);
    expect(exitCalls).toEqual([0]);
  });

  it('H4: shutdownAll never settles -- exit(1) after the deadline, no double-exit on a later settle', async () => {
    vi.useFakeTimers();
    const stdin = new EventEmitter();
    const { proc, exitCalls } = makeFakeProc();
    let resolveShutdown: () => void = () => {};
    installShutdownHooks({
      runtime: { shutdownAll: () => new Promise((r) => { resolveShutdown = r; }) },
      stdin,
      proc,
      log: () => {},
      deadlineMs: 10_000,
    });
    stdin.emit('end');
    await vi.advanceTimersByTimeAsync(10_001);
    expect(exitCalls).toEqual([1]);
    resolveShutdown();
    await vi.advanceTimersByTimeAsync(10);
    expect(exitCalls).toEqual([1]); // still just the one call
    vi.useRealTimers();
  });

  it('H5: no events (60s of idle time) -- no shutdownAll, no exit', async () => {
    vi.useFakeTimers();
    const stdin = new EventEmitter();
    const { proc, exitCalls } = makeFakeProc();
    let calls = 0;
    installShutdownHooks({ runtime: { shutdownAll: async () => { calls++; } }, stdin, proc, log: () => {} });
    stdin.emit('data');
    stdin.emit('pause');
    stdin.emit('resume');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toBe(0);
    expect(exitCalls).toEqual([]);
    vi.useRealTimers();
  });

  it('H6: stdin error alone does not trigger shutdown', async () => {
    const stdin = new EventEmitter();
    stdin.on('error', () => {}); // avoid unhandled 'error' throwing in Node's EventEmitter
    const { proc, exitCalls } = makeFakeProc();
    let calls = 0;
    installShutdownHooks({ runtime: { shutdownAll: async () => { calls++; } }, stdin, proc, log: () => {} });
    stdin.emit('error', new Error('disconnect'));
    await new Promise((r) => setImmediate(r));
    expect(calls).toBe(0);
    expect(exitCalls).toEqual([]);
  });

  it('H7: the default logger never writes to stdout', async () => {
    const stdin = new EventEmitter();
    const { proc } = makeFakeProc();
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    installShutdownHooks({ runtime: { shutdownAll: async () => {} }, stdin, proc });
    stdin.emit('end');
    await new Promise((r) => setImmediate(r));
    expect(writeSpy).not.toHaveBeenCalled();
    writeSpy.mockRestore();
  });
});
