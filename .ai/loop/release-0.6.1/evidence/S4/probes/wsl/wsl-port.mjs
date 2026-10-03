import os from 'node:os'; import path from 'node:path';
const ROOT = process.env.PROBE_ROOT ?? ''; const chk = (p) => { const r = path.resolve(p); return r.startsWith('/mnt/') || !(ROOT && (r === ROOT || r.startsWith(ROOT + '/'))) || !ROOT.startsWith('/tmp/'); };
for (const p of [os.tmpdir(), ROOT, ...(process.env.PROBE_TMPROOTS ?? '').split(':').filter(Boolean)]) if (!p || chk(p)) { console.error(`WSL GUARD: refusing ${p}`); process.exit(97); }
console.error(`[wsl-guard] root=${ROOT}`);
import fsp from 'node:fs/promises'; import { pathToFileURL } from 'node:url'; import { spawn } from 'node:child_process';
const TP = await import(pathToFileURL(process.env.TP_MODULE).href);
const C = await import(new URL('./common.mjs', import.meta.url).href);
const { P, check, done, tree, sameTree, exists, setOld, profileDir, header, sleep } = C;
const ISO = os.tmpdir();
const under = (p) => { const r = path.resolve(p); return r.startsWith(ROOT + '/') && !r.startsWith('/mnt/'); };
const mkroot = async (pfx) => { const t = await fsp.mkdtemp(path.join(ISO, pfx)); if (!under(t)) { console.error(`WSL GUARD: tmpRoot ${t} outside ROOT`); process.exit(97); } return t; };
import { describe, it, beforeEach, afterEach } from 'node:test'; import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises';
const { commandLinesReference, createTempProfileDir, decideRemoval, isAutoTempProfileDir, OWNER_MARKER, readOwnerPid, removeSessionTempProfile, STALE_MIN_AGE_MS, sweepStaleTempProfiles, waitForPidExit, writeOwnerMarker } = TP;
header('wsl-port: 19-case node:test port of temp-profile.spec.ts');
const SROOT = path.resolve(os.tmpdir(), 'root-for-rules');
const DIR = path.join(SROOT, 'sutradhar-cli-1790798002107-AbC123');
const BS = String.fromCharCode(92);
function facts(over = {}) { return { dir: DIR, tmpRoot: SROOT, commandLines: [], ownerAlive: false, ageMs: STALE_MIN_AGE_MS + 1, minAgeMs: STALE_MIN_AGE_MS, ...over }; }
const ex = (p) => stat(p).then(() => true, () => false);
describe('isAutoTempProfileDir (rule 1)', () => {
  it('T01 accepts legacy and mkdtemp-suffixed names directly in the temp root', () => {
    assert.equal(isAutoTempProfileDir(path.join(SROOT, 'sutradhar-cli-1790798002107'), SROOT), true);
    assert.equal(isAutoTempProfileDir(DIR, SROOT), true);
  });
  it('T02 rejects named profiles, nested dirs, other roots and look-alikes', () => {
    assert.equal(isAutoTempProfileDir(path.join(os.homedir(), '.sutradhar', 'profiles', 'work'), SROOT), false);
    assert.equal(isAutoTempProfileDir(path.join(SROOT, 'work'), SROOT), false);
    assert.equal(isAutoTempProfileDir(path.join(SROOT, 'nested', 'sutradhar-cli-1790798002107'), SROOT), false);
    assert.equal(isAutoTempProfileDir(path.join(SROOT + '-other', 'sutradhar-cli-1790798002107'), SROOT), false);
    assert.equal(isAutoTempProfileDir(path.join(SROOT, 'sutradhar-cli-'), SROOT), false);
    assert.equal(isAutoTempProfileDir(path.join(SROOT, 'sutradhar-cli-abc'), SROOT), false);
    assert.equal(isAutoTempProfileDir(path.join(SROOT, 'sutradhar-cli-1790798002107-x', '..', '..'), SROOT), false);
    assert.equal(isAutoTempProfileDir(SROOT, SROOT), false);
  });
});
describe('commandLinesReference (rule 2 matcher)', () => {
  it('T03 matches the basename as a whole token, case-insensitively, whatever the path form', () => {
    assert.equal(commandLinesReference(DIR, ['chrome.exe --user-data-dir=C:' + BS + 'TEMP' + BS + 'SUTRADHAR-CLI-1790798002107-AbC123 --type=renderer']), true);
    assert.equal(commandLinesReference(DIR, ['chrome --user-data-dir="/tmp/sutradhar-cli-1790798002107-AbC123"']), true);
  });
  it('T04 does not match a longer name that merely starts with it', () => {
    const legacy = path.join(SROOT, 'sutradhar-cli-1790798002107');
    assert.equal(commandLinesReference(legacy, ['chrome --user-data-dir=E:' + BS + 'tmp' + BS + 'sutradhar-cli-1790798002107-AbC123']), false);
    assert.equal(commandLinesReference(legacy, ['chrome --user-data-dir=E:' + BS + 'tmp' + BS + 'sutradhar-cli-17907980021079']), false);
    assert.equal(commandLinesReference(legacy, ['x sutradhar-cli-17907980021079 y --user-data-dir=E:' + BS + 'tmp' + BS + 'sutradhar-cli-1790798002107']), true);
  });
});
describe('decideRemoval', () => {
  it('T05 removes only when every rule holds', () => { assert.deepEqual(decideRemoval(facts()), { remove: true }); });
  it('T06 keeps a named/non-temp dir even when everything else says remove', () => { assert.deepEqual(decideRemoval(facts({ dir: path.join(SROOT, 'my-profile') })), { remove: false, reason: 'not-auto-temp' }); });
  it('T07 fails closed when the process scan failed', () => { assert.deepEqual(decideRemoval(facts({ commandLines: null })), { remove: false, reason: 'scan-unavailable' }); });
  it('T08 keeps a dir a running process has on its command line, even if the owner PID is dead and it is old', () => { assert.deepEqual(decideRemoval(facts({ commandLines: [`chrome --user-data-dir=${DIR}`], ageMs: 1e9 })), { remove: false, reason: 'in-use' }); });
  it('T09 keeps a dir whose owning Chrome PID is alive', () => { assert.deepEqual(decideRemoval(facts({ ownerPid: 123, ownerAlive: true })), { remove: false, reason: 'owner-alive' }); });
  it('T10 keeps a dir younger than the threshold', () => {
    assert.deepEqual(decideRemoval(facts({ ageMs: STALE_MIN_AGE_MS - 1 })), { remove: false, reason: 'too-young' });
    assert.deepEqual(decideRemoval(facts({ ageMs: 0, minAgeMs: 0 })), { remove: true });
    assert.deepEqual(decideRemoval(facts({ ageMs: -5, minAgeMs: 0 })), { remove: true });
  });
});
describe('waitForPidExit', () => {
  it('T11 returns false at the hard timeout for a PID that never exits', async () => { const t0 = performance.now(); assert.equal(await waitForPidExit(1, 300, () => true), false); assert.ok(performance.now() - t0 < 5000); });
  it('T12 returns true once the PID is gone', async () => { let n = 0; assert.equal(await waitForPidExit(1, 5000, () => ++n < 3), true); });
});
describe('filesystem paths (scratch temp root)', () => {
  let root;
  beforeEach(async () => { root = await mkdtemp(path.join(os.tmpdir(), 'gap315-spec-')); P('spec-root', root); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });
  async function oldDir(name) { const d = path.join(root, name); await mkdir(path.join(d, 'Default'), { recursive: true }); await writeFile(path.join(d, 'Default', 'Preferences'), '{}'); const past = new Date(Date.now() - 2 * STALE_MIN_AGE_MS); await utimes(d, past, past); return d; }
  it('T13 createTempProfileDir makes unique, rule-1-matching dirs; the marker round-trips', async () => {
    const a = await createTempProfileDir(root); const b = await createTempProfileDir(root); P('created', a); P('created', b);
    assert.notEqual(a, b); assert.equal(isAutoTempProfileDir(a, root), true); await writeOwnerMarker(a, 4242); assert.equal(await readOwnerPid(a), 4242);
  });
  it('T14 sweep removes only stale, unreferenced, dead-owner temp dirs', async () => {
    const stale = await oldDir('sutradhar-cli-1790000000001'); const inUse = await oldDir('sutradhar-cli-1790000000002'); const liveOwner = await oldDir('sutradhar-cli-1790000000003-Zz9');
    await writeFile(path.join(liveOwner, OWNER_MARKER), JSON.stringify({ chromePid: process.pid }));
    const young = path.join(root, 'sutradhar-cli-1790000000004'); await mkdir(young); const named = await oldDir('work-profile');
    const res = await sweepStaleTempProfiles({ tmpRoot: root, scan: async () => [`chrome.exe --user-data-dir=${inUse} --type=gpu-process`] });
    for (const r of res.removed) P('sweep-removed', r);
    assert.deepEqual(res.removed, [stale]);
    assert.deepEqual(Object.fromEntries(res.kept.map((k) => [path.basename(k.dir), k.reason])), { 'sutradhar-cli-1790000000002': 'in-use', 'sutradhar-cli-1790000000003-Zz9': 'owner-alive', 'sutradhar-cli-1790000000004': 'too-young' });
    assert.equal(await ex(stale), false); for (const d of [inUse, liveOwner, young, named]) assert.equal(await ex(d), true);
  });
  it('T15 sweep deletes nothing when the process scan fails', async () => { const stale = await oldDir('sutradhar-cli-1790000000001'); const res = await sweepStaleTempProfiles({ tmpRoot: root, scan: async () => null }); assert.deepEqual(res.removed, []); assert.equal(await ex(stale), true); });
  it('T16 close removes its own fresh temp dir (no age threshold) once the owner is gone', async () => { const d = await createTempProfileDir(root); P('created', d); await writeFile(path.join(d, 'lockfile'), String()); const res = await removeSessionTempProfile(d, undefined, { tmpRoot: root, scan: async () => [] }); assert.deepEqual(res, { removed: true }); assert.equal(await ex(d), false); });
  it('T17 close never removes a dir still referenced by a running process', async () => { const d = await createTempProfileDir(root); const res = await removeSessionTempProfile(d, undefined, { tmpRoot: root, scan: async () => [`chrome --user-data-dir=${d}`] }); assert.deepEqual(res, { removed: false, reason: 'in-use' }); assert.equal(await ex(d), true); });
  it('T18 close never removes a named profile dir', async () => { const d = await oldDir('work-profile'); const res = await removeSessionTempProfile(d, undefined, { tmpRoot: root, scan: async () => [] }); assert.deepEqual(res, { removed: false, reason: 'not-auto-temp' }); assert.equal(await ex(d), true); });
  it('T19 close keeps the dir if Chrome does not exit within the timeout', async () => { const d = await createTempProfileDir(root); const res = await removeSessionTempProfile(d, process.pid, { tmpRoot: root, exitTimeoutMs: 200, scan: async () => [] }); assert.equal(res.removed, false); assert.match(res.reason, /did not exit in time/); assert.equal(await ex(d), true); });
});
