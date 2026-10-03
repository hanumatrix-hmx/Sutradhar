// AUDIT-2 live SDK (bundle dist/index.js): option > config > default incl. null options, opt-in, F1 (refused
// discovered download root vs option / configFile), F8 (viewport), F9 (announce). argv: <scratch>
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { observer, chromePids, until } from './obs.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const WT = path.resolve(HERE, '../../../../../../..');
const SDK = path.join(WT, 'packages/sutradhar/dist/index.js');
const S = path.resolve(process.argv[2], 'sdk'); fs.rmSync(S, { recursive: true, force: true });
const OUT = path.join(HERE, '..', process.argv[3] ? 'live-sdk-only-' + process.argv[3] + '.jsonl' : 'live-sdk.jsonl'); fs.writeFileSync(OUT, '');
const O = await observer();
const mk = (...p) => { const d = path.join(S, ...p); fs.mkdirSync(d, { recursive: true }); return d; };
const proj = mk('proj'); mk('proj', '.git'); const pcwd = mk('proj', 'k');
const optdl = mk('optdl'); const optup = mk('optup'); const other = mk('other'); const cup = mk('proj', 'cup');
fs.writeFileSync(path.join(optup, 'O.txt'), 'o'); fs.writeFileSync(path.join(cup, 'C.txt'), 'c'); fs.writeFileSync(path.join(other, 'X.txt'), 'x');
const H = { option: '127.0.0.61', config: '127.0.0.62', loser: '127.0.0.63' };
const VC = { width: 433, height: 333 }, VO = { width: 444, height: 344 };
fs.writeFileSync(path.join(proj, '.sutradhar.json'), JSON.stringify({ allowedDomains: [H.config], downloadDir: './cdl', allowedUploadRoots: ['./cup'], dialog: { mode: 'accept', promptText: 'CFs' }, viewport: VC }));
const hp = mk('hp'); mk('hp', '.git'); const hcwd = mk('hp', 'w'); const outside = path.join(S, 'outside-hp');
const HF = path.join(hp, '.sutradhar.json'); fs.writeFileSync(HF, JSON.stringify({ downloadDir: '../outside-hp', dialog: { mode: 'accept' } }));
const vpd = mk('vpd'); mk('vpd', '.git'); fs.writeFileSync(path.join(vpd, '.sutradhar.json'), JSON.stringify({ viewport: { width: 1000000000, height: 300 } }));
let pass = 0, fail = 0; const fails = [];
const rec = (o) => { fs.appendFileSync(OUT, JSON.stringify(o) + '\n'); o.pass ? pass++ : (fail++, fails.push(o.id)); };
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const dlName = (tag) => 'a2-' + tag.replace(/[^A-Za-z0-9_-]/g, '_') + '.bin';
const where = (tag, dirs) => Object.entries(dirs).filter(([, d]) => fs.existsSync(path.join(d, dlName(tag)))).map(([k]) => k);
const shaOk = (tag, dir) => O.served.some((s) => s.tag === tag && s.sha === sha(path.join(dir, dlName(tag))));
let n = 0;
function child(name, cwd, spec) {
  const temp = mk('t' + (n++)); /* short: Chrome fails past MAX_PATH under a long TEMP (harness fix, attempt 3) */ const sf = path.join(S, 'spec-' + name + '.json'); fs.writeFileSync(sf, JSON.stringify(spec));
  return new Promise((resolve) => {
    const env = { ...process.env, TEMP: temp, TMP: temp }; for (const k of Object.keys(env)) if (/^SUTRADHAR_/i.test(k)) delete env[k];
    env.SUTRADHAR_ALLOWED_DOMAINS = '127.0.0.99'; env.SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS = path.join(S, 'env-ignored'); // the SDK must ignore env
    const ch = spawn(process.execPath, [path.join(HERE, 'sdk-child.mjs'), SDK, sf], { cwd, env, windowsHide: true });
    let so = '', se = ''; ch.stdout.on('data', (d) => (so += d)); ch.stderr.on('data', (d) => (se += d));
    const t = setTimeout(() => { try { ch.kill(); } catch {} }, 180000);
    ch.on('close', async (code) => { clearTimeout(t); const line = so.split(String.fromCharCode(10)).find((l) => l.startsWith('RESULT ')); const pids = await chromePids(temp); resolve({ code, r: line ? JSON.parse(line.slice(7)) : { error: 'NO RESULT ' + se.slice(0, 300) }, temp, pids }); });
  });
}
const files = { O: path.join(optup, 'O.txt'), C: path.join(cup, 'C.txt'), X: path.join(other, 'X.txt') };
const upOk = (r, allow) => Object.entries(files).every(([k, f]) => { const v = r.steps['up:' + f.slice(-5)]; return allow.includes(k) ? v === 'ok' : v !== 'ok'; });
const ANN = 'sets dialog.mode "accept": native alert/confirm/prompt dialogs will be accepted automatically';
const ONLY = process.argv[3];
async function prec(name, opts, nullKeys, want) {
  if (ONLY && name !== ONLY) return;
  const t = 'sdk-' + name;
  const navs = { option: O.url(H.option, t + '-o'), config: O.url(H.config, t + '-c'), loser: O.url(H.loser, t + '-l') };
  const winHost = want.dom === 'option' ? H.option : want.dom === 'config' ? H.config : H.loser;
  const x = await child(name, pcwd, { opts, nullKeys, navs, main: O.url(winHost, t), clickPrompt: want.pq !== 'SKIP', download: true, uploads: Object.values(files) });
  const r = x.r; await until(() => O.sig(t, 'vp')[0], 6000);
  const reached = Object.fromEntries(Object.keys(navs).map((k) => [k, O.reached(t + '-' + k[0]).length > 0]));
  const domOk = want.dom ? Object.entries(reached).every(([k, v]) => v === (k === want.dom)) : Object.values(reached).every(Boolean);
  const vp = O.sig(t, 'vp')[0]; const pq = O.sig(t, 'pq')[0];
  const dirs = { option: optdl, config: path.join(proj, 'cdl'), default: path.join(x.temp, 'sutradhar-downloads'), env: path.join(S, 'env-ignored') };
  const found = where(t, dirs);
  const ups = O.sig(t, 'up');
  const res = {
    domains: domOk, viewport: want.vp === 'DEFAULT' ? vp !== undefined && vp !== '433x333' && vp !== '444x344' : vp === want.vp, prompt: want.pq === 'SKIP' ? pq === undefined : pq === want.pq, download: found.join() === want.dl && shaOk(t, dirs[want.dl]),
    upload: JSON.stringify([...ups].sort()) === JSON.stringify(want.up.map((k) => k + '.txt').sort()), announce: r.warns.some((w) => w.includes(ANN)) === want.announce, chromeLeft: (x.pids ?? []).length === 0,
  };
  rec({ id: 'SDK.' + name, err: r.error, reached, vp, pq, found, ups, warns: r.warns, res, pass: !r.error && Object.values(res).every(Boolean) });
}
async function refused(name, cwd, opts, nullKeys, needle) {
  if (ONLY && name !== ONLY) return;
  const x = await child(name, cwd, { opts, nullKeys, main: O.url(H.option, 'sdk-' + name), download: true });
  rec({ id: 'SDK.' + name, err: x.r.error, pids: x.pids, pass: !!x.r.error && x.r.error.includes(needle) && O.reached('sdk-' + name).length === 0 && (x.pids ?? [1]).length === 0 });
}
async function works(name, cwd, opts, nullKeys, dlDir, wantAnnounce) {
  if (ONLY && name !== ONLY) return;
  const t = 'sdk-' + name;
  const x = await child(name, cwd, { opts, nullKeys, main: O.url(H.option, t), download: true });
  const found = where(t, { want: dlDir, outside, optdl, def: path.join(x.temp, 'sutradhar-downloads') });
  rec({ id: 'SDK.' + name, err: x.r.error, found, warns: x.r.warns, dl: x.r.steps.download, pass: !x.r.error && found[0] === 'want' && found.length === (dlDir === outside || dlDir === optdl ? 2 : 1) && shaOk(t, dlDir) && (dlDir === outside || !fs.existsSync(outside)) && x.r.warns.some((w) => w.includes(ANN)) === wantAnnounce && (x.pids ?? [1]).length === 0 });
}
const ALLNULL = ['allowedDomains', 'viewport', 'allowedDownloadRoots', 'allowedUploadRoots', 'dialogPolicy', 'idleTimeoutMs', 'configFile'];
try {
  await prec('config', { discoverConfig: true }, [], { dom: 'config', vp: '433x333', pq: 'CFs', dl: 'config', up: ['C'], announce: true });
  await prec('option+config', { discoverConfig: true, allowedDomains: [H.option], viewport: VO, allowedDownloadRoots: [optdl], allowedUploadRoots: [optup], dialogPolicy: { mode: 'dismiss' } }, [], { dom: 'option', vp: '444x344', pq: 'NULL', dl: 'option', up: ['O'], announce: false });
  await prec('null+config', { discoverConfig: true }, ALLNULL, { dom: 'config', vp: '433x333', pq: 'CFs', dl: 'config', up: ['C'], announce: true });
  await prec('optin-off', {}, [], { dom: null, vp: 'DEFAULT', pq: 'SKIP', dl: 'default', up: ['O', 'C', 'X'], announce: false });
  await refused('F1.hostile.none', hcwd, { discoverConfig: true }, [], "outside this config's directory");
  await refused('F1.hostile.optEmpty', hcwd, { discoverConfig: true, allowedDownloadRoots: [] }, [], "outside this config's directory");
  await refused('F1.hostile.optNull', hcwd, { discoverConfig: true }, ['allowedDownloadRoots'], "outside this config's directory");
  await refused('F1.hostile.uploadOptOnly', hcwd, { discoverConfig: true, allowedUploadRoots: [optup] }, [], "outside this config's directory");
  await works('F1.hostile.optRoots', hcwd, { discoverConfig: true, allowedDownloadRoots: [optdl] }, [], optdl, true);
  await works('F1.hostile.configFile', hcwd, { configFile: HF }, [], outside, false);
  await refused('F8.fileHuge', vpd, { discoverConfig: true }, [], 'viewport.width must be a positive integer');
  if (!ONLY) { const t = 'sdk-F8.optHuge'; const x = await child('F8optHuge', pcwd, { opts: { discoverConfig: true, viewport: { width: 1000000000, height: 1000000000 } }, main: O.url(H.config, t) });
    const vp = await until(() => O.sig(t, 'vp')[0], 6000); rec({ id: 'SDK.F8.optionHuge(observed)', err: x.r.error ?? null, vp, warns: x.r.warns, pids: x.pids, pass: (x.pids ?? [1]).length === 0, note: 'records what an out-of-range SDK option does (GAP-350)' }); }
} catch (e) { rec({ id: 'HARNESS-ERROR', err: String(e.stack).slice(0, 400), pass: false }); }
const left = await chromePids(S);
fs.appendFileSync(OUT, JSON.stringify({ summary: { pass, fail, fails, leftChromePids: left } }) + '\n');
console.log(JSON.stringify({ pass, fail, fails, leftChromePids: left }));
await O.close(); process.exit(0);
