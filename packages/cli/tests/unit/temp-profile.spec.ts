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
