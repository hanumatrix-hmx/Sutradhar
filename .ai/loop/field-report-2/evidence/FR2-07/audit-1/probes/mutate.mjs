// Auditor mutation driver: apply ONE exact-string mutant, run the package's vitest, restore the
// original bytes, and prove restoration by sha256. Never commits anything.
// Usage: node mutate.mjs <repoRoot> <out.json>
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
const [root, out] = process.argv.slice(2);
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const V = 'packages/browser/src/verifier/';
const mutants = [
  { id: 'M1-http-status-500-only', file: V + 'post-conditions.ts', find: 'const bad = newDoc && o.status >= 400;', repl: 'const bad = newDoc && o.status >= 500;', pkg: 'packages/browser' },
  { id: 'M2-zero-byte-download-accepted', file: V + 'post-conditions.ts', find: 'if (st.size === 0) {', repl: 'if (st.size < 0) {', pkg: 'packages/browser' },
  { id: 'M3-clipboard-length-only', file: V + 'post-conditions.ts', find: 'if (r.text === written) {', repl: 'if (r.text.length === written.length) {', pkg: 'packages/browser' },
  { id: 'M4-expect-notrun-counts-as-verified', file: V + 'execution-verifier.ts', find: 'if (!anyPass || anyExpectNotRun) {', repl: 'if (!anyPass) {', pkg: 'packages/browser' },
  { id: 'M5-focus-any-active-element', file: V + 'post-conditions.ts', find: 'return { ok: a === el, observed:', repl: 'return { ok: a !== null, observed:', pkg: 'packages/browser' },
  { id: 'M6-untrusted-keydown-counts', file: V + 'post-conditions.ts', find: '(ev) => ev.trusted && matches(ev),', repl: '(ev) => matches(ev),', pkg: 'packages/browser' },
  { id: 'M7-text-uses-textContent', file: V + 'execution-verifier.ts', find: "if (body && typeof body.innerText === 'string' && body.innerText.includes(t)) return true;", repl: "if (body && (body.textContent ?? '').includes(t)) return true;", pkg: 'packages/browser' },
  { id: 'M8-key-delivery-enough-for-value-rule', file: V + 'post-conditions.ts', find: '    if (post.valueChanged) {\n      return done(\'pass\'', repl: '    if (post.valueChanged || post.delivered) {\n      return done(\'pass\'', pkg: 'packages/browser' },
  { id: 'M9-goback-swallows-all-errors', file: 'packages/capability-runtime/src/runtime.ts', find: "if (!/history entry to navigate to not found/i.test((e as Error)?.message ?? '')) throw e;", repl: 'void e;', pkg: 'packages/capability-runtime' },
  { id: 'M10-sdk-no-throw-on-failure', file: 'packages/sutradhar/src/page.ts', find: 'if (!result.success) throw new ActionFailedError(result);', repl: 'void ActionFailedError;', pkg: 'packages/sutradhar' },
];
const only = process.env.MUTANTS ? new Set(process.env.MUTANTS.split(',')) : null;
const results = [];
for (const m of mutants) {
  if (only && !only.has(m.id)) continue;
  const fp = path.join(root, m.file);
  const orig = await fs.readFile(fp);
  const before = sha(orig);
  const src = orig.toString('utf8');
  const count = src.split(m.find).length - 1;
  if (count !== 1) { results.push({ id: m.id, error: `anchor matched ${count} times` }); console.log(m.id, 'ANCHOR', count); continue; }
  let run;
  try {
    await fs.writeFile(fp, src.replace(m.find, m.repl));
    run = spawnSync(process.execPath, [path.join(root, 'node_modules', 'vitest', 'vitest.mjs'), 'run', '--globals'], { cwd: path.join(root, m.pkg), encoding: 'utf8', timeout: 600000 });
  } finally {
    await fs.writeFile(fp, orig);
  }
  const after = sha(await fs.readFile(fp));
  const txt = (run.stdout + run.stderr).replace(/\x1b\[[0-9;]*m/g, '');
  const tests = (txt.match(/Tests\s+[^\n]+/) || [''])[0];
  const failedNames = [...txt.matchAll(/FAIL\s+([^\n]+)/g)].map((x) => x[1].trim()).slice(0, 6);
  const r = { id: m.id, file: m.file, exit: run.status, caught: run.status !== 0, tests, failedNames, shaBefore: before, shaAfter: after, restored: before === after };
  results.push(r);
  console.log(JSON.stringify(r));
}
await fs.writeFile(out, JSON.stringify(results, null, 2));
