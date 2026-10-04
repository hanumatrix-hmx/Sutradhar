/**
 * @file packages/cli/tests/unit/close-session.spec.ts
 * @description S6b (0.6.1): the ORDER of `close` / self-heal for a Chrome this CLI spawned:
 *   kill (awaited, 0.6.0 semantics) -> clear the recorded state -> bounded temp-profile cleanup.
 * Clearing the state BEFORE the (slow, interruptible) cleanup means a recorded chromePid can never
 * outlive its kill, so no later command can `taskkill /T /F` a PID that something else now holds.
 * Fake deps and an in-memory state store; `cli.ts` runs main() on import, so its wiring is checked
 * by reading the source (same idea as the GAP-356 guard).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KILL_CAP_MS, stopSpawnedChrome, type StopDeps } from '../../src/close-session.js';
import type { CliState } from '../../src/state.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const cliSource = fs.readFileSync(path.join(here, '..', '..', 'src', 'cli.ts'), 'utf8').replace(/\r\n/g, '\n');
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type Rec = Record<string, unknown>;

function harness(initial: Rec | undefined, over: Partial<StopDeps> = {}) {
  const events: string[] = [];
  const killCalls: Array<[number, number]> = [];
  const cleanupCalls: Array<{ target: unknown; pid: number | undefined; deadlineAt: number; storeAtCall: Rec | undefined }> = [];
  const warnings: string[] = [];
  const debug: string[] = [];
  const h = {
    store: initial === undefined ? undefined : ({ ...initial } as Rec | undefined),
    events,
    killCalls,
    cleanupCalls,
    warnings,
    debug,
    deps: undefined as unknown as StopDeps,
    readState: () => h.store as unknown as CliState,
  };
  h.deps = {
    kill: async (pid, cap) => {
      events.push('kill-start');
      killCalls.push([pid, cap]);
      await sleep(5);
      events.push('kill-end');
    },
    clearState: async () => {
      events.push('clearState');
      h.store = undefined;
    },
    cleanup: async (target, pid, deadlineAt) => {
      events.push('cleanup');
      cleanupCalls.push({ target, pid, deadlineAt, storeAtCall: h.store });
    },
    now: () => performance.now(),
    debug: (l) => debug.push(l),
    warn: (m) => warnings.push(m),
    ...over,
  };
  return h;
}

const SPAWNED: Rec = { sessionId: 's', wsEndpoint: 'ws://x', chromePid: 4242, userDataDir: 'E:\\t\\sutradhar-cli-1790000000001-AbC', tempProfile: true };

describe('stopSpawnedChrome (close/recovery order)', () => {
  it('O1: normal close runs kill -> clearState -> cleanup, and cleanup sees NO chromePid in the store', async () => {
    const h = harness(SPAWNED);
    await stopSpawnedChrome(h.readState(), h.deps);
    expect(h.events).toEqual(['kill-start', 'kill-end', 'clearState', 'cleanup']);
    expect(h.killCalls).toEqual([[4242, KILL_CAP_MS]]);
    expect(h.cleanupCalls).toHaveLength(1);
    expect(h.cleanupCalls[0]!.storeAtCall?.chromePid).toBeUndefined();
    expect(h.cleanupCalls[0]!.pid).toBe(4242); // used only for the read-only exit wait
    expect(h.cleanupCalls[0]!.target).toEqual({ userDataDir: SPAWNED.userDataDir, tempProfile: true });
    expect(h.debug.some((l) => /^\[cleanup\] phase kill ms=\d+/.test(l))).toBe(true);
    expect(h.debug).toContain('[cleanup] state-cleared');
  });

  it('O2: an interrupted (never-settling) cleanup leaves the state already cleared; a second stop makes 0 kill calls', async () => {
    const h = harness(SPAWNED, {
      cleanup: async () => {
        h.events.push('cleanup');
        await new Promise<never>(() => {});
      },
    });
    const first = stopSpawnedChrome(h.readState(), h.deps);
    await Promise.race([first, sleep(200)]); // "Ctrl-C" at 200 ms: the cleanup never settles
    expect(h.store).toBeUndefined();
    const before = h.killCalls.length;
    await stopSpawnedChrome((h.store ?? {}) as unknown as CliState, h.deps); // a later command re-reads the (empty) state
    expect(h.killCalls.length).toBe(before);
    expect(h.killCalls).toHaveLength(1);
  });

  it('O3: a rejecting cleanup is a warning, never a throw; kill ran once; state is cleared', async () => {
    const h = harness(SPAWNED, {
      cleanup: async () => {
        h.events.push('cleanup');
        throw new Error('rm exploded');
      },
    });
    await expect(stopSpawnedChrome(h.readState(), h.deps)).resolves.toBeUndefined();
    expect(h.warnings).toHaveLength(1);
    expect(h.warnings[0]).toContain('rm exploded');
    expect(h.killCalls).toHaveLength(1);
    expect(h.store).toBeUndefined();
  });

  it('O4: a slow kill (resolves only at its cap) still gets the state cleared and the cleanup run, after kill-end', async () => {
    const h = harness(SPAWNED, {
      kill: async (pid, cap) => {
        h.events.push('kill-start');
        h.killCalls.push([pid, cap]);
        await sleep(150); // stands in for "resolved only because the cap fired"
        h.events.push('kill-end');
      },
    });
    await stopSpawnedChrome(h.readState(), h.deps);
    expect(h.killCalls[0]![1]).toBe(KILL_CAP_MS);
    expect(h.events).toEqual(['kill-start', 'kill-end', 'clearState', 'cleanup']);
  });

  it('O5: an attached session (no chromePid) makes 0 kill calls, clears the state, and runs no cleanup without tempProfile', async () => {
    const h = harness({ sessionId: 's', wsEndpoint: 'ws://x', tempProfile: false });
    await stopSpawnedChrome(h.readState(), h.deps);
    expect(h.killCalls).toHaveLength(0);
    expect(h.events).toEqual(['clearState']);
    expect(h.store).toBeUndefined();
  });

  it('O6: cli.ts wiring (source guard): exactly 2 `await stopSpawnedChrome(` calls, kill by reference, monotonic now', () => {
    expect(cliSource.split('await stopSpawnedChrome(').length - 1).toBe(2);
    expect(cliSource).toContain('kill: killChromeTree');
    expect(cliSource).toContain('now: () => performance.now()');
    expect(cliSource).not.toMatch(/now:\s*(\(\)\s*=>\s*)?Date\.now/);
    // the 3 tripwires S6c converts later: killChromeTree( is only ever called through the dep, never fire-and-forget
    expect(cliSource).not.toMatch(/void\s+(killChromeTree|stopSpawnedChrome)\(/);
  });

  it('O7: a state record written during the cleanup (a concurrent `nav` from the same cwd) survives', async () => {
    const h = harness(SPAWNED, {
      cleanup: async () => {
        h.events.push('cleanup');
        h.store = { sessionId: 'new', chromePid: 999 };
      },
    });
    await stopSpawnedChrome(h.readState(), h.deps);
    expect(h.store).toEqual({ sessionId: 'new', chromePid: 999 });
    expect(h.events.filter((e) => e === 'clearState')).toHaveLength(1);
  });

  describe('O7 source guard: cmdClose clears the state exactly where the plan says', () => {
    const body = extractBlock(cliSource, cliSource.indexOf('async function cmdClose('));
    it('located the real cmdClose body (ends with the Session closed message)', () => {
      expect(body.endsWith("console.log('Session closed.');\n}")).toBe(true);
    });
    it('(a) no clearState( between `await stopSpawnedChrome(` and the end of the enclosing `if (state.chromePid)` block', () => {
      const call = body.indexOf('await stopSpawnedChrome(');
      expect(call).toBeGreaterThan(-1);
      const ifStart = body.lastIndexOf('if (state.chromePid) {', call);
      expect(ifStart).toBeGreaterThan(-1);
      const ifBlock = extractBlock(body, ifStart);
      const fromCall = ifBlock.slice(ifBlock.indexOf('await stopSpawnedChrome('));
      expect(fromCall).not.toContain('clearState(');
    });
    it('(b) exactly one clearState( in cmdClose, inside the else of `if (state.chromePid)` and OUTSIDE `if (!closeBlocked) {...}`', () => {
      expect(body.split('clearState(').length - 1).toBe(1);
      const ifStart = body.indexOf('if (state.chromePid) {');
      const ifBlock = extractBlock(body, ifStart);
      const endOfIf = body.indexOf('{', ifStart) + ifBlock.length;
      const elseIdx = body.indexOf('else {', endOfIf - 1);
      expect(elseIdx).toBeGreaterThan(-1);
      expect(body.slice(endOfIf, elseIdx).trim()).toBe(''); // the else belongs to THIS if
      const elseBlock = extractBlock(body, elseIdx);
      const cb = elseBlock.indexOf('if (!closeBlocked) {');
      expect(cb).toBeGreaterThan(-1);
      const cbBlock = extractBlock(elseBlock, cb);
      const clearAt = elseBlock.indexOf('clearState(');
      // `cb` is the index of the `if` keyword, NOT of the block's `{` (19 characters later), and
      // `cbBlock` starts at that `{`. Measure the block's closing `}` from the `{` itself; measured
      // from `cb` it lands 19 characters early and a clear placed as the LAST statement of the
      // block would be wrongly accepted (S8 F-S8-1).
      const cbOpen = elseBlock.indexOf('{', cb);
      const cbClose = cbOpen + cbBlock.length - 1;
      expect(elseBlock[cbClose]).toBe('}');
      expect(clearAt).toBeGreaterThan(cbClose);
    });
  });

  it('O8: with the real default clock, the cleanup deadline is ~15 s ahead on the performance.now() scale', async () => {
    let remaining = 0;
    const h = harness(SPAWNED, {
      now: undefined,
      cleanup: async (_t, _p, deadlineAt) => {
        remaining = deadlineAt - performance.now();
      },
    });
    await stopSpawnedChrome(h.readState(), h.deps);
    expect(remaining).toBeGreaterThan(14_000);
    expect(remaining).toBeLessThanOrEqual(15_001);
  });

  it('O9: a malformed userDataDir is not passed to the cleanup, but a valid chromePid is still killed once and the state cleared', async () => {
    const h = harness({ chromePid: 4242, userDataDir: 123, tempProfile: true });
    await expect(stopSpawnedChrome(h.readState(), h.deps)).resolves.toBeUndefined();
    expect(h.killCalls).toHaveLength(1);
    expect(h.cleanupCalls).toHaveLength(0);
    expect(h.store).toBeUndefined();
  });

  it('O10: a malformed chromePid is never killed (never reaches taskkill); state cleared; resolves', async () => {
    const h = harness({ chromePid: '12' });
    await expect(stopSpawnedChrome(h.readState(), h.deps)).resolves.toBeUndefined();
    expect(h.killCalls).toHaveLength(0);
    expect(h.store).toBeUndefined();
    expect(h.debug.some((l) => l.includes('skip'))).toBe(true);
    for (const bad of [0, -5, 1.5, NaN, null]) {
      const g = harness({ chromePid: bad as unknown as number });
      await stopSpawnedChrome(g.readState(), g.deps);
      expect(g.killCalls).toHaveLength(0);
    }
  });

  it('a failing kill or clearState never throws (never-throws contract) and later steps still run', async () => {
    const k = harness(SPAWNED, {
      kill: async () => {
        throw new Error('kill blew up');
      },
    });
    await expect(stopSpawnedChrome(k.readState(), k.deps)).resolves.toBeUndefined();
    expect(k.events).toEqual(['clearState', 'cleanup']);
    const c = harness(SPAWNED, {
      clearState: async () => {
        throw new Error('disk full');
      },
    });
    await expect(stopSpawnedChrome(c.readState(), c.deps)).resolves.toBeUndefined();
    expect(c.warnings.some((w) => w.includes('disk full'))).toBe(true);
    expect(c.events).toContain('cleanup');
  });
});

/** Text of the `{ ... }` block that starts at the first `{` at or after `from` (braces inside
 *  strings, template literals and comments are skipped), including both braces. */
function extractBlock(src: string, from: number): string {
  const open = src.indexOf('{', from);
  if (from < 0 || open < 0) throw new Error('block start not found');
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i]!;
    const n = src[i + 1];
    if (c === '/' && n === '/') {
      i = src.indexOf('\n', i);
      if (i < 0) break;
    } else if (c === '/' && n === '*') {
      i = src.indexOf('*/', i + 2) + 1;
    } else if (c === "'" || c === '"' || c === '`') {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++;
    } else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return src.slice(open, i + 1);
  }
  throw new Error('unbalanced block');
}
