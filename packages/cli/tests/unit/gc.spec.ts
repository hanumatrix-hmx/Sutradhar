/**
 * @file packages/cli/tests/unit/gc.spec.ts
 * @description FR2-03 (subset of §4's G/X series): pure `planGc` decisions and `executeGc`
 * against injected fake deps — no real filesystem or process is ever touched here.
 */
import path from 'node:path';
import { planGc, executeGc, discoverMarkerStateFiles, type GcSnapshot } from '../../src/gc.js';
import type { SessionsSnapshot } from '../../src/sessions.js';
import { buildMarkerArgs } from '@sutradhar/browser';

const TEMP_ROOT = path.join('C:', 'fake-temp');
const STATE_ROOT = path.join('C:', 'fake-state');

function emptySessions(overrides: Partial<SessionsSnapshot['sessions'][number]>[] = []): SessionsSnapshot {
  return {
    stateRoot: STATE_ROOT,
    generatedAt: new Date().toISOString(),
    processEnumeration: { ok: true },
    sessions: overrides.map((o) => ({
      stateFile: path.join(STATE_ROOT, 'x', 'state.json'),
      current: false,
      status: 'stale',
      viaMarker: false,
      sessionId: null,
      cwd: null,
      createdAt: null,
      ageMs: 0,
      ageSource: 'stateFileMtime',
      chromePid: null,
      pidAlive: null,
      pidMatchesProfile: null,
      endpoint: null,
      endpointReachable: false,
      profileDir: null,
      profileDirOwned: false,
      profileDirExists: false,
      profileName: null,
      ...o,
    })),
  };
}

function baseSnapshot(overrides: Partial<GcSnapshot> = {}): GcSnapshot {
  return {
    scope: { tempRoot: TEMP_ROOT, stateRoot: STATE_ROOT, extraStateDirs: [] },
    sessions: emptySessions(),
    processEnumeration: { ok: true, processes: [] },
    candidateDirs: [],
    lockProbes: {},
    now: Date.now(),
    ...overrides,
  };
}

