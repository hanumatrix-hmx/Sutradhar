// FR2-07 fix-2 step 5: REVERT-AND-CONFIRM. Applies each mutant to packages/browser/src/verifier/execution-verifier.ts,
// runs the unit suites that pin the contract, records whether they FAIL (caught), restores the file byte-identically
// (sha256 checked before, after every restore, and at the end). Usage: node mutate-fix2.mjs <repoRoot> <outJson> [--only=M1,M2]
// Never touches any other file. Hard timeout per mutant run: 240 s.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const repo = process.argv[2];
const out = process.argv[3];
const only = (process.argv.find((a) => a.startsWith('--only=')) ?? '').slice(7).split(',').filter(Boolean);
const target = path.join(repo, 'packages', 'browser', 'src', 'verifier', 'execution-verifier.ts');
const browserDir = path.join(repo, 'packages', 'browser');
const vitest = path.join(repo, 'node_modules', 'vitest', 'vitest.mjs');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const original = fs.readFileSync(target);
const shaBefore = sha(original);
const src = original.toString('utf8');

/** { id, why (the plan's mutant), from, to } : `from` must occur EXACTLY once. */
const MUTANTS = [
  { id: 'M1', why: 'drop the parent-side frame check (hidden frame treated as shown)', from: "          if (s === 'hidden') return 'absent';\n", to: '' },
  { id: 'M2', why: 'drop the visibility-inheritance check', from: "if (laidOut && styleOf(c).visibility === 'visible') {", to: 'if (laidOut) {' },
  { id: 'M3a', why: 'fail OPEN: no checkVisibility => treat as rendered (instead of throwing)', from: "          if (typeof (e as Element & { checkVisibility?: unknown }).checkVisibility !== 'function') {\n            throw new Error('Element.checkVisibility is unavailable in this browser; cannot judge rendering');\n          }\n          // a closed", to: "          if (typeof (e as Element & { checkVisibility?: unknown }).checkVisibility !== 'function') {\n            memo.set(n, true);\n            return true;\n          }\n          // a closed" },
  { id: 'M3b', why: 'guard fails OPEN: an exhausted work budget silently continues instead of failing closed', from: "if (++spent > BUDGET) throw new Error('the text check exceeded its work budget; page too large to judge');", to: 'if (++spent > BUDGET) return;' },
  { id: 'M4', why: 'drop the Range client-rects check', from: 'if (laidOut && styleOf(c).visibility', to: 'if (styleOf(c).visibility' },
  { id: 'M5', why: 'aggregation waits for every frame before answering (no short-circuit on found)', from: "          if (o === 'found') return resolve({ result: 'found' });\n          if (--pending > 0) return;\n", to: "          if (--pending > 0) return;\n          if (tally.found > 0) return resolve({ result: 'found' });\n" },
  { id: 'M6', why: 'aggregation: ANY hung/failed frame makes the result unavailable even when the text was found elsewhere', from: "          if (o === 'found') return resolve({ result: 'found' });\n          if (--pending > 0) return;\n", to: "          if (--pending > 0) return;\n          if (tally.found > 0 && tally.hung + tally.failed + tally.unjudged === 0) return resolve({ result: 'found' });\n" },
  { id: 'M7', why: 'walk elements, not text nodes: bare text in a shadow root is never collected', from: '    if (n.nodeType === 3) {\n      items.push(n as Text);', to: '    if (n.nodeType === 3) {\n      if ((n as Text).parentElement) items.push(n as Text);' },
  { id: 'M8', why: 'flip the fail-closed default: an unjudgeable frame is entered and trusted', from: "          if (s === 'unjudgeable') return 'unjudged';\n", to: '' },
  { id: 'M9', why: 'drop the closed-details rule for direct text', from: 'ok = !closedDetails && e.checkVisibility()', to: 'ok = e.checkVisibility()' },
  { id: 'M10', why: 'drop the checkVisibility() judgement (content-visibility:hidden / closed <details> ancestors)', from: 'ok = !closedDetails && e.checkVisibility() && styleOf(e)', to: 'ok = !closedDetails && styleOf(e)' },
  { id: 'M11', why: 'bare shadow text: ignore the shadow host as container', from: '    return root && root.host ? root.host : null;', to: '    return null;' },
  { id: 'M12', why: 'a hidden link in the frame chain no longer dominates (hidden parent, shown child => shown)', from: "    if (up === 'hidden') return 'hidden';\n    return own === 'shown' && up === 'shown' ? 'shown' : 'unjudgeable';", to: "    return own === 'shown' ? 'shown' : 'unjudgeable';" },
  { id: 'M13', why: 'per-frame bound removed: frame waits are unbounded (only the backstop remains)', from: '        EXPECT_TEXT_TIMEOUT_MS,\n      );\n      if (r.ok) return r.value;', to: '        60000,\n      );\n      if (r.ok) return r.value;' },
];

const results = [];
try {
  for (const m of MUTANTS) {
    if (only.length && !only.includes(m.id)) continue;
    const count = src.split(m.from).length - 1;
    if (count !== 1) {
      results.push({ id: m.id, why: m.why, error: `pattern occurs ${count} times (need exactly 1)` });
      console.log(m.id, 'PATTERN ERROR', count);
      continue;
    }
    fs.writeFileSync(target, src.replace(m.from, () => m.to));
    const t0 = performance.now();
    const r = spawnSync(process.execPath, [vitest, 'run', 'tests/unit/execution-verifier.spec.ts', 'tests/unit/expect-text-matrix.spec.ts'], { cwd: browserDir, encoding: 'utf8', timeout: 240000, maxBuffer: 64 * 1024 * 1024 });
    const outText = (r.stdout ?? '') + (r.stderr ?? '');
    const strip = outText.replace(/\x1b\[[0-9;]*m/g, '');
    const failedTests = [...strip.matchAll(/FAIL\s+tests\/unit\/[^\n]*/g)].map((x) => x[0].slice(0, 220));
    const summary = (strip.match(/Tests\s+[^\n]*/) ?? [''])[0];
    fs.writeFileSync(target, original); // restore immediately
    const shaNow = sha(fs.readFileSync(target));
    const row = { id: m.id, why: m.why, unitCaught: r.status !== 0, exit: r.status, summary, firstFailures: failedTests.slice(0, 4), failedCount: failedTests.length, restoredIdentical: shaNow === shaBefore, ms: Math.round(performance.now() - t0) };
    results.push(row);
    console.log(m.id, row.unitCaught ? 'CAUGHT' : 'NOT CAUGHT', summary, 'restored:', row.restoredIdentical);
  }
} finally {
  fs.writeFileSync(target, original);
}
const shaAfter = sha(fs.readFileSync(target));
fs.writeFileSync(out, JSON.stringify({ shaBefore, shaAfter, identical: shaBefore === shaAfter, results }, null, 2));
console.log('sha256 before', shaBefore, 'after', shaAfter, shaBefore === shaAfter ? 'IDENTICAL' : 'DIFFERENT');
