/**
 * @file packages/cli/tests/unit/temp-profile.spec.ts
 * @description GAP-315: the deletion safety rules for the CLI's auto-created Chrome temp
 * profiles (`decideRemoval` and its helpers), plus the close/sweep paths against a real scratch
 * temp root with injected process scans.
 */
import { mkdir, mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  CLOSE_CLEANUP_DEADLINE_MS,
  commandLinesReference,
  createTempProfileDir,
  decideRemoval,
  EXIT_WAIT_CAP_MS,
  isAutoTempProfileDir,
  MIN_RM_START_MS,
  OWNER_MARKER,
  readOwnerPid,
  removeSessionTempProfile,
  SCAN_TIMEOUT_MS,
  STALE_MIN_AGE_MS,
  SWEEP_BUDGET_MS,
  SWEEP_PER_DIR_RETRY_MS,
  sweepStaleTempProfiles,
  waitForPidExit,
  writeOwnerMarker,
  type RemovalFacts,
} from '../../src/temp-profile.js';

const ROOT = path.resolve(os.tmpdir(), 'root-for-rules');
const DIR = path.join(ROOT, 'sutradhar-cli-1790798002107-AbC123');

function facts(over: Partial<RemovalFacts> = {}): RemovalFacts {
  return { dir: DIR, tmpRoot: ROOT, commandLines: [], ownerAlive: false, ageMs: STALE_MIN_AGE_MS + 1, minAgeMs: STALE_MIN_AGE_MS, ...over };
}

const exists = (p: string) => stat(p).then(() => true, () => false);

describe('isAutoTempProfileDir (rule 1)', () => {
  it('accepts legacy and mkdtemp-suffixed names directly in the temp root', () => {
    expect(isAutoTempProfileDir(path.join(ROOT, 'sutradhar-cli-1790798002107'), ROOT)).toBe(true);
    expect(isAutoTempProfileDir(DIR, ROOT)).toBe(true);
  });
  it('rejects named profiles, nested dirs, other roots and look-alikes', () => {
    expect(isAutoTempProfileDir(path.join(os.homedir(), '.sutradhar', 'profiles', 'work'), ROOT)).toBe(false);
    expect(isAutoTempProfileDir(path.join(ROOT, 'work'), ROOT)).toBe(false);
    expect(isAutoTempProfileDir(path.join(ROOT, 'nested', 'sutradhar-cli-1790798002107'), ROOT)).toBe(false);
    expect(isAutoTempProfileDir(path.join(ROOT + '-other', 'sutradhar-cli-1790798002107'), ROOT)).toBe(false);
    expect(isAutoTempProfileDir(path.join(ROOT, 'sutradhar-cli-'), ROOT)).toBe(false);
    expect(isAutoTempProfileDir(path.join(ROOT, 'sutradhar-cli-abc'), ROOT)).toBe(false);
    expect(isAutoTempProfileDir(path.join(ROOT, 'sutradhar-cli-1790798002107-x', '..', '..'), ROOT)).toBe(false);
    expect(isAutoTempProfileDir(ROOT, ROOT)).toBe(false);
  });
});

describe('commandLinesReference (rule 2 matcher)', () => {
  it('matches the basename as a whole token, case-insensitively, whatever the path form', () => {
    expect(commandLinesReference(DIR, ['chrome.exe --user-data-dir=C:\\TEMP\\SUTRADHAR-CLI-1790798002107-AbC123 --type=renderer'])).toBe(true);
    expect(commandLinesReference(DIR, ['chrome --user-data-dir="/tmp/sutradhar-cli-1790798002107-AbC123"'])).toBe(true);
  });
  it('does not match a longer name that merely starts with it', () => {
    const legacy = path.join(ROOT, 'sutradhar-cli-1790798002107');
    expect(commandLinesReference(legacy, ['chrome --user-data-dir=E:\\tmp\\sutradhar-cli-1790798002107-AbC123'])).toBe(false);
    expect(commandLinesReference(legacy, ['chrome --user-data-dir=E:\\tmp\\sutradhar-cli-17907980021079'])).toBe(false);
    expect(commandLinesReference(legacy, ['x sutradhar-cli-17907980021079 y --user-data-dir=E:\\tmp\\sutradhar-cli-1790798002107'])).toBe(true);
  });
});

describe('decideRemoval', () => {
  it('removes only when every rule holds', () => {
    expect(decideRemoval(facts())).toEqual({ remove: true });
  });
  it('keeps a named/non-temp dir even when everything else says remove', () => {
    expect(decideRemoval(facts({ dir: path.join(ROOT, 'my-profile') }))).toEqual({ remove: false, reason: 'not-auto-temp' });
  });
  it('fails closed when the process scan failed', () => {
    expect(decideRemoval(facts({ commandLines: null }))).toEqual({ remove: false, reason: 'scan-unavailable' });
  });
  it('keeps a dir a running process has on its command line, even if the owner PID is dead and it is old', () => {
    expect(decideRemoval(facts({ commandLines: [`chrome --user-data-dir=${DIR}`], ageMs: 1e9 }))).toEqual({ remove: false, reason: 'in-use' });
  });
  it('keeps a dir whose owning Chrome PID is alive', () => {
    expect(decideRemoval(facts({ ownerPid: 123, ownerAlive: true }))).toEqual({ remove: false, reason: 'owner-alive' });
  });
  it('keeps a dir younger than the threshold', () => {
    expect(decideRemoval(facts({ ageMs: STALE_MIN_AGE_MS - 1 }))).toEqual({ remove: false, reason: 'too-young' });
    expect(decideRemoval(facts({ ageMs: 0, minAgeMs: 0 }))).toEqual({ remove: true });
    expect(decideRemoval(facts({ ageMs: -5, minAgeMs: 0 }))).toEqual({ remove: true });
  });
});

