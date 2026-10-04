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

  it('a failing kill never throws (N2) and the later steps still run; the kill error is debug-only', async () => {
    const k = harness(SPAWNED, {
      kill: async () => {
        throw new Error('kill blew up');
      },
    });
    await expect(stopSpawnedChrome(k.readState(), k.deps)).resolves.toBeUndefined();
    expect(k.events).toEqual(['clearState', 'cleanup']);
    expect(k.warnings).toHaveLength(0);
    expect(k.debug.some((l) => l.startsWith('[cleanup] kill-error'))).toBe(true);
  });

  // S6g (F-S8-2): 0.6.0 ended `close` and self-heal with an UNGUARDED `await clearState()`, so a failing
  // clear rejected, `close` exited 1 without "Session closed.", and self-heal failed the command. The only
  // thing that may throw out of stopSpawnedChrome is that clearState failure, and only AFTER the bounded
  // cleanup ran (Chrome is already killed, so removing its dir is safe).
  describe('S6g: a failing clearState is rethrown (0.6.0 failure semantics), after the cleanup', () => {
    const diskFull = () => Object.assign(new Error('EBUSY: resource busy or locked, unlink state.json'), { code: 'EBUSY' });
    const failingClear = (err: Error, h: { events: string[] }) => async () => {
      h.events.push('clearState');
      throw err;
    };
    const settle = (p: Promise<void>): Promise<{ resolved: true } | { rejected: unknown }> =>
      p.then(
        () => ({ resolved: true as const }),
        (e: unknown) => ({ rejected: e }),
      );

    it('G6g-1 (AC1): clearState rejects -> the cleanup still runs with the same args -> rejects with the SAME error object, no extra warning', async () => {
      const err = diskFull();
      const h = harness(SPAWNED);
      h.deps.clearState = failingClear(err, h);
      const tStart = performance.now();
      const r = await settle(stopSpawnedChrome(h.readState(), h.deps));
      const tEnd = performance.now();
      expect(r).toHaveProperty('rejected');
      expect((r as { rejected: unknown }).rejected).toBe(err); // identity: not wrapped, not a copy
      expect(h.events).toEqual(['kill-start', 'kill-end', 'clearState', 'cleanup']);
      expect(h.cleanupCalls).toHaveLength(1);
      expect(h.cleanupCalls[0]!.target).toEqual({ userDataDir: SPAWNED.userDataDir, tempProfile: true });
      expect(h.cleanupCalls[0]!.pid).toBe(4242);
      // the 15 s overall deadline still applies: deadlineAt = now() at the call + 15 s, on the performance.now() scale
      expect(h.cleanupCalls[0]!.deadlineAt).toBeGreaterThanOrEqual(tStart + 15_000);
      expect(h.cleanupCalls[0]!.deadlineAt).toBeLessThanOrEqual(tEnd + 15_000);
      expect(h.warnings.filter((w) => w.includes('could not clear the session state'))).toHaveLength(0);
      expect(h.warnings).toHaveLength(0); // "no extra warning line": the caller's error path prints it, as 0.6.0 did
      expect(h.debug).not.toContain('[cleanup] state-cleared');
    });

    it('G6g-1b: the rethrow happens only AFTER the (slow) cleanup has finished', async () => {
      const err = diskFull();
      const h = harness(SPAWNED, {
        cleanup: async () => {
          h.events.push('cleanup-start');
          await sleep(60);
          h.events.push('cleanup-end');
        },
      });
      h.deps.clearState = failingClear(err, h);
      let rejectedAfter: string[] | undefined;
      await stopSpawnedChrome(h.readState(), h.deps).catch(() => {
        rejectedAfter = [...h.events]; // what had happened by the time the caller saw the rejection
      });
      expect(rejectedAfter).toEqual(['kill-start', 'kill-end', 'clearState', 'cleanup-start', 'cleanup-end']);
    });

    it('G6g-2 (AC2): clearState resolves -> nothing is thrown (the O1-O10 order is unchanged)', async () => {
      const h = harness(SPAWNED);
      await expect(stopSpawnedChrome(h.readState(), h.deps)).resolves.toBeUndefined();
      expect(h.events).toEqual(['kill-start', 'kill-end', 'clearState', 'cleanup']);
      expect(h.warnings).toHaveLength(0);
    });

    it('G6g-3 (F7-i): clearState AND cleanup reject -> rejects with the clearState error, exactly one cleanup warning', async () => {
      const err = diskFull();
      const h = harness(SPAWNED, {
        cleanup: async () => {
          h.events.push('cleanup');
          throw new Error('rm exploded');
        },
      });
      h.deps.clearState = failingClear(err, h);
      const r = await settle(stopSpawnedChrome(h.readState(), h.deps));
      expect((r as { rejected: unknown }).rejected).toBe(err);
      expect(h.warnings).toHaveLength(1);
      expect(h.warnings[0]).toContain('rm exploded');
      expect(h.warnings[0]).toContain('temp profile cleanup failed');
      expect(h.events).toEqual(['kill-start', 'kill-end', 'clearState', 'cleanup']);
    });

    it('G6g-4 (F7-ii): clearState rejects with tempProfile false or absent -> rejects, the cleanup is not called', async () => {
      for (const rec of [{ ...SPAWNED, tempProfile: false }, { chromePid: 4242, userDataDir: 'E:\\t\\sutradhar-cli-1790000000001-AbC' }]) {
        const err = diskFull();
        const h = harness(rec);
        h.deps.clearState = failingClear(err, h);
        const r = await settle(stopSpawnedChrome(h.readState(), h.deps));
        expect((r as { rejected: unknown }).rejected).toBe(err);
        expect(h.cleanupCalls).toHaveLength(0);
        expect(h.events).toEqual(['kill-start', 'kill-end', 'clearState']);
      }
      // an attached session (no chromePid at all) that cannot clear its state also rejects
      const err = diskFull();
      const a = harness({ sessionId: 's', wsEndpoint: 'ws://x', tempProfile: false });
      a.deps.clearState = failingClear(err, a);
      expect(((await settle(stopSpawnedChrome(a.readState(), a.deps))) as { rejected: unknown }).rejected).toBe(err);
      expect(a.killCalls).toHaveLength(0);
    });

    it('G6g-5 (F7-iii): clearState AND kill reject -> rejects with the clearState error; the kill error is debug-only', async () => {
      const err = diskFull();
      const h = harness(SPAWNED, {
        kill: async () => {
          throw new Error('kill blew up');
        },
      });
      h.deps.clearState = failingClear(err, h);
      const r = await settle(stopSpawnedChrome(h.readState(), h.deps));
      expect((r as { rejected: unknown }).rejected).toBe(err);
      expect(h.warnings).toHaveLength(0);
      expect(h.debug.some((l) => l.startsWith('[cleanup] kill-error') && l.includes('kill blew up'))).toBe(true);
      expect(h.events).toEqual(['clearState', 'cleanup']);
    });

    it('G6g-6: a non-Error rejection value is rethrown unchanged too', async () => {
      const h = harness(SPAWNED);
      const weird = { code: 'EPERM' };
      h.deps.clearState = async () => {
        h.events.push('clearState');
        throw weird;
      };
      const r = await settle(stopSpawnedChrome(h.readState(), h.deps));
      expect((r as { rejected: unknown }).rejected).toBe(weird);
      expect(h.cleanupCalls).toHaveLength(1);
    });
  });

  // F2: the call sites must NOT swallow that rejection. O6 only counts `await stopSpawnedChrome(`, which a
  // `.catch(() => {})` or a try/catch around the call would leave intact.
  describe('O6b source guard: neither `await stopSpawnedChrome(` call site swallows the rejection', () => {
    const selfHealBody = extractBlock(cliSource, cliSource.indexOf('selfHeal: async'));
    const closeBody = extractBlock(cliSource, cliSource.indexOf('async function cmdClose('));
    const CALL = 'await stopSpawnedChrome(';

    it('located both real bodies', () => {
      expect(selfHealBody).toContain(CALL);
      expect(selfHealBody.startsWith('{')).toBe(true);
      expect(closeBody).toContain(CALL);
      expect(closeBody.endsWith("console.log('Session closed.');\n}")).toBe(true);
    });
    it('self-heal: the call is not followed by .catch/.then and not inside a try block', () => {
      expect(swallowedAtCallSite(selfHealBody, CALL)).toEqual([]);
    });
    it('cmdClose: the call is not followed by .catch/.then and not inside a try block', () => {
      expect(swallowedAtCallSite(closeBody, CALL)).toEqual([]);
      // F2: also the `if (state.chromePid) {` block on its own
      const ifBlock = extractBlock(closeBody, closeBody.indexOf('if (state.chromePid) {'));
      expect(ifBlock).toContain(CALL);
      expect(swallowedAtCallSite(ifBlock, CALL)).toEqual([]);
    });
    it('the detector itself flags every swallowing form (positive controls) and passes the plain call', () => {
      const plain = 'async function f() {\n  await stopSpawnedChrome(state, deps);\n  return 1;\n}';
      expect(swallowedAtCallSite(plain, CALL)).toEqual([]);
      const dotCatch = plain.replace('deps);', 'deps).catch(() => {});');
      expect(swallowedAtCallSite(dotCatch, CALL)).toEqual(['followed-by-.catch/.then']);
      const dotThen = plain.replace('deps);', 'deps)\n    .then(() => 0, () => 1);');
      expect(swallowedAtCallSite(dotThen, CALL)).toEqual(['followed-by-.catch/.then']);
      const tried = 'async function f() {\n  try {\n    await stopSpawnedChrome(state, deps);\n  } catch {}\n}';
      expect(swallowedAtCallSite(tried, CALL)).toEqual(['inside-try']);
      const triedFinally = 'async function f() {\n  try {\n    log();\n    await stopSpawnedChrome(state, deps);\n  } finally {\n    x();\n  }\n}';
      expect(swallowedAtCallSite(triedFinally, CALL)).toEqual(['inside-try']);
      const nested = 'async function f() {\n  try {\n    g();\n  } catch {}\n  if (a) {\n    await stopSpawnedChrome(state, deps);\n  }\n}'; // a try ELSEWHERE is fine
      expect(swallowedAtCallSite(nested, CALL)).toEqual([]);
    });
  });
});

/** Reasons the single `call` in `body` is swallowed at its call site (empty = not swallowed). */
function swallowedAtCallSite(body: string, call: string): string[] {
  const reasons: string[] = [];
  const at = body.indexOf(call);
  if (at < 0) throw new Error('call not found');
  if (body.indexOf(call, at + 1) >= 0) throw new Error('more than one call in this body');
  // end of the call expression: match the parentheses that open at `call`'s last character
  let depth = 0;
  let end = -1;
  for (let i = at + call.length - 1; i < body.length; i++) {
    if (body[i] === '(') depth++;
    else if (body[i] === ')' && --depth === 0) {
      end = i + 1;
      break;
    }
  }
  if (end < 0) throw new Error('unbalanced call');
  if (/^\s*\.(catch|then)\s*\(/.test(body.slice(end))) reasons.push('followed-by-.catch/.then');
  for (let t = body.indexOf('try {'); t >= 0; t = body.indexOf('try {', t + 1)) {
    const block = extractBlock(body, t);
    const open = body.indexOf('{', t);
    if (at > open && at < open + block.length) {
      reasons.push('inside-try');
      break;
    }
  }
  return reasons;
}

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
