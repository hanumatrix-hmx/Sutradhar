// AUDIT-2 harness mutant for the CLI post-spawn kill path (F8). Phase A: both viewport bounds widened (parse-args +
// resolveViewport), kill kept -> expect exit 1 and NO Chrome left. Phase B (positive control): also remove the kill ->
// expect a leak (then killed by PID via the marker). Restores byte-identically. argv: <scratch>
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromePids } from './obs.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const WT = path.resolve(HERE, '../../../../../../..');
const SCR = path.resolve(process.argv[2]);
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const F = {
  pa: path.join(WT, 'packages/cli/src/parse-args.ts'),
  cp: path.join(WT, 'packages/capability-runtime/src/config-precedence.ts'),
  cli: path.join(WT, 'packages/cli/src/cli.ts'),
};
const orig = Object.fromEntries(Object.entries(F).map(([k, f]) => [k, fs.readFileSync(f)]));
const before = Object.fromEntries(Object.entries(orig).map(([k, b]) => [k, sha(b)]));
const env = { ...process.env, TEMP: path.join(SCR, 'tmp'), TMP: path.join(SCR, 'tmp') }; fs.mkdirSync(env.TEMP, { recursive: true });
const turbo = path.join(WT, 'node_modules/.bin/turbo.cmd');
const build = () => spawnSync('cmd.exe', ['/c', turbo, 'run', 'build', '--force', '--concurrency=1', '--filter=@sutradhar/cli...'], { cwd: WT, env, encoding: 'utf8', timeout: 900000 }).status;
const sub = (k, a, b) => { const t = fs.readFileSync(F[k], 'utf8'); if (t.split(a).length !== 2) throw new Error('count ' + k); fs.writeFileSync(F[k], t.replace(a, b)); };
const out = { before };
try {
  sub('pa', 'viewportParsed.width <= VIEWPORT_MAX &&', 'viewportParsed.width <= VIEWPORT_MAX * 1000 &&');
  sub('cp', '(v as { width: number }).width <= VIEWPORT_MAX &&', '(v as { width: number }).width <= VIEWPORT_MAX * 1000 &&');
  out.buildA = build();
  const a = spawnSync(process.execPath, [path.join(HERE, 'f8-kill-check.mjs'), path.join(SCR, 'kpA')], { encoding: 'utf8', timeout: 300000 });
  out.phaseA_killKept = JSON.parse(a.stdout.trim().split(String.fromCharCode(10)).pop());
  sub('cli', '    killChromeTree(spawned.pid);' + String.fromCharCode(10) + '    throw err;', '    throw err;');
  out.buildB = build();
  const b = spawnSync(process.execPath, [path.join(HERE, 'f8-kill-check.mjs'), path.join(SCR, 'kpB')], { encoding: 'utf8', timeout: 300000 });
  out.phaseB_killRemoved_positiveControl = JSON.parse(b.stdout.trim().split(String.fromCharCode(10)).pop());
  const leaked = await chromePids(path.join(SCR, 'kpB'));
  out.killedLeakedPids = leaked;
  for (const pid of leaked ?? []) spawnSync('taskkill', ['/PID', String(pid), '/T', '/F']);
} catch (e) { out.error = String(e.message); }
finally {
  for (const [k, f] of Object.entries(F)) fs.writeFileSync(f, orig[k]);
  out.after = Object.fromEntries(Object.entries(F).map(([k, f]) => [k, sha(fs.readFileSync(f))]));
  out.restored = Object.keys(F).every((k) => out.after[k] === before[k]);
  out.rebuild = build();
}
fs.writeFileSync(path.join(HERE, '..', 'kill-path.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
