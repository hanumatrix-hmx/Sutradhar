/**
 * @file packages/cli/tests/unit/spawn-failure-cleanup.spec.ts
 * @description GAP-349 (0.6.1): every way a fresh CLI spawn can fail after the auto-created
 * `<tmpRoot>/sutradhar-cli-*` profile dir exists must remove that dir again:
 *   P0  spawn throws synchronously        P1  no PID (async ENOENT)
 *   P2  start timeout, child alive        P2x start timeout / early exit, child ALREADY exited (no kill)
 *   F8  attach or setViewport fails after a successful spawn (attachOrDiscard)
 * Deterministic seams only (fake spawn, fake probe, fake kill, injected liveness); no real Chrome.
 * Every G test passes `executablePath` (so no Chrome lookup happens) and its own `tmpRoot`.
 */
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { KILL_CAP_MS } from '../../src/close-session.js';
import { discardSpawnedProfile, spawnDetachedChrome, type SpawnDeps, type SpawnedChrome } from '../../src/spawn-chrome.js';
import { attachOrDiscard } from '../../src/spawn-session.js';
import { removeSessionTempProfile } from '../../src/temp-profile.js';

type RemoveProfile = NonNullable<SpawnDeps['removeProfile']>;
type RemoveCall = { exists: boolean; parent: string; pid: number | undefined; opts: Parameters<RemoveProfile>[2] };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

