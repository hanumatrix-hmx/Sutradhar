// AUDIT-2 mutant runner. argv: <mutantId> <scratch>. One mutant per invocation: sha256 before, exact-once
// replace, forced build (package + bundle), unit suites, my f1-attack probe, the live CLI F1 part (or the SDK F1
// cases), then restore byte-identically (sha256 checked) and rebuild. Appends one JSON line to ../mutants.jsonl.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const WT = path.resolve(HERE, '../../../../../../..');
const [, , ID, SCR] = process.argv;
const M = (await import('./mutants-def.mjs')).MUTANTS[ID];
if (!M) throw new Error('unknown mutant ' + ID);
const file = path.join(WT, M.file);
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const orig = fs.readFileSync(file); const before = sha(orig);
const text = orig.toString('utf8');
const CRLF = text.includes(String.fromCharCode(13, 10)); const NL = String.fromCharCode(10); const eol = (x) => (CRLF ? x.split(String.fromCharCode(13, 10)).join(NL).split(NL).join(String.fromCharCode(13, 10)) : x);
M.find = eol(M.find); M.replace = eol(M.replace);
const count = text.split(M.find).length - 1;
const out = { id: ID, desc: M.desc, file: M.file, shaBefore: before, occurrences: count };
const env = { ...process.env, TEMP: path.join(SCR, 'tmp'), TMP: path.join(SCR, 'tmp') };
for (const k of Object.keys(env)) if (/^SUTRADHAR_/i.test(k)) delete env[k];
fs.mkdirSync(env.TEMP, { recursive: true });
const run = (cmd, args, cwd, ms) => { const r = spawnSync(cmd, args, { cwd, env, encoding: 'utf8', timeout: ms, windowsHide: true, shell: false, maxBuffer: 64 * 1024 * 1024 }); return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }; };
const turbo = path.join(WT, 'node_modules/.bin/turbo.cmd');
const vitest = path.join(WT, 'node_modules/.bin/vitest.cmd');
const build = () => {
  const a = run('cmd.exe', ['/c', turbo, 'run', 'build', '--force', '--concurrency=1', '--filter=' + M.pkg], WT, 900000);
  const b = run('cmd.exe', ['/c', turbo, 'run', 'build', '--force', '--concurrency=1', '--filter=sutradhar'], WT, 900000);
  return { pkg: a.code, bundle: b.code, tail: (a.out + b.out).split(String.fromCharCode(10)).filter((l) => /error|Tasks:|Failed/i.test(l)).slice(-6) };
};
try {
  if (count !== 1) throw new Error('find string occurs ' + count + ' times');
  fs.writeFileSync(file, text.replace(M.find, M.replace));
  out.build = build();
  if (out.build.pkg !== 0 || out.build.bundle !== 0) throw new Error('mutant build failed (type-invalid?)');
  out.unit = {};
  for (const p of ['packages/capability-runtime', 'packages/cli', 'packages/mcp-server', 'packages/sutradhar']) {
    const r = run('cmd.exe', ['/c', vitest, 'run'], path.join(WT, p), 900000);
    const m = r.out.replace(/\u001b\[[0-9;]*m/g, '').match(/Tests\s+(.*)/);
    out.unit[path.basename(p)] = { code: r.code, tests: m ? m[1].trim() : r.out.slice(-200), failed: [...r.out.replace(/\u001b\[[0-9;]*m/g, '').matchAll(/FAIL\s+(.*)/g)].map((x) => x[1].slice(0, 140)).slice(0, 6) };
  }
  const fa = run(process.execPath, [path.join(HERE, 'f1-attack.mjs'), path.join(SCR, 'f1m-' + ID)], HERE, 600000);
  const j = fa.out.slice(fa.out.lastIndexOf('{\n "pass"'));
  try { const s = JSON.parse(j); out.f1attack = { pass: s.pass, fail: s.fail, firstFails: s.failures.slice(0, 4).map((x) => x.id + ' ' + (x.why || '')) }; } catch { out.f1attack = { raw: fa.out.slice(-300) }; }
  if (M.live === 'cli') {
    const lv = run(process.execPath, [path.join(HERE, 'live-cli.mjs'), 'pkg', path.join(SCR, 'lm-' + ID), 'f1'], HERE, 900000);
    const last = lv.out.trim().split(String.fromCharCode(10)).pop(); try { const s = JSON.parse(last); out.liveCliF1 = { pass: s.pass, fail: s.fail, fails: s.fails }; } catch { out.liveCliF1 = { raw: lv.out.slice(-300) }; }
    try { fs.renameSync(path.join(HERE, '..', 'live-cli-pkg-f1.jsonl'), path.join(HERE, '..', 'mutant-' + ID + '-live-cli-f1.jsonl')); } catch {}
  }
  if (M.live === 'f8kill') { const lv = run(process.execPath, [path.join(HERE, 'f8-kill-check.mjs'), path.join(SCR, 'fk-' + ID)], HERE, 300000); try { out.f8kill = JSON.parse(lv.out.trim().split(String.fromCharCode(10)).pop()); } catch { out.f8kill = { raw: lv.out.slice(-300) }; } }
  if (M.live === 'sdk') { const lv = run(process.execPath, [path.join(HERE, 'sdk-f1-mini.mjs'), path.join(SCR, 'sm-' + ID)], HERE, 600000); try { out.liveSdkF1 = JSON.parse(lv.out.trim().split(String.fromCharCode(10)).pop()); } catch { out.liveSdkF1 = { raw: lv.out.slice(-300) }; } }
} catch (e) { out.error = String(e.message).slice(0, 300); }
finally {
  fs.writeFileSync(file, orig);
  out.shaAfter = sha(fs.readFileSync(file)); out.restored = out.shaAfter === before;
  out.rebuild = build();
}
const unitCaught = out.unit ? Object.values(out.unit).some((u) => u.code !== 0) : false;
const probeCaught = !!(out.f1attack && out.f1attack.fail > 0);
const liveCaught = !!(out.liveCliF1 && out.liveCliF1.fail > 0) || !!(out.liveSdkF1 && out.liveSdkF1.fail > 0);
out.caught = { unit: unitCaught, f1attack: probeCaught, liveCli: liveCaught, any: unitCaught || probeCaught || liveCaught };
fs.appendFileSync(path.join(HERE, '..', 'mutants.jsonl'), JSON.stringify(out) + '\n');
console.log(JSON.stringify(out, null, 1));
