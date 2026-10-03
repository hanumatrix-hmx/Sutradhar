// AUDIT-1 live CLI precedence matrix: every subset of {flag, env, state, config} x every CLI key, on
// one CLI build (argv[2] = pkg | bundle | master). Effective values are read from INDEPENDENT
// observers only: server Host log (navigation), page beacons (viewport, prompt result, upload),
// the filesystem + served sha256 (download). argv[3] = scratch root.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startObserver } from './observer-server.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const WT = path.resolve(HERE, '../../../../../../..');
const BUILD = process.argv[2];
const BIN = { pkg: path.join(WT, 'packages/cli/dist/cli.js'), bundle: path.join(WT, 'packages/sutradhar/dist/cli-bin.js') }[BUILD];
const S = path.resolve(process.argv[3], BUILD);
const ONLY = process.argv[4] ? process.argv[4].split(',') : null;
fs.mkdirSync(S, { recursive: true });
const OUT = path.join(HERE, '..', 'live-cli-' + BUILD + '.jsonl');
fs.writeFileSync(OUT, '');
const T0 = performance.now();
const DEADLINE_MS = 19 * 60 * 1000;
const obs = await startObserver();
const P = obs.port;
const proj = path.join(S, 'proj'); const cwd = path.join(proj, 'a', 'b');
for (const d of [path.join(proj, '.git'), cwd, path.join(proj, 'cup'), path.join(S, 'envup'), path.join(S, 'other'), path.join(S, 'envdl'), path.join(S, 'temp'), path.join(S, 'state')]) fs.mkdirSync(d, { recursive: true });
fs.writeFileSync(path.join(proj, 'cup', 'c.txt'), 'cfg-up');
fs.writeFileSync(path.join(S, 'envup', 'e.txt'), 'env-upload');
fs.writeFileSync(path.join(S, 'other', 'o.txt'), 'other-upload-file');
const CFGFILE = path.join(proj, '.sutradhar.json');
const baseEnv = { ...process.env, TEMP: path.join(S, 'temp'), TMP: path.join(S, 'temp'), SUTRADHAR_CLI_STATE_DIR: path.join(S, 'state') };
for (const k of Object.keys(baseEnv)) if (/^SUTRADHAR_(ALLOWED|CONFIG|IDLE)/i.test(k)) delete baseEnv[k];
function cli(args, extraEnv = {}) {
  return new Promise((resolve) => {
    const t = performance.now();
    const ch = spawn(process.execPath, [BIN, ...args], { cwd, env: { ...baseEnv, ...extraEnv }, windowsHide: true });
    let so = '', se = '';
    ch.stdout.on('data', (d) => { so += d; }); ch.stderr.on('data', (d) => { se += d; });
    const timer = setTimeout(() => { try { ch.kill(); } catch {} }, 90_000);
    ch.on('close', (code, signal) => { clearTimeout(timer); resolve({ args, code, signal, stdout: so.slice(0, 3000), stderr: se.slice(0, 3000), ms: Math.round(performance.now() - t) }); });
  });
}
async function waitFor(fn, ms) { const end = performance.now() + ms; for (;;) { const v = fn(); if (v !== undefined) return v; if (performance.now() > end) return undefined; await new Promise((r) => setTimeout(r, 100)); } }
const url = (host, c) => 'http://' + host + ':' + P + '/p?c=' + encodeURIComponent(c);
const LAYERS = ['flag', 'env', 'state', 'config'];
const subsets = []; for (let m = 0; m < 16; m++) subsets.push(LAYERS.filter((_, i) => m & (1 << i)));
let pass = 0, fail = 0; const fails = [];
function rec(o) { fs.appendFileSync(OUT, JSON.stringify(o) + '\n'); if (o.pass) pass++; else { fail++; fails.push(o.id); } }
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
for (const sub of subsets) {
  if (performance.now() - T0 > DEADLINE_MS) { rec({ id: 'DEADLINE', pass: false }); break; }
  const has = (l) => sub.includes(l);
  const id = BUILD + '[' + (sub.join('+') || 'none') + ']';
  if (ONLY && !ONLY.includes(sub.join('+') || 'none')) continue;
  const steps = [];
  steps.push(await cli(['close']));
  try { fs.rmSync(path.join(S, 'state', 'state.json'), { force: true }); } catch {}
  if (has('config')) fs.writeFileSync(CFGFILE, JSON.stringify({ allowedDomains: ['127.0.0.4'], downloadDir: './cdl', allowedUploadRoots: ['./cup'], dialog: { mode: 'accept', promptText: 'CFG' }, viewport: { width: 405, height: 305 }, idleTimeoutMs: 1000 }));
  else fs.rmSync(CFGFILE, { force: true });
  if (has('state')) steps.push(await cli(['nav', url('127.0.0.4', id + '-prime'), '--allowlist-domains', '127.0.0.4', '--viewport', '402x302', '--dialog', 'accept', '--dialog-text', 'STATE']));
  const env = has('env') ? { SUTRADHAR_ALLOWED_DOMAINS: '127.0.0.3', SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS: path.join(S, 'envdl'), SUTRADHAR_ALLOWED_UPLOAD_ROOTS: path.join(S, 'envup') } : {};
  const flags = has('flag') ? ['--allowlist-domains', '127.0.0.2', '--viewport', '401x301', '--dialog', 'dismiss'] : [];
  // ---- allowedDomains: flag > env > config > unrestricted
  const winner = has('flag') ? '127.0.0.2' : has('env') ? '127.0.0.3' : has('config') ? '127.0.0.4' : null;
  const nav = {};
  for (const h of ['127.0.0.2', '127.0.0.3', '127.0.0.4', '127.0.0.5']) {
    const c = id + '-h' + h;
    const r = await cli(['nav', url(h, c), ...flags], env); steps.push(r);
    const reached = (await waitFor(() => (obs.pageHits(c).length ? true : undefined), 3000)) === true;
    nav[h] = { code: r.code, reached };
  }
  const domOk = Object.entries(nav).every(([h, v]) => (winner === null || h === winner) ? (v.reached && v.code === 0) : (!v.reached && v.code !== 0));
  rec({ id: id + '.allowedDomains', expectWinner: winner ?? 'unrestricted', nav, pass: domOk });
  // ---- viewport: flag > state > config > Chrome default (observed by the page itself)
  const cm = id + '-main';
  steps.push(await cli(['nav', url(winner ?? '127.0.0.5', cm), ...flags], env));
  const vp = await waitFor(() => obs.beacons(cm, 'vp')[0], 8000);
  const wantVp = has('flag') ? '401x301' : has('state') ? '402x302' : has('config') ? '405x305' : 'DEFAULT';
  rec({ id: id + '.viewport', want: wantVp, got: vp, pass: wantVp === 'DEFAULT' ? (vp !== undefined && !['401x301', '402x302', '405x305'].includes(vp)) : vp === wantVp });
  // ---- dialog: flag(dismiss) > state(accept STATE) > config(accept CFG) > report (pending)
  const rc = await cli(['click', '#pr', ...flags], env); steps.push(rc);
  const pr = await waitFor(() => obs.beacons(cm, 'prompt')[0], 4000);
  const wantDlg = has('flag') ? '<null>' : has('state') ? 'STATE' : has('config') ? 'CFG' : 'PENDING';
  let dlgOk;
  if (wantDlg === 'PENDING') {
    const pendingSaid = /dialogPending|pending/i.test(rc.stdout + rc.stderr);
    const rd = await cli(['dialog', 'dismiss'], env); steps.push(rd);
    const after = await waitFor(() => obs.beacons(cm, 'prompt')[0], 4000);
    dlgOk = pr === undefined && pendingSaid && after === '<null>';
    rec({ id: id + '.dialog', want: wantDlg, gotBeforeHandle: pr ?? null, pendingSaid, afterDismiss: after, pass: dlgOk });
  } else {
    dlgOk = pr === wantDlg;
    rec({ id: id + '.dialog', want: wantDlg, got: pr ?? null, clickOut: rc.stdout.slice(0, 300), pass: dlgOk });
  }
  // ---- download roots: env > config(downloadDir rel. to the FILE) > <TEMP>/sutradhar-downloads
  const rdl = await cli(['download', '#dl', ...flags], env); steps.push(rdl);
  const name = 'a1-' + cm.replace(/[^A-Za-z0-9_.-]/g, '_') + '.bin';
  const dirs = { env: path.join(S, 'envdl'), config: path.join(proj, 'cdl'), default: path.join(S, 'temp', 'sutradhar-downloads'), cwdRel: path.join(cwd, 'cdl') };
  const found = Object.entries(dirs).filter(([, d]) => fs.existsSync(path.join(d, name))).map(([k]) => k);
  const wantDl = has('env') ? 'env' : has('config') ? 'config' : 'default';
  const servedSha = obs.served.filter((s) => s.c === cm).map((s) => s.sha256);
  const shaOk = found.length === 1 && servedSha.includes(sha(path.join(dirs[found[0]], name)));
  rec({ id: id + '.download', want: wantDl, found, shaOk, code: rdl.code, pass: found.length === 1 && found[0] === wantDl && shaOk });
  // ---- D12c notice on that command
  const wantNoteDl = has('config') && !has('env');
  const wantNoteDlg = has('config') && !has('flag') && !has('state');
  const notes = rdl.stderr.split(String.fromCharCode(10)).map((l) => l.trim()).filter((l) => l.startsWith('Note: using')); const note = notes.join(' | ');
  const noteOk = (wantNoteDl || wantNoteDlg) ? (notes.length === 1 && note.includes('downloadDir/allowedDownloadRoots') === wantNoteDl && note.includes('dialog.mode "accept"') === wantNoteDlg) : note === '';
  rec({ id: id + '.trustNotice', wantNoteDl, wantNoteDlg, note, pass: noteOk });
  // ---- upload roots: env > config > unrestricted (observed by the page's change handler)
  const ups = {};
  for (const [k, f] of [['e', path.join(S, 'envup', 'e.txt')], ['c', path.join(proj, 'cup', 'c.txt')], ['o', path.join(S, 'other', 'o.txt')]]) {
    const before = obs.beacons(cm, 'up').length;
    const r = await cli(['upload', '#f', f, ...flags], env); steps.push(r);
    const got = await waitFor(() => (obs.beacons(cm, 'up').length > before ? obs.beacons(cm, 'up').at(-1) : undefined), 3000);
    ups[k] = { code: r.code, got: got ?? null };
  }
  const allowedSet = has('env') ? ['e'] : has('config') ? ['c'] : ['e', 'c', 'o'];
  const upOk = Object.entries(ups).every(([k, v]) => allowedSet.includes(k) ? (v.code === 0 && v.got && v.got.startsWith(k + '.txt:')) : (v.code !== 0 && v.got === null));
  rec({ id: id + '.upload', allowedSet, ups, pass: upOk });
  steps.push(await cli(['close']));
  fs.appendFileSync(OUT, JSON.stringify({ id: id + '.steps', steps: steps.map((s) => ({ a: s.args.slice(0, 2).join(' '), code: s.code, ms: s.ms, err: s.stderr.split('\n').filter((l) => /Error|Warning|Note|Fatal/.test(l)).slice(0, 3) })) }) + '\n');
}
fs.rmSync(CFGFILE, { force: true });
await obs.close();
const summary = { build: BUILD, pass, fail, fails, seconds: Math.round((performance.now() - T0) / 1000) };
fs.appendFileSync(OUT, JSON.stringify({ summary }) + '\n');
console.log(JSON.stringify(summary));