let tmpRoot: string;
const extraDirs: string[] = [];
beforeEach(() => {
  tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'g349-'));
});
afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
  for (const d of extraDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** The first recorded removeProfile call (fails the test, with a clear message, if there was none). */
const first = (calls: RemoveCall[]): RemoveCall => {
  const c = calls[0];
  if (!c) throw new Error('removeProfile was never called');
  return c;
};

const leftover = () => readdirSync(tmpRoot).filter((n) => n.startsWith('sutradhar-cli-'));

function fakeChild(pid: number | undefined, after?: (c: EventEmitter) => void) {
  const c = Object.assign(new EventEmitter(), { pid, unref: () => {} });
  if (after) after(c);
  return c;
}

/** The plan's wrapper (review-6 D): records what it received, then FORWARDS the received opts
 *  (never a fresh object: that would drop the injected `isAlive`) to the real removal. */
function harness(over: Partial<SpawnDeps> = {}) {
  const calls: RemoveCall[] = [];
  const killCalls: Array<[number, number]> = [];
  const events: string[] = [];
  const removeProfile: RemoveProfile = async (dir, pid, opts) => {
    calls.push({ exists: existsSync(dir), parent: path.dirname(dir), pid, opts });
    events.push('remove-start');
    const res = await removeSessionTempProfile(dir, pid, {
      ...opts,
      tmpRoot,
      scan: async () => [],
      rmFn:
        opts?.rmFn ??
        (async (p, o) => {
          events.push('rm');
          return rm(p, o);
        }),
    });
    events.push(`removed=${res.removed}`);
    return res;
  };
  const deps: SpawnDeps = {
    executablePath: 'fake-chrome',
    tmpRoot,
    probeEndpoint: async () => undefined,
    kill: async (pid, cap) => {
      killCalls.push([pid, cap]);
      events.push('kill-end');
    },
    removeProfile,
    ...over,
  };
  return { deps, calls, killCalls, events };
}

describe('GAP-349: spawn-failure paths remove their own temp dir', () => {
  it('G1 (P0): a synchronous spawn throw (EFTYPE) removes the dir; nothing is killed', async () => {
    const h = harness({
      spawnFn: () => {
        throw Object.assign(new Error('spawn fake-chrome EFTYPE'), { code: 'EFTYPE' });
      },
    });
    await expect(spawnDetachedChrome(true, undefined, undefined, undefined, h.deps)).rejects.toThrow(/EFTYPE/);
    expect(h.calls).toHaveLength(1);
    expect(first(h.calls).exists).toBe(true); // the dir existed when the discard ran
    expect(path.resolve(first(h.calls).parent)).toBe(path.resolve(tmpRoot)); // created under the injected root
    expect(leftover()).toEqual([]);
    expect(h.killCalls).toEqual([]);
    expect(first(h.calls).pid).toBeUndefined();
  });

  it('G2 (P1): no PID plus an async ENOENT removes the dir and reports ENOENT; nothing is killed', async () => {
    const h = harness({
      spawnFn: () =>
        fakeChild(undefined, (c) => {
          setImmediate(() => c.emit('error', Object.assign(new Error('spawn fake-chrome ENOENT'), { code: 'ENOENT' })));
        }),
    });
    await expect(spawnDetachedChrome(true, undefined, undefined, undefined, h.deps)).rejects.toThrow(/ENOENT/);
    expect(h.calls).toHaveLength(1);
    expect(path.resolve(first(h.calls).parent)).toBe(path.resolve(tmpRoot));
    expect(leftover()).toEqual([]);
    expect(h.killCalls).toEqual([]);
  });

  it('G3 (P2): timeout with the child alive kills once, then removes with the pid and the forwarded isAlive seam', async () => {
    let aliveCalls = 0;
    const isAlive = (_pid: number) => {
      aliveCalls++;
      return false;
    };
    const h = harness({ spawnFn: () => fakeChild(4242), startTimeoutMs: 300, isAlive });
    const t0 = performance.now();
    await expect(spawnDetachedChrome(true, undefined, undefined, undefined, h.deps)).rejects.toThrow(/Timed out/);
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(h.killCalls).toEqual([[4242, KILL_CAP_MS]]);
    expect(h.calls).toHaveLength(1);
    expect(first(h.calls).pid).toBe(4242);
    expect(first(h.calls).opts?.isAlive).toBe(isAlive); // identity: the injected seam reached removeProfile
    expect(aliveCalls).toBeGreaterThan(0); // and it was actually used by removeSessionTempProfile
    expect(h.events.indexOf('kill-end')).toBeLessThan(h.events.indexOf('remove-start'));
    expect(leftover()).toEqual([]);
  });

  it('G3b (P2, dying child): the dir is removed only after the killed child is really gone', async () => {
    let killEndAt = Infinity;
    let sawFalse = false;
    const events: string[] = [];
    const h = harness({
      spawnFn: () => fakeChild(4242),
      startTimeoutMs: 200,
      kill: async () => {
        killEndAt = performance.now();
        events.push('kill-end');
      },
      isAlive: () => {
        const alive = performance.now() - killEndAt < 300;
        if (!alive && !sawFalse) {
          sawFalse = true;
          events.push('isAlive=false');
        }
        return alive;
      },
    });
    // route the wrapper's own events into the same list, in order
    const innerRemove = h.deps.removeProfile as RemoveProfile;
    h.deps.removeProfile = async (dir, pid, opts) => {
      const res = await innerRemove(dir, pid, {
        ...opts,
        rmFn: async (p, o) => {
          events.push(sawFalse ? 'rm-after-dead' : 'rm-while-alive');
          return rm(p, o);
        },
      });
      events.push('removed');
      return res;
    };
    await expect(spawnDetachedChrome(true, undefined, undefined, undefined, h.deps)).rejects.toThrow(/Timed out/);
    expect(leftover()).toEqual([]); // still removed, not a one-shot keep
    expect(events).not.toContain('rm-while-alive');
    expect(events.indexOf('kill-end')).toBeLessThan(events.indexOf('isAlive=false'));
    expect(events.indexOf('isAlive=false')).toBeLessThan(events.indexOf('removed'));
  });

  it('G4 (P2x): a child that already exited is NOT killed (its pid may be reused); the dir is removed fast', async () => {
    const h = harness({
      spawnFn: () => fakeChild(4242, (c) => setImmediate(() => c.emit('exit', 9, null))),
      startTimeoutMs: 5000,
      isAlive: () => false,
    });
    const t0 = performance.now();
    await expect(spawnDetachedChrome(true, undefined, undefined, undefined, h.deps)).rejects.toThrow(/exited/);
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(h.killCalls).toEqual([]);
    expect(h.calls).toHaveLength(1);
    expect(first(h.calls).pid).toBeUndefined(); // nothing was killed, so no exit wait on a dead pid
    expect(leftover()).toEqual([]);
  });

  it('G6: a named profile creates nothing in tmpRoot and is never removed (its Chrome is still killed)', async () => {
    const named = mkdtempSync(path.join(os.tmpdir(), 'g349-named-'));
    extraDirs.push(named);
    mkdirSync(path.join(named, 'Default'));
    const h = harness({ spawnFn: () => fakeChild(4242), startTimeoutMs: 200, isAlive: () => false });
    await expect(spawnDetachedChrome(true, named, undefined, undefined, h.deps)).rejects.toThrow(/Timed out/);
    expect(readdirSync(tmpRoot)).toEqual([]);
    expect(h.calls).toEqual([]);
    expect(h.killCalls).toEqual([[4242, KILL_CAP_MS]]);
    expect(existsSync(path.join(named, 'Default'))).toBe(true);
  });

  it('success path: returns the endpoint and keeps the dir (no discard)', async () => {
    const h = harness({ spawnFn: () => fakeChild(4242), probeEndpoint: async () => 'ws://127.0.0.1:1/devtools/browser/x' });
    const res = await spawnDetachedChrome(true, undefined, undefined, undefined, h.deps);
    expect(res.pid).toBe(4242);
    expect(res.tempProfile).toBe(true);
    expect(path.resolve(path.dirname(res.userDataDir))).toBe(path.resolve(tmpRoot));
    expect(existsSync(res.userDataDir)).toBe(true);
    expect(h.calls).toEqual([]);
    expect(h.killCalls).toEqual([]);
  });
});

describe('GAP-349 F8: attachOrDiscard', () => {
  const spawned: SpawnedChrome = { wsEndpoint: 'ws://x', pid: 4242, userDataDir: path.join(os.tmpdir(), 'unused'), tempProfile: true };

  it('G5: order is attach, discard-start, discard-end, rethrow-original (the discard is awaited first)', async () => {
    const events: string[] = [];
    const original = new Error('attach failed');
    await attachOrDiscard(
      spawned,
      async () => {
        events.push('attach');
        throw original;
      },
      async () => {
        events.push('discard-start');
        await sleep(30);
        events.push('discard-end');
      },
    ).catch((e: unknown) => {
      events.push('rethrow');
      expect(e).toBe(original);
    });
    expect(events).toEqual(['attach', 'discard-start', 'discard-end', 'rethrow']);
  });

  it('G5: on attach success the result is returned and nothing is discarded', async () => {
    let discards = 0;
    const res = await attachOrDiscard(
      spawned,
      async () => 'attached',
      async () => {
        discards++;
      },
    );
    expect(res).toBe('attached');
    expect(discards).toBe(0);
  });

  it('G5: a failing discard cannot replace the original error', async () => {
    const original = new Error('attach failed');
    await expect(
      attachOrDiscard(
        spawned,
        async () => {
          throw original;
        },
        async () => {
          throw new Error('discard blew up');
        },
      ),
    ).rejects.toBe(original);
  });
});

describe('GAP-349: discardSpawnedProfile', () => {
  it('F8 shape (alive unknown): kills the pid, then removes the temp dir WITH that pid; a named profile is only killed', async () => {
    const h = harness({ isAlive: () => false });
    await discardSpawnedProfile({ pid: 4242, userDataDir: path.join(tmpRoot, 'sutradhar-cli-1790000000000-AAA'), tempProfile: true }, h.deps);
    expect(h.killCalls).toEqual([[4242, KILL_CAP_MS]]);
    expect(first(h.calls).pid).toBe(4242);
    const h2 = harness();
    await discardSpawnedProfile({ pid: 4242, userDataDir: path.join(tmpRoot, 'named-profile'), tempProfile: false }, h2.deps);
    expect(h2.killCalls).toEqual([[4242, KILL_CAP_MS]]);
    expect(h2.calls).toEqual([]);
  });

  it('never throws: a throwing kill and a rejecting removeProfile are both contained, and the removal still runs after a failed kill', async () => {
    const calls: Array<number | undefined> = [];
    await expect(
      discardSpawnedProfile(
        { pid: 4242, userDataDir: path.join(tmpRoot, 'sutradhar-cli-1790000000000-BBB'), tempProfile: true },
        {
          kill: async () => {
            throw new Error('kill boom');
          },
          removeProfile: async (_d, pid) => {
            calls.push(pid);
            throw new Error('remove boom');
          },
        },
      ),
    ).resolves.toBeUndefined();
    expect(calls).toEqual([4242]);
  });
});