describe('planGc', () => {
  it('G1: a live session dir/pid appear in no action; kept live-session', () => {
    const dir = path.join(TEMP_ROOT, 'sutradhar-cli-1700000000000');
    const snapshot = baseSnapshot({
      sessions: emptySessions([{ status: 'live', chromePid: 111, profileDir: dir, profileDirOwned: true }]),
      candidateDirs: [{ path: dir, mtimeMs: Date.now(), isSymlink: false, isDirectory: true }],
    });
    const plan = planGc(snapshot);
    expect(plan.actions).toEqual([]);
    expect(plan.kept.some((k) => k.reason === 'live-session')).toBe(true);
  });

  it('G2: a stale session with a dead pid gives clearState + deleteDir(stale-session), no kill', () => {
    const dir = path.join(TEMP_ROOT, 'sutradhar-cli-1700000000001');
    const snapshot = baseSnapshot({
      sessions: emptySessions([
        {
          status: 'stale',
          sessionId: 's1',
          endpoint: 'ws://x/devtools/browser/id1',
          chromePid: 222,
          pidAlive: false,
          profileDir: dir,
          profileDirOwned: true,
          stateFile: path.join(STATE_ROOT, 'a', 'state.json'),
        },
      ]),
      candidateDirs: [{ path: dir, mtimeMs: Date.now(), isSymlink: false, isDirectory: true }],
    });
    const plan = planGc(snapshot);
    expect(plan.actions.find((a) => a.type === 'clearState')).toBeDefined();
    expect(plan.actions.find((a) => a.type === 'deleteDir' && a.reason === 'stale-session')).toBeDefined();
    expect(plan.actions.find((a) => a.type === 'kill')).toBeUndefined();
  });

  it('G3: a stale session with profileDirOwned:false clears state, never deletes the dir, kept named-profile', () => {
    const dir = path.join('C:', 'Users', 'x', '.sutradhar', 'profiles', 'work');
    const snapshot = baseSnapshot({
      sessions: emptySessions([
        {
          status: 'stale',
          sessionId: 's1',
          endpoint: 'ws://x/devtools/browser/id1',
          profileDir: dir,
          profileDirOwned: false,
        },
      ]),
    });
    const plan = planGc(snapshot);
    expect(plan.actions.find((a) => a.type === 'deleteDir')).toBeUndefined();
    expect(plan.kept.find((k) => k.path === dir && k.reason === 'named-profile')).toBeDefined();
  });

  it('G5: a CLI-marked browser with a dead owner is killed (orphan-cli) and its dir (past grace) queued for delete', () => {
    const dir = path.join(TEMP_ROOT, 'sutradhar-cli-1700000000002');
    const deadOwnerPid = 999999; // vanishingly unlikely to be a real live PID in CI
    const snapshot = baseSnapshot({
      processEnumeration: {
        ok: true,
        processes: [
          {
            pid: 333,
            ppid: 1,
            startMs: Date.now(),
            commandLine: `chrome --user-data-dir=${dir} --sutradhar-launch=cli --sutradhar-owner-pid=${deadOwnerPid} --sutradhar-owner-start=1`,
          },
        ],
      },
      // GAP-193 (audit-4): the grace period is a property of the DIRECTORY's own age, checked
      // uniformly before `dirsWithKilledBrowser` is ever consulted -- so this dir must be older
      // than GC_GRACE_MS for this case to exercise the delete path at all (a separate, dedicated
      // test below now covers "a young dir stays grace-protected even with a killed marked
      // browser claiming it").
      candidateDirs: [{ path: dir, mtimeMs: Date.now() - 200_000, isSymlink: false, isDirectory: true }],
    });
    const plan = planGc(snapshot);
    const kill = plan.actions.find((a) => a.type === 'kill');
    expect(kill).toMatchObject({ pid: 333, reason: 'orphan-cli' });
    const del = plan.actions.find((a) => a.type === 'deleteDir');
    expect(del).toMatchObject({ path: dir, reason: 'orphan-browser' });
  });

  it('GAP-193: a YOUNG dir (mtime=now) stays grace-protected even though a killed CLI-marked browser claims it as its --user-data-dir', () => {
    const dir = path.join(TEMP_ROOT, 'sutradhar-cli-1700000000009');
    const deadOwnerPid = 999999;
    const snapshot = baseSnapshot({
      processEnumeration: {
        ok: true,
        processes: [
          {
            pid: 334,
            ppid: 1,
            startMs: Date.now(),
            commandLine: `chrome --user-data-dir=${dir} --sutradhar-launch=cli --sutradhar-owner-pid=${deadOwnerPid} --sutradhar-owner-start=1`,
          },
        ],
      },
      candidateDirs: [{ path: dir, mtimeMs: Date.now(), isSymlink: false, isDirectory: true }],
    });
    const plan = planGc(snapshot);
    // The browser process itself is still killed (it really is orphaned) -- only the directory
    // delete is grace-gated, matching D2's grace-period intent for a dir mid-mkdtemp.
    expect(plan.actions.find((a) => a.type === 'kill')).toMatchObject({ pid: 334, reason: 'orphan-cli' });
    expect(plan.actions.find((a) => a.type === 'deleteDir' && a.path === dir)).toBeUndefined();
    expect(plan.kept.find((k) => k.path === dir && k.reason === 'grace')).toBeDefined();
  });

  it('G6: owner alive and start within 5s -- no kill, dir kept in-use', () => {
    const dir = path.join(TEMP_ROOT, 'sutradhar-cli-1700000000003');
    const ownerPid = process.pid; // genuinely alive in this test process
    const startMs = Date.now();
    const snapshot = baseSnapshot({
      processEnumeration: {
        ok: true,
        processes: [
          { pid: ownerPid, ppid: 1, startMs, commandLine: 'node' },
          {
            pid: 444,
            ppid: 1,
            startMs: Date.now(),
            commandLine: `chrome --user-data-dir=${dir} --sutradhar-launch=cli --sutradhar-owner-pid=${ownerPid} --sutradhar-owner-start=${startMs}`,
          },
        ],
      },
      candidateDirs: [{ path: dir, mtimeMs: Date.now(), isSymlink: false, isDirectory: true }],
    });
    const plan = planGc(snapshot);
    expect(plan.actions.find((a) => a.type === 'kill')).toBeUndefined();
    expect(plan.kept.find((k) => k.path === dir && k.reason === 'in-use')).toBeDefined();
  });

  it('G9: a runtime-marked browser with a dead owner is killed (orphan-runtime), Puppeteer dir deleted', () => {
    const dir = path.join(TEMP_ROOT, 'puppeteer_dev_chrome_profile-AbC123');
    const deadOwnerPid = 999998;
    const snapshot = baseSnapshot({
      processEnumeration: {
        ok: true,
        processes: [
          {
            pid: 555,
            ppid: 1,
            startMs: Date.now(),
            commandLine: `chrome --user-data-dir=${dir} --sutradhar-launch=runtime --sutradhar-owner-pid=${deadOwnerPid} --sutradhar-owner-start=1`,
          },
        ],
      },
      candidateDirs: [
        {
          path: dir,
          mtimeMs: Date.now(),
          isSymlink: false,
          isDirectory: true,
          ownerFile: { v: 1, tool: 'sutradhar', kind: 'runtime', ownerPid: deadOwnerPid, ownerStartMs: 1, createdAt: 'x' },
        },
      ],
    });
    const plan = planGc(snapshot);
    expect(plan.actions.find((a) => a.type === 'kill')).toMatchObject({ pid: 555, reason: 'orphan-runtime' });
    // GAP-193 (audit-4): a Puppeteer dir is now deleted ONLY via its own `.sutradhar-owner.json`
    // (D2 attribution), never via `dirsWithKilledBrowser` -- so the reason is `owner-dead` (the
    // ownerFile's own recorded owner is dead), not `orphan-browser`.
    expect(plan.actions.find((a) => a.type === 'deleteDir')).toMatchObject({ path: dir, reason: 'owner-dead' });
  });

  it('GAP-193: an UNOWNED (no .sutradhar-owner.json) Puppeteer dir is never deleted, even when a killed marked browser claims it as --user-data-dir (D2 attribution cannot be satisfied by command-line text alone)', () => {
    const dir = path.join(TEMP_ROOT, 'puppeteer_dev_chrome_profile-fOrGd1');
    const deadOwnerPid = 999997;
    const snapshot = baseSnapshot({
      processEnumeration: {
        ok: true,
        processes: [
          {
            pid: 556,
            ppid: 1,
            startMs: Date.now(),
            // A plain forged carrier: claims runtime marker + dead owner + this exact unowned dir.
            commandLine: `node --user-data-dir=${dir} --sutradhar-launch=runtime --sutradhar-owner-pid=${deadOwnerPid} --sutradhar-owner-start=1`,
          },
        ],
      },
      // No `ownerFile` at all -- this dir was never proven to be ours.
      candidateDirs: [{ path: dir, mtimeMs: Date.now() - 3_600_000, isSymlink: false, isDirectory: true }],
    });
    const plan = planGc(snapshot);
    // The carrier process itself may still be killed (it really did claim a dead-owner marker),
    // but the unowned dir must never be deleted or even queued.
    expect(plan.actions.find((a) => a.type === 'deleteDir')).toBeUndefined();
    expect(plan.kept.find((k) => k.path === dir && k.reason === 'not-sutradhar')).toBeDefined();
  });

  it('GAP-180: a runtime-marked browser whose --user-data-dir is a caller-supplied dir OUTSIDE tempRoot is never killed, even with a dead owner (GC\'s reach must stay bounded to its own scratch area)', () => {
    const callerDir = path.join('C:', 'Users', 'x', 'my-own-profile'); // NOT under TEMP_ROOT
    const deadOwnerPid = 999994;
    const snapshot = baseSnapshot({
      processEnumeration: {
        ok: true,
        processes: [
          {
            pid: 556,
            ppid: 1,
            startMs: Date.now(),
            commandLine: `chrome --user-data-dir=${callerDir} --sutradhar-launch=runtime --sutradhar-owner-pid=${deadOwnerPid} --sutradhar-owner-start=1`,
          },
        ],
      },
    });
    const plan = planGc(snapshot);
    expect(plan.actions.find((a) => a.type === 'kill')).toBeUndefined();
    expect(plan.kept.find((k) => k.pid === 556)).toMatchObject({ reason: 'out-of-scope' });
  });

  it('G10: an unmarked browser on a Puppeteer dir with no owner file is never killed or deleted, kept not-sutradhar', () => {
    const dir = path.join(TEMP_ROOT, 'puppeteer_dev_chrome_profile-DeCoY1');
    const snapshot = baseSnapshot({
      processEnumeration: {
        ok: true,
        processes: [{ pid: 666, ppid: 1, startMs: Date.now(), commandLine: `chrome --user-data-dir=${dir}` }],
      },
      candidateDirs: [{ path: dir, mtimeMs: Date.now(), isSymlink: false, isDirectory: true }],
    });
    const plan = planGc(snapshot);
    expect(plan.actions).toEqual([]);
    expect(plan.kept.some((k) => k.reason === 'not-sutradhar')).toBe(true);
  });

  it('G12: a legacy unmarked CLI dir at age 30s is kept (grace); at age 121s it is killed (legacy-orphan)', () => {
    const dirYoung = path.join(TEMP_ROOT, 'sutradhar-cli-1700000000010');
    const dirOld = path.join(TEMP_ROOT, 'sutradhar-cli-1700000000011');
    const now = Date.now();
    const snapshot = baseSnapshot({
      now,
      processEnumeration: {
        ok: true,
        processes: [
          { pid: 701, ppid: 1, startMs: now - 30_000, commandLine: `chrome --user-data-dir=${dirYoung}` },
          { pid: 702, ppid: 1, startMs: now - 121_000, commandLine: `chrome --user-data-dir=${dirOld}` },
        ],
      },
      candidateDirs: [
        { path: dirYoung, mtimeMs: now - 30_000, isSymlink: false, isDirectory: true },
        { path: dirOld, mtimeMs: now - 121_000, isSymlink: false, isDirectory: true },
      ],
    });
    const plan = planGc(snapshot);
    expect(plan.kept.find((k) => k.pid === 701)).toMatchObject({ reason: 'grace' });
    expect(plan.actions.find((a) => a.type === 'kill' && a.pid === 702)).toMatchObject({ reason: 'legacy-orphan' });
  });

  it('GAP-194: a legacy unmarked CLI dir past grace is PROTECTED (unknown-liveness) when legacyProbes independently confirms its DevToolsActivePort still answers -- no marker or state file involved at all', () => {
    const dirReachable = path.join(TEMP_ROOT, 'sutradhar-cli-1700000000012');
    const dirDead = path.join(TEMP_ROOT, 'sutradhar-cli-1700000000013');
    const now = Date.now();
    const snapshot = baseSnapshot({
      now,
      processEnumeration: {
        ok: true,
        processes: [
          { pid: 703, ppid: 1, startMs: now - 121_000, commandLine: `chrome --user-data-dir=${dirReachable}` },
          { pid: 704, ppid: 1, startMs: now - 121_000, commandLine: `chrome --user-data-dir=${dirDead}` },
        ],
      },
      candidateDirs: [
        { path: dirReachable, mtimeMs: now - 121_000, isSymlink: false, isDirectory: true },
        { path: dirDead, mtimeMs: now - 121_000, isSymlink: false, isDirectory: true },
      ],
      // Only `dirReachable`'s own DevToolsActivePort probe succeeded -- an entry absent, or
      // explicitly false, must still fall back to the existing age-based kill (no regression
      // for a genuinely orphaned legacy Chrome, per G12).
      legacyProbes: { [dirReachable.toLowerCase()]: true },
    });
    const plan = planGc(snapshot);
    expect(plan.actions.find((a) => a.type === 'kill' && a.pid === 703)).toBeUndefined();
    expect(plan.kept.find((k) => k.pid === 703)).toMatchObject({ reason: 'unknown-liveness' });
    expect(plan.actions.find((a) => a.type === 'kill' && a.pid === 704)).toMatchObject({ reason: 'legacy-orphan' });
  });

  it('G20: a symlink candidate is never deleted, kept symlink; an unreadable state is kept unreadable-state', () => {
    const link = path.join(TEMP_ROOT, 'sutradhar-cli-1700000000099');
    const snapshot = baseSnapshot({
      sessions: emptySessions([{ status: 'unreadable', stateFile: path.join(STATE_ROOT, 'bad', 'state.json') }]),
      candidateDirs: [{ path: link, mtimeMs: Date.now(), isSymlink: true, isDirectory: true }],
    });
    const plan = planGc(snapshot);
    expect(plan.actions.find((a) => a.type === 'deleteDir')).toBeUndefined();
    expect(plan.kept.some((k) => k.reason === 'symlink')).toBe(true);
    expect(plan.kept.some((k) => k.reason === 'unreadable-state')).toBe(true);
  });

  it('G15: enumeration unavailable gives zero kill actions and incomplete:true; dirs past grace deleted only where lockProbe is free', () => {
    const dirFree = path.join(TEMP_ROOT, 'sutradhar-cli-1700000000020');
    const dirUnknown = path.join(TEMP_ROOT, 'sutradhar-cli-1700000000021');
    const now = Date.now();
    const snapshot = baseSnapshot({
      now,
      processEnumeration: { ok: false, reason: 'no powershell' },
      candidateDirs: [
        // Both past the 120s grace period -- see GAP-178(b) below for the still-fresh case.
        { path: dirFree, mtimeMs: now - 121_000, isSymlink: false, isDirectory: true },
        { path: dirUnknown, mtimeMs: now - 121_000, isSymlink: false, isDirectory: true },
      ],
      lockProbes: { [dirFree]: 'free', [dirUnknown]: 'unknown' },
    });
    const plan = planGc(snapshot);
    expect(plan.incomplete).toBe(true);
    expect(plan.actions.filter((a) => a.type === 'kill')).toEqual([]);
    expect(plan.actions.find((a) => a.type === 'deleteDir' && a.path === dirFree)).toBeDefined();
    expect(plan.kept.find((k) => k.path === dirUnknown)).toBeDefined();
  });

  it('GAP-178(a): degraded mode never deletes an unmarked, un-owned Puppeteer dir even with a free lock (D2 ownership gate applies regardless of enumeration availability)', () => {
    const dir = path.join(TEMP_ROOT, 'puppeteer_dev_chrome_profile-NotOur');
    const snapshot = baseSnapshot({
      processEnumeration: { ok: false, reason: 'no powershell' },
      candidateDirs: [{ path: dir, mtimeMs: Date.now() - 200_000, isSymlink: false, isDirectory: true }], // no ownerFile
      lockProbes: { [dir]: 'free' },
    });
    const plan = planGc(snapshot);
    expect(plan.actions.find((a) => a.type === 'deleteDir')).toBeUndefined();
    expect(plan.kept.find((k) => k.path === dir)).toMatchObject({ reason: 'not-sutradhar' });
  });

  it('GAP-178(b): degraded mode still honors the 120s grace period -- a fresh dir with a free lock is kept, not deleted', () => {
    const dir = path.join(TEMP_ROOT, 'sutradhar-cli-1700000000022');
    const now = Date.now();
    const snapshot = baseSnapshot({
      now,
      processEnumeration: { ok: false, reason: 'no powershell' },
      candidateDirs: [{ path: dir, mtimeMs: now - 5_000, isSymlink: false, isDirectory: true }], // 5s old, well within grace
      lockProbes: { [dir]: 'free' },
    });
    const plan = planGc(snapshot);
    expect(plan.actions.find((a) => a.type === 'deleteDir')).toBeUndefined();
    expect(plan.kept.find((k) => k.path === dir)).toMatchObject({ reason: 'grace' });
  });

  it('G13: an orphan sutradhar-cli dir with no process reference at all is kept grace within 120s, deleted past it -- also the revert-and-confirm regression test for audit-1 mutation A2 ("remove dir-level grace for orphan dirs"), which no existing test caught', () => {
    const now = Date.now();
    const dirYoung = path.join(TEMP_ROOT, 'sutradhar-cli-1700000000090');
    const dirOld = path.join(TEMP_ROOT, 'sutradhar-cli-1700000000091');
    const snapshot = baseSnapshot({
      now,
      processEnumeration: { ok: true, processes: [] }, // no process anywhere references either dir
      candidateDirs: [
        { path: dirYoung, mtimeMs: now - 119_000, isSymlink: false, isDirectory: true },
        { path: dirOld, mtimeMs: now - 121_000, isSymlink: false, isDirectory: true },
      ],
    });
    const plan = planGc(snapshot);
    expect(plan.kept.find((k) => k.path === dirYoung)).toMatchObject({ reason: 'grace' });
    expect(plan.actions.find((a) => a.type === 'deleteDir' && a.path === dirOld)).toMatchObject({ reason: 'orphan-dir' });
  });

  describe('GAP-175: a session using a custom state dir (SUTRADHAR_CLI_STATE_DIR) must never look orphaned just because its owner CLI process has already exited', () => {
    it('discoverMarkerStateFiles extracts a cli marker\'s own --sutradhar-state path from a real command line, when the carrier is a genuine CLI-owned browser process', () => {
      const stateFile = path.join('D:', 'custom-state-dir', 'state.json');
      const args = buildMarkerArgs({ kind: 'cli', ownerPid: 123, ownerStartMs: 1_700_000_000_000, stateFile });
      const udd = path.join(TEMP_ROOT, 'sutradhar-cli-1700000000000');
      const cmdline = `chrome --user-data-dir=${udd} ${args.join(' ')}`;
      const result = discoverMarkerStateFiles({ ok: true, processes: [{ pid: 1, ppid: 0, startMs: 1, commandLine: cmdline }] }, TEMP_ROOT);
      expect(result).toEqual([stateFile]);
    });

    it('discoverMarkerStateFiles returns [] when enumeration is unavailable, and dedupes/ignores runtime markers', () => {
      expect(discoverMarkerStateFiles({ ok: false, reason: 'x' }, TEMP_ROOT)).toEqual([]);
      const stateFile = path.join('D:', 'dup', 'state.json');
      const cliArgs = buildMarkerArgs({ kind: 'cli', ownerPid: 1, ownerStartMs: 1, stateFile });
      const runtimeArgs = buildMarkerArgs({ kind: 'runtime', ownerPid: 2, ownerStartMs: 2 });
      const udd1 = path.join(TEMP_ROOT, 'sutradhar-cli-1700000000010');
      const udd2 = path.join(TEMP_ROOT, 'sutradhar-cli-1700000000011');
      const udd3 = path.join(TEMP_ROOT, 'sutradhar-cli-1700000000012');
      const result = discoverMarkerStateFiles(
        {
          ok: true,
          processes: [
            { pid: 1, ppid: 0, startMs: 1, commandLine: `chrome --user-data-dir=${udd1} ${cliArgs.join(' ')}` },
            { pid: 2, ppid: 0, startMs: 1, commandLine: `chrome --user-data-dir=${udd2} ${cliArgs.join(' ')}` }, // same stateFile again
            { pid: 3, ppid: 0, startMs: 1, commandLine: `chrome --user-data-dir=${udd3} ${runtimeArgs.join(' ')}` },
          ],
        },
        TEMP_ROOT,
      );
      expect(result).toEqual([stateFile]);
    });

    it('GAP-184: discoverMarkerStateFiles ignores a marker on a non-browser process (no --user-data-dir at all) -- live-reproduced (adv-forged-marker.mjs) as a plain node process forging --sutradhar-state to point at an arbitrary foreign file', () => {
      const stateFile = path.join('D:', 'attacker-controlled', 'session-cache.json');
      const args = buildMarkerArgs({ kind: 'cli', ownerPid: 4, ownerStartMs: 1, stateFile });
      const result = discoverMarkerStateFiles(
        { ok: true, processes: [{ pid: 5, ppid: 0, startMs: 1, commandLine: `node idle.cjs ${args.join(' ')}` }] },
        TEMP_ROOT,
      );
      expect(result).toEqual([]);
    });

    it('GAP-184: discoverMarkerStateFiles ignores a marker whose --user-data-dir sits outside tempRoot (a real browser, but not one Sutradhar owns)', () => {
      const stateFile = path.join('D:', 'somewhere', 'state.json');
      const args = buildMarkerArgs({ kind: 'cli', ownerPid: 1, ownerStartMs: 1, stateFile });
      const udd = path.join('D:', 'not-our-temp-root', 'profile');
      const result = discoverMarkerStateFiles(
        { ok: true, processes: [{ pid: 1, ppid: 0, startMs: 1, commandLine: `chrome --user-data-dir=${udd} ${args.join(' ')}` }] },
        TEMP_ROOT,
      );
      expect(result).toEqual([]);
    });

    it('GAP-184: discoverMarkerStateFiles ignores a marker whose referenced path is not literally named state.json', () => {
      const stateFile = path.join('D:', 'custom-state-dir', 'session-cache.json');
      const args = buildMarkerArgs({ kind: 'cli', ownerPid: 1, ownerStartMs: 1, stateFile });
      const udd = path.join(TEMP_ROOT, 'sutradhar-cli-1700000000020');
      const result = discoverMarkerStateFiles(
        { ok: true, processes: [{ pid: 1, ppid: 0, startMs: 1, commandLine: `chrome --user-data-dir=${udd} ${args.join(' ')}` }] },
        TEMP_ROOT,
      );
      expect(result).toEqual([]);
    });

    it('planGc: once the discovered session is scanned as live, its cli-marked browser is never killed even though its owner pid (the already-exited CLI) is dead -- this is also the revert-and-confirm regression test for audit-1 mutation A1 ("remove live-session pid protection"), which no existing test caught', () => {
      const dir = path.join(TEMP_ROOT, 'sutradhar-cli-1700000000050');
      const deadOwnerPid = 999997;
      const livePid = 777;
      const snapshot = baseSnapshot({
        sessions: emptySessions([
          { status: 'live', chromePid: livePid, profileDir: dir, profileDirOwned: true, stateFile: path.join('D:', 'custom', 'state.json') },
        ]),
        processEnumeration: {
          ok: true,
          processes: [
            {
              pid: livePid,
              ppid: 1,
              startMs: Date.now(),
              commandLine: `chrome --user-data-dir=${dir} --sutradhar-launch=cli --sutradhar-owner-pid=${deadOwnerPid} --sutradhar-owner-start=1`,
            },
          ],
        },
        candidateDirs: [{ path: dir, mtimeMs: Date.now(), isSymlink: false, isDirectory: true }],
      });
      const plan = planGc(snapshot);
      expect(plan.actions.find((a) => a.type === 'kill')).toBeUndefined();
      expect(plan.actions.find((a) => a.type === 'deleteDir')).toBeUndefined();
      expect(plan.kept.some((k) => k.reason === 'live-session')).toBe(true);
    });
  });

  it('GAP-176: a killed browser\'s profile dir is reclaimed in the SAME run even though a child process (e.g. Windows crashpad-handler) still carries the same --user-data-dir at snapshot time', () => {
    const dir = path.join(TEMP_ROOT, 'sutradhar-cli-1700000000060');
    const deadOwnerPid = 999996;
    const browserPid = 800;
    const childPid = 801;
    const snapshot = baseSnapshot({
      processEnumeration: {
        ok: true,
        processes: [
          {
            pid: browserPid,
            ppid: 1,
            startMs: Date.now(),
            commandLine: `chrome --user-data-dir=${dir} --sutradhar-launch=cli --sutradhar-owner-pid=${deadOwnerPid} --sutradhar-owner-start=1`,
          },
          // Not a "browser" process (has --type=), so it's a child -- and per spec §0.2, exactly
          // this kind of Windows child (crashpad-handler) DOES carry its own --user-data-dir.
          { pid: childPid, ppid: browserPid, startMs: Date.now(), commandLine: `chrome --type=crashpad-handler --user-data-dir=${dir}` },
        ],
      },
      // GAP-193 (audit-4): backdated past GC_GRACE_MS -- this test's own point is the same-run
      // PPID-child reclaim, not grace timing, and grace is now checked uniformly before
      // `dirsWithKilledBrowser` regardless of pass (see the dedicated grace-vs-marker test above).
      candidateDirs: [{ path: dir, mtimeMs: Date.now() - 200_000, isSymlink: false, isDirectory: true }],
    });
    const plan = planGc(snapshot);
    expect(plan.actions.find((a) => a.type === 'kill' && a.pid === browserPid)).toMatchObject({ role: 'browser', reason: 'orphan-cli' });
    expect(plan.actions.find((a) => a.type === 'kill' && a.pid === childPid)).toMatchObject({ role: 'child' });
    const del = plan.actions.find((a) => a.type === 'deleteDir');
    expect(del).toMatchObject({ path: dir, reason: 'orphan-browser' });
    expect(plan.kept.find((k) => k.path === dir)).toBeUndefined();
  });

  it('GAP-177: a stale session\'s state file pointing at a dir a LIVE session/process still owns is cleared, but its dir is never deleted (delete rules 3-4 apply to the stale-session delete path too)', () => {
    const dir = path.join(TEMP_ROOT, 'sutradhar-cli-1700000000070');
    const livePid = 900;
    const liveStateFile = path.join(STATE_ROOT, 'live', 'state.json');
    const staleStateFile = path.join(STATE_ROOT, 'stale', 'state.json');
    const snapshot = baseSnapshot({
      sessions: emptySessions([
        { status: 'live', chromePid: livePid, profileDir: dir, profileDirOwned: true, stateFile: liveStateFile },
        {
          status: 'stale',
          sessionId: 's-stale',
          endpoint: 'ws://x/devtools/browser/id-stale',
          chromePid: null,
          pidAlive: false,
          profileDir: dir,
          profileDirOwned: true,
          stateFile: staleStateFile,
        },
      ]),
      processEnumeration: {
        ok: true,
        processes: [{ pid: livePid, ppid: 1, startMs: Date.now(), commandLine: `chrome --user-data-dir=${dir}` }],
      },
      candidateDirs: [{ path: dir, mtimeMs: Date.now(), isSymlink: false, isDirectory: true }],
    });
    const plan = planGc(snapshot);
    expect(plan.actions.find((a) => a.type === 'clearState' && a.stateFile === staleStateFile)).toBeDefined();
    expect(plan.actions.find((a) => a.type === 'deleteDir')).toBeUndefined();
    expect(plan.kept.some((k) => k.reason === 'live-session')).toBe(true);
  });

  describe('GAP-183 (BLOCKER, audit-2): the killedTreePids PPID walk must verify a candidate parent actually predates its apparent child before trusting the link, so a dead parent\'s reused PID can never be misclassified as still owning a live "child"', () => {
    it('a PID-reuse chain (child created BEFORE the process now squatting on its old ppid) is never treated as a descendant of the killed browser', () => {
      const browserPid = 1000;
      const browserDir = path.join(TEMP_ROOT, 'sutradhar-cli-1700000000080');
      const deadOwnerPid = 999995;
      const childCreatedAt = 5_000; // the real orphan child, created while the (now-dead) original parent still existed
      const reusedPidHolderCreatedAt = 50_000; // an UNRELATED live process that started much later and happens to reuse that dead parent's old pid
      const unrelatedPid = 2000; // reused pid value that happens to equal the dead original parent's pid
      const grandchildPid = 2001; // some genuinely unrelated descendant of the innocent live process
      const snapshot = baseSnapshot({
        processEnumeration: {
          ok: true,
          processes: [
            {
              pid: browserPid,
              ppid: 1,
              startMs: 1_000,
              commandLine: `chrome --user-data-dir=${browserDir} --sutradhar-launch=cli --sutradhar-owner-pid=${deadOwnerPid} --sutradhar-owner-start=1`,
            },
            // the real orphan structural child (e.g. crashpad-handler), created early, ppid points at `unrelatedPid`
            // which WAS its real parent back then but has since died and had its pid reused.
            { pid: 3000, ppid: unrelatedPid, startMs: childCreatedAt, commandLine: undefined },
            // the process now squatting on `unrelatedPid` -- created LATER than the child above, so it is
            // provably NOT the same process that was ever this child's parent.
            { pid: unrelatedPid, ppid: 1, startMs: reusedPidHolderCreatedAt, commandLine: undefined },
            // a genuinely unrelated descendant of the innocent reused-pid process (e.g. explorer's own children
            // in the real-world worst case) -- must never be caught up in the kill either.
            { pid: grandchildPid, ppid: unrelatedPid, startMs: reusedPidHolderCreatedAt + 100, commandLine: undefined },
          ],
        },
        candidateDirs: [{ path: browserDir, mtimeMs: Date.now(), isSymlink: false, isDirectory: true }],
      });
      const plan = planGc(snapshot);
      expect(plan.actions.find((a) => a.type === 'kill' && a.pid === browserPid)).toBeDefined();
      expect(plan.actions.find((a) => a.type === 'kill' && a.pid === 3000)).toBeUndefined();
      expect(plan.actions.find((a) => a.type === 'kill' && a.pid === unrelatedPid)).toBeUndefined();
      expect(plan.actions.find((a) => a.type === 'kill' && a.pid === grandchildPid)).toBeUndefined();
    });

    it('a genuine PPID chain (parent strictly predates child at every hop) still gets the whole tree killed -- GAP-176 must not regress', () => {
      const browserPid = 1100;
      const browserDir = path.join(TEMP_ROOT, 'sutradhar-cli-1700000000090');
      const deadOwnerPid = 999994;
      const crashpadPid = 1101;
      const grandchildPid = 1102;
      const snapshot = baseSnapshot({
        processEnumeration: {
          ok: true,
          processes: [
            {
              pid: browserPid,
              ppid: 1,
              startMs: 1_000,
              commandLine: `chrome --user-data-dir=${browserDir} --sutradhar-launch=cli --sutradhar-owner-pid=${deadOwnerPid} --sutradhar-owner-start=1`,
            },
            { pid: crashpadPid, ppid: browserPid, startMs: 1_500, commandLine: `chrome-crashpad --user-data-dir=${browserDir} --type=crashpad-handler` },
            { pid: grandchildPid, ppid: crashpadPid, startMs: 2_000, commandLine: undefined },
          ],
        },
        // GAP-193 (audit-4): backdated past GC_GRACE_MS -- grace timing isn't this test's point.
        candidateDirs: [{ path: browserDir, mtimeMs: Date.now() - 200_000, isSymlink: false, isDirectory: true }],
      });
      const plan = planGc(snapshot);
      expect(plan.actions.find((a) => a.type === 'kill' && a.pid === browserPid)).toBeDefined();
      expect(plan.actions.find((a) => a.type === 'kill' && a.pid === crashpadPid)).toBeDefined();
      expect(plan.actions.find((a) => a.type === 'kill' && a.pid === grandchildPid)).toBeDefined();
      expect(plan.actions.find((a) => a.type === 'deleteDir' && a.path === browserDir)).toBeDefined();
    });

    it('a chain link with a missing/non-finite start time is UNVERIFIED and stops the walk (protects, never kills)', () => {
      const browserPid = 1200;
      const browserDir = path.join(TEMP_ROOT, 'sutradhar-cli-1700000000100');
      const deadOwnerPid = 999993;
      const unverifiablePpidPid = 1300;
      const snapshot = baseSnapshot({
        processEnumeration: {
          ok: true,
          processes: [
            {
              pid: browserPid,
              ppid: 1,
              startMs: 1_000,
              commandLine: `chrome --user-data-dir=${browserDir} --sutradhar-launch=cli --sutradhar-owner-pid=${deadOwnerPid} --sutradhar-owner-start=1`,
            },
            // child's own startMs is NaN (unavailable) -- the parent link can never be verified.
            { pid: 1301, ppid: browserPid, startMs: NaN as unknown as number, commandLine: undefined },
          ],
        },
        candidateDirs: [{ path: browserDir, mtimeMs: Date.now(), isSymlink: false, isDirectory: true }],
      });
      const plan = planGc(snapshot);
      expect(plan.actions.find((a) => a.type === 'kill' && a.pid === browserPid)).toBeDefined();
      expect(plan.actions.find((a) => a.type === 'kill' && a.pid === 1301)).toBeUndefined();
      void unverifiablePpidPid;
    });
  });

  describe('GAP-185 (major, audit-2): an unreadable/malformed state file must make GC treat that session as UNKNOWN liveness, never "orphan" -- same failure class as the original GAP-175 blocker, via a different code path (state-file corruption/mid-write, not owner-liveness misclassification)', () => {
    it('a session whose state file is unreadable protects its marked browser process from the orphan-cli kill, even though the marker\'s embedded owner pid (the long-exited CLI) reads dead -- that is the expected, not-orphaned, steady state', () => {
      const browserPid = 1400;
      const browserDir = path.join(TEMP_ROOT, 'sutradhar-cli-1700000000110');
      const deadOwnerPid = 999992; // normal: the CLI that spawned this Chrome has already exited
      const stateFile = path.join('D:', 'custom-midwrite', 'state.json');
      const snapshot = baseSnapshot({
        sessions: emptySessions([{ status: 'unreadable', stateFile }]),
        processEnumeration: {
          ok: true,
          processes: [
            {
              pid: browserPid,
              ppid: 1,
              startMs: Date.now(),
              commandLine: `chrome --user-data-dir=${browserDir} --sutradhar-launch=cli --sutradhar-owner-pid=${deadOwnerPid} --sutradhar-owner-start=1 --sutradhar-state=${Buffer.from(stateFile, 'utf-8').toString('base64url')}`,
            },
          ],
        },
        candidateDirs: [{ path: browserDir, mtimeMs: Date.now(), isSymlink: false, isDirectory: true }],
      });
      const plan = planGc(snapshot);
      expect(plan.actions.find((a) => a.type === 'kill')).toBeUndefined();
      expect(plan.actions.find((a) => a.type === 'deleteDir')).toBeUndefined();
      expect(plan.kept.some((k) => k.pid === browserPid && k.reason === 'unknown-liveness')).toBe(true);
      expect(plan.kept.some((k) => k.path === stateFile && k.reason === 'unreadable-state')).toBe(true);
    });

    it('an unreadable session with NO corresponding browser process at all changes nothing else -- there is simply nothing to protect or act on', () => {
      const stateFile = path.join('D:', 'gone', 'state.json');
      const snapshot = baseSnapshot({ sessions: emptySessions([{ status: 'unreadable', stateFile }]) });
      const plan = planGc(snapshot);
      expect(plan.actions).toEqual([]);
      expect(plan.kept.some((k) => k.path === stateFile && k.reason === 'unreadable-state')).toBe(true);
    });
  });

  describe('GAP-189 (FR2-03 fix-3, structural): a `viaMarker` session must NEVER reach the clearState/deleteDir-producing branch, no matter what its (attacker-shapeable) content claims -- audit-3\'s gap184-bypass.mjs forged exactly this: a plain node process\'s command-line marker pointing at a foreign, parseable state.json with a fake sessionId/wsEndpoint (reads unreachable/stale) and an attacker-chosen profileDir aimed at an unrelated, grace-protected young dir', () => {
    it('a viaMarker stale session with a full attacker-shaped payload (sessionId+endpoint set, profileDir pointing at a victim dir) produces ZERO actions -- no clearState for its own state file, no deleteDir for the dir it names', () => {
      const victimDir = path.join(TEMP_ROOT, 'sutradhar-cli-1700000000900-victim');
      const stateFile = path.join('D:', 'forged', 'project-notes', 'state.json');
      const snapshot = baseSnapshot({
        sessions: emptySessions([
          {
            status: 'stale',
            viaMarker: true,
            stateFile,
            sessionId: 'forged-session',
            endpoint: 'ws://127.0.0.1:1/devtools/browser/forged',
            profileDir: victimDir,
            profileDirOwned: true,
          },
        ]),
      });
      const plan = planGc(snapshot);
      // The two lines this gap is about: neither ever fires for a viaMarker entry.
      expect(plan.actions.find((a) => a.type === 'clearState')).toBeUndefined();
      expect(plan.actions.find((a) => a.type === 'deleteDir' && a.path === victimDir)).toBeUndefined();
      expect(plan.actions).toEqual([]);
      // It can only ever ADD protection, never authorize an action.
      expect(plan.kept.some((k) => k.path === stateFile && k.reason === 'unknown-liveness')).toBe(true);
    });

    it('control: the IDENTICAL attacker-shaped payload with viaMarker:false (a genuinely trusted stale session, e.g. found via the real stateRoot scan) is still cleaned up normally -- proves the gate is keyed on viaMarker, not on quietly suppressing every stale action', () => {
      const victimDir = path.join(TEMP_ROOT, 'sutradhar-cli-1700000000901-trustd');
      const stateFile = path.join(STATE_ROOT, 'trusted', 'state.json');
      const snapshot = baseSnapshot({
        sessions: emptySessions([
          {
            status: 'stale',
            viaMarker: false,
            stateFile,
            sessionId: 'real-session',
            endpoint: 'ws://127.0.0.1:1/devtools/browser/real',
            profileDir: victimDir,
            profileDirOwned: true,
          },
        ]),
      });
      const plan = planGc(snapshot);
      expect(plan.actions.some((a) => a.type === 'clearState' && a.stateFile === stateFile)).toBe(true);
      expect(plan.actions.some((a) => a.type === 'deleteDir' && a.path === victimDir)).toBe(true);
    });

    it('a viaMarker session that classifies as unreadable/live/unresponsive/unknown behaves identically to a non-marker session of the same status -- the gate only needed to change the stale branch, since every other status was already protect-only', () => {
      const stateFile = path.join('D:', 'forged', 'unreadable', 'state.json');
      const snapshot = baseSnapshot({
        sessions: emptySessions([{ status: 'unreadable', viaMarker: true, stateFile }]),
      });
      const plan = planGc(snapshot);
      expect(plan.actions).toEqual([]);
      expect(plan.kept.some((k) => k.path === stateFile && k.reason === 'unreadable-state')).toBe(true);
    });
  });
});

