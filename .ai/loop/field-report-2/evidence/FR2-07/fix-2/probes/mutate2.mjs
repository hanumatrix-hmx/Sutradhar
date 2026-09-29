// Auditor-2 mutation driver: apply ONE exact-string mutant, run the package vitest, restore original
// bytes, prove restoration by sha256 (before/after). Never commits. Optional LIVE hook: if
// MUT_LIVE_CMD is set, after the unit run it rebuilds packages/browser (tsc), runs the live command,
// restores the source, rebuilds, and proves the dist file sha is back to the original.
// Usage: node mutate2.mjs <repoRoot> <out.json>   (MUTANTS=id1,id2 to filter)
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
const [root, out] = process.argv.slice(2);
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const EV = 'packages/browser/src/verifier/execution-verifier.ts';
const PC = 'packages/browser/src/verifier/post-conditions.ts';
const B = 'packages/browser';
const mutants = [
  { id: 'R-F2-clipboard-length-only', file: PC, find: 'if (r.text === written) {', repl: 'if (r.text.length === written.length) {', pkg: B },
  { id: 'R-F3-focus-any-active-element', file: PC, find: 'return { ok: a === el, observed:', repl: 'return { ok: a !== null, observed:', pkg: B },
  { id: 'N1-drop-document-box-check', file: EV, find: "de.getClientRects().length === 0) return false;", repl: "de.getClientRects().length === -1) return false;", pkg: B },
  { id: 'N2-drop-frameElement-hop', file: EV, find: 'next = (w.frameElement as Element | null) ?? null;', repl: 'next = null; void w;', pkg: B },
  { id: 'N3-drop-shadow-host-hop', file: EV, find: 'if (root && root.host) next = root.host;', repl: 'if (root && root.host) next = null;', pkg: B },
  { id: 'N4-skip-start-display-check', file: EV, find: "if (cs && (cs.display === 'none' || (e !== start", repl: "if (cs && ((e !== start && cs.display === 'none') || (e !== start", pkg: B },
  { id: 'N5-body-match-not-confirmed', file: EV, find: 'body.innerText.includes(t) && rendered(body)) return true;', repl: 'body.innerText.includes(t)) return true;', pkg: B },
  { id: 'N6-shadow-match-not-confirmed', file: EV, find: 'it.includes(t) && rendered(child)) return true;', repl: 'it.includes(t)) return true;', pkg: B },
  { id: 'N7-shallow-guard-fails-open', file: EV, find: 'guard < 10000; guard++', repl: 'guard < 2; guard++', pkg: B },
  { id: 'N8-drop-content-visibility-check', file: EV, find: "(e !== start && cs.contentVisibility === 'hidden')", repl: '(false)', pkg: B },
  { id: 'N9-F4-notrun-labelled-as-builtin-pass', file: EV, find: "} else if (bi.outcome === 'pass') {", repl: "} else if (bi.outcome !== 'fail') {", pkg: B },
  { id: 'N10-failed-frames-reported-not-found', file: EV, find: 'if (failed > 0) return {', repl: 'if (failed > frames.length) return {', pkg: B },
];
const only = process.env.MUTANTS ? new Set(process.env.MUTANTS.split(',')) : null;
const results = [];
const tscBuild = () => spawnSync(process.execPath, [path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.json'], { cwd: path.join(root, B), encoding: 'utf8', timeout: 300000 });
for (const m of mutants) {
  if (only && !only.has(m.id)) continue;
  const fp = path.join(root, m.file);
  const orig = await fs.readFile(fp);
  const before = sha(orig);
  const src = orig.toString('utf8');
  const count = src.split(m.find).length - 1;
  if (count !== 1) { results.push({ id: m.id, error: 'anchor matched ' + count + ' times' }); console.log(m.id, 'ANCHOR', count); continue; }
  let run; let live;
  const distFile = path.join(root, B, 'dist', 'verifier', path.basename(m.file).replace(/\.ts$/, '.js'));
  const distBefore = sha(await fs.readFile(distFile));
  try {
    await fs.writeFile(fp, src.replace(m.find, m.repl));
    run = spawnSync(process.execPath, [path.join(root, 'node_modules', 'vitest', 'vitest.mjs'), 'run'], { cwd: path.join(root, m.pkg), encoding: 'utf8', timeout: 600000 });
    if (process.env.MUT_LIVE_CMD) {
      const b = tscBuild();
      const l = spawnSync(process.env.MUT_LIVE_CMD, { shell: true, cwd: root, encoding: 'utf8', timeout: 1100000 });
      live = { buildExit: b.status, exit: l.status, tail: (l.stdout + l.stderr).split(String.fromCharCode(10)).filter((x) => /^(PASS|FAIL|SUMMARY)/.test(x)).map((x) => x.slice(0, 160)) };
    }
  } finally {
    await fs.writeFile(fp, orig);
  }
  const after = sha(await fs.readFile(fp));
  let distAfter;
  if (process.env.MUT_LIVE_CMD) { tscBuild(); }
  distAfter = sha(await fs.readFile(distFile));
  const txt = (run.stdout + run.stderr).replace(/\x1b\[[0-9;]*m/g, '');
  const tests = (txt.match(/Tests\s+[^\n]+/) || [''])[0];
  const failedNames = [...txt.matchAll(/FAIL\s+([^\n]+)/g)].map((x) => x[1].trim()).slice(0, 6);
  const r = { id: m.id, file: m.file, find: m.find, repl: m.repl, exit: run.status, caught: run.status !== 0, tests, failedNames, shaBefore: before, shaAfter: after, restored: before === after, distShaBefore: distBefore, distShaAfter: distAfter, distRestored: distBefore === distAfter, live };
  results.push(r);
  console.log(JSON.stringify({ id: r.id, caught: r.caught, tests: r.tests, restored: r.restored, distRestored: r.distRestored, failed: failedNames.slice(0, 2), live }));
}
await fs.writeFile(out, JSON.stringify(results, null, 2));
