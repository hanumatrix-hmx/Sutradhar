// FR2-14 fix-1 (F8): the post-spawn "kill the Chrome we just spawned" path, tested with MUTANTS (the shipped bound makes the
// failing path unreachable). Three builds of the CLI dist, each driven by tools/scenario-suite/probe-fr2-14-launch-leak.mjs:
//   A  bounds removed (flag parse + isViewport), kill KEPT     -> the CDP limit fails after spawn; expect NO leaked Chrome
//   B  bounds removed, kill REMOVED                             -> expect a leaked Chrome (positive control: the probe can see a leak)
//   C  shipped code                                             -> expect rejection before any Chrome (no leak, no Chrome ever started)
// Sources are restored from their original bytes (sha256 checked) and the dists rebuilt at the end. Only PIDs found via the probe's own
// scratch path are ever killed. Run from the repo root: node <this file>.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const repo = process.cwd();
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const files = {
  parse: path.join(repo, 'packages/cli/src/parse-args.ts'),
  prec: path.join(repo, 'packages/capability-runtime/src/config-precedence.ts'),
  cli: path.join(repo, 'packages/cli/src/cli.ts'),
};
const orig = Object.fromEntries(Object.entries(files).map(([k, f]) => [k, fs.readFileSync(f)]));
const before = Object.fromEntries(Object.entries(files).map(([k, f]) => [k, sha(f)]));
const tscBin = path.join(repo, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc');
const build = (pkg) => spawnSync(tscBin, ['-p', path.join(repo, pkg)], { encoding: 'utf8', shell: process.platform === 'win32' }).status;
function edit(buf, pairs) {
  const crlf = buf.toString('utf8').includes('\r\n');
  let s = buf.toString('utf8').replace(/\r\n/g, '\n');
  for (const [a, b] of pairs) {
    if (s.split(a).length !== 2) throw new Error(`pattern count != 1: ${a.slice(0, 60)}`);
    s = s.replace(a, () => b);
  }
  return crlf ? s.replace(/\n/g, '\r\n') : s;
}
const probe = () => {
  const r = spawnSync(process.execPath, [path.join(repo, 'tools/scenario-suite/probe-fr2-14-launch-leak.mjs')], { encoding: 'utf8', timeout: 180000 });
  const line = r.stdout.trim().split('\n').at(-1);
  try { return JSON.parse(line); } catch { return { error: `unparseable: ${r.stdout.slice(0, 200)} ${r.stderr.slice(0, 200)}` }; }
};
const results = {};
try {
  fs.writeFileSync(files.parse, edit(orig.parse, [[`    viewportParsed.width <= VIEWPORT_MAX &&\n    viewportParsed.height <= VIEWPORT_MAX\n`, `    viewportParsed.width <= VIEWPORT_MAX * 1e9 &&\n    viewportParsed.height <= VIEWPORT_MAX * 1e9\n`]]));
  fs.writeFileSync(files.prec, edit(orig.prec, [[`  (v as { width: number }).width <= VIEWPORT_MAX &&\n  (v as { height: number }).height <= VIEWPORT_MAX;`, `  (v as { width: number }).width <= VIEWPORT_MAX * 1e9 &&\n  (v as { height: number }).height <= VIEWPORT_MAX * 1e9;`]]));
  results.buildA = [build('packages/capability-runtime'), build('packages/cli')];
  results.A_boundsRemoved_killKept = probe();
  fs.writeFileSync(files.cli, edit(orig.cli, [[`    killChromeTree(spawned.pid);\n    throw err;`, `    throw err;`]]));
  results.buildB = build('packages/cli');
  results.B_boundsRemoved_killRemoved = probe();
} finally {
  for (const [k, f] of Object.entries(files)) fs.writeFileSync(f, orig[k]);
  results.restoredByteIdentical = Object.fromEntries(Object.entries(files).map(([k, f]) => [k, sha(f) === before[k]]));
  results.rebuild = [build('packages/capability-runtime'), build('packages/cli')];
}
results.C_shipped = probe();
console.log(JSON.stringify(results, null, 1));
