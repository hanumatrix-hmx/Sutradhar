// AUDIT-3 mutant runner: one exact replacement per mutant, rebuild touched dists (tsc), vitest x4, own probes, restore (sha256 checked).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
const [REPO, S0, ONLY] = process.argv.slice(2);
const T = path.join(S0, 't');
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const BS = String.fromCharCode(92);
const PC = 'packages/capability-runtime/src/project-config.ts';
const M = [
  ['M1', PC, 'if (canonIn && !logicalIn) dir = canonCwd;', '/* M1 */', 'home walk: N2 revert (never follow the canonical cwd)'],
  ['M2', PC, 'if (isPathWithinRoot(home, here, platform) && !sameFold(here, home)) {', 'if (Math.random() < 0 && isPathWithinRoot(home, here, platform) && !sameFold(here, home)) {', 'home walk: never skip a dir whose real location is above home'],
  ['M3', PC, 'inHome = canonIn || logicalIn;', 'inHome = logicalIn;', 'topology: a cwd that is in home only canonically is not in home'],
  ['M4', PC, 'if (isPathWithinRoot(home, here, platform) && !sameFold(here, home)) {', 'if (isPathWithinRoot(literalHome!, here, platform) && !sameFold(here, home)) {', 'topology: above-home test against the LITERAL home (HOME-is-a-link revert)'],
  ['M5', PC, 'ignored${s ? ` (did you mean "${prefix}${s}"?)` : \'\'}`);', 'ignored${s ? ` (did you mean "${prefix}${s}"?)` : \'\'}` + \' (\' + key + \')\');', 'echo bypass by concatenation (invisible to the template guard)'],
  ['M6', 'packages/capability-runtime/src/echo.ts', BS + 'u2028-' + BS + 'u202e', BS + 'u2028-' + BS + 'u2029', 'echo choke point: bidi controls no longer replaced'],
  ['M7', PC, 'cannot be checked (${echo((e as Error).message)})', 'cannot be checked (${(e as Error).message})', 'message path skipping the choke point (raw error text)'],
  ['M8', 'packages/capability-runtime/src/fs-roots.ts', 'if (isLayerSet(input.options?.allowedDownloadRoots)) {', 'if (input.options?.allowedDownloadRoots !== undefined && input.options?.allowedDownloadRoots !== null) {', 'site bypassing isLayerSet: option [] counts as set'],
  ['M9', 'packages/capability-runtime/src/layer-set.ts', 'if (Array.isArray(v) && v.length === 0) return false;', '', 'isLayerSet definition: empty list counts as set'],
  ['M10', PC, "if (origin === 'discovered') {\n    let base: string;", "if (origin === 'discovered' && false) {\n    let base: string;", 'a discovered file is trusted (no containment refusal)'],
  ['M11', 'packages/cli/src/project-config-cli.ts', ' && i.config.downloadRefusal !== undefined', '', 'CLI: download <dir> strips a NON-refused file roots too'],
  ['M12', 'packages/capability-runtime/src/fs-roots.ts', "if (input.config?.downloadRefusal !== undefined && (downloadSource === 'option' || downloadSource === 'env')) {", "if (input.config?.downloadRefusal !== undefined && Math.random() < 0) {", 'N8 override note removed'],
  ['M13', PC, 'if (isPathWithinRoot(home, here, platform) && !sameFold(here, home)) {', 'if (!isPathWithinRoot(here, home, platform)) {', 'topology: stricter rule (skip everything outside home): GAP-355 alternative'],
];
function sh(cmd, args, cwd, timeout = 600000) { const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout, shell: false, env: { ...process.env, TEMP: T, TMP: T } }); return { status: r.status, out: (r.stdout || '') + (r.stderr || '') }; }
const node = process.execPath;
const tsc = path.join(REPO, 'node_modules/typescript/bin/tsc');
const vitest = path.join(REPO, 'node_modules/vitest/vitest.mjs');
function build(pkgs) { for (const p of pkgs) { const r = sh(node, [tsc, '-p', '.'], path.join(REPO, p)); if (r.status !== 0) return 'TSC FAIL ' + p + ': ' + r.out.slice(0, 300); } return 'ok'; }
function vt(p) { const r = sh(node, [vitest, 'run', '--globals'], path.join(REPO, p)); const s = r.out.replace(/\x1b\[[0-9;]*m/g, ''); const m = s.match(/Tests\s+(?:(\d+) failed \| )?(\d+) passed/); return m ? Number(m[1] || 0) : 'ERR(' + (s.match(/Tests .*/) || ['?'])[0] + ')'; }
function rm(d) { fs.rmSync(path.join(S0, d), { recursive: true, force: true }); }
function probes() {
  const o = {};
  rm('tp'); let r = sh(node, [path.join(T, 'topo-a3.mjs'), REPO, path.join(S0, 'tp'), '150', '2748415573'], S0);
  try { const j = JSON.parse(r.out.slice(r.out.indexOf('{'))); o.topo = j.fail + '/' + j.checks + ' S1=' + j.S1_aboveHomeLoadedWhileInHome; } catch { o.topo = 'ERR'; }
  r = sh(node, [path.join(T, 'attack-home.mjs'), REPO, S0], S0); o.attackHome = (r.out.match(/PASS \d+ FAIL \d+/) || ['ERR'])[0];
  rm('ec'); r = sh(node, [path.join(T, 'echo-corpus.mjs'), REPO, S0], S0);
  try { const rows = JSON.parse(fs.readFileSync(path.join(T, 'echo-rows.json'), 'utf8')); o.echo = rows.filter((x) => x.probs && x.probs.length).filter((x) => !(x.probs.every((p) => p.startsWith('fill=')) && +x.probs[0].slice(5) <= 264 && (x.m || '').includes('resolves to'))).length + ' bad msgs'; } catch { o.echo = 'ERR'; }
  r = sh(node, [path.join(T, 'prec-a3.mjs'), REPO, S0], S0);
  try { const j = JSON.parse(fs.readFileSync(path.join(T, 'prec-a3.json'), 'utf8')); o.prec = j.fail + '/' + j.total + ' fail (baseline 12)'; } catch { o.prec = 'ERR'; }
  r = sh(node, [path.join(T, 'failclosed.mjs'), REPO, S0], S0); try { const j = JSON.parse(r.out.slice(r.out.indexOf('{'))); o.failclosed = j.fail + '/' + j.total; } catch { o.failclosed = 'ERR'; }
  rm('lp1'); r = sh(node, [path.join(T, 'loader-probes-adapted.mjs'), path.join(S0, 'lp1'), REPO], S0);
  const acc = r.out.split(String.fromCharCode(10)).filter((l) => l.startsWith('{')).map((l) => JSON.parse(l)).filter((x) => /^(DL|ADR)[.]/.test(x.id) && x.ok).length; o.hostileRootsAccepted = acc + ' (baseline 17)';
  return o;
}
const out = [];
for (const [id, file, from, to, desc] of M) {
  if (ONLY && !ONLY.split(',').includes(id)) continue;
  const f = path.join(REPO, file);
  const orig = fs.readFileSync(f, 'utf8');
  const h0 = sha(f);
  const eol = orig.includes('\r\n') ? '\r\n' : '\n';
  const fr = from.split('\n').join(eol), tt = to.split('\n').join(eol);
  const n = orig.split(fr).length - 1;
  if (n !== 1) { out.push({ id, desc, error: 'occurrences=' + n }); continue; }
  const row = { id, desc, file };
  try {
    fs.writeFileSync(f, orig.replace(fr, tt));
    const pk = file.startsWith('packages/cli/') ? ['packages/capability-runtime', 'packages/cli'] : ['packages/capability-runtime'];
    row.build = build(pk);
    if (row.build === 'ok') {
      row.unit = { cr: vt('packages/capability-runtime'), cli: vt('packages/cli'), mcp: vt('packages/mcp-server'), sdk: vt('packages/sutradhar') };
      row.probes = probes();
    }
  } finally {
    fs.writeFileSync(f, orig);
    row.restored = sha(f) === h0;
    row.rebuild = build(file.startsWith('packages/cli/') ? ['packages/capability-runtime', 'packages/cli'] : ['packages/capability-runtime']);
  }
  out.push(row);
  console.log(JSON.stringify(row));
}
fs.writeFileSync(path.join(T, 'mutants-a3-' + (ONLY || 'all') + '.json'), JSON.stringify(out, null, 1));
