/**
 * @file packages/cli/tests/unit/warden-control.spec.ts
 * @description FR2-04 Branch W, CLI side: unit tests for ensureWarden/stopWarden against a real
 * scratch state directory, with injected `spawn`/`fetch` so no real process or network is used.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ensureWarden, stopWarden, readWardenFile, writeWardenFile, isRivalWardenAlive } from '../../src/warden-control.js';

async function scratchDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'fr2-04-wc-'));
}

describe('@sutradhar/cli warden-control (FR2-04 Branch W)', () => {
  it('WC1: a healthy existing warden for the same wsEndpoint is reused (spawn 0 calls)', async () => {
    const dir = await scratchDir();
    try {
      await writeWardenFile(dir, { v: 1, pid: 999, port: 4321, token: 'tok', wsEndpoint: 'ws://x', startedAt: 'x' });
      const spawnFn = vi.fn();
      const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ pid: 999, wsEndpoint: 'ws://x' }) });
      const result = await ensureWarden({ stateDir: dir, wsEndpoint: 'ws://x', spawnFn: spawnFn as any, fetchImpl: fetchImpl as any });
      expect(result).toEqual({ port: 4321, token: 'tok', reused: true });
      expect(spawnFn).not.toHaveBeenCalled();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('WC2: an unhealthy/absent warden spawns a fresh one with the expected argv/options and a decodable payload', async () => {
    const dir = await scratchDir();
    try {
      let writtenLater: Promise<void> | undefined;
      const fetchImpl = vi.fn().mockResolvedValue({ ok: false });
      const spawnFn = vi.fn().mockImplementation(() => {
        // Simulate the spawned warden writing its own file shortly after start.
        writtenLater = writeWardenFile(dir, {
          v: 1,
          pid: 12345,
          port: 5555,
          token: 'newtok',
          wsEndpoint: 'ws://real',
          startedAt: 'x',
        });
        return { unref: vi.fn() };
      });
      // fetchImpl is called for the readiness poll too — make it succeed AFTER the file exists.
      let calls = 0;
      const fetchImpl2 = vi.fn().mockImplementation(async () => {
        calls++;
        if (calls <= 1) return { ok: false };
        return { ok: true, json: async () => ({ pid: 12345, wsEndpoint: 'ws://real' }) };
      });
      const resultPromise = ensureWarden({
        stateDir: dir,
        wsEndpoint: 'ws://real',
        spawnFn: spawnFn as any,
        fetchImpl: fetchImpl2 as any,
        execPath: '/node',
        argv1: '/cli.js',
      });
      const result = await resultPromise;
      await writtenLater;
      expect(spawnFn).toHaveBeenCalledTimes(1);
      const [execPath, args, options] = spawnFn.mock.calls[0]!;
      expect(execPath).toBe('/node');
      expect(args[0]).toBe('/cli.js');
      expect(args[1]).toBe('__dialog-warden');
      const decoded = JSON.parse(Buffer.from(args[2], 'base64url').toString('utf-8'));
      expect(decoded.wsEndpoint).toBe('ws://real');
      expect(decoded.stateFile).toBe(path.join(dir, 'state.json'));
      expect(options).toMatchObject({ detached: true, windowsHide: true });
      expect(result?.reused).toBe(false);
      void fetchImpl;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('WC3: readiness never arrives — returns undefined and prints the exact §2.5 warning', async () => {
    const dir = await scratchDir();
    try {
      const spawnFn = vi.fn().mockReturnValue({ unref: vi.fn() });
      const fetchImpl = vi.fn().mockResolvedValue({ ok: false });
      const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const result = await ensureWarden({ stateDir: dir, wsEndpoint: 'ws://never', spawnFn: spawnFn as any, fetchImpl: fetchImpl as any });
      expect(result).toBeUndefined();
      expect(stderrSpy).toHaveBeenCalledWith(
        'Warning: the dialog warden did not start, so dialogs left open between commands can\'t be handled ' +
          'or auto-handled. Run "sutradhar dialog" to check.',
      );
      stderrSpy.mockRestore();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 10000);

  it('WC4: stopWarden removes the file even when the health pid mismatches (kill 0 calls)', async () => {
    const dir = await scratchDir();
    try {
      await writeWardenFile(dir, { v: 1, pid: 111, port: 1234, token: 'tok', wsEndpoint: 'ws://x', startedAt: 'x' });
      const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ pid: 222, wsEndpoint: 'ws://x' }) });
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true as any);
      await stopWarden(dir, fetchImpl as any);
      expect(killSpy).not.toHaveBeenCalled();
      expect(await readWardenFile(dir)).toBeUndefined();
      killSpy.mockRestore();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('WC5 (GAP-223): two concurrent ensureWarden calls for the same fresh session spawn exactly ONE warden', async () => {
    const dir = await scratchDir();
    try {
      const fetchImpl = vi.fn().mockImplementation(async () => {
        const file = await readWardenFile(dir);
        if (!file) return { ok: false };
        return { ok: true, json: async () => ({ pid: file.pid, wsEndpoint: file.wsEndpoint }) };
      });
      const spawnFn = vi.fn().mockImplementation(() => {
        // Simulate the real warden process: write its file shortly after being spawned.
        void writeWardenFile(dir, {
          v: 1,
          pid: 55555,
          port: 9999,
          token: 'onlyone',
          wsEndpoint: 'ws://shared',
          startedAt: new Date().toISOString(),
        });
        return { unref: vi.fn() };
      });
      const deps = { stateDir: dir, wsEndpoint: 'ws://shared', spawnFn: spawnFn as any, fetchImpl: fetchImpl as any };
      const [a, b] = await Promise.all([ensureWarden(deps), ensureWarden(deps)]);
      expect(spawnFn).toHaveBeenCalledTimes(1);
      expect(a).toEqual({ port: 9999, token: 'onlyone', reused: expect.any(Boolean) });
      expect(b).toEqual({ port: 9999, token: 'onlyone', reused: expect.any(Boolean) });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('WC6 (GAP-223): a stale lock (dead pid) from a crashed spawner is recovered, not left wedged forever', async () => {
    const dir = await scratchDir();
    try {
      const { writeFile, mkdir } = await import('node:fs/promises');
      await mkdir(dir, { recursive: true });
      // A pid essentially guaranteed dead on any real machine, simulating a spawner that took
      // the lock and then crashed before releasing it.
      await writeFile(path.join(dir, 'warden.lock'), JSON.stringify({ pid: 999999, startedAt: Date.now() }));
      const fetchImpl = vi.fn().mockImplementation(async () => {
        const file = await readWardenFile(dir);
        if (!file) return { ok: false };
        return { ok: true, json: async () => ({ pid: file.pid, wsEndpoint: file.wsEndpoint }) };
      });
      const spawnFn = vi.fn().mockImplementation(() => {
        void writeWardenFile(dir, {
          v: 1,
          pid: 7777,
          port: 8888,
          token: 'recovered',
          wsEndpoint: 'ws://stale-lock',
          startedAt: new Date().toISOString(),
        });
        return { unref: vi.fn() };
      });
      const result = await ensureWarden({ stateDir: dir, wsEndpoint: 'ws://stale-lock', spawnFn: spawnFn as any, fetchImpl: fetchImpl as any });
      expect(spawnFn).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ port: 8888, token: 'recovered', reused: false });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // FR2-04 escalation-1, GAP-250: audit-4 found M22 (the lock read-back check) and M23
  // (isRivalWardenAlive's singleton check) survive vitest because nothing tests either function
  // DIRECTLY — WC5/WC6 above only exercise them indirectly through `ensureWarden`'s spawn path,
  // which happens to converge on one winner even without them (the spawned process's OWN
  // `warden.json` write is what those tests actually assert on). M22's own direct test lives in
  // warden-control-lock-raceback.spec.ts (a separate file — it mocks `node:fs/promises`, which
  // would break every real-directory test in THIS file if done here). M23's tests are here,
  // since they need no fs mocking.

  it('WC8 (GAP-250/M23): isRivalWardenAlive reports true for a live, healthy warden on the SAME wsEndpoint that is not this process', async () => {
    const dir = await scratchDir();
    try {
      await writeWardenFile(dir, { v: 1, pid: 424242, port: 1, token: 't', wsEndpoint: 'ws://shared', startedAt: 'x' });
      const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ pid: 424242, wsEndpoint: 'ws://shared' }) });
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true as any); // pretend the rival pid is alive
      const result = await isRivalWardenAlive(dir, 'ws://shared', /* selfPid */ 1, fetchImpl as any);
      expect(result).toBe(true);
      killSpy.mockRestore();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('WC9 (GAP-250/M23): isRivalWardenAlive reports false when the rival is for a DIFFERENT wsEndpoint, IS this process, or its pid is dead', async () => {
    const dir = await scratchDir();
    try {
      await writeWardenFile(dir, { v: 1, pid: 424242, port: 1, token: 't', wsEndpoint: 'ws://shared', startedAt: 'x' });
      const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ pid: 424242, wsEndpoint: 'ws://shared' }) });

      // Different wsEndpoint: even a live rival for a different browser isn't a rival for THIS one.
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true as any);
      expect(await isRivalWardenAlive(dir, 'ws://different', 1, fetchImpl as any)).toBe(false);
      // Self pid: warden.json already names THIS process — never a rival to itself.
      expect(await isRivalWardenAlive(dir, 'ws://shared', 424242, fetchImpl as any)).toBe(false);
      killSpy.mockRestore();

      // Dead pid: process.kill(pid, 0) throws for a pid that doesn't exist.
      const deadKillSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
        throw new Error('ESRCH');
      });
      expect(await isRivalWardenAlive(dir, 'ws://shared', 1, fetchImpl as any)).toBe(false);
      deadKillSpy.mockRestore();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
