// AUDIT-3 hand-written home-boundary attack cases (function level + live CLI doctor).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
const BS = String.fromCharCode(92);
const DOLLAR = String.fromCharCode(36);
const [REPO, S0] = process.argv.slice(2);
const cr = await import(pathToFileURL(path.join(REPO, 'packages/capability-runtime/dist/index.js')).href);
const CLI = path.join(REPO, 'packages/cli/dist/cli.js');
const S = path.join(S0, 'ah');
fs.rmSync(S, { recursive: true, force: true });
const mk = (...p) => { const d = path.join(S, ...p); fs.mkdirSync(d, { recursive: true }); return d; };
const cfg = (d, w) => fs.writeFileSync(path.join(d, '.sutradhar.json'), JSON.stringify({ viewport: { width: w, height: 100 } }));
const link = (target, at, kind) => fs.symlinkSync(target, at, kind);
const out = [];
async function fn(name, cwd, homedir, expect) {
  let got;
  try { const r = await cr.findProjectConfigPath(cwd, { homedir }); got = r.path ? 'F:' + r.path : r.stoppedAt + (r.stopDir ? '@' + r.stopDir : ''); } catch (e) { got = 'ERR:' + String(e.message).slice(0, 140); }
  let w;
  try { const l = await cr.loadProjectConfig({ cwd, discover: true, homedir }); w = l.status === 'loaded' ? l.config.values.viewport?.width : 'none'; } catch (e) { w = 'ERR'; }
  const ok = typeof expect === 'function' ? expect(got, w) : String(w) === String(expect);
  out.push({ name, level: 'fn', cwd, homedir, got, width: w, expect: String(expect).slice(0, 80), ok });
}
function live(name, cwd, home, expectWidth) {
  const env = { ...process.env, SUTRADHAR_CONFIG: '', USERPROFILE: home, HOME: home };
  const r = spawnSync(process.execPath, [CLI, 'doctor'], { cwd, env, encoding: 'utf8', timeout: 60000 });
  const txt = (r.stdout || '') + (r.stderr || '');
  const lines = txt.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('Config') || l.startsWith('Error') || l.startsWith('Warning'));
  const line = lines.join(' | ');
  let w = 'none';
  const cl = lines.find((l) => l.startsWith('Config:'));
  const j = cl ? cl.indexOf('.sutradhar.json') : -1;
  if (j >= 0) { const p = cl.slice('Config:'.length, j + 15).trim(); try { w = JSON.parse(fs.readFileSync(p, 'utf8')).viewport.width; } catch { w = 'unreadable'; } }
  const ok = String(w) === String(expectWidth);
  out.push({ name, level: 'live-doctor', cwd, home, status: r.status, line: line.slice(0, 260), width: w, expect: expectWidth, ok });
}
const T = mk('T'); cfg(T, 1);
const U = mk('T', 'U'); cfg(U, 2);
const H = mk('T', 'U', 'H');
const P = mk('T', 'U', 'H', 'P');
const Q = mk('T', 'U', 'H', 'P', 'Q');
const X = mk('X'); cfg(X, 9);
const XY = mk('X', 'Y');
link(XY, path.join(P, 'jout'), 'junction');
await fn('F3 cwd=home/P/jout (->X/Y), file at X', path.join(P, 'jout'), H, 'none');
live('F3 live', path.join(P, 'jout'), H, 'none');
link(XY, path.join(P, 'sout'), 'dir');
await fn('F3 dir-symlink variant', path.join(P, 'sout'), H, 'none');
link(Q, path.join(T, 'jin'), 'junction');
await fn('N2 cwd=T/jin (->home/P/Q), file at T and U', path.join(T, 'jin'), H, 'none');
live('N2 live', path.join(T, 'jin'), H, 'none');
link(P, path.join(U, 'sin'), 'dir');
await fn('N2 dir-symlink from U into home/P, sub Q', path.join(U, 'sin', 'Q'), H, 'none');
link(path.join(T, 'jin'), path.join(S, 'c1'), 'junction');
await fn('junction->junction chain into home', path.join(S, 'c1'), H, 'none');
link(path.join(S, 'c1'), path.join(S, 'c2'), 'dir');
await fn('symlink->junction->junction chain into home', path.join(S, 'c2'), H, 'none');
link(XY, path.join(S, 'c3'), 'junction');
link(path.join(S, 'c3'), path.join(P, 'j2'), 'junction');
await fn('home junction -> junction -> outside', path.join(P, 'j2'), H, 'none');
link(T, path.join(P, 'up'), 'junction');
await fn('cwd=home/P/up (->T, above home)', path.join(P, 'up'), H, 'none');
await fn('cwd=home/P/up/U (->U, parent of home)', path.join(P, 'up', 'U'), H, 'none');
live('home/P/up/U live', path.join(P, 'up', 'U'), H, 'none');
link(H, path.join(S, 'HL'), 'junction');
await fn('HOME is a link, cwd real P', P, path.join(S, 'HL'), 'none');
await fn('HOME is a link, cwd via link HL/P', path.join(S, 'HL', 'P'), path.join(S, 'HL'), 'none');
live('HOME is a link live', path.join(S, 'HL', 'P'), path.join(S, 'HL'), 'none');
await fn('HOME trailing slash', P, H + BS, 'none');
await fn('HOME upper case', P, H.toUpperCase(), 'none');
await fn('HOME forward slashes', P, H.split(BS).join('/'), 'none');
cfg(H, 5);
await fn('home has file, cwd T/jin', path.join(T, 'jin'), H, 5);
await fn('home has file, cwd P/up/U', path.join(P, 'up', 'U'), H, 5);
fs.rmSync(path.join(H, '.sutradhar.json'));
await fn('homedir empty string -> plain walk reaches U (documented: not in home)', Q, '', 2);
const realHome = os.homedir();
await fn('HOME on another drive (C:), cwd E:/.../Q', Q, realHome, 2);
link(realHome, path.join(S, 'jreal'), 'junction');
await fn('cwd=E:/S/jreal/.claude (-> real C: home): canonical walk stops at home', path.join(S, 'jreal', '.claude'), realHome, (g) => g.startsWith('home'));
const short = 'C:' + BS + 'Users' + BS + 'VARADM~1';
if (fs.existsSync(short)) {
  await fn('HOME 8.3 spelling, cwd real long path', path.join(realHome, '.claude'), short, (g) => g.startsWith('home'));
  await fn('HOME long, cwd 8.3 path', path.join(short, '.claude'), realHome, (g) => g.startsWith('home'));
}
const UT = mk('UT'); fs.writeFileSync(path.join(UT, 'evil.json'), JSON.stringify({ downloadDir: '../../../../UT/dl', viewport: { width: 7, height: 7 } }));
const R1 = mk('T', 'U', 'H', 'R1'); fs.mkdirSync(path.join(R1, '.git'));
link(path.join(UT, 'evil.json'), path.join(R1, '.sutradhar.json'), 'file');
{
  const l = await cr.loadProjectConfig({ cwd: R1, discover: true, homedir: H });
  out.push({ name: 'config is a file symlink into untrusted tree: baseDir is the link dir, escaping downloadDir refused', level: 'fn', baseDir: l.config?.baseDir, refused: !!l.config?.downloadRefusal, ok: l.status === 'loaded' && l.config.baseDir === R1 && !!l.config.downloadRefusal });
}
const R2 = mk('T', 'U', 'H', 'R2'); fs.mkdirSync(path.join(R2, '.git'));
link(path.join(T, '.sutradhar.json'), path.join(R2, '.sutradhar.json'), 'file');
await fn('in-home file symlink to an above-home file: read as R2 content (project-owned link)', R2, H, 1);
const R3 = mk('T', 'U', 'H', 'R3'); fs.mkdirSync(path.join(R3, '.git'));
link(path.join(S, 'nope.json'), path.join(R3, '.sutradhar.json'), 'file');
await fn('dangling config symlink -> error', R3, H, 'ERR');
await fn('cwd = drive root E: -> never read', 'E:' + BS, H, (g) => g === 'filesystem-root');
await fn('cwd = device path form of Q (info only)', BS + BS + '?' + BS + Q, H, () => true);
const unc = BS + BS + 'localhost' + BS + 'E' + DOLLAR + Q.slice(2);
let uncOk = false; try { fs.statSync(unc); uncOk = true; } catch (e) { out.push({ name: 'UNC admin share unavailable', level: 'env', err: e.code, ok: null }); }
if (uncOk) await fn('cwd = UNC path to Q, home = UNC H', unc, BS + BS + 'localhost' + BS + 'E' + DOLLAR + H.slice(2), 'none');
console.log(JSON.stringify(out, null, 1));
console.log('PASS', out.filter((o) => o.ok === true).length, 'FAIL', out.filter((o) => o.ok === false).length);
