// AUDIT-3 independent topology generator + model oracle for the FR2-14 home boundary.
// Own structure (a/b/h home, a/b/s sibling, o/p/q outside), own seed, own resolution model
// (link table resolved in-memory, never via the fs), compared with the REAL implementation
// (dist findProjectConfigPath) on REAL junctions / directory symlinks.
// usage: node topo-a3.mjs REPO SCRATCH CASES [SEED] [--live N]
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const BS = String.fromCharCode(92);
const [REPO, S, NARG, SEEDARG] = process.argv.slice(2);
const N = Number(NARG || 300);
const SEED = Number(SEEDARG || 0xa3d17e55);
const LIVE = process.argv.includes('--live') ? Number(process.argv[process.argv.indexOf('--live') + 1]) : 0;
const cr = await import(pathToFileURL(path.join(REPO, 'packages/capability-runtime/dist/index.js')).href);

function rng(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rnd = rng(SEED);
const pick = (xs) => xs[Math.floor(rnd() * xs.length)];

const REAL = ['a', 'a/b', 'a/b/h', 'a/b/h/w', 'a/b/h/w/k', 'a/b/s', 'a/b/s/t', 'o', 'o/p', 'o/p/q'];
const HOME = 'a/b/h';
const lc = (s) => s.toLowerCase();
const norm = (p) => { let s = lc(path.resolve(p)); while (s.endsWith(BS) && path.dirname(s) !== s) s = s.slice(0, -1); return s; };
const under = (c, r) => { c = norm(c); r = norm(r); return c === r || c.startsWith(r.endsWith(BS) ? r : r + BS); };
const strictlyUnder = (c, r) => under(c, r) && norm(c) !== norm(r);

function buildCase(i) {
  const B = path.join(S, 'c' + i);
  const links = new Map();
  const nl = 1 + Math.floor(rnd() * 4);
  const parents = ['', ...REAL];
  const targets = ['', ...REAL];
  for (let j = 0; j < nl; j++) {
    const parent = pick(parents);
    const key = parent ? parent + '/l' + j : 'l' + j;
    const target = rnd() < 0.3 && links.size ? pick([...links.keys()]) : pick(targets);
    links.set(key, { target, kind: rnd() < 0.5 ? 'junction' : 'dir' });
  }
  const files = new Set(), gits = new Set();
  for (const d of ['', ...REAL]) { if (rnd() < (d === '' || d === 'a' || d === 'a/b' ? 0.6 : 0.35)) files.add(d); if (d !== HOME && rnd() < 0.08) gits.add(d); }
  const homeVariant = pick(['real', 'real', 'link', 'upper', 'trail', 'linklink']);
  if (homeVariant === 'link') links.set('hl', { target: HOME, kind: 'junction' });
  if (homeVariant === 'linklink') { links.set('hl0', { target: HOME, kind: 'dir' }); links.set('hl', { target: 'hl0', kind: 'junction' }); }
  return { B, links, files, gits, homeVariant };
}

function R(c, rel, depth = 0) {
  if (depth > 40) throw new Error('loop');
  const comps = rel === '' ? [] : rel.split('/');
  let cur = [];
  for (const comp of comps) {
    const key = [...cur, comp].join('/');
    if (c.links.has(key)) { const t = R(c, c.links.get(key).target, depth + 1); cur = t === '' ? [] : t.split('/'); }
    else cur = [...cur, comp];
  }
  return cur.join('/');
}
const absOf = (c, rel) => (rel === '' ? c.B : path.join(c.B, ...rel.split('/')));
function relOf(c, abs) { const b = norm(c.B), a = norm(abs); if (a === b) return ''; if (a.startsWith(b + BS)) return a.slice(b.length + 1).split(BS).join('/'); return undefined; }
function Rabs(c, abs) { const r = relOf(c, abs); if (r === undefined) return norm(abs); return norm(absOf(c, R(c, r))); }
const realFile = (c, realAbs) => { const r = relOf(c, realAbs); return r !== undefined && c.files.has(r); };
const realGit = (c, realAbs) => { const r = relOf(c, realAbs); return r !== undefined && c.gits.has(r); };

function oracle(c, cwdLit, homeLit) {
  const realCwd = Rabs(c, cwdLit), realHome = Rabs(c, homeLit);
  const logicalIn = under(cwdLit, homeLit), canonIn = under(realCwd, realHome);
  const inHome = logicalIn || canonIn;
  let d = canonIn && !logicalIn ? realCwd : path.resolve(cwdLit);
  for (;;) {
    if (path.dirname(d) === d) return { stop: 'filesystem-root', inHome };
    const rd = Rabs(c, d);
    if (!(inHome && strictlyUnder(realHome, rd))) {
      if (realFile(c, rd)) return { found: rd, inHome };
      if (realGit(c, rd)) return { stop: 'git-root', at: rd, inHome };
      if (inHome && rd === realHome) return { stop: 'home', at: rd, inHome };
    }
    d = path.dirname(d);
  }
}
function direct(c, realCwd, realHome) { const cc = { ...c, links: new Map() }; return oracle(cc, realCwd, realHome); }

function materialize(c) {
  fs.mkdirSync(c.B, { recursive: true });
  for (const d of REAL) fs.mkdirSync(absOf(c, d), { recursive: true });
  for (const [key, l] of c.links) fs.symlinkSync(absOf(c, l.target), absOf(c, key), l.kind);
  for (const f of c.files) fs.writeFileSync(path.join(absOf(c, f), '.sutradhar.json'), JSON.stringify({ viewport: { width: 101 + REAL.indexOf(f), height: 100 } }));
  for (const g of c.gits) fs.mkdirSync(path.join(absOf(c, g), '.git'));
}
function homeLitOf(B, v) {
  const real = path.join(B, 'a', 'b', 'h');
  return v === 'link' || v === 'linklink' ? path.join(B, 'hl') : v === 'upper' ? B + real.slice(B.length).toUpperCase() : v === 'trail' ? real + BS : real;
}
function randomCwd(c) {
  for (let tries = 0; tries < 50; tries++) {
    const lit = [];
    const depth = 1 + Math.floor(rnd() * 6);
    for (let s = 0; s < depth; s++) {
      const real = R(c, lit.join('/'));
      const kids = new Set();
      for (const d of REAL) { const pr = d.split('/'); if (pr.slice(0, -1).join('/') === real) kids.add(pr[pr.length - 1]); }
      for (const k of c.links.keys()) { const pr = k.split('/'); if (pr.slice(0, -1).join('/') === real) kids.add(pr[pr.length - 1]); }
      if (!kids.size) break;
      lit.push(pick([...kids]));
    }
    if (!lit.length) continue;
    try { R(c, lit.join('/')); } catch { continue; }
    return absOf(c, lit.join('/'));
  }
  return absOf(c, 'a/b/h/w');
}

const rows = [];
let pass = 0, fail = 0, s1 = 0, s3 = 0;
const classes = {}, cover = { inHome: 0, notInHome: 0, canonOnly: 0, logicalOnly: 0, found: 0, git: 0, home: 0, root: 0, viaLink: 0, junction: 0, dir: 0, homeVariants: {} };
fs.mkdirSync(S, { recursive: true });
const linksOf = (c) => [...c.links].map(([kk, v]) => kk + '->' + v.target + '(' + v.kind + ')');
for (let i = 0; i < N; i++) {
  const c = buildCase(i);
  try { materialize(c); } catch (e) { rows.push({ i, skip: 'materialize ' + e.code }); continue; }
  for (const l of c.links.values()) cover[l.kind]++;
  cover.homeVariants[c.homeVariant] = (cover.homeVariants[c.homeVariant] || 0) + 1;
  const homeLit = homeLitOf(c.B, c.homeVariant);
  for (let k = 0; k < 3; k++) {
    const cwd = randomCwd(c);
    let exp; try { exp = oracle(c, cwd, homeLit); } catch (e) { rows.push({ i, cwd, skip: 'model ' + e.message }); continue; }
    let got;
    try {
      const r = await cr.findProjectConfigPath(cwd, { homedir: homeLit });
      got = r.path ? { found: norm(fs.realpathSync.native(path.dirname(r.path))) } : { stop: r.stoppedAt, at: r.stopDir ? norm(fs.realpathSync.native(r.stopDir)) : undefined };
    } catch (e) { got = { error: String(e.message).slice(0, 160) }; }
    const ok = exp.found !== undefined ? got.found === exp.found : got.stop === exp.stop && (exp.at === undefined || got.at === exp.at);
    const realHome = Rabs(c, homeLit), realCwd = Rabs(c, cwd);
    const lIn = under(cwd, homeLit), cIn = under(realCwd, realHome);
    cover[exp.inHome ? 'inHome' : 'notInHome']++; if (cIn && !lIn) cover.canonOnly++; if (lIn && !cIn) cover.logicalOnly++;
    if (norm(cwd) !== realCwd) cover.viaLink++;
    cover[exp.found ? 'found' : exp.stop === 'git-root' ? 'git' : exp.stop === 'home' ? 'home' : 'root']++;
    if (exp.inHome && got.found && strictlyUnder(realHome, got.found)) s1++;
    if (got.found) {
      const lits = []; let d = path.resolve(cwd); while (path.dirname(d) !== d) { lits.push(Rabs(c, d)); d = path.dirname(d); }
      const reals = []; d = realCwd; while (path.dirname(d) !== d) { reals.push(norm(d)); d = path.dirname(d); }
      if (!lits.includes(got.found) && !reals.includes(got.found)) s3++;
      const dw = direct(c, realCwd, realHome);
      const cls = dw.found === got.found ? 'same-as-direct' : !under(got.found, realHome) ? (reals.includes(got.found) ? 'differs:outside-home,on-real-chain' : 'differs:outside-home,literal-chain-only') : 'differs:inside-home';
      classes[cls] = (classes[cls] || 0) + 1;
      if (cls !== 'same-as-direct') rows.push({ i, cls, cwd, homeLit, inHome: exp.inHome, found: got.found, direct: dw.found ?? dw.stop, links: linksOf(c) });
    }
    if (ok) pass++; else { fail++; rows.push({ i, FAIL: true, cwd, homeLit, links: linksOf(c), files: [...c.files], gits: [...c.gits], exp, got }); }
    rows.push({ i, k, ok, cwd: cwd.slice(S.length + 1), home: c.homeVariant, inHome: exp.inHome, exp: exp.found ? 'F:' + relOf(c, exp.found) : exp.stop, got: got.found ? 'F:' + relOf(c, got.found) : got.stop ?? got.error });
  }
}
const live = [];
if (LIVE) {
  const cli = path.join(REPO, 'packages/cli/dist/cli.js');
  const all = rows.filter((r) => r.ok === true && r.inHome);
  const step = Math.max(1, Math.floor(all.length / LIVE));
  for (const r of all.filter((_, j) => j % step === 0).slice(0, LIVE)) {
    const B = path.join(S, 'c' + r.i);
    const res = spawnSync(process.execPath, [cli, 'doctor'], { cwd: path.join(S, r.cwd), env: { ...process.env, SUTRADHAR_CONFIG: '', USERPROFILE: homeLitOf(B, r.home), HOME: homeLitOf(B, r.home) }, encoding: 'utf8', timeout: 60000 });
    const txt = res.stdout + res.stderr;
    const line = txt.split('\n').find((l) => l.trim().toLowerCase().startsWith('config')) || '';
    let liveFound = 'none';
    const at = line.indexOf(':' + BS) - 1;
    const j = line.toLowerCase().indexOf('.sutradhar.json');
    if (j >= 0 && at >= 0) { const p = line.slice(at, j + '.sutradhar.json'.length); try { liveFound = 'F:' + relOf({ B }, fs.realpathSync.native(path.dirname(p))); } catch { liveFound = 'unresolvable:' + p; } }
    live.push({ i: r.i, cwd: r.cwd, home: r.home, exp: r.exp, liveFound, agree: r.exp.startsWith('F:') ? liveFound === r.exp : liveFound === 'none', configLine: line.trim().slice(0, 240) });
  }
}
const summary = { seed: '0x' + SEED.toString(16), cases: N, checks: pass + fail, pass, fail, S1_aboveHomeLoadedWhileInHome: s1, S3_foundOffBothChains: s3, gap355Classes: classes, coverage: cover, live: live.length ? { n: live.length, agree: live.filter((x) => x.agree).length } : undefined };
console.log(JSON.stringify(summary, null, 1));
fs.writeFileSync(path.join(S, 'topo-rows.json'), JSON.stringify({ summary, rows, live }, null, 1));