describe('waitForPidExit', () => {
  it('returns false at the hard timeout for a PID that never exits', async () => {
    const t0 = performance.now();
    expect(await waitForPidExit(1, 300, () => true)).toBe(false);
    expect(performance.now() - t0).toBeLessThan(5_000);
  });
  it('returns true once the PID is gone', async () => {
    let n = 0;
    expect(await waitForPidExit(1, 5_000, () => ++n < 3)).toBe(true);
  });
});

describe('filesystem paths (scratch temp root)', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'gap315-spec-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function oldDir(name: string): Promise<string> {
    const d = path.join(root, name);
    await mkdir(path.join(d, 'Default'), { recursive: true });
    await writeFile(path.join(d, 'Default', 'Preferences'), '{}');
    const past = new Date(Date.now() - 2 * STALE_MIN_AGE_MS);
    await utimes(d, past, past);
    return d;
  }

  it('createTempProfileDir makes unique, rule-1-matching dirs; the marker round-trips', async () => {
    const a = await createTempProfileDir(root);
    const b = await createTempProfileDir(root);
    expect(a).not.toBe(b);
    expect(isAutoTempProfileDir(a, root)).toBe(true);
    await writeOwnerMarker(a, 4242);
    expect(await readOwnerPid(a)).toBe(4242);
  });

  it('sweep removes only stale, unreferenced, dead-owner temp dirs', async () => {
    const stale = await oldDir('sutradhar-cli-1790000000001');
    const inUse = await oldDir('sutradhar-cli-1790000000002');
    const liveOwner = await oldDir('sutradhar-cli-1790000000003-Zz9');
    await writeFile(path.join(liveOwner, OWNER_MARKER), JSON.stringify({ chromePid: process.pid }));
    const young = path.join(root, 'sutradhar-cli-1790000000004');
    await mkdir(young);
    const named = await oldDir('work-profile');
    const scan = async () => [`chrome.exe --user-data-dir=${inUse} --type=gpu-process`];

    const res = await sweepStaleTempProfiles({ tmpRoot: root, scan });

    expect(res.removed).toEqual([stale]);
    expect(Object.fromEntries(res.kept.map((k) => [path.basename(k.dir), k.reason]))).toEqual({
      'sutradhar-cli-1790000000002': 'in-use',
      'sutradhar-cli-1790000000003-Zz9': 'owner-alive',
      'sutradhar-cli-1790000000004': 'too-young',
    });
    expect(await exists(stale)).toBe(false);
    for (const d of [inUse, liveOwner, young, named]) expect(await exists(d)).toBe(true);
  });

  it('sweep deletes nothing when the process scan fails', async () => {
    const stale = await oldDir('sutradhar-cli-1790000000001');
    const res = await sweepStaleTempProfiles({ tmpRoot: root, scan: async () => null });
    expect(res.removed).toEqual([]);
    expect(await exists(stale)).toBe(true);
  });

  it('close removes its own fresh temp dir (no age threshold) once the owner is gone', async () => {
    const d = await createTempProfileDir(root);
    await writeFile(path.join(d, 'lockfile'), '');
    const res = await removeSessionTempProfile(d, undefined, { tmpRoot: root, scan: async () => [] });
    expect(res).toEqual({ removed: true });
    expect(await exists(d)).toBe(false);
  });

  it('close never removes a dir still referenced by a running process', async () => {
    const d = await createTempProfileDir(root);
    const res = await removeSessionTempProfile(d, undefined, { tmpRoot: root, scan: async () => [`chrome --user-data-dir=${d}`] });
    expect(res).toEqual({ removed: false, reason: 'in-use' });
    expect(await exists(d)).toBe(true);
  });

  it('close never removes a named profile dir', async () => {
    const d = await oldDir('work-profile');
    const res = await removeSessionTempProfile(d, undefined, { tmpRoot: root, scan: async () => [] });
    expect(res).toEqual({ removed: false, reason: 'not-auto-temp' });
    expect(await exists(d)).toBe(true);
  });

  it('close keeps the dir if Chrome does not exit within the timeout', async () => {
    const d = await createTempProfileDir(root);
    const res = await removeSessionTempProfile(d, process.pid, { tmpRoot: root, exitTimeoutMs: 200, scan: async () => [] });
    expect(res.removed).toBe(false);
    expect(res.reason).toMatch(/did not exit in time/);
    expect(await exists(d)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// S6a (0.6.1): ONE cleanup deadline, the debug seam, the isAlive seam. Fake scans and fake rmFn;
// every duration is measured with performance.now() only.
// ---------------------------------------------------------------------------------------------
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('S6a: bounded cleanup (fake scan / fake rm, monotonic clock)', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'gap315-s6a-'));
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  });

  async function staleDir(name: string): Promise<string> {
    const d = path.join(root, name);
    await mkdir(path.join(d, 'Default'), { recursive: true });
    await writeFile(path.join(d, 'Default', 'Preferences'), '{}');
    const past = new Date(Date.now() - 2 * STALE_MIN_AGE_MS);
    await utimes(d, past, past);
    return d;
  }

  it('exports the seven constants with the planned values', () => {
    expect(STALE_MIN_AGE_MS).toBe(600_000);
    expect(CLOSE_CLEANUP_DEADLINE_MS).toBe(15_000);
    expect(SCAN_TIMEOUT_MS).toBe(8_000);
    expect(SWEEP_BUDGET_MS).toBe(15_000);
    expect(EXIT_WAIT_CAP_MS).toBe(10_000);
    expect(MIN_RM_START_MS).toBe(1_000);
    expect(SWEEP_PER_DIR_RETRY_MS).toBe(1_000);
  });

  it('T1: a scan that only returns at its own timeout is clamped to the remaining deadline', async () => {
    const d = await createTempProfileDir(root);
    const timeouts: Array<number | undefined> = [];
    const scan = ((t?: number) => {
      timeouts.push(t);
      return new Promise<null>((resolve) => setTimeout(() => resolve(null), t ?? 20_000));
    }) as typeof import('../../src/temp-profile.js').scanCommandLines;
    const t0 = performance.now();
    const res = await removeSessionTempProfile(d, undefined, { tmpRoot: root, scan, deadlineMs: 1500 });
    const took = performance.now() - t0;
    expect(took).toBeLessThanOrEqual(2500);
    expect(await exists(d)).toBe(true);
    expect(res.removed).toBe(false);
    expect(['deadline', 'scan-unavailable']).toContain(res.reason);
    expect(timeouts).toHaveLength(1);
    expect(timeouts[0]).toBeLessThanOrEqual(1500);
  });

  it('T2: an owner that never exits is only ever probed with signal 0, never killed, and the deadline ends the wait', async () => {
    const d = await createTempProfileDir(root);
    const signals: unknown[] = [];
    vi.spyOn(process, 'kill').mockImplementation(((_pid: number, sig?: string | number) => {
      signals.push(sig);
      return true;
    }) as typeof process.kill);
    const t0 = performance.now();
    const res = await removeSessionTempProfile(d, process.pid, { tmpRoot: root, scan: async () => [], deadlineMs: 1000 });
    const took = performance.now() - t0;
    vi.restoreAllMocks();
    expect(res.removed).toBe(false);
    expect(res.reason).toBe('deadline');
    expect(took).toBeLessThanOrEqual(2000);
    expect(signals.length).toBeGreaterThan(0);
    expect(signals.every((s) => s === 0)).toBe(true);
    expect(await exists(d)).toBe(true);
  });

  it('A.4: exitTimeoutMs / removeTimeoutMs stay as caps, clamped to the overall deadline', async () => {
    const d = await createTempProfileDir(root);
    const t0 = performance.now();
    // exit cap (5 s) is larger than the deadline (600 ms): the DEADLINE ends it, reason 'deadline'
    const clamped = await removeSessionTempProfile(d, process.pid, { tmpRoot: root, scan: async () => [], exitTimeoutMs: 5000, deadlineMs: 600 });
    expect(clamped).toEqual({ removed: false, reason: 'deadline' });
    expect(performance.now() - t0).toBeLessThan(3000);
    // exit cap (200 ms) is smaller than the deadline: the CAP ends it, reason keeps the old wording
    const capped = await removeSessionTempProfile(d, process.pid, { tmpRoot: root, scan: async () => [], exitTimeoutMs: 200, deadlineMs: 5000 });
    expect(capped.removed).toBe(false);
    expect(capped.reason).toBe(`Chrome (pid ${process.pid}) did not exit in time`);
    expect(await exists(d)).toBe(true);
  });

  it('T3: a slow scan eats the sweep budget, so NO dir is removed (deadline starts before the scan)', async () => {
    const dirs = [await staleDir('sutradhar-cli-1790000000001'), await staleDir('sutradhar-cli-1790000000002'), await staleDir('sutradhar-cli-1790000000003')];
    const scan = async () => {
      await sleep(1500);
      return [] as string[];
    };
    const res = await sweepStaleTempProfiles({ tmpRoot: root, budgetMs: 2000, scan });
    expect(res.removed).toHaveLength(0);
    for (const d of dirs) expect(await exists(d)).toBe(true);
  });

  it('T3b: the same sweep with enough budget removes all three', async () => {
    const dirs = [await staleDir('sutradhar-cli-1790000000001'), await staleDir('sutradhar-cli-1790000000002'), await staleDir('sutradhar-cli-1790000000003')];
    const scan = async () => {
      await sleep(800);
      return [] as string[];
    };
    const res = await sweepStaleTempProfiles({ tmpRoot: root, budgetMs: 5000, scan });
    expect(res.removed.sort()).toEqual([...dirs].sort());
    for (const d of dirs) expect(await exists(d)).toBe(false);
  });

  it('T4: the scan timeout passed by sweep and by close never exceeds the time remaining at the call', async () => {
    await staleDir('sutradhar-cli-1790000000001');
    const rec: Array<{ arg: number | undefined; rem: number }> = [];
    const mk = (deadlineAt: number) => (async (t?: number) => {
      rec.push({ arg: t, rem: deadlineAt - performance.now() });
      return [] as string[];
    }) as typeof import('../../src/temp-profile.js').scanCommandLines;
    const sweepDeadline = performance.now() + 3000;
    await sweepStaleTempProfiles({ tmpRoot: root, budgetMs: 3000, scan: mk(sweepDeadline) });
    const d = await createTempProfileDir(root);
    const closeDeadline = performance.now() + 3000;
    await removeSessionTempProfile(d, undefined, { tmpRoot: root, deadlineAt: closeDeadline, scan: mk(closeDeadline) });
    expect(rec).toHaveLength(2);
    for (const r of rec) {
      expect(typeof r.arg).toBe('number');
      expect(r.arg as number).toBeLessThanOrEqual(3000);
      expect(r.arg as number).toBeLessThanOrEqual(r.rem + 50); // 50 ms: scheduling slack between computing the arg and the fake measuring
    }
  });

  it('T5: no rm attempt starts with less than MIN_RM_START_MS left (absolute deadlineAt)', async () => {
    const d = await createTempProfileDir(root);
    const deadlineAt = performance.now() + 2000;
    const starts: number[] = [];
    const rmFn = (async () => {
      starts.push(deadlineAt - performance.now());
      await sleep(600);
      throw Object.assign(new Error('busy'), { code: 'EBUSY' });
    }) as unknown as typeof rm;
    const res = await removeSessionTempProfile(d, undefined, { tmpRoot: root, scan: async () => [], deadlineAt, rmFn });
    expect(res.removed).toBe(false);
    expect(starts.length).toBeGreaterThanOrEqual(1);
    for (const s of starts) expect(s).toBeGreaterThanOrEqual(975);
  });

  it('T8: a scan that fails (null) keeps the dir, for close and for sweep (fail closed)', async () => {
    const d = await createTempProfileDir(root);
    const res = await removeSessionTempProfile(d, undefined, { tmpRoot: root, scan: async () => null });
    expect(res).toEqual({ removed: false, reason: 'scan-unavailable' });
    expect(await exists(d)).toBe(true);
    const stale = await staleDir('sutradhar-cli-1790000000009');
    const sw = await sweepStaleTempProfiles({ tmpRoot: root, scan: async () => null });
    expect(sw.removed).toEqual([]);
    expect(sw.kept.find((k) => k.dir === stale)?.reason).toBe('scan-unavailable');
    expect(await exists(stale)).toBe(true);
  });

  it('isAlive seam: the injected probe drives BOTH the exit wait and the ownerAlive fact', async () => {
    const d = await createTempProfileDir(root);
    await writeFile(path.join(d, OWNER_MARKER), JSON.stringify({ chromePid: 4242, cliPid: 1, createdAt: new Date().toISOString() }));
    const probed: number[] = [];
    const alive = (pid: number) => {
      probed.push(pid);
      return true;
    };
    const kept = await removeSessionTempProfile(d, undefined, { tmpRoot: root, scan: async () => [], isAlive: alive });
    expect(kept).toEqual({ removed: false, reason: 'owner-alive' });
    expect(probed).toContain(4242);
    // chromePid given and "alive" for ~300 ms, then dead: the exit wait polls the seam, then the dir goes
    const t0 = performance.now();
    const dead = (pid: number) => {
      probed.push(pid);
      return performance.now() - t0 < 300;
    };
    const res = await removeSessionTempProfile(d, 4242, { tmpRoot: root, scan: async () => [], isAlive: dead });
    expect(res).toEqual({ removed: true });
    expect(await exists(d)).toBe(false);
  });
});

