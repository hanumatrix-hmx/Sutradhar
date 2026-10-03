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
  commandLinesReference,
  createTempProfileDir,
  decideRemoval,
  isAutoTempProfileDir,
  OWNER_MARKER,
  readOwnerPid,
  removeSessionTempProfile,
  STALE_MIN_AGE_MS,
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
