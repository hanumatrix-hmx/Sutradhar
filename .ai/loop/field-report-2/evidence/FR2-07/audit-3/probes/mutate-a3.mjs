// audit-3 mutation driver: applies ONE mutant at a time to execution-verifier.ts (exactly-one-occurrence replace),
// runs the browser package's vitest, restores the file byte-identically (sha256 before/after, per mutant and at end).
import fs from 'node:fs'; import crypto from 'node:crypto'; import path from 'node:path'; import { spawnSync } from 'node:child_process';
const WT = process.cwd();
const FILE = path.join(WT, 'packages/browser/src/verifier/execution-verifier.ts');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const orig = fs.readFileSync(FILE); const shaBefore = sha(orig);
export const MUTANTS = [
  ['N1', 'frame element visibility ignored', "  if (cs.visibility !== 'visible') return false;\n  if (typeof (el as Element", "  if (false) return false;\n  if (typeof (el as Element"],
  ['N2', 'frame element zero-area accepted', 'return r.width > 0 && r.height > 0 && el.getClientRects().length > 0;', 'return true;'],
  ['N3', 'content-visibility:hidden on the iframe itself ignored', "if (!el.checkVisibility() || cs.contentVisibility === 'hidden') return false;", 'if (!el.checkVisibility()) return false;'],
  ['N4', 'aggregation: hung/failed frames conclude not-found', 'if (tally.absent === frames.length) return resolve', 'if (tally.found === 0) return resolve'],
  ['N5', 'per-frame error fails OPEN to found', "return r.timedOut ? 'hung' : 'failed';", "return r.timedOut ? 'hung' : 'found';"],
  ['N6', 'expect not-run no longer blocks verified when built-in passed', 'if (!anyPass || anyExpectNotRun) {', 'if (!anyPass) {'],
  ['N7', 'F4 reason: expectation-only verification reported like a built-in pass', "} else if (bi.outcome === 'pass') {\n      const met", "} else if (bi.outcome !== 'fail') {\n      const met"],
  ['N8', 'split match: only the first segment must be rendered', 'if (!rendered(sg.node)) {\n            allRendered = false;', 'if (sg === segs[0] && !rendered(sg.node)) {\n            allRendered = false;'],
  ['N9', 'match may cross a block boundary', 'if (j > i && blockOf(it) !== block) break;', ''],
  ['N10', 'display:contents container judged directly (no climb)', "while (e && styleOf(e).display === 'contents') e = flatParent(e);", ''],
  ['N11', 'slots never followed to their assigned nodes', 'kids = assigned.length > 0 ? assigned : Array.from(el.childNodes);', 'kids = Array.from(el.childNodes);'],
  ['N12', 'hidden-link dominance lost for the parent chain (up hidden ignored)', "    if (up === 'hidden') return 'hidden';\n", ''],
];
const only = process.argv.slice(2);
const results = [];
try {
  for (const [id, why, from, to] of MUTANTS) {
    if (only.length && !only.includes(id)) continue;
    const s = orig.toString('utf8');
    const n = s.split(from).length - 1;
    if (n !== 1) { results.push({ id, why, error: `pattern occurs ${n} times` }); continue; }
    fs.writeFileSync(FILE, s.replace(from, to));
    const t0 = performance.now();
    const r = spawnSync(process.execPath, [path.join(WT, 'node_modules/vitest/vitest.mjs'), 'run'], { cwd: path.join(WT, 'packages/browser'), encoding: 'utf8', timeout: 600000 });
    const outp = (r.stdout || '') + (r.stderr || '');
    fs.writeFileSync(FILE, orig);
    const restored = sha(fs.readFileSync(FILE)) === shaBefore;
    const summary = (outp.match(/Tests\s+.*\(\d+\)/) || [''])[0].replace(/\x1b\[[0-9;]*m/g, '');
    const fails = [...outp.replace(/\x1b\[[0-9;]*m/g, '').matchAll(/FAIL\s+(tests\/unit\/[^\n]{0,160})/g)].map((m) => m[1]).slice(0, 3);
    results.push({ id, why, exit: r.status, caught: r.status !== 0, summary, firstFailures: fails, restoredIdentical: restored, ms: Math.round(performance.now() - t0) });
    console.log(id, r.status !== 0 ? 'CAUGHT' : 'SURVIVED', summary, restored ? 'restored' : 'NOT-RESTORED');
  }
} finally {
  fs.writeFileSync(FILE, orig);
}
const shaAfter = sha(fs.readFileSync(FILE));
const outj = { file: FILE, shaBefore, shaAfter, identical: shaBefore === shaAfter, results };
fs.writeFileSync(path.join(WT, '.ai/loop/field-report-2/evidence/FR2-07/audit-3/mutation-unit.json'), JSON.stringify(outj, null, 2));
console.log('sha identical', outj.identical);
