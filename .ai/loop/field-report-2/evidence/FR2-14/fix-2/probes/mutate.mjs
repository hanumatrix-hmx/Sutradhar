// FR2-14 fix-2 mutation runner. argv: <outJsonl> <id> [id...]   (run from anywhere; repo root derived from this file's location)
// For each mutant: sha256 before -> exact-once (EOL-aware) replace -> tsc build of the mutated package -> vitest for the four
// dependent packages (capability-runtime, cli, mcp-server, sutradhar) -> restore from the original bytes, verify sha256 -> rebuild.
// A mutant is CAUGHT iff at least one package's vitest exits non-zero. Appends one JSON line per mutant to <outJsonl>.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const WT = path.resolve(HERE, '../../../../../../..');
const [, , OUT, ...IDS] = process.argv;
const MUTANTS = { ...(await import('./mutants-def.mjs')).MUTANTS, ...(await import('./mutants-audit.mjs')).MUTANTS };
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const TSC = path.join(WT, 'node_modules', 'typescript', 'bin', 'tsc');
const VITEST = path.join(WT, 'node_modules', 'vitest', 'vitest.mjs');
const run = (cmd, args, cwd, ms) => {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: ms, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
};
const build = (pkg) => run(process.execPath, [TSC, '-p', path.join(WT, 'packages', pkg)], WT, 600000);
const strip = (s) => s.replace(/\u001b\[[0-9;]*m/g, '');
for (const id of IDS) {
  const M = MUTANTS[id];
  if (!M) { console.log('unknown ' + id); continue; }
  const file = path.join(WT, M.file);
  const orig = fs.readFileSync(file);
  const before = sha(orig);
  const text = orig.toString('utf8');
  const crlf = text.includes('\r\n');
  const eol = (x) => (crlf ? x.split('\r\n').join('\n').split('\n').join('\r\n') : x);
  const find = eol(M.find);
  const rep = eol(M.replace);
  const count = text.split(find).length - 1;
  const row = { id, desc: M.desc, file: M.file, occurrences: count, shaBefore: before.slice(0, 16) };
  try {
    if (count !== 1) throw new Error('find string occurs ' + count + ' times');
    fs.writeFileSync(file, text.replace(find, () => rep));
    const b = build(M.pkg);
    row.buildCode = b.code;
    if (b.code !== 0) throw new Error('mutant does not type-check: ' + strip(b.out).split('\n').slice(0, 3).join(' | '));
    row.unit = {};
    for (const p of ['capability-runtime', 'cli', 'mcp-server', 'sutradhar']) {
      const r = run(process.execPath, [VITEST, 'run'], path.join(WT, 'packages', p), 900000);
      const o = strip(r.out);
      const m = o.match(/Tests\s+(.*)/);
      row.unit[p] = { code: r.code, tests: m ? m[1].trim() : o.slice(-120), failed: [...o.matchAll(/FAIL\s+(.*)/g)].map((x) => x[1].slice(0, 150)).filter((v, i, a) => a.indexOf(v) === i).slice(0, 3) };
    }
    row.caught = Object.values(row.unit).some((u) => u.code !== 0);
  } catch (e) {
    row.error = String(e.message).slice(0, 300);
  } finally {
    fs.writeFileSync(file, orig);
    row.shaAfter = sha(fs.readFileSync(file)).slice(0, 16);
    row.restoredByteIdentical = row.shaAfter === row.shaBefore;
    row.rebuildCode = build(M.pkg).code;
  }
  fs.appendFileSync(OUT, JSON.stringify(row) + '\n');
  console.log(JSON.stringify({ id, caught: row.caught, error: row.error, restored: row.restoredByteIdentical, rebuild: row.rebuildCode }));
}
