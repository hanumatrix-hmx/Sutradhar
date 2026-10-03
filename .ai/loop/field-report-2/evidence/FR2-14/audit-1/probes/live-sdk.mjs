// AUDIT-1 live SDK (bundle dist/index.js) precedence: option > config > default, plus opt-in, explicit,
// both, env-ignored, report-option. Observers: server log, page beacons, filesystem, chrome.exe list.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startObserver } from './observer-server.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const WT = path.resolve(HERE, '../../../../../../..');
const SDK = path.join(WT, 'packages/sutradhar/dist/index.js');
const S = path.resolve(process.argv[2], 'sdk');
const OUT = path.join(HERE, '..', 'live-sdk.jsonl'); fs.writeFileSync(OUT, '');
const obs = await startObserver();
const proj = path.join(S, 'proj'); const cwd = path.join(proj, 'a', 'b');
for (const d of [path.join(proj, '.git'), cwd, path.join(proj, 'cup'), path.join(S, 'optup'), path.join(S, 'other'), path.join(S, 'optdl'), path.join(S, 'explicit')]) fs.mkdirSync(d, { recursive: true });
fs.writeFileSync(path.join(proj, 'cup', 'c.txt'), 'cfg-up'); fs.writeFileSync(path.join(S, 'optup', 'e.txt'), 'opt-upload'); fs.writeFileSync(path.join(S, 'other', 'o.txt'), 'other-upload-file');
fs.writeFileSync(path.join(S, 'explicit', 'cfg.json'), JSON.stringify({ allowedDomains: ['127.0.0.3'], downloadDir: '../outside-explicit' }));
const CFG = path.join(proj, '.sutradhar.json');
const CFGV = JSON.stringify({ allowedDomains: ['127.0.0.4'], downloadDir: './cdl', allowedUploadRoots: ['./cup'], dialog: { mode: 'accept', promptText: 'CFG' }, viewport: { width: 405, height: 305 }, idleTimeoutMs: 15000 });
let pass = 0, fail = 0; const fails = [];
function rec(o) { fs.appendFileSync(OUT, JSON.stringify(o) + '\n'); if (o.pass) pass++; else { fail++; fails.push(o.id); } }
function child(mode, extraEnv) {
  const temp = path.join(S, 'temp-' + mode.replace(/[^a-z]/g, '_')); fs.mkdirSync(temp, { recursive: true });
  const env = { ...process.env, TEMP: temp, TMP: temp, ...extraEnv };
  return new Promise((resolve) => {
    const ch = spawn(process.execPath, [path.join(HERE, 'sdk-child.mjs'), SDK, String(obs.port), mode, S, temp], { cwd, env, windowsHide: true });
    let so = ''; let se = ''; ch.stdout.on('data', (d) => { so += d; }); ch.stderr.on('data', (d) => { se += d; });
    const t = setTimeout(() => ch.kill(), 240000);
    ch.on('close', () => { clearTimeout(t); const m = so.match(/RESULT (.*)/); resolve({ temp, r: m ? JSON.parse(m[1]) : { error: 'no result', so: so.slice(-500), se: se.slice(-500) } }); });
  });
}
const has = (n) => fs.existsSync(n);
const dlName = (mode) => 'a1-' + (mode + '-main').replace(/[^A-Za-z0-9_.-]/g, '_') + '.bin';
for (const mode of ['none', 'option', 'config', 'option+config']) {
  if (mode.includes('config')) fs.writeFileSync(CFG, CFGV); else fs.rmSync(CFG, { force: true });
  const { temp, r } = await child(mode, {});
  const hasO = mode.startsWith('option'); const hasC = mode.includes('config');
  const winner = hasO ? '127.0.0.2' : hasC ? '127.0.0.4' : null;
  const navOk = ['127.0.0.2', '127.0.0.3', '127.0.0.4', '127.0.0.5'].every((h) => { const reached = obs.pageHits(mode + '-h' + h).length > 0; return (winner === null || h === winner) ? reached : !reached; });
  rec({ id: 'sdk[' + mode + '].allowedDomains', winner, nav: r.nav, pass: navOk });
  const vp = obs.beacons(mode + '-main', 'vp')[0]; const wantVp = hasO ? '401x301' : hasC ? '405x305' : 'DEFAULT';
  rec({ id: 'sdk[' + mode + '].viewport', want: wantVp, got: vp, pass: wantVp === 'DEFAULT' ? (!!vp && !['401x301', '405x305'].includes(vp)) : vp === wantVp });
  const pr = obs.beacons(mode + '-main', 'prompt')[0]; const wantPr = hasO ? 'null-fast' : hasC ? 'CFG' : 'null-after-30s-auto';
  rec({ id: 'sdk[' + mode + '].dialog', want: wantPr, got: pr, clickMs: r.clickMs, pass: hasO ? (pr === '<null>' && r.clickMs < 15000) : hasC ? pr === 'CFG' : (r.click === undefined) });
  const dirs = { option: path.join(S, 'optdl'), config: path.join(proj, 'cdl'), default: path.join(temp, 'sutradhar-downloads'), cwdRel: path.join(cwd, 'cdl') };
  const found = Object.entries(dirs).filter(([, d]) => has(path.join(d, dlName(mode)))).map(([k]) => k);
  const wantDl = hasO ? 'option' : hasC ? 'config' : 'default';
  rec({ id: 'sdk[' + mode + '].download', want: wantDl, found, ret: r.download, pass: found.length === 1 && found[0] === wantDl });
  const allowed = hasO ? ['e'] : hasC ? ['c'] : ['e', 'c', 'o'];
  const ups = obs.beacons(mode + '-main', 'up');
  rec({ id: 'sdk[' + mode + '].upload', allowed, up: r.up, beacons: ups, pass: ['e', 'c', 'o'].every((k) => allowed.includes(k) ? (r.up[k] === 'ok' && ups.some((u) => u.startsWith(k + '.txt:'))) : (r.up[k] !== 'ok' && !ups.some((u) => u.startsWith(k + '.txt:')))) });
  const wantReaped = hasC && !hasO;
  rec({ id: 'sdk[' + mode + '].idle', wantReaped, pidsBefore: r.pidsBefore, reaped: r.reaped, pass: r.pidsBefore > 0 && r.reaped === wantReaped });
  rec({ id: 'sdk[' + mode + '].warnings', warns: r.warns, error: r.error, pass: !r.error });
}
fs.writeFileSync(CFG, CFGV);
{
  const { r } = await child('optin-off', {}); const vp = obs.beacons('optin-off-main', 'vp')[0];
  rec({ id: 'sdk[optin-off]', nav: r.nav, vp, pass: ['127.0.0.2', '127.0.0.3', '127.0.0.4', '127.0.0.5'].every((h) => obs.pageHits('optin-off-h' + h).length > 0) && vp !== '405x305' });
}
{
  const { r } = await child('env-ignored', { SUTRADHAR_CONFIG: 'none', SUTRADHAR_ALLOWED_DOMAINS: '127.0.0.3', SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS: path.join(S, 'optdl') });
  rec({ id: 'sdk[env-ignored]', nav: r.nav, pass: ['127.0.0.2', '127.0.0.3', '127.0.0.5'].every((h) => obs.pageHits('env-ignored-h' + h).length === 0) && obs.pageHits('env-ignored-h127.0.0.4').length > 0 && has(path.join(proj, 'cdl', dlName('env-ignored'))) });
}
{
  const { r } = await child('explicit', {});
  rec({ id: 'sdk[explicit-trusted]', nav: r.nav, dl: r.download, pass: obs.pageHits('explicit-h127.0.0.3').length > 0 && obs.pageHits('explicit-h127.0.0.5').length === 0 && has(path.join(S, 'outside-explicit', dlName('explicit'))) });
}
{ const { r } = await child('both', {}); rec({ id: 'sdk[both]', error: r.error, pass: /either configFile or discoverConfig/.test(r.error || 'x') }); }
{ const { r } = await child('report-option', {}); rec({ id: 'sdk[report-option]', error: r.error, pass: /not supported by the SDK/.test(r.error || 'x') }); }
fs.rmSync(CFG, { force: true });
await obs.close();
const summary = { pass, fail, fails }; fs.appendFileSync(OUT, JSON.stringify({ summary }) + '\n'); console.log(JSON.stringify(summary));
process.exit(0);