describe('S6a: debug seam (SUTRADHAR_CLI_DEBUG_CLEANUP=1)', () => {
  let root: string;
  let saved: string | undefined;
  beforeEach(async () => {
    saved = process.env.SUTRADHAR_CLI_DEBUG_CLEANUP;
    root = await mkdtemp(path.join(os.tmpdir(), 'gap315-dbg-'));
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    if (saved === undefined) delete process.env.SUTRADHAR_CLI_DEBUG_CLEANUP;
    else process.env.SUTRADHAR_CLI_DEBUG_CLEANUP = saved;
    await rm(root, { recursive: true, force: true });
  });

  function captureStderr(): string[] {
    const lines: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => {
      lines.push(String(chunk));
      return true;
    }) as typeof process.stderr.write);
    return lines;
  }

  it('T6: [cleanup] lines appear only with the env set; every path is written as path="<abs>"', async () => {
    delete process.env.SUTRADHAR_CLI_DEBUG_CLEANUP;
    const off = captureStderr();
    const d0 = await createTempProfileDir(root);
    await removeSessionTempProfile(d0, undefined, { tmpRoot: root, scan: async () => [] });
    await sweepStaleTempProfiles({ tmpRoot: root, scan: async () => [] });
    vi.restoreAllMocks();
    expect(off.filter((l) => l.includes('[cleanup]'))).toEqual([]);

    process.env.SUTRADHAR_CLI_DEBUG_CLEANUP = '1';
    const on = captureStderr();
    const d1 = await createTempProfileDir(root);
    const d2 = await createTempProfileDir(root);
    await removeSessionTempProfile(d1, undefined, { tmpRoot: root, scan: async () => [`chrome --user-data-dir=${d1}`] });
    await removeSessionTempProfile(d2, undefined, { tmpRoot: root, scan: async () => [] });
    await sweepStaleTempProfiles({ tmpRoot: root, scan: async () => [] });
    vi.restoreAllMocks();
    const cleanup = on.join('').split('\n').filter((l) => l.includes('[cleanup]'));
    expect(cleanup.length).toBeGreaterThan(0);
    const events = new Set(cleanup.map((l) => l.split(' ')[1]));
    for (const e of ['created', 'consider', 'decision', 'removed', 'kept', 'scan', 'phase']) expect(events).toContain(e);
    const withPath = cleanup.filter((l) => l.includes('path='));
    expect(withPath.length).toBeGreaterThan(0);
    for (const l of withPath) expect(l).toMatch(/path="[^"]+"/);
    for (const l of cleanup.filter((x) => / decision /.test(x))) expect(l).toMatch(/ path="[^"]+" .*reason=\S+|reason=\S+.* path="[^"]+"/);
    for (const l of withPath) expect(path.isAbsolute(/path="([^"]+)"/.exec(l)![1]!)).toBe(true);
    expect(cleanup.some((l) => /phase cleanup ms=\d+/.test(l))).toBe(true);
    expect(cleanup.some((l) => /phase sweep ms=\d+/.test(l))).toBe(true);
    expect(cleanup.some((l) => /rm-attempt .*n=1 .*remaining-ms=\d+/.test(l))).toBe(true);
  });

  it('T6b: the pure predicates never log, even with the debug env set', () => {
    process.env.SUTRADHAR_CLI_DEBUG_CLEANUP = '1';
    const writes = captureStderr();
    isAutoTempProfileDir(path.join(os.homedir(), '.sutradhar', 'profiles', 'work'), root);
    isAutoTempProfileDir(path.join(root, 'sutradhar-cli-1790798002107-AbC123'), root);
    commandLinesReference(path.join(root, 'sutradhar-cli-1790798002107-AbC123'), ['chrome --user-data-dir=x']);
    decideRemoval({ dir: path.join(root, 'sutradhar-cli-1790798002107-AbC123'), tmpRoot: root, commandLines: [], ownerAlive: false, ageMs: 1, minAgeMs: 0 });
    decideRemoval({ dir: path.join(root, 'work'), tmpRoot: root, commandLines: null, ownerAlive: false, ageMs: 1, minAgeMs: 0 });
    vi.restoreAllMocks();
    expect(writes).toEqual([]);
  });
});

