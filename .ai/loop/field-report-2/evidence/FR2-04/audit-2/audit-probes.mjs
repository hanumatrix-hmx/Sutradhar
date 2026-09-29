// FR2-04 audit-1: independent live probes (Auditor-written; not the Executor's script).
// Drives the BUILT packages/cli/dist/cli.js as a separate process per step, with an observer
// that only ever sends Runtime.evaluate (never pages()/Page.*), same rules as spec §5.
//
// Usage: node audit-probes.mjs [probeName ...]   (no args = all)
// Output: audit-1/probes/<probe>.json + console. Scratch root under os.tmpdir(), removed in finally.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..', '..', '..', '..');
const CLI = path.join(repoRoot, 'packages/cli/dist/cli.js');
const require_ = createRequire(path.join(repoRoot, 'packages/browser/package.json'));
const puppeteer = require_('puppeteer-core');
const OUT = path.join(here, 'probes');
await fs.mkdir(OUT, { recursive: true });
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const R = await fs.mkdtemp(path.join(os.tmpdir(), 'fr2-04-audit-'));
const TEMP_ROOT = path.join(R, 'temp');
await fs.mkdir(TEMP_ROOT, { recursive: true });
const rReal = await fs.realpath(R);

const FX = await fs.readFile(path.join(repoRoot, 'tools/scenario-suite/fixtures/fr2-04-dialogs.html'), 'utf-8');
const AUDIT_PAGE = (port) => `<!doctype html><html><head><title>audit</title></head><body>
<button id="popup-delay">popup</button><button id="xnav-delay">xnav</button><button id="xframe">xframe</button>
<button id="chain-timer">chain</button><button id="popup-late">popup-late</button>
<script>
var q=new URLSearchParams(location.search);var N=q.get('n');document.title='audit '+N;
var KEY='fr2-04:'+N;function rec(e){var a=JSON.parse(localStorage.getItem(KEY)||'[]');e.seq=a.length+1;a.push(e);localStorage.setItem(KEY,JSON.stringify(a));}
window.rec=rec;
document.getElementById('popup-delay').onclick=function(){setTimeout(function(){rec({k:'popup-open',w:!!window.open('/fx.html?n='+N+'-pop&onloadAlert=1')});},1500);};
document.getElementById('popup-late').onclick=function(){setTimeout(function(){rec({k:'popup-open',w:!!window.open('/fx.html?n='+N+'-late&timerKind=alert&timerMs=3000')});},1500);};
document.getElementById('xnav-delay').onclick=function(){setTimeout(function(){location.href='http://localhost:${port}/fx.html?n='+N+'-x&onloadAlert=1';},1500);};
document.getElementById('xframe').onclick=function(){var f=document.createElement('iframe');f.src='http://localhost:${port}/fx.html?n='+N+'-f&onloadAlert=1';document.body.appendChild(f);};
document.getElementById('chain-timer').onclick=function(){setTimeout(function(){rec({k:'c1',r:confirm('audit c1 '+N)});rec({k:'p1',r:prompt('audit p1 '+N,'dflt')});rec({k:'c2',r:confirm('audit c2 '+N)});},1500);};
if(q.get('timerChain')){setTimeout(function(){rec({k:'c1',r:confirm('audit c1 '+N)});rec({k:'p1',r:prompt('audit p1 '+N,'dflt')});rec({k:'c2',r:confirm('audit c2 '+N)});},+q.get('timerChain'));}
</script></body></html>`;
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
  res.end(u.pathname === '/audit.html' ? AUDIT_PAGE(server.address().port) : FX);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;
