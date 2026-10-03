// AUDIT-2 live CLI: precedence over every subset of {flag, env, state, config} (seeded values) + the F1/F6/F8
// surfaces, on one build. argv: <pkg|bundle|master> <scratch> [onlyPart]. Observers: Host log, page beacons,
// files on disk + sha256 of served bytes, chrome.exe PIDs by command-line marker. Never trusts CLI stdout.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { observer, chromePids, until } from './obs.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const WT = path.resolve(HERE, '../../../../../../..');
const BUILD = process.argv[2];
const BIN = { pkg: path.join(WT, 'packages/cli/dist/cli.js'), bundle: path.join(WT, 'packages/sutradhar/dist/cli-bin.js'), master: 'E:/AI-Cache/tmp/fr211-master/packages/cli/dist/cli.js' }[BUILD];
const S = path.resolve(process.argv[3], 'cli-' + BUILD + '-' + (process.argv[4] || 'all')); fs.rmSync(S, { recursive: true, force: true });
const PART = process.argv[4] || 'all';
const OUT = path.join(HERE, '..', `live-cli-${BUILD}${PART === 'all' ? '' : '-' + PART}.jsonl`); fs.writeFileSync(OUT, '');
const T0 = performance.now(); const DEADLINE = 18 * 60 * 1000;
const O = await observer();
let seed = 0xa2c11 + (BUILD === 'bundle' ? 7 : 0);
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const vp = () => ({ width: 300 + Math.floor(rnd() * 900), height: 200 + Math.floor(rnd() * 600) });
const mk = (...p) => { const d = path.join(S, ...p); fs.mkdirSync(d, { recursive: true }); return d; };
const proj = mk('proj'); mk('proj', '.git'); const cwd = mk('proj', 'a', 'b');
const TEMP = mk('temp'); const STATE = mk('state');
const envdl = mk('envdl'); const envup = mk('envup'); const other = mk('other'); const cup = mk('proj', 'cup');
fs.writeFileSync(path.join(envup, 'E.txt'), 'e'); fs.writeFileSync(path.join(cup, 'C.txt'), 'c'); fs.writeFileSync(path.join(other, 'X.txt'), 'x');
const CFG = path.join(proj, '.sutradhar.json');
const base = { ...process.env, TEMP, TMP: TEMP, SUTRADHAR_CLI_STATE_DIR: STATE };
for (const k of Object.keys(base)) if (/^SUTRADHAR_(ALLOWED|CONFIG|IDLE|RESTRICT)/i.test(k)) delete base[k];
export function cli(args, env = {}, dir = cwd) {
  return new Promise((resolve) => {
    const ch = spawn(process.execPath, [BIN, ...args], { cwd: dir, env: { ...base, ...env }, windowsHide: true });
    let so = '', se = '';
    ch.stdout.on('data', (d) => (so += d)); ch.stderr.on('data', (d) => (se += d));
    const t = setTimeout(() => { try { ch.kill(); } catch {} }, 90000);
    ch.on('close', (code) => { clearTimeout(t); resolve({ code, so: so.slice(0, 40000), se: se.slice(0, 4000) }); });
  });
}
let pass = 0, fail = 0; const fails = [];
const rec = (o) => { fs.appendFileSync(OUT, JSON.stringify(o) + '\n'); o.pass ? pass++ : (fail++, fails.push(o.id)); };
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const dlName = (tag) => 'a2-' + tag.replace(/[^A-Za-z0-9_-]/g, '_') + '.bin';
const where = (tag, dirs) => Object.entries(dirs).filter(([, d]) => fs.existsSync(path.join(d, dlName(tag)))).map(([k]) => k);
const shaOk = (tag, dir) => O.served.some((s) => s.tag === tag && s.sha === sha(path.join(dir, dlName(tag))));
const DEFDL = path.join(TEMP, 'sutradhar-downloads');
const H = { flag: '127.0.0.11', env: '127.0.0.12', config: '127.0.0.13', loser: '127.0.0.14' };
const notes = (r) => r.se.split(String.fromCharCode(10)).filter((l) => l.startsWith('Note: using'));
async function precedence() {
  const L = ['flag', 'env', 'state', 'config'];
  const order = []; for (let m = 0; m < 16; m++) order.push(m);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; } // shuffled order
  for (const m of order.filter((x) => PART === 'prec0' ? x < 8 : PART === 'prec1' ? x >= 8 : true)) {
    if (performance.now() - T0 > DEADLINE) { rec({ id: 'DEADLINE', pass: false }); return; }
    const sub = L.filter((_, i) => m & (1 << i)); const has = (l) => sub.includes(l);
    const id = `${BUILD}[${sub.join('+') || 'none'}]`; const tg = (s) => `${BUILD}-${m}-${s}`;
    const V = { flag: vp(), state: vp(), config: vp() };
    const PT = { state: 'ST' + m, config: 'CF' + m };
    await cli(['close']); fs.rmSync(path.join(STATE, 'state.json'), { force: true });
    if (has('config')) fs.writeFileSync(CFG, JSON.stringify({ allowedDomains: [H.config], downloadDir: './cdl', allowedUploadRoots: ['./cup'], dialog: { mode: 'accept', promptText: PT.config }, viewport: V.config }));
    else fs.rmSync(CFG, { force: true });
    if (has('state')) await cli(['nav', 'about:blank', '--viewport', `${V.state.width}x${V.state.height}`, '--dialog', 'accept', '--dialog-text', PT.state]);
    const env = has('env') ? { SUTRADHAR_ALLOWED_DOMAINS: H.env, SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS: envdl, SUTRADHAR_ALLOWED_UPLOAD_ROOTS: envup } : {};
    const fl = has('flag') ? ['--allowlist-domains', H.flag, '--viewport', `${V.flag.width}x${V.flag.height}`, '--dialog', 'dismiss'] : [];
    const domWin = has('flag') ? 'flag' : has('env') ? 'env' : has('config') ? 'config' : null;
    const host = domWin ? H[domWin] : H.loser;
    const rWin = await cli(['nav', O.url(host, tg('win')), ...fl], env);
    const reachedWin = !!(await until(() => O.reached(tg('win')).length > 0, 4000));
    const rLose = await cli(['nav', O.url(H.loser === host ? H.config : H.loser, tg('lose')), ...fl], env);
    const reachedLose = !!(await until(() => O.reached(tg('lose')).length > 0, 2500));
    rec({ id: id + '.domains', want: domWin ?? 'unrestricted', win: [rWin.code, reachedWin], lose: [rLose.code, reachedLose], pass: rWin.code === 0 && reachedWin && (domWin ? rLose.code !== 0 && !reachedLose : rLose.code === 0 && reachedLose) });
    // the "lose" nav may have moved the page when unrestricted: go back to the winner page for the remaining checks
    const main = tg('main'); await cli(['nav', O.url(host, main), ...fl], env);
    const gotVp = await until(() => O.sig(main, 'vp')[0], 8000);
    const vpWin = has('flag') ? 'flag' : has('state') ? 'state' : has('config') ? 'config' : null;
    const wantVp = vpWin ? `${V[vpWin].width}x${V[vpWin].height}` : null;
    rec({ id: id + '.viewport', want: vpWin ?? 'default', got: gotVp, pass: wantVp ? gotVp === wantVp : gotVp !== undefined && ![V.flag, V.state, V.config].some((v) => `${v.width}x${v.height}` === gotVp) });
    const rc = await cli(['click', '#pq', ...fl], env);
    const pq = await until(() => O.sig(main, 'pq')[0], 4000);
    const dlgWin = has('flag') ? 'flag' : has('state') ? 'state' : has('config') ? 'config' : null;
    if (dlgWin) rec({ id: id + '.dialog', want: dlgWin, got: pq, pass: pq === { flag: 'NULL', state: PT.state, config: PT.config }[dlgWin] });
    else { const d = await cli(['dialog', 'dismiss']); const after = await until(() => O.sig(main, 'pq')[0], 4000); rec({ id: id + '.dialog', want: 'report(pending)', before: pq ?? null, after, pass: pq === undefined && after === 'NULL' && /pending|dialog/i.test(rc.so + rc.se) }); }
    const rd = await cli(['download', '#dl', ...fl], env);
    const dirs = { env: envdl, config: path.join(proj, 'cdl'), default: DEFDL, cwdRel: path.join(cwd, 'cdl') };
    const found = where(main, dirs); const dlWin = has('env') ? 'env' : has('config') ? 'config' : 'default';
    rec({ id: id + '.download', want: dlWin, found, code: rd.code, pass: found.length === 1 && found[0] === dlWin && shaOk(main, dirs[dlWin]) });
    const n = notes(rd); const wantDl = has('config') && !has('env'); const wantAcc = has('config') && !has('flag') && !has('state');
    rec({ id: id + '.notice', wantDl, wantAcc, n, pass: (wantDl || wantAcc) ? n.length === 1 && n[0].includes('downloadDir/allowedDownloadRoots') === wantDl && n[0].includes('dialog.mode "accept"') === wantAcc : n.length === 0 });
    const ups = {};
    for (const [k, f] of [['E', path.join(envup, 'E.txt')], ['C', path.join(cup, 'C.txt')], ['X', path.join(other, 'X.txt')]]) {
      const before = O.sig(main, 'up').length; const r = await cli(['upload', '#up', f, ...fl], env);
      const got = await until(() => (O.sig(main, 'up').length > before ? O.sig(main, 'up').at(-1) : undefined), 3000);
      ups[k] = [r.code, got ?? null]; await new Promise((r2) => setTimeout(r2, 1100));
    }
    const allow = has('env') ? ['E'] : has('config') ? ['C'] : ['E', 'C', 'X'];
    rec({ id: id + '.upload', allow, ups, pass: Object.entries(ups).every(([k, [c, g]]) => (allow.includes(k) ? c === 0 && g === k + '.txt' : c !== 0 && g === null)) });
    await cli(['close']);
  }
}
async function f1() {
  // hostile discovered project: downloadDir escapes the tree. Every override the error names is exercised.
  const hp = mk('hp'); mk('hp', '.git'); const hcwd = mk('hp', 'w'); const outside = path.join(S, 'outside-hp');
  const HF = path.join(hp, '.sutradhar.json'); fs.writeFileSync(HF, JSON.stringify({ downloadDir: '../outside-hp' }));
  const marker = TEMP; const host = '127.0.0.21';
  const pidsBefore = (await chromePids(marker))?.length;
  const c = (args, env) => cli(args, env, hcwd);
  // a) nothing set: refused before Chrome, message names every override
  const a = await c(['nav', O.url(host, BUILD + '-f1a')]);
  const pidsA = (await chromePids(marker))?.length;
  const need = ["outside this config's directory", 'SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS', 'allowedDownloadRoots', 'SUTRADHAR_CONFIG=<file>'];
  rec({ id: BUILD + '.F1.noOverride.refused', code: a.code, missing: need.filter((s) => !a.se.includes(s)), pidsBefore, pidsA, reached: O.reached(BUILD + '-f1a').length, pass: a.code === 1 && need.every((s) => a.se.includes(s)) && O.reached(BUILD + '-f1a').length === 0 && pidsA === pidsBefore && !fs.existsSync(path.join(STATE, 'state.json')) });
  // b) set-but-unusable env values: still refused
  for (const [lab, v] of [['empty', ''], ['blank', '   '], ['delims', ';;'], ['zero', '0'], ['false', 'false'], ['brackets', '[]'], ['relative', 'outside-hp']]) {
    const r = await c(['nav', O.url(host, BUILD + '-f1b-' + lab)], { SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS: v });
    rec({ id: BUILD + '.F1.env=' + lab + '.refused', code: r.code, err: r.se.split(String.fromCharCode(10))[0].slice(0, 160), pass: r.code === 1 && O.reached(BUILD + '-f1b-' + lab).length === 0 });
  }
  const ru = await c(['nav', O.url(host, BUILD + '-f1u')], { SUTRADHAR_ALLOWED_UPLOAD_ROOTS: envup });
  rec({ id: BUILD + '.F1.uploadEnvOnly.refused', code: ru.code, pass: ru.code === 1 && O.reached(BUILD + '-f1u').length === 0 });
  // c) env override works: download lands in env dir only; nothing outside; no download Note
  const envOnly = { SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS: envdl };
  const t = BUILD + '-f1c'; const n1 = await c(['nav', O.url(host, t)], envOnly); const d1 = await c(['download', '#dl'], envOnly);
  rec({ id: BUILD + '.F1.envOverride.works', nav: n1.code, dl: d1.code, found: where(t, { env: envdl, outside, def: DEFDL }), notes: notes(d1), pass: n1.code === 0 && d1.code === 0 && where(t, { env: envdl, outside, def: DEFDL }).join() === 'env' && shaOk(t, envdl) && notes(d1).length === 0 && !fs.existsSync(outside) });
  // d) download <ref> <dir>: explicit per-command grant, no env
  const gdir = path.join(S, 'grant-dir'); const d2 = await c(['download', '#dl', gdir]);
  rec({ id: BUILD + '.F1.downloadDirArg.works', code: d2.code, se: d2.se.slice(0, 200), found: where(t, { grant: gdir, outside, def: DEFDL }), pass: d2.code === 0 && fs.existsSync(path.join(gdir, dlName(t))) && shaOk(t, gdir) && !fs.existsSync(outside) });
  // d2) other verbs without the grant are still refused in the same session
  const d3 = await c(['snap']);
  rec({ id: BUILD + '.F1.otherVerbStillRefused', code: d3.code, pass: d3.code === 1 && d3.se.includes("outside this config's directory") });
  await c(['close'], envOnly);
  // e) explicit load (SUTRADHAR_CONFIG=<file>) is trusted like env: the out-of-tree dir is used
  const t2 = BUILD + '-f1e'; const ex = { SUTRADHAR_CONFIG: HF };
  const n2 = await c(['nav', O.url(host, t2)], ex); const d4 = await c(['download', '#dl'], ex);
  rec({ id: BUILD + '.F1.explicitConfig.works', nav: n2.code, dl: d4.code, found: where(t2, { outside, env: envdl, def: DEFDL }), pass: n2.code === 0 && d4.code === 0 && where(t2, { outside, env: envdl, def: DEFDL }).join() === 'outside' && shaOk(t2, outside) });
  await c(['close'], ex);
  // f) doctor: never blocked; sources show the refusal when no override, env when overridden
  const doc1 = await c(['doctor']); const doc2 = await c(['doctor'], envOnly);
  const src1 = doc1.so.split(String.fromCharCode(10)).filter((l) => l.startsWith('Config')); const src2 = doc2.so.split(String.fromCharCode(10)).filter((l) => l.startsWith('Config'));
  rec({ id: BUILD + '.F1.doctor', code: [doc1.code, doc2.code], src1, src2, pass: doc1.code === 0 && doc2.code === 0 && src1.some((l) => l.includes('unavailable') && l.includes("outside this config's directory")) && src2.some((l) => l.includes('downloadRoots=env')) });
}
async function f6f8() {
  const vdir = mk('vp'); mk('vp', '.git'); const VF = path.join(vdir, '.sutradhar.json');
  const marker = TEMP; const host = '127.0.0.31';
  fs.rmSync(path.join(STATE, 'state.json'), { force: true });
  const base0 = (await chromePids(marker))?.length;
  // F6: empty allowlist flag is an error, before Chrome
  for (const [lab, v] of [['empty', ''], ['blank', ' , ']]) {
    const r = await cli(['nav', O.url(host, BUILD + '-f6' + lab), '--allowlist-domains', v], {}, vdir);
    rec({ id: BUILD + '.F6.allowlist=' + lab, code: r.code, err: r.se.slice(0, 120), pass: r.code === 1 && /at least one domain/.test(r.se) && O.reached(BUILD + '-f6' + lab).length === 0 });
  }
  const help = await cli(['--help'], {}, vdir);
  rec({ id: BUILD + '.F6.help', pass: /empty value .*is an error/i.test(help.so.split(String.fromCharCode(10)).join(' ')) });
  // F8: file viewport over the bound is refused before Chrome; flag over the bound likewise
  for (const [lab, w] of [['fileMax+1', 10000001], ['file1e9', 1000000000], ['file0', 0]]) {
    fs.writeFileSync(VF, JSON.stringify({ viewport: { width: w, height: 300 } }));
    const r = await cli(['nav', O.url(host, BUILD + '-f8' + lab)], {}, vdir);
    const pids = (await chromePids(marker))?.length;
    rec({ id: BUILD + '.F8.' + lab, code: r.code, err: r.se.slice(0, 160), pids, base0, pass: r.code === 1 && /viewport\.width must be a positive integer/.test(r.se) && pids === base0 && O.reached(BUILD + '-f8' + lab).length === 0 });
  }
  fs.rmSync(VF, { force: true });
  for (const [lab, v] of [['flagMax+1', '10000001x300'], ['flag1e9', '1000000000x1000000000'], ['flag0', '0x300']]) {
    const r = await cli(['nav', O.url(host, BUILD + '-f8' + lab), '--viewport', v], {}, vdir);
    const pids = (await chromePids(marker))?.length;
    rec({ id: BUILD + '.F8.' + lab, code: r.code, err: r.se.slice(0, 120), pids, pass: r.code === 1 && /--viewport must be WIDTHxHEIGHT/.test(r.se) && pids === base0 });
  }
  // F8 at the bound: accepted at load; whatever Chrome does, no Chrome may be left behind if the command fails
  fs.writeFileSync(VF, JSON.stringify({ viewport: { width: 10000000, height: 10000000 } }));
  const rb = await cli(['nav', 'about:blank'], {}, vdir);
  const stateAfter = fs.existsSync(path.join(STATE, 'state.json'));
  const pidsB = (await chromePids(marker))?.length;
  rec({ id: BUILD + '.F8.fileAtBound', code: rb.code, err: rb.se.slice(0, 200), stateAfter, pidsB, base0, pass: rb.code === 0 ? stateAfter : pidsB === base0 });
  await cli(['close'], {}, vdir); fs.rmSync(VF, { force: true });
  await new Promise((r) => setTimeout(r, 1500));
  const leftover = await chromePids(marker);
  rec({ id: BUILD + '.F8.noChromeLeft', leftover, pass: Array.isArray(leftover) && leftover.length === base0 });
}
try {
  if (PART === 'all' || PART.startsWith('prec')) await precedence();
  if (PART === 'all' || PART === 'f1') await f1();
  if (PART === 'all' || PART === 'f6f8') await f6f8();
} catch (e) { rec({ id: 'HARNESS-ERROR', err: String(e.stack).slice(0, 500), pass: false }); }
await cli(['close']);
const left = await chromePids(TEMP);
fs.appendFileSync(OUT, JSON.stringify({ summary: { pass, fail, fails, leftChromePids: left, ms: Math.round(performance.now() - T0) } }) + '\n');
console.log(JSON.stringify({ build: BUILD, pass, fail, fails, leftChromePids: left }));
await O.close();
process.exit(0);