describe('S6b amendment N2: cleanup never throws on malformed input (the documented contract)', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'gap315-n2-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('T9: a non-string dir (hand-corrupted state.json) resolves with not-auto-temp instead of throwing', async () => {
    for (const bad of [123, null, undefined, {}, ['x']]) {
      const res = await removeSessionTempProfile(bad as unknown as string, undefined, { tmpRoot: root, scan: async () => [] });
      expect(res).toEqual({ removed: false, reason: 'not-auto-temp' });
    }
  });

  it('T10: a scan that REJECTS is treated as null (scan-unavailable, fail closed), for close and for sweep', async () => {
    const d = await createTempProfileDir(root);
    const boom = async (): Promise<string[] | null> => {
      throw new Error('scan exploded');
    };
    expect(await removeSessionTempProfile(d, undefined, { tmpRoot: root, scan: boom })).toEqual({ removed: false, reason: 'scan-unavailable' });
    expect(await exists(d)).toBe(true);
    const stale = path.join(root, 'sutradhar-cli-1790000000077');
    await mkdir(stale);
    const past = new Date(Date.now() - 2 * STALE_MIN_AGE_MS);
    await utimes(stale, past, past);
    const sw = await sweepStaleTempProfiles({ tmpRoot: root, scan: boom });
    expect(sw.removed).toEqual([]);
    expect(sw.kept.find((k) => k.dir === stale)?.reason).toBe('scan-unavailable');
    expect(await exists(stale)).toBe(true);
  });

  it('an unexpected internal error becomes {removed:false, reason:"error"} (never a throw)', async () => {
    const d = await createTempProfileDir(root);
    const res = await removeSessionTempProfile(d, undefined, {
      tmpRoot: root,
      scan: async () => [],
      isAlive: () => {
        throw new Error('isAlive exploded');
      },
    });
    // no chromePid, no marker: the owner-alive fact is never computed, so the dir is simply removed ...
    expect(res).toEqual({ removed: true });
    // ... but a marker makes the seam run, and its throw is contained
    const d2 = await createTempProfileDir(root);
    await writeOwnerMarker(d2, 4242);
    const res2 = await removeSessionTempProfile(d2, undefined, {
      tmpRoot: root,
      scan: async () => [],
      isAlive: () => {
        throw new Error('isAlive exploded');
      },
    });
    expect(res2).toEqual({ removed: false, reason: 'error' });
    expect(await exists(d2)).toBe(true);
  });

  it('a sweep that hits an unexpected internal error resolves (keeping the dir) instead of throwing', async () => {
    const stale = path.join(root, 'sutradhar-cli-1790000000088');
    await mkdir(stale);
    await writeOwnerMarker(stale, 4242);
    const past = new Date(Date.now() - 2 * STALE_MIN_AGE_MS);
    await utimes(stale, past, past);
    const res = await sweepStaleTempProfiles({
      tmpRoot: root,
      scan: async () => [],
      isAlive: () => {
        throw new Error('isAlive exploded');
      },
    });
    expect(res.removed).toEqual([]);
    expect(await exists(stale)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// S6e-1 (F1 / N3): a link or a non-directory named like a profile is NEVER a candidate. On
// Windows the rule-5 probe `rm(<dir>/lockfile)` follows a junction / dir symlink and deleted the
// VICTIM's lockfile (S4 audit A2); a regular FILE named like a profile used to be swept (N3).
// ---------------------------------------------------------------------------------------------
import { lstat, readdir, symlink } from 'node:fs/promises';

describe('S6e-1 (F1/N3): links and non-directories are kept, never followed', () => {
  let root: string;
  let victimRoot: string;
  const created: string[] = [];
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'gap315-f1-'));
    victimRoot = await mkdtemp(path.join(os.tmpdir(), 'gap315-f1v-'));
    created.push(root, victimRoot);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    // a junction/symlink inside root is removed as a link by rm (it never follows); victims are removed separately
    for (const d of created.splice(0)) await rm(d, { recursive: true, force: true });
  });

  async function makeVictim(name: string): Promise<string> {
    const v = path.join(victimRoot, name);
    await mkdir(path.join(v, 'Default'), { recursive: true });
    await writeFile(path.join(v, 'Default', 'Preferences'), '{"p":1}');
    await writeFile(path.join(v, 'Local State'), '{"s":1}');
    await writeFile(path.join(v, 'lockfile'), '');
    return v;
  }
  async function entries(dir: string): Promise<string[]> {
    const out: string[] = [];
    const walk = async (d: string, rel: string): Promise<void> => {
      for (const e of await readdir(d, { withFileTypes: true })) {
        const r = rel ? `${rel}/${e.name}` : e.name;
        out.push(r);
        if (e.isDirectory()) await walk(path.join(d, e.name), r);
      }
    };
    await walk(dir, '');
    return out.sort();
  }
  /** Returns false (and logs why) if this kind of link cannot be created here. */
  async function tryLink(target: string, link: string, type: 'junction' | 'dir'): Promise<boolean> {
    try {
      await symlink(target, link, type);
      return true;
    } catch (err) {
      console.log(`F1 link type=${type} not permitted here: ${(err as NodeJS.ErrnoException).code}`);
      return false;
    }
  }
  /** rmFn spy: records every path an rm is attempted on, then runs the real rm. */
  function rmSpy() {
    const paths: string[] = [];
    const fn = (async (p: Parameters<typeof rm>[0], o?: Parameters<typeof rm>[1]) => {
      paths.push(String(p));
      return rm(p, o);
    }) as typeof rm;
    return { paths, fn };
  }

  async function linkCase(type: 'junction' | 'dir', skip: () => void): Promise<void> {
    const linkType = type === 'junction' && process.platform !== 'win32' ? 'dir' : type;
    for (const mode of ['sweep', 'close'] as const) {
      const modeRoot = await mkdtemp(path.join(root, `${mode}-`));
      const victim = await makeVictim(`victim-${mode}`);
      const before = await entries(victim);
      const link = path.join(modeRoot, 'sutradhar-cli-1700000000000-JUNC');
      if (!(await tryLink(victim, link, linkType))) {
        skip();
        return;
      }
      const spy = rmSpy();
      if (mode === 'sweep') {
        const res = await sweepStaleTempProfiles({ tmpRoot: modeRoot, scan: async () => [], minAgeMs: 0, rmFn: spy.fn });
        expect(res.removed).toEqual([]);
        expect(res.kept).toEqual([{ dir: link, reason: 'not-a-directory' }]);
      } else {
        const res = await removeSessionTempProfile(link, undefined, { tmpRoot: modeRoot, scan: async () => [], rmFn: spy.fn });
        expect(res).toEqual({ removed: false, reason: 'not-a-directory' });
      }
      expect(await entries(victim)).toEqual(before); // every victim entry, incl. lockfile, remains
      expect(await exists(path.join(victim, 'lockfile'))).toBe(true);
      expect((await lstat(link)).isSymbolicLink()).toBe(true); // the link itself is kept too (a harmless leak)
      expect(spy.paths.filter((p) => p.startsWith(link))).toEqual([]); // no rm was ever attempted THROUGH the link
    }
  }

  it('F1-a: a junction (Windows) / symlink (POSIX) named like a profile is kept by sweep and close; the victim, incl. lockfile, is intact', async () => {
    let skipped = false;
    await linkCase('junction', () => {
      skipped = true;
    });
    expect(skipped).toBe(false); // a junction needs no privilege; failing to create one is a test-environment failure
  });

  it('F1-b: a dir symlink named like a profile is kept (skipped with a logged reason where symlinks need privilege)', async (ctx) => {
    let skipped = false;
    await linkCase('dir', () => {
      skipped = true;
    });
    if (skipped) ctx.skip();
  });

  it('F1-c (N3): a regular FILE named like a profile is kept by sweep and close', async () => {
    for (const mode of ['sweep', 'close'] as const) {
      const modeRoot = await mkdtemp(path.join(root, `${mode}-`));
      const file = path.join(modeRoot, 'sutradhar-cli-1700000000001');
      await writeFile(file, 'precious');
      const past = new Date(Date.now() - 2 * STALE_MIN_AGE_MS);
      await utimes(file, past, past);
      if (mode === 'sweep') {
        const res = await sweepStaleTempProfiles({ tmpRoot: modeRoot, scan: async () => [], minAgeMs: 0 });
        expect(res.removed).toEqual([]);
        expect(res.kept).toEqual([{ dir: file, reason: 'not-a-directory' }]);
      } else {
        expect(await removeSessionTempProfile(file, undefined, { tmpRoot: modeRoot, scan: async () => [] })).toEqual({
          removed: false,
          reason: 'not-a-directory',
        });
      }
      expect(await exists(file)).toBe(true);
    }
  });

  it('F1-d (positive control): a real dir under the same setup is still removed by sweep and close', async () => {
    const sweepRoot = await mkdtemp(path.join(root, 'sweep-'));
    const real = path.join(sweepRoot, 'sutradhar-cli-1700000000002-REAL');
    await mkdir(path.join(real, 'Default'), { recursive: true });
    await writeFile(path.join(real, 'lockfile'), '');
    const res = await sweepStaleTempProfiles({ tmpRoot: sweepRoot, scan: async () => [], minAgeMs: 0 });
    expect(res.removed).toEqual([real]);
    expect(await exists(real)).toBe(false);

    const closeRoot = await mkdtemp(path.join(root, 'close-'));
    const real2 = path.join(closeRoot, 'sutradhar-cli-1700000000003-REAL');
    await mkdir(path.join(real2, 'Default'), { recursive: true });
    await writeFile(path.join(real2, 'lockfile'), '');
    expect(await removeSessionTempProfile(real2, undefined, { tmpRoot: closeRoot, scan: async () => [] })).toEqual({ removed: true });
    expect(await exists(real2)).toBe(false);
  });

  it('F1-e: a dir swapped for a junction/symlink between the facts and a retry is NOT followed (re-check inside the retry loop)', async () => {
    const modeRoot = await mkdtemp(path.join(root, 'swap-'));
    const victim = await makeVictim('victim-swap');
    const before = await entries(victim);
    const dir = path.join(modeRoot, 'sutradhar-cli-1700000000004-SWAP');
    await mkdir(path.join(dir, 'Default'), { recursive: true });
    await writeFile(path.join(dir, 'lockfile'), '');
    const calls: string[] = [];
    let linked = true;
    // First attempt: report a lock error AFTER swapping the real dir for a link to the victim.
    const rmFn = (async (p: Parameters<typeof rm>[0]) => {
      calls.push(String(p));
      if (calls.length === 1) {
        await rm(dir, { recursive: true, force: true });
        linked = await tryLink(victim, dir, process.platform === 'win32' ? 'junction' : 'dir');
        throw Object.assign(new Error('simulated lock'), { code: 'EBUSY' });
      }
      return rm(p, { force: true });
    }) as typeof rm;
    const res = await removeSessionTempProfile(dir, undefined, { tmpRoot: modeRoot, scan: async () => [], rmFn, deadlineMs: 8000 });
    if (!linked) return; // cannot create the link in this environment (logged by tryLink)
    expect(res).toEqual({ removed: false, reason: 'not-a-directory' });
    expect(calls).toHaveLength(1); // the retry never reached the rm
    expect(await entries(victim)).toEqual(before);
    expect(await exists(path.join(victim, 'lockfile'))).toBe(true);
  });

  it('decideRemoval: realDir === false is not-a-directory (after not-auto-temp, before every other rule); undefined keeps the old behaviour', () => {
    expect(decideRemoval(facts({ realDir: false }))).toEqual({ remove: false, reason: 'not-a-directory' });
    expect(decideRemoval(facts({ realDir: false, commandLines: null }))).toEqual({ remove: false, reason: 'not-a-directory' });
    expect(decideRemoval(facts({ realDir: false, dir: path.join(ROOT, 'my-profile') }))).toEqual({ remove: false, reason: 'not-auto-temp' });
    expect(decideRemoval(facts({ realDir: true }))).toEqual({ remove: true });
    expect(decideRemoval(facts())).toEqual({ remove: true }); // realDir undefined: unchanged (port-probe compatibility)
  });
});