const FXURL = `http://127.0.0.1:${PORT}/fx.html`;
const AUDURL = `http://127.0.0.1:${PORT}/audit.html`;
const nonce = (t) => `${t}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

function cli(args, dir, { capMs = 60000, env = {} } = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn(process.execPath, [CLI, ...args], {
      env: { ...process.env, TEMP: TEMP_ROOT, TMP: TEMP_ROOT, SUTRADHAR_CLI_STATE_DIR: dir, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let out = '', err = '', killed = false;
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    const cap = setTimeout(() => { killed = true; child.kill('SIGKILL'); }, capMs);
    child.on('exit', (code) => { clearTimeout(cap); resolve({ args: args.join(' '), code, ms: Date.now() - t0, killedAtCap: killed, stdout: out, stderr: err }); });
  });
}
const readJson = async (f) => { try { return JSON.parse(await fs.readFile(f, 'utf-8')); } catch { return undefined; } };
const readState = (d) => readJson(path.join(d, 'state.json'));
const readWarden = (d) => readJson(path.join(d, 'warden.json'));
function procs() {
  const out = execSync('powershell -NoProfile -Command "Get-CimInstance Win32_Process | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Depth 2"', { encoding: 'utf-8', maxBuffer: 64 << 20 });
  const p = JSON.parse(out); return Array.isArray(p) ? p : [p];
}
function wardenPids() {
  return procs().filter((p) => /__dialog-warden/.test(p.CommandLine || '')).map((p) => {
    const m = /__dialog-warden\s+(\S+)/.exec(p.CommandLine); let d = {};
    try { d = JSON.parse(Buffer.from(m[1], 'base64url').toString()); } catch {}
    return { pid: p.ProcessId, stateFile: d.stateFile, wsEndpoint: d.wsEndpoint };
  }).filter((w) => (w.stateFile || '').startsWith(R) || (w.stateFile || '').startsWith(rReal));
}
const chromeInR = () => procs().filter((p) => /chrome\.exe/i.test(p.Name || '') && (p.CommandLine || '').includes(rReal)).map((p) => p.ProcessId);
const pidAlive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const taskkill = (pid, tree = false) => { try { execSync(`taskkill /PID ${pid} /F${tree ? ' /T' : ''}`, { stdio: 'ignore' }); } catch {} };

const violations = [];
function guard(s) { const send = s.send.bind(s); s.send = (m, ...r) => { if (m !== 'Runtime.evaluate') { violations.push(m); return Promise.reject(new Error('guard ' + m)); } return send(m, ...r); }; return s; }
async function observe(ws, marker) {
  const b = await puppeteer.connect({ browserWSEndpoint: ws, defaultViewport: null });
  const end = Date.now() + 8000; let t;
  while (!t && Date.now() < end) { t = b.targets().find((x) => x.type() === 'page' && x.url().includes(marker)); if (!t) await delay(100); }
  if (!t) throw new Error('no target ' + marker);
  return { b, s: guard(await t.createCDPSession()) };
}
async function sessionFor(b, marker, ms = 8000) {
  const end = Date.now() + ms; let t;
  while (!t && Date.now() < end) { t = b.targets().find((x) => x.type() === 'page' && x.url().includes(marker)); if (!t) await delay(100); }
  return t ? guard(await t.createCDPSession()) : undefined;
}
async function live(s, ms = 1000) { try { await s.send('Runtime.evaluate', { expression: '1', returnByValue: true }, { timeout: ms }); return 'responsive'; } catch { return 'blocked'; } }
async function waitBlocked(s, ms) { const e = Date.now() + ms; while (Date.now() < e) { if ((await live(s, 200)) === 'blocked') return true; await delay(50); } return false; }
async function waitLive(s, ms) { const e = Date.now() + ms; while (Date.now() < e) { if ((await live(s, 700)) === 'responsive') return true; await delay(100); } return false; }
async function record(s, n) { const r = await s.send('Runtime.evaluate', { expression: `localStorage.getItem(${JSON.stringify('fr2-04:' + n)})`, returnByValue: true }, { timeout: 3000 }); return JSON.parse(r.result.value ?? 'null'); }
const pageUrls = (b) => b.targets().filter((t) => t.type() === 'page').map((t) => t.url());
const noHeal = (r) => !/previous session was unreachable/.test(r.stderr);

const results = {};
const checks = [];
function check(probe, name, pass, detail) { checks.push({ probe, name, pass, detail }); console.log(`[${pass ? 'PASS' : 'FAIL'}] ${probe}.${name}${pass ? '' : ' ' + JSON.stringify(detail ?? '').slice(0, 600)}`); }
const dirs = [];
function dirFor(name) { const d = path.join(R, 'state-' + name); dirs.push(d); return d; }

const probes = {
  // E3 / GAP-017 / GAP-006 with the warden UP: orphaned confirm, then several different verbs.
  async gap017_wardenUp() {
    const P = 'gap017_wardenUp', d = dirFor(P), n = nonce('g1'), log = [];
    log.push(await cli(['nav', `${FXURL}?n=${n}`], d));
    const st0 = await readState(d);
    const { b, s } = await observe(st0.wsEndpoint, n);
    const urls0 = pageUrls(b);
    const click = await cli(['click', '#confirm'], d); log.push(click);
    check(P, 'click-exit0-pending', click.code === 0 && click.stdout.includes('dialogPending: {"type":"confirm"'), click);
    check(P, 'observer-blocked', await waitBlocked(s, 2000));
    for (const args of [['snap'], ['tabs'], ['eval', '1+1'], ['text'], ['nav', `${FXURL}?n=${n}-other`], ['click', '#alert']]) {
      const r = await cli(args, d, { capMs: 200000 }); log.push(r);
      const st = await readState(d);
      check(P, `${args[0]}-exit3`, r.code === 3 && r.ms < 8000, { code: r.code, ms: r.ms, out: r.stdout, err: r.stderr });
      check(P, `${args[0]}-no-selfheal-same-chrome`, noHeal(r) && st.chromePid === st0.chromePid && st.wsEndpoint === st0.wsEndpoint);
      check(P, `${args[0]}-no-new-tab`, JSON.stringify(pageUrls(b)) === JSON.stringify(urls0), pageUrls(b));
    }
    const dis = await cli(['dialog', 'dismiss'], d); log.push(dis);
    check(P, 'dismiss', dis.code === 0 && /Dismissed confirm/.test(dis.stdout), dis);
    check(P, 'responsive-after', await waitLive(s, 3000));
    const rec = await record(s, n);
    check(P, 'record-false-once', JSON.stringify(rec?.map((e) => [e.phase, e.result ?? null])) === JSON.stringify([['opening', null], ['returned', false]]), rec);
    const snap = await cli(['snap'], d); log.push(snap);
    check(P, 'snap-right-tab', snap.code === 0 && snap.stdout.includes(`fr2-04 ${n}`) && !snap.stdout.includes('dialogPending'), snap);
    await b.disconnect();
    log.push(await cli(['close'], d));
    results[P] = log;
  },

  // Warden killed AFTER a CLI command orphaned a dialog (lastPendingDialog hint exists).
  async wardenDown_hint() {
    const P = 'wardenDown_hint', d = dirFor(P), n = nonce('h'), log = [];
    log.push(await cli(['nav', `${FXURL}?n=${n}`], d));
    const st0 = await readState(d);
    const { b, s } = await observe(st0.wsEndpoint, n);
    const urls0 = pageUrls(b);
    log.push(await cli(['click', '#confirm'], d));
    const st1 = await readState(d);
    check(P, 'lastPendingDialog-written', st1.lastPendingDialog?.type === 'confirm', st1.lastPendingDialog);
    const w = await readWarden(d); taskkill(w.pid);
    await delay(500);
    check(P, 'warden-dead', !pidAlive(w.pid));
    const snap = await cli(['snap'], d, { capMs: 200000 }); log.push(snap);
    const st2 = await readState(d);
    check(P, 'snap-exit3-fast', snap.code === 3 && snap.ms < 10000, { code: snap.code, ms: snap.ms });
    check(P, 'snap-reports-confirm-via-hint', snap.stdout.includes('"type":"confirm"') && snap.stdout.includes(`fr2-04 confirm ${n}`), snap.stdout);
    check(P, 'no-selfheal-no-newtab', noHeal(snap) && st2.chromePid === st0.chromePid && JSON.stringify(pageUrls(b)) === JSON.stringify(urls0), { urls: pageUrls(b) });
    const acc = await cli(['dialog', 'accept'], d); log.push(acc);
    results[P + '_acceptOutcome'] = { code: acc.code, stdout: acc.stdout, stderr: acc.stderr };
    check(P, 'dialog-accept-honest-failure-or-success', (acc.code === 1 && /could not accept/.test(acc.stderr)) || acc.code === 0, acc);
    check(P, 'failure-message-mentions-recovery', acc.code === 0 || /close/.test(acc.stderr), acc.stderr);
    const t0 = Date.now(); const cl = await cli(['close'], d); log.push(cl);
    check(P, 'close-fast', Date.now() - t0 < 10000 && cl.code === 0, cl);
    await b.disconnect().catch(() => {});
    results[P] = log;
  },

  // Warden killed, THEN a dialog opens later from a page timer (no CLI saw it; no hint).
  async wardenDown_laterDialog() {
    const P = 'wardenDown_laterDialog', d = dirFor(P), n = nonce('ld'), log = [];
    log.push(await cli(['nav', `${FXURL}?n=${n}&timerKind=confirm&timerMs=3000`], d));
    const st0 = await readState(d);
    const w = await readWarden(d); taskkill(w.pid);
    const { b, s } = await observe(st0.wsEndpoint, n);
    const urls0 = pageUrls(b);
    check(P, 'observer-blocked', await waitBlocked(s, 6000));
    const snap = await cli(['snap'], d, { capMs: 200000 }); log.push(snap);
    const st1 = await readState(d);
    check(P, 'snap-exit3-fast', snap.code === 3 && snap.ms < 10000, { code: snap.code, ms: snap.ms, out: snap.stdout, err: snap.stderr });
    check(P, 'no-selfheal-no-newtab', noHeal(snap) && st1.chromePid === st0.chromePid && JSON.stringify(pageUrls(b)) === JSON.stringify(urls0), pageUrls(b));
    const acc = await cli(['dialog', 'accept'], d); log.push(acc);
    results[P + '_acceptOutcome'] = { code: acc.code, stdout: acc.stdout, stderr: acc.stderr };
    await b.disconnect().catch(() => {});
    const t0 = Date.now(); log.push(await cli(['close'], d));
    check(P, 'close-fast', Date.now() - t0 < 10000);
    results[P] = log;
  },

  // Warden killed, page runs a long script (NOT a dialog): the disclosed trade-off.
  async wardenDown_slowScript() {
    const P = 'wardenDown_slowScript', d = dirFor(P), n = nonce('ss'), log = [];
    log.push(await cli(['nav', `${FXURL}?n=${n}`], d));
    const st0 = await readState(d);
    const w = await readWarden(d); taskkill(w.pid); await delay(300);
    const { b, s } = await observe(st0.wsEndpoint, n);
    await s.send('Runtime.evaluate', { expression: 'setTimeout(()=>{const t=Date.now();while(Date.now()-t<5000){}},0)' }, { timeout: 2000 });
    await delay(200);
    const snap = await cli(['snap'], d, { capMs: 60000 }); log.push(snap);
    results[P + '_snapDuringBusy'] = { code: snap.code, ms: snap.ms, stdout: snap.stdout, stderr: snap.stderr };
    check(P, 'busy-with-warden-down-reports-unknown-exit3 (disclosed trade-off)', snap.code === 3 && snap.stdout.includes('"type":"unknown"'), snap);
    await delay(5500);
    const snap2 = await cli(['snap'], d); log.push(snap2);
    const w2 = await readWarden(d);
    check(P, 'after-busy-ends-snap-ok-and-warden-respawned', snap2.code === 0 && w2 && w2.pid !== w.pid && pidAlive(w2.pid), { snap2, w2 });
    await b.disconnect();
    log.push(await cli(['close'], d));
    results[P] = log;
  },

  // Sibling paths: dialogs that open BETWEEN commands on a target the warden must attach to late
  // (a popup), after a cross-origin navigation (renderer swap), and in a cross-origin OOPIF.
  async betweenCommands_newTargets() {
    const P = 'betweenCommands_newTargets';
    for (const [btn, suffix] of [['#popup-delay', '-pop'], ['#xnav-delay', '-x']]) {
      const d = dirFor(P + btn.slice(1)), n = nonce('bc'), log = [];
      log.push(await cli(['nav', `${AUDURL}?n=${n}`], d));
      const st0 = await readState(d);
      const b = await puppeteer.connect({ browserWSEndpoint: st0.wsEndpoint, defaultViewport: null });
      const click = await cli(['click', btn], d); log.push(click);
      const s = await sessionFor(b, n + suffix, 10000);
      const blocked = s ? await waitBlocked(s, 6000) : false;
      check(P, `${btn}-dialog-opened-between-commands`, !!s && blocked, { found: !!s, urls: pageUrls(b) });
      const urls0 = pageUrls(b);
      const snap = await cli(['snap'], d, { capMs: 200000 }); log.push(snap);
      const st1 = await readState(d);
      results[`${P}${btn}_snap`] = { code: snap.code, ms: snap.ms, stdout: snap.stdout, stderr: snap.stderr, urlsBefore: urls0, urlsAfter: pageUrls(b) };
      check(P, `${btn}-snap-exit3-fast`, snap.code === 3 && snap.ms < 10000, { code: snap.code, ms: snap.ms, out: snap.stdout.slice(0, 400), err: snap.stderr.slice(0, 400) });
      check(P, `${btn}-snap-names-onload-alert`, snap.stdout.includes(`fr2-04 onload ${n}${suffix}`), snap.stdout.slice(0, 400));
      check(P, `${btn}-no-new-blank-tab-no-heal`, !pageUrls(b).includes('about:blank') && noHeal(snap) && st1.chromePid === st0.chromePid, pageUrls(b));
      const acc = await cli(['dialog', 'accept'], d); log.push(acc);
      check(P, `${btn}-dialog-accept`, acc.code === 0 && acc.stdout.includes('Accepted alert'), acc);
      await b.disconnect().catch(() => {});
      log.push(await cli(['close'], d, { capMs: 30000 }));
      results[P + btn] = log;
    }
    // cross-origin OOPIF with an onload alert, triggered IN-command (click)
    {
      const d = dirFor(P + 'xframe'), n = nonce('xf'), log = [];
      log.push(await cli(['nav', `${AUDURL}?n=${n}`], d));
      const st0 = await readState(d);
      const b = await puppeteer.connect({ browserWSEndpoint: st0.wsEndpoint, defaultViewport: null });
      const click = await cli(['click', '#xframe'], d, { capMs: 200000 }); log.push(click);
      results[P + '_xframe_click'] = { code: click.code, ms: click.ms, stdout: click.stdout, stderr: click.stderr };
      await delay(1500);
      const snap = await cli(['snap'], d, { capMs: 200000 }); log.push(snap);
      const st1 = await readState(d);
      results[P + '_xframe_snap'] = { code: snap.code, ms: snap.ms, stdout: snap.stdout.slice(0, 800), stderr: snap.stderr, urls: pageUrls(b) };
      check(P, 'xframe-click-reports-oopif-dialog', click.stdout.includes(`fr2-04 onload ${n}-f`), click.stdout.slice(0, 500));
      check(P, 'xframe-next-snap-honest(exit3 or clean exit0), fast, no heal/blank', (snap.code === 3 || (snap.code === 0 && !snap.stdout.includes('about:blank'))) && snap.ms < 10000 && noHeal(snap) && st1.chromePid === st0.chromePid, { code: snap.code, ms: snap.ms });
      log.push(await cli(['dialog', 'accept'], d));
      await b.disconnect().catch(() => {});
      log.push(await cli(['close'], d, { capMs: 30000 }));
      results[P + '_xframe'] = log;
    }
  },

  async popupDiag() {
    const P = 'popupDiag', out = [];
    for (const [btn, suffix, trials] of [['#popup-delay', '-pop', 4], ['#popup-late', '-late', 2]]) {
      for (let i = 0; i < trials; i++) {
        const d = dirFor(P + btn.slice(1) + i), n = nonce('pd');
        await cli(['nav', `${AUDURL}?n=${n}`], d);
        const st0 = await readState(d);
        const b = await puppeteer.connect({ browserWSEndpoint: st0.wsEndpoint, defaultViewport: null });
        await cli(['click', btn], d);
        const s = await sessionFor(b, n + suffix, 10000);
        const blocked = s ? await waitBlocked(s, 8000) : false;
        const status = await cli(['dialog'], d);
        out.push({ btn, i, popupBlocked: blocked, dialogStatus: status.stdout.trim().slice(0, 300), code: status.code });
        await b.disconnect().catch(() => {});
        const st = await readState(d); await cli(['close'], d, { capMs: 20000 });
        await delay(800);
        out[out.length - 1].chromeLeftAfterClose = chromeInR().length;
      }
    }
    const miss = (x) => x.popupBlocked && /No dialog is open/.test(x.dialogStatus);
    check(P, 'onload-alert-popup-seen-by-warden (4 trials)', out.filter((x) => x.btn === '#popup-delay').every((x) => !miss(x)), out);
    check(P, 'late-alert-popup-seen-by-warden (2 trials)', out.filter((x) => x.btn === '#popup-late').every((x) => !miss(x)), out);
    results[P] = out;
  },

  // D10: --dialog report persists across separate invocations.
  async d10_persist() {
    const P = 'd10_persist', d = dirFor(P), n = nonce('d10'), seq = [];
    const step = async (args) => { const r = await cli(args, d); const st = await readState(d); seq.push({ args: args.join(' '), code: r.code, stderr: r.stderr, policy: st?.dialogPolicy }); return { r, st }; };
    let x = await step(['nav', `${FXURL}?n=${n}`]);
    check(P, 'fresh-no-flag-no-key', x.st.dialogPolicy === undefined);
    x = await step(['snap', '--dialog', 'accept']); check(P, 'accept-set', x.st.dialogPolicy?.action === 'accept');
    x = await step(['snap', '--dialog', 'report']); check(P, 'report-set-explicitly', x.st.dialogPolicy?.action === 'report', x.st.dialogPolicy);
    x = await step(['snap']); check(P, 'report-persists-1', x.st.dialogPolicy?.action === 'report');
    x = await step(['eval', '1']); check(P, 'report-persists-2', x.st.dialogPolicy?.action === 'report');
    // behavior actually is report (not stale accept): a confirm stays pending
    x = await step(['click', '#confirm']); check(P, 'behaves-as-report', x.r.stdout.includes('dialogPending: {"type":"confirm"'), x.r.stdout);
    // and the WARDEN does not auto-accept it (policyFromState report => undefined)
    await delay(1500);
    x = await step(['snap']); check(P, 'still-pending-after-1.5s(warden not applying stale accept)', x.r.code === 3, x.r);
    await step(['dialog', 'dismiss']);
    x = await step(['nav', `${FXURL}?n=${n}-b`, '--dialog', 'report']); check(P, 'fresh-spawn-flag-report-persisted?', x.st.dialogPolicy?.action === 'report', x.st.dialogPolicy);
    results[P] = seq;
    await cli(['close'], d);
    // fresh spawn WITH --dialog report
    const d2 = dirFor(P + '2');
    await cli(['nav', `${FXURL}?n=${n}-c`, '--dialog', 'report'], d2);
    const st2 = await readState(d2);
    check(P, 'fresh-spawn-with-report-flag-persists', st2.dialogPolicy?.action === 'report', st2.dialogPolicy);
    await cli(['close'], d2);
  },

  // L15 exactly as the amendment defines it.
  async l15_selfheal() {
    const P = 'l15_selfheal', d = dirFor(P), n = nonce('l15'), log = [];
    log.push(await cli(['nav', `${FXURL}?n=${n}`, '--dialog', 'accept'], d));
    const st0 = await readState(d);
    const w0 = await readWarden(d);
    check(P, 'setup-accept-persisted', st0.dialogPolicy?.action === 'accept');
    taskkill(st0.chromePid, true);
    await delay(3000);
    const wardenGoneOnChromeDeath = !pidAlive(w0.pid);
    check(P, 'old-warden-exited-on-chrome-death', wardenGoneOnChromeDeath, { pid: w0.pid });
    const snap = await cli(['snap'], d, { capMs: 120000 }); log.push(snap);
    const st1 = await readState(d);
    check(P, 'snap-exit0', snap.code === 0, snap);
    check(P, 'stderr-note-line', /Note: previous session was unreachable/.test(snap.stderr), snap.stderr);
    check(P, 'new-chromePid', st1.chromePid && st1.chromePid !== st0.chromePid, { old: st0.chromePid, new: st1.chromePid });
    check(P, 'policy-carried-accept', st1.dialogPolicy?.action === 'accept', st1.dialogPolicy);
    const w1 = await readWarden(d);
    check(P, 'new-warden-for-new-endpoint', w1 && w1.wsEndpoint === st1.wsEndpoint && pidAlive(w1.pid), w1);
    check(P, 'exactly-one-warden-for-dir', wardenPids().filter((x) => x.stateFile.startsWith(d)).length === 1, wardenPids());
    // carried policy is effective (in-process AND warden-between-commands)
    const nav = await cli(['nav', `${FXURL}?n=${n}-2&timerKind=confirm&timerMs=1500`], d); log.push(nav);
    const { b, s } = await observe(st1.wsEndpoint, n + '-2');
    let rec; for (let i = 0; i < 30; i++) { await delay(200); try { rec = await record(s, n + '-2'); } catch {} if (rec?.some((e) => e.phase === 'returned')) break; }
    check(P, 'carried-accept-applied-by-warden-between-commands', rec?.find((e) => e.phase === 'returned')?.result === true, rec);
    await b.disconnect();
    log.push(await cli(['close'], d));
    results[P] = log;
  },

  // Warden lifecycle: exit on chrome disconnect / state removed / state repointed / close; two sessions.
  async wardenLifecycle() {
    const P = 'wardenLifecycle', out = {};
    // (a) chrome killed, no CLI command afterwards
    { const d = dirFor('lc-a'); await cli(['nav', `${FXURL}?n=${nonce('a')}`], d); const st = await readState(d); const w = await readWarden(d);
      taskkill(st.chromePid, true); let t = Date.now(); while (pidAlive(w.pid) && Date.now() - t < 10000) await delay(100);
      out.a = { exitedMs: Date.now() - t, alive: pidAlive(w.pid), wardenJsonLeft: !!(await readWarden(d)) };
      check(P, 'a-chrome-death-warden-exits', !out.a.alive, out.a);
      check(P, 'a-warden-json-removed-by-warden', !out.a.wardenJsonLeft, out.a);
      await fs.rm(path.join(d, 'state.json'), { force: true }); }
    // (b) state.json removed
    { const d = dirFor('lc-b'); await cli(['nav', `${FXURL}?n=${nonce('b')}`], d); const st = await readState(d); const w = await readWarden(d);
      await fs.rm(path.join(d, 'state.json')); let t = Date.now(); while (pidAlive(w.pid) && Date.now() - t < 10000) await delay(100);
      out.b = { exitedMs: Date.now() - t, alive: pidAlive(w.pid) };
      check(P, 'b-state-removed-warden-exits<=5s', !out.b.alive && out.b.exitedMs <= 5000, out.b);
      taskkill(st.chromePid, true); }
    // (b2) whole state dir removed
    { const d = dirFor('lc-b2'); await cli(['nav', `${FXURL}?n=${nonce('b2')}`], d); const st = await readState(d); const w = await readWarden(d);
      await fs.rm(d, { recursive: true, force: true }); let t = Date.now(); while (pidAlive(w.pid) && Date.now() - t < 10000) await delay(100);
      out.b2 = { exitedMs: Date.now() - t, alive: pidAlive(w.pid) };
      check(P, 'b2-state-dir-removed-warden-exits', !out.b2.alive, out.b2);
      taskkill(st.chromePid, true); }
    // (c) state.json repointed at another endpoint
    { const d = dirFor('lc-c'); await cli(['nav', `${FXURL}?n=${nonce('c')}`], d); const st = await readState(d); const w = await readWarden(d);
      await fs.writeFile(path.join(d, 'state.json'), JSON.stringify({ ...st, wsEndpoint: 'ws://127.0.0.1:1/devtools/browser/x' }));
      let t = Date.now(); while (pidAlive(w.pid) && Date.now() - t < 10000) await delay(100);
      out.c = { exitedMs: Date.now() - t, alive: pidAlive(w.pid) };
      check(P, 'c-state-repointed-warden-exits', !out.c.alive, out.c);
      taskkill(st.chromePid, true); await fs.rm(path.join(d, 'state.json'), { force: true }); }
    // (d) close
    { const d = dirFor('lc-d'); await cli(['nav', `${FXURL}?n=${nonce('d')}`], d); const w = await readWarden(d);
      const cl = await cli(['close'], d); await delay(300);
      out.d = { alive: pidAlive(w.pid), wardenJson: !!(await readWarden(d)), code: cl.code, ms: cl.ms };
      check(P, 'd-close-stops-warden-and-removes-file', !out.d.alive && !out.d.wardenJson && cl.code === 0, out.d); }
    // (d2) close while a dialog is open (report)
    { const d = dirFor('lc-d2'); const n = nonce('d2'); await cli(['nav', `${FXURL}?n=${n}`], d); await cli(['click', '#alert'], d); const w = await readWarden(d); const st = await readState(d);
      const cl = await cli(['close'], d, { capMs: 30000 }); await delay(500);
      out.d2 = { alive: pidAlive(w.pid), chromeAlive: pidAlive(st.chromePid), code: cl.code, ms: cl.ms, stderr: cl.stderr };
      check(P, 'd2-close-with-dialog-fast-and-clean', !out.d2.alive && !out.d2.chromeAlive && cl.code === 0 && cl.ms < 10000, out.d2); }
    // (e) two sessions (two state dirs) at once: one warden each, no cross-talk, tokens isolated
    { const dA = dirFor('lc-eA'), dB = dirFor('lc-eB'), nA = nonce('eA'), nB = nonce('eB');
      await Promise.all([cli(['nav', `${FXURL}?n=${nA}`], dA), cli(['nav', `${FXURL}?n=${nB}`], dB)]);
      const [wA, wB] = [await readWarden(dA), await readWarden(dB)];
      const [sA, sB] = [await readState(dA), await readState(dB)];
      const ws = wardenPids();
      check(P, 'e-one-warden-each', ws.filter((x) => x.stateFile.startsWith(dA)).length === 1 && ws.filter((x) => x.stateFile.startsWith(dB)).length === 1 && wA.pid !== wB.pid && wA.wsEndpoint === sA.wsEndpoint && wB.wsEndpoint === sB.wsEndpoint, ws);
      await cli(['click', '#confirm'], dA);
      const listB = await cli(['dialog'], dB);
      check(P, 'e-B-sees-no-dialog-from-A', listB.code === 0 && /No dialog is open/.test(listB.stdout), listB);
      const crossToken = await fetch(`http://127.0.0.1:${wA.port}/v1/dialogs`, { headers: { authorization: `Bearer ${wB.token}` } });
      check(P, 'e-B-token-rejected-by-A', crossToken.status === 401, crossToken.status);
      const accB = await cli(['dialog', 'accept'], dB);
      check(P, 'e-B-accept-does-not-touch-A', accB.code === 1, accB);
      const snapA = await cli(['snap'], dA);
      check(P, 'e-A-still-blocked', snapA.code === 3, snapA.code);
      await cli(['dialog', 'dismiss'], dA);
      await Promise.all([cli(['close'], dA), cli(['close'], dB)]); await delay(500);
      check(P, 'e-both-wardens-gone', !pidAlive(wA.pid) && !pidAlive(wB.pid)); }
    // (f) concurrent ensureWarden race: warden killed, then 3 commands at once in one dir
    { const d = dirFor('lc-f'); await cli(['nav', `${FXURL}?n=${nonce('f')}`], d); const w = await readWarden(d); taskkill(w.pid); await delay(300);
      await Promise.all([cli(['snap'], d), cli(['snap'], d), cli(['snap'], d)]);
      await delay(1000);
      const mine = wardenPids().filter((x) => x.stateFile.startsWith(d));
      out.f = { wardensAfterRace: mine.map((x) => x.pid), file: (await readWarden(d))?.pid };
      check(P, 'f-concurrent-respawn-yields-one-warden (informational)', mine.length === 1, out.f);
      await cli(['close'], d); await delay(2500);
      const left = wardenPids().filter((x) => x.stateFile.startsWith(d));
      out.f.afterClose = left.map((x) => x.pid);
      check(P, 'f-all-racing-wardens-gone-after-close(+poll)', left.length === 0, out.f); }
    results[P] = out;
  },

  // HTTP API security.
  async wardenSecurity() {
    const P = 'wardenSecurity', d = dirFor(P), n = nonce('sec'), out = {};
    await cli(['nav', `${FXURL}?n=${n}`], d);
    await cli(['click', '#confirm'], d);
    const w = await readWarden(d);
    const base = `http://127.0.0.1:${w.port}`;
    const st = async (p, init) => { try { const r = await fetch(base + p, init); return r.status; } catch (e) { return 'ERR ' + e.cause?.code; } };
    const body = JSON.stringify({ targetId: 'x', accept: true });
    out.noToken = await st('/v1/dialogs');
    out.wrongToken = await st('/v1/dialogs', { headers: { authorization: 'Bearer ' + '0'.repeat(64) } });
    out.tokenNoBearer = await st('/v1/dialogs', { headers: { authorization: w.token } });
    out.bearerLower = await st('/v1/dialogs', { headers: { authorization: 'bearer ' + w.token } });
    out.tokenPrefix = await st('/v1/dialogs', { headers: { authorization: 'Bearer ' + w.token.slice(0, 63) } });
    out.tokenInQuery = await st('/v1/dialogs?token=' + w.token);
    out.handleNoToken = await st('/v1/dialogs/handle', { method: 'POST', body });
    out.optionsPreflight = await (async () => { try { const r = await fetch(base + '/v1/dialogs/handle', { method: 'OPTIONS', headers: { origin: 'http://evil.example', 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization' } }); return { status: r.status, acao: r.headers.get('access-control-allow-origin') }; } catch (e) { return 'ERR'; } })();
    out.goodToken = await st('/v1/dialogs', { headers: { authorization: 'Bearer ' + w.token } });
    const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
    out.lanAttempts = {};
    for (const ip of ips) { try { await fetch(`http://${ip}:${w.port}/v1/health`, { signal: AbortSignal.timeout(1500) }); out.lanAttempts[ip] = 'CONNECTED'; } catch (e) { out.lanAttempts[ip] = 'refused/' + (e.cause?.code ?? e.name); } }
    try { out.listen = execSync(`powershell -NoProfile -Command "Get-NetTCPConnection -OwningProcess ${w.pid} -State Listen | Select LocalAddress,LocalPort | ConvertTo-Json"`, { encoding: 'utf-8' }); } catch (e) { out.listen = 'ERR ' + e.message; }
    const cmd = procs().find((p) => p.ProcessId === w.pid)?.CommandLine ?? '';
    out.tokenOnCommandLine = cmd.includes(w.token);
    check(P, 'no-token-401', out.noToken === 401);
    check(P, 'wrong-token-401', out.wrongToken === 401);
    check(P, 'no-bearer-prefix-401', out.tokenNoBearer === 401);
    check(P, 'prefix-token-401', out.tokenPrefix === 401);
    check(P, 'query-token-401', out.tokenInQuery === 401);
    check(P, 'handle-no-token-401', out.handleNoToken === 401);
    check(P, 'preflight-no-cors-allow', out.optionsPreflight?.acao == null, out.optionsPreflight);
    check(P, 'good-token-200', out.goodToken === 200);
    check(P, 'lan-ip-not-reachable', Object.values(out.lanAttempts).every((v) => v !== 'CONNECTED'), out.lanAttempts);
    check(P, 'listens-on-127.0.0.1-only', /127\.0\.0\.1/.test(out.listen) && !/0\.0\.0\.0|"::"/.test(out.listen), out.listen);
    check(P, 'token-not-on-command-line', !out.tokenOnCommandLine);
    const snap = await cli(['snap'], d);
    check(P, 'dialog-still-pending-after-unauth-attempts', snap.code === 3);
    await cli(['dialog', 'dismiss'], d);
    await cli(['close'], d);
    results[P] = out;
  },

  // R10: in-process BrowserTab policy and the warden both armed on the same dialogs.
  async r10_doubleHandling() {
    const P = 'r10_doubleHandling', d = dirFor(P), n = nonce('r10'), out = { inCommand: [], between: [], concurrent: [] };
    await cli(['nav', `${FXURL}?n=${n}`, '--dialog', 'accept'], d);
    // (1) in-command chain, 12 iterations: confirm, prompt(default), confirm
    for (let i = 0; i < 12; i++) {
      const r = await cli(['eval', `JSON.stringify([confirm('a${i}'), prompt('p${i}','dflt${i}'), confirm('b${i}')])`], d);
      out.inCommand.push({ code: r.code, stdout: r.stdout.trim().split('\n')[0] });
    }
    const expectIn = (i) => JSON.stringify([true, `dflt${i}`, true]);
    check(P, 'in-command-chains-exact(12)', out.inCommand.every((x, i) => x.code === 0 && x.stdout.includes(expectIn(i).replace(/"/g, '\\"')) || x.stdout.includes(expectIn(i))), out.inCommand);
    // (2) between commands: warden alone handles a timer chain
    for (let i = 0; i < 4; i++) {
      const m = `${n}-bt${i}`;
      await cli(['nav', `${AUDURL}?n=${m}&timerChain=1500`], d);
      const st = await readState(d);
      const b = await puppeteer.connect({ browserWSEndpoint: st.wsEndpoint, defaultViewport: null });
      const s = await sessionFor(b, m);
      let rec; for (let k = 0; k < 40; k++) { await delay(200); try { rec = await record(s, m); } catch {} if (rec?.length === 3) break; }
      out.between.push(rec);
      await b.disconnect();
    }
    check(P, 'between-commands-warden-chain-exact', out.between.every((r) => JSON.stringify(r?.map((e) => e.r)) === JSON.stringify([true, 'dflt', true])), out.between);
    // (3) concurrent: a CLI command is alive (in-process accept armed) while the timer chain fires
    for (let i = 0; i < 4; i++) {
      const m = `${n}-cc${i}`;
      await cli(['nav', `${AUDURL}?n=${m}&timerChain=800`], d);
      const w = await cli(['wait', '#never-exists', '3500'], d);
      const st = await readState(d);
      const b = await puppeteer.connect({ browserWSEndpoint: st.wsEndpoint, defaultViewport: null });
      const s = await sessionFor(b, m);
      let rec; for (let k = 0; k < 40; k++) { await delay(200); try { rec = await record(s, m); } catch {} if (rec?.length === 3) break; }
      out.concurrent.push({ rec, waitCode: w.code, waitOut: w.stdout.slice(0, 300), waitErr: w.stderr.slice(0, 300) });
      await b.disconnect();
    }
    check(P, 'concurrent-inprocess+warden-chain-exact', out.concurrent.every((x) => JSON.stringify(x.rec?.map((e) => e.r)) === JSON.stringify([true, 'dflt', true])), out.concurrent);
    await cli(['close'], d);
    results[P] = out;
  },

  // D-9 via the GATE: an orphaned prompt, then the next command sets --dialog accept (no text).
  async gatePromptDefault() {
    const P = 'gatePromptDefault', d = dirFor(P), n = nonce('gp'), log = [];
    log.push(await cli(['nav', `${FXURL}?n=${n}`], d));
    log.push(await cli(['click', '#prompt'], d));
    const snap = await cli(['snap', '--dialog', 'accept'], d); log.push(snap);
    const st = await readState(d);
    const b = await puppeteer.connect({ browserWSEndpoint: st.wsEndpoint, defaultViewport: null });
    const s = await sessionFor(b, n);
    const rec = await record(s, n);
    results[P] = { snap: { code: snap.code, stdout: snap.stdout.slice(0, 300), stderr: snap.stderr }, rec };
    check(P, 'gate-handled-exit0', snap.code === 0 && snap.stdout.includes('dialogHandled'), snap);
    check(P, 'gate-accept-no-text-uses-default(D-9)', rec?.find((e) => e.phase === 'returned')?.result === 'fr2-default', rec);
    check(P, 'dialogHandled-line-promptText', snap.stdout, snap.stdout.split('\n').find((l) => l.startsWith('dialogHandled')));
    await b.disconnect();
    // same through `dialog accept` (control)
    const n2 = n + '-2';
    await cli(['nav', `${FXURL}?n=${n2}`, '--dialog', 'report'], d);
    await cli(['click', '#prompt'], d);
    await cli(['dialog', 'accept'], d);
    const b2 = await puppeteer.connect({ browserWSEndpoint: st.wsEndpoint, defaultViewport: null });
    const rec2 = await record(await sessionFor(b2, n2), n2);
    check(P, 'control-dialog-accept-uses-default', rec2?.find((e) => e.phase === 'returned')?.result === 'fr2-default', rec2);
    await b2.disconnect();
    await cli(['close'], d);
  },
};

const want = process.argv.slice(2);
const before = { chrome: chromeInR().length, wardens: wardenPids().length };
try {
  for (const [name, fn] of Object.entries(probes)) {
    if (want.length && !want.includes(name)) continue;
    console.log(`--- ${name}`);
    try { await fn(); } catch (e) { check(name, 'unexpected-exception', false, String(e?.stack || e)); }
  }
} finally {
  server.close();
  for (const d of dirs) await cli(['close'], d, { capMs: 20000 }).catch(() => {});
  await delay(2500);
  let wl = wardenPids(), cl = chromeInR();
  const leftovers = { wardens: wl.map((w) => w.pid), chrome: cl };
  for (const w of wl) taskkill(w.pid);
  for (const c of cl) taskkill(c, true);
  check('cleanup', 'no-leftover-wardens-before-forced-kill', wl.length === 0, leftovers);
  check('cleanup', 'no-leftover-chrome-before-forced-kill', cl.length === 0, leftovers);
  check('observer', 'no-guard-violations', violations.length === 0, violations);
  for (let i = 0; i < 8; i++) { try { await fs.rm(R, { recursive: true, force: true }); break; } catch { await delay(500 * (i + 1)); } }
  const tag = want.length ? want.join('+') : 'all';
  await fs.writeFile(path.join(OUT, `results-${tag}.json`), JSON.stringify({ at: new Date().toISOString(), before, checks, results }, null, 2));
  const failed = checks.filter((c) => !c.pass);
  console.log(`\n${checks.length - failed.length}/${checks.length} pass; failed: ${failed.map((f) => f.probe + '.' + f.name).join(', ') || 'none'}`);
  process.exit(0);
}
