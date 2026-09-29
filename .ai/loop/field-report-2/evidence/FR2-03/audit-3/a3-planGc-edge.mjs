// audit-3: pure planGc edge cases against the BUILT dist (no fs/process mutation).
//  E1 the exact GAP-183 shape the unit test SHOULD model (victim.ppid === killed browser pid, victim created BEFORE the
//     browser) -> must be spared (it is; but no unit test models this -- see N1 in revert-and-confirm-audit3.txt)
//  E2 same shape but victim created in the SAME rounded millisecond as the squatting browser -> the "<=" relaxation
//     trusts the link and plans the kill (documents the residual window's exact size: 1 enumeration-ms)
//  E3 victim 1ms EARLIER -> spared
import path from 'node:path'; import os from 'node:os'; import { pathToFileURL } from 'node:url';
const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '../../../../../..');
const { planGc } = await import(pathToFileURL(path.join(repo, 'packages/cli/dist/gc.js')).href);
const TEMP = os.tmpdir(); const dir = path.join(TEMP, 'sutradhar-cli-1700000000999-edge01');
function snap(victimStart) {
  return { scope: { tempRoot: TEMP, stateRoot: path.join(TEMP, 'nope-sr'), extraStateDirs: [] }, sessions: { stateRoot: '', generatedAt: '', processEnumeration: { ok: true }, sessions: [] },
    processEnumeration: { ok: true, processes: [
      { pid: 5000, ppid: 1, startMs: 100_000, commandLine: `chrome --user-data-dir=${dir} --sutradhar-launch=cli --sutradhar-owner-pid=999991 --sutradhar-owner-start=1` },
      { pid: 6000, ppid: 5000, startMs: victimStart, commandLine: undefined }, // victim: its REAL parent (old pid 5000) died, pid reused by the browser
    ] }, candidateDirs: [], lockProbes: {}, now: Date.now() };
}
const k = (p, pid) => p.actions.some((a) => a.type === 'kill' && a.pid === pid);
const out = {
  E1_victim_8s_before_browser: { victimKilled: k(planGc(snap(92_000)), 6000) },
  E2_victim_same_ms_as_browser: { victimKilled: k(planGc(snap(100_000)), 6000) },
  E3_victim_1ms_before_browser: { victimKilled: k(planGc(snap(99_999)), 6000) },
};
console.log(JSON.stringify(out, null, 2));