// ---------------------------------------------------------------------------------------------
// S6e-4 (N1): an owner marker that is PRESENT but unreadable or corrupt means "owner unknown", never
// "owner dead". Before this, `{"chromePid":"123"` made readOwnerPid return undefined, which rule 3
// treated as a dead owner (fail open). Only a genuinely ABSENT marker falls back to SingletonLock.
// ---------------------------------------------------------------------------------------------
describe('S6e-4 (N1): an unreadable or corrupt owner marker fails CLOSED (owner-unknown)', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'gap315-n1-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  /** A stale, unreferenced profile dir whose marker is made by `makeMarker` (or absent). */
  async function staleWithMarker(name: string, makeMarker?: (markerPath: string) => Promise<void>): Promise<string> {
    const d = path.join(root, name);
    await mkdir(path.join(d, 'Default'), { recursive: true });
    await writeFile(path.join(d, 'Default', 'Preferences'), '{}');
    if (makeMarker) await makeMarker(path.join(d, OWNER_MARKER));
    const past = new Date(Date.now() - 2 * STALE_MIN_AGE_MS);
    await utimes(d, past, past);
    return d;
  }

  const BAD_MARKERS: Array<[string, (markerPath: string) => Promise<void>]> = [
    ['N1-a corrupt JSON', (p) => writeFile(p, '{"chromePid":"123"')],
    ['N1-b chromePid is a string', (p) => writeFile(p, JSON.stringify({ chromePid: 'abc', cliPid: 1 }))],
    ['N1-c the marker path is a directory (EISDIR)', (p) => mkdir(p)],
    ['chromePid is 0', (p) => writeFile(p, JSON.stringify({ chromePid: 0 }))],
    ['chromePid is negative', (p) => writeFile(p, JSON.stringify({ chromePid: -5 }))],
    ['chromePid is fractional', (p) => writeFile(p, JSON.stringify({ chromePid: 12.5 }))],
    ['chromePid is missing', (p) => writeFile(p, JSON.stringify({ cliPid: 1 }))],
    ['marker is JSON null', (p) => writeFile(p, 'null')],
    ['marker is an empty file', (p) => writeFile(p, '')],
  ];

  for (const [name, make] of BAD_MARKERS) {
    it(`${name}: sweep and close keep the dir with owner-unknown`, async () => {
      const forSweep = await staleWithMarker('sutradhar-cli-1700000000100-SWP', make);
      const sweep = await sweepStaleTempProfiles({ tmpRoot: root, scan: async () => [], minAgeMs: 0, isAlive: () => false });
      expect(sweep.removed).toEqual([]);
      expect(sweep.kept).toEqual([{ dir: forSweep, reason: 'owner-unknown' }]);
      expect(await exists(forSweep)).toBe(true);

      const forClose = await staleWithMarker('sutradhar-cli-1700000000101-CLS', make);
      const res = await removeSessionTempProfile(forClose, undefined, { tmpRoot: root, scan: async () => [], isAlive: () => false });
      expect(res).toEqual({ removed: false, reason: 'owner-unknown' });
      expect(await exists(forClose)).toBe(true);
    });
  }

  it('N1-d (positive control): no marker and no lock is still removed by sweep and close', async () => {
    const a = await staleWithMarker('sutradhar-cli-1700000000102-AAA');
    const sweep = await sweepStaleTempProfiles({ tmpRoot: root, scan: async () => [], minAgeMs: 0, isAlive: () => false });
    expect(sweep.removed).toEqual([a]);
    const b = await staleWithMarker('sutradhar-cli-1700000000103-BBB');
    expect(await removeSessionTempProfile(b, undefined, { tmpRoot: root, scan: async () => [], isAlive: () => false })).toEqual({ removed: true });
    expect(await exists(a)).toBe(false);
    expect(await exists(b)).toBe(false);
  });

  it('a VALID marker whose owner is dead is still removed; with an alive owner it is owner-alive (unchanged)', async () => {
    const dead = await staleWithMarker('sutradhar-cli-1700000000104-DED', (p) => writeFile(p, JSON.stringify({ chromePid: 4242, cliPid: 1 })));
    expect(await removeSessionTempProfile(dead, undefined, { tmpRoot: root, scan: async () => [], isAlive: () => false })).toEqual({ removed: true });
    const live = await staleWithMarker('sutradhar-cli-1700000000105-LIV', (p) => writeFile(p, JSON.stringify({ chromePid: 4242, cliPid: 1 })));
    expect(await removeSessionTempProfile(live, undefined, { tmpRoot: root, scan: async () => [], isAlive: () => true })).toEqual({ removed: false, reason: 'owner-alive' });
  });

  it('readOwnerPid keeps its old behaviour (the S4 probes call it): corrupt marker -> undefined, valid marker -> pid', async () => {
    const corrupt = await staleWithMarker('sutradhar-cli-1700000000106-COR', (p) => writeFile(p, '{"chromePid":"123"'));
    expect(await readOwnerPid(corrupt)).toBeUndefined();
    const valid = await staleWithMarker('sutradhar-cli-1700000000107-VAL', (p) => writeFile(p, JSON.stringify({ chromePid: 777 })));
    expect(await readOwnerPid(valid)).toBe(777);
  });

  it('decideRemoval: ownerState invalid is owner-unknown (after in-use, before owner-alive); absent/undefined are unchanged', () => {
    expect(decideRemoval(facts({ ownerState: 'invalid' }))).toEqual({ remove: false, reason: 'owner-unknown' });
    expect(decideRemoval(facts({ ownerState: 'invalid', ownerPid: 123, ownerAlive: true }))).toEqual({ remove: false, reason: 'owner-unknown' });
    expect(decideRemoval(facts({ ownerState: 'invalid', commandLines: [`chrome --user-data-dir=${DIR}`] }))).toEqual({ remove: false, reason: 'in-use' });
    expect(decideRemoval(facts({ ownerState: 'invalid', commandLines: null }))).toEqual({ remove: false, reason: 'scan-unavailable' });
    expect(decideRemoval(facts({ ownerState: 'absent' }))).toEqual({ remove: true });
    expect(decideRemoval(facts({ ownerState: 'absent', ownerPid: 123, ownerAlive: true }))).toEqual({ remove: false, reason: 'owner-alive' });
    expect(decideRemoval(facts({ ownerState: 'valid', ownerPid: 123, ownerAlive: false }))).toEqual({ remove: true });
    expect(decideRemoval(facts())).toEqual({ remove: true }); // ownerState undefined: unchanged (port-probe compatibility)
  });
});