describe('executeGc', () => {
  function makeReadySnapshot(): GcSnapshot {
    return baseSnapshot({ processEnumeration: { ok: true, processes: [] } });
  }

  it('X1: dry-run makes 0 calls to kill/rm/clearState', async () => {
    const dir = path.join(TEMP_ROOT, 'sutradhar-cli-1700000000030');
    const snapshot = baseSnapshot({
      sessions: emptySessions([
        { status: 'stale', sessionId: 's1', endpoint: 'ws://x/devtools/browser/id1', profileDir: dir, profileDirOwned: true },
      ]),
      candidateDirs: [{ path: dir, mtimeMs: Date.now(), isSymlink: false, isDirectory: true }],
    });
    const plan = planGc(snapshot);
    const killSpy = vi.fn();
    const rmSpy = vi.fn();
    const clearSpy = vi.fn();
    const report = await executeGc(plan, snapshot, true, {
      killChromeTree: killSpy,
      removeDirWithRetry: rmSpy,
      clearStateFileIfUnchanged: clearSpy,
    });
    expect(killSpy).not.toHaveBeenCalled();
    expect(rmSpy).not.toHaveBeenCalled();
    expect(clearSpy).not.toHaveBeenCalled();
    expect(report.exitCode).toBe(0);
  });

  it('X2: a kill whose pid is still alive after waitMs gives result failed and exit code 2', async () => {
    const snapshot = makeReadySnapshot();
    const plan = { actions: [{ type: 'kill' as const, pid: 1, role: 'browser' as const, reason: 'orphan-cli' as const, result: 'planned' as const }], kept: [], incomplete: false };
    const report = await executeGc(plan, snapshot, false, {
      killChromeTree: async () => ({ exited: false }),
    });
    const killResult = report.actions.find((a) => a.type === 'kill');
    expect(killResult?.result).toBe('failed');
    expect(report.exitCode).toBe(2);
  });

  it('X3: a changed-concurrently clear is reported and is not itself a failure', async () => {
    const snapshot = baseSnapshot({
      sessions: emptySessions([{ status: 'stale', sessionId: 's1', endpoint: 'ws://x/devtools/browser/id1', stateFile: path.join(STATE_ROOT, 'a', 'state.json') }]),
    });
    const plan = planGc(snapshot);
    const report = await executeGc(plan, snapshot, false, {
      clearStateFileIfUnchanged: async () => 'changed-concurrently',
    });
    const clearResult = report.actions.find((a) => a.type === 'clearState');
    expect(clearResult?.result).toBe('changed-concurrently');
    expect(report.exitCode).toBe(0);
  });

  it('X4: a deleteDir failure gives remaining.orphanDirs >= 1 and exit 2', async () => {
    const dir = path.join(TEMP_ROOT, 'sutradhar-cli-1700000000040');
    const snapshot = baseSnapshot({
      sessions: emptySessions([
        { status: 'stale', sessionId: 's1', endpoint: 'ws://x/devtools/browser/id1', profileDir: dir, profileDirOwned: true },
      ]),
      candidateDirs: [{ path: dir, mtimeMs: Date.now(), isSymlink: false, isDirectory: true }],
    });
    const plan = planGc(snapshot);
    const report = await executeGc(plan, snapshot, false, {
      removeDirWithRetry: async () => ({ status: 'failed', attempts: 8, code: 'EBUSY' }),
    });
    expect(report.remaining.orphanDirs).toBeGreaterThanOrEqual(1);
    expect(report.exitCode).toBe(2);
  });

  it('X5: enumeration unavailable (non-dry) gives exit 2; dry-run gives 0', async () => {
    const snapshot = baseSnapshot({ processEnumeration: { ok: false, reason: 'x' } });
    const plan = planGc(snapshot);
    const reportRun = await executeGc(plan, snapshot, false);
    expect(reportRun.exitCode).toBe(2);
    const reportDry = await executeGc(plan, snapshot, true);
    expect(reportDry.exitCode).toBe(0);
  });
});