// ---------------------------------------------------------------------------------------------
// S6e-5 (N4-a): rule 5 (Windows): Chrome holds `lockfile` open exclusively for the profile's whole life,
// so the first delete of `lockfile` fails and NOTHING else may be touched. This is the only guard
// against partial deletion of a live profile when rules 2 and 3 are wrong: with the probe removed
// (S4 mutant M2) the live A4 run deleted 106 of 200 entries of a running Chrome profile, and the
// branch spec did not notice.
// ---------------------------------------------------------------------------------------------
import { spawn as spawnChildProcess } from 'node:child_process';
import { readdir as readdirNames } from 'node:fs/promises';
import { powershellExe } from '../../src/system-binaries.js';

describe('S6e-5 (N4-a): a lockfile held open by a live process protects the whole profile (Windows rule 5)', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'gap315-n4a-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it.skipIf(process.platform !== 'win32')(
    'N4-a (Windows only; rule 5 is Windows-only, so this is skipped on POSIX): 21 entries survive while lockfile is held with FileShare.None',
    async () => {
      const dir = path.join(root, 'sutradhar-cli-1700000000200-N4A');
      await mkdir(dir);
      for (let i = 0; i < 20; i++) await writeFile(path.join(dir, `f${String(i).padStart(2, '0')}.dat`), `data ${i}`);
      const lockPath = path.join(dir, 'lockfile');
      await writeFile(lockPath, '');
      const before = (await readdirNames(dir)).sort();
      expect(before).toHaveLength(21);

      // Hold `lockfile` open exclusively from a CHILD process (the path goes through the environment, never argv).
      const script = "$f=[IO.File]::Open($env:LOCKPATH,'Open','ReadWrite','None'); 'ready'; [Console]::In.ReadLine()";
      const child = spawnChildProcess(powershellExe(), ['-NoProfile', '-NonInteractive', '-Command', script], {
        env: { ...process.env, LOCKPATH: lockPath },
        stdio: ['pipe', 'pipe', 'ignore'],
        windowsHide: true,
      });
      let exited = false;
      child.once('exit', () => {
        exited = true;
      });
      try {
        let out = '';
        const ready = await new Promise<boolean>((resolve) => {
          const timer = setTimeout(() => resolve(false), 30_000);
          child.stdout?.on('data', (d: Buffer) => {
            out += d.toString('utf8');
            if (out.includes('ready')) {
              clearTimeout(timer);
              resolve(true);
            }
          });
          child.once('exit', () => {
            clearTimeout(timer);
            resolve(false);
          });
        });
        expect(ready).toBe(true); // the child really holds the lock before we call anything

        const held = await removeSessionTempProfile(dir, undefined, { tmpRoot: root, scan: async () => [], deadlineMs: 2000, isAlive: () => false });
        expect(held.removed).toBe(false);
        const after = (await readdirNames(dir)).sort();
        for (const name of before) expect(after).toContain(name); // every one of the 21 pre-existing entries is still there
        expect(after).toContain('lockfile');
      } finally {
        // End the child by closing its stdin, then confirm through its own handle that it exited.
        child.stdin?.end();
        const gone = await new Promise<boolean>((resolve) => {
          if (exited) return resolve(true);
          const timer = setTimeout(() => resolve(false), 15_000);
          child.once('exit', () => {
            clearTimeout(timer);
            resolve(true);
          });
        });
        if (!gone) child.kill(); // only OUR child, by handle
        expect(gone).toBe(true);
      }

      // Positive control: with the lock released the very same call removes the dir (the test can see a removal).
      const released = await removeSessionTempProfile(dir, undefined, { tmpRoot: root, scan: async () => [], deadlineMs: 8000, isAlive: () => false });
      expect(released).toEqual({ removed: true });
      expect(await exists(dir)).toBe(false);
    },
    90_000,
  );
});
