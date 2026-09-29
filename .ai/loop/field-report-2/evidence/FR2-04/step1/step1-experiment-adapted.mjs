#!/usr/bin/env node
// FR2-04 Step 1 — what does a re-attaching process see when an earlier CLI process left a native
// dialog open? Runs against the CURRENT (pre-FR2-04) worktree build. Writes only into this evidence
// dir and an OS-temp scratch dir it creates and removes. The "observer" session (S.s) NEVER sends
// any Page.* method, so it never holds a dialog callback and cannot contaminate the result; Page.*
// is sent only on the dedicated B/C/F/H/I sessions, at the step that is testing exactly that.
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../../../..');
const CLI = path.join(ROOT, 'packages/cli/dist/cli.js');
const puppeteer = createRequire(path.join(ROOT, 'packages/browser/package.json'))('puppeteer-core');
const HEADED = process.argv.includes('--headed');
const SKIP_SLOW = process.argv.includes('--skip-slow');
const OUT = path.join(HERE, HEADED ? 'step1-results.headed.json' : 'step1-results.json');
const results = [];
const note = (id, desc, observed, expected) => {
  results.push({ id, desc, expected, observed, at: new Date().toISOString() });
  console.log(`[${id}] ${desc}\n   -> ${JSON.stringify(observed).slice(0, 600)}`);
};
const nonce = (tag) => `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const FIXTURE = `<!doctype html><html><head><meta charset="utf-8"><title>fr2-04 step1</title></head><body>
<button id="alert">alert</button> <button id="confirm">confirm</button> <button id="prompt">prompt</button>
<button id="arm-bu">arm beforeunload</button><pre id="log"></pre>
<script>
const q = new URLSearchParams(location.search); const N = q.get('n') || 'none'; const KEY = 'fr2-04:' + N;
function rec(e) { const a = JSON.parse(localStorage.getItem(KEY) || '[]'); e.seq = a.length + 1; e.t = Date.now();
  a.push(e); localStorage.setItem(KEY, JSON.stringify(a)); document.getElementById('log').textContent = JSON.stringify(a); }
if (q.get('landed')) rec({ kind: 'landed' });
document.getElementById('alert').onclick = () => { rec({kind:'alert',phase:'opening'}); const r = alert('s1 alert ' + N);
  rec({kind:'alert',phase:'returned',result: r === undefined ? '__undefined__' : String(r)}); };
document.getElementById('confirm').onclick = () => { rec({kind:'confirm',phase:'opening'}); const r = confirm('s1 confirm ' + N);
  rec({kind:'confirm',phase:'returned',result:r}); };
document.getElementById('prompt').onclick = () => { rec({kind:'prompt',phase:'opening'}); const r = prompt('s1 prompt ' + N, 's1-default');
  rec({kind:'prompt',phase:'returned',result:r}); };
document.getElementById('arm-bu').onclick = () => { addEventListener('beforeunload', (e) => { rec({kind:'beforeunload',phase:'fired'});
  e.preventDefault(); e.returnValue = 's1 unsaved'; }); rec({kind:'beforeunload',phase:'armed'}); };
const tk = q.get('timerKind'); const tm = Number(q.get('timerMs') || 0);
if (tk && tm) setTimeout(() => { rec({kind: tk, phase: 'opening', timer: true});
  const r = tk === 'alert' ? alert('s1 timer ' + N) : confirm('s1 timer ' + N);
  rec({kind: tk, phase: 'returned', timer: true, result: r === undefined ? '__undefined__' : r}); }, tm);
</script></body></html>`;

const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }); res.end(FIXTURE); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/fx.html`;
const STATE_DIR = await fs.mkdtemp(path.join(os.tmpdir(), 'fr2-04-step1-'));
const tmpBefore = new Set((await fs.readdir(os.tmpdir())).filter((n) => n.startsWith('sutradhar-cli-')));

async function timed(p, ms) {
  const t0 = Date.now(); let timer;
  try {
    const v = await Promise.race([p, new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`__timeout_${ms}`)), ms); })]);
    return { status: 'resolved', ms: Date.now() - t0, value: v };
  } catch (e) {
    return { status: /__timeout_|timed out/.test(String(e?.message)) ? 'timeout' : 'rejected', ms: Date.now() - t0, error: String(e?.message).slice(0, 300) };
  } finally { clearTimeout(timer); }
}
const tsend = (s, m, p, ms) => timed(s.send(m, p, { timeout: ms }), ms + 500);
async function liveness(s, ms = 2000) {
  const r = await tsend(s, 'Runtime.evaluate', { expression: '1', returnByValue: true }, ms);
  return r.status === 'resolved' ? 'responsive' : r.status === 'timeout' ? 'blocked' : `error:${r.error}`;
}
async function pollLive(s, ms) { const end = Date.now() + ms; let l; do { l = await liveness(s, 1000); if (l === 'responsive') return l; } while (Date.now() < end); return l; }
async function pollBlocked(s, ms) { const end = Date.now() + ms; let l; do { l = await liveness(s, 800); if (l === 'blocked') return l; await delay(200); } while (Date.now() < end); return l; }
async function record(s, n) {
  const r = await tsend(s, 'Runtime.evaluate', { expression: `localStorage.getItem(${JSON.stringify('fr2-04:' + n)})`, returnByValue: true }, 3000);
  return r.status === 'resolved' ? JSON.parse(r.value.result.value ?? 'null') : r;
}
function cli(args, { capMs = 120000 } = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn(process.execPath, [CLI, ...args], { env: { ...process.env, SUTRADHAR_CLI_STATE_DIR: STATE_DIR }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = '', err = '', killed = false;
    child.stdout.on('data', (d) => (out += d)); child.stderr.on('data', (d) => (err += d));
    const cap = setTimeout(() => { killed = true; child.kill('SIGKILL'); }, capMs);
    child.on('exit', (code) => { clearTimeout(cap); resolve({ args, code, ms: Date.now() - t0, killedAtCap: killed, stdout: out.slice(0, 1500), stderr: err.slice(0, 1500) }); });
  });
}
const readState = async () => JSON.parse(await fs.readFile(path.join(STATE_DIR, 'state.json'), 'utf-8'));
const connect = (ws) => puppeteer.connect({ browserWSEndpoint: ws, defaultViewport: null, protocolTimeout: 20000 });
const pageUrls = (b) => b.targets().filter((t) => t.type() === 'page').map((t) => t.url());
async function waitForTarget(b, n, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const t = b.targets().find((x) => x.type() === 'page' && x.url().includes(n)); if (t) return t; await delay(100); }
  throw new Error(`no page target with ${n}`);
}
async function enableAndListen(session, listenMs) {
  const events = [];
  session.on('Page.javascriptDialogOpening', (e) => events.push({ ev: 'opening', type: e.type, message: e.message, defaultPrompt: e.defaultPrompt, t: Date.now() }));
  session.on('Page.javascriptDialogClosed', (e) => events.push({ ev: 'closed', result: e.result, t: Date.now() }));
  const enable = tsend(session, 'Page.enable', undefined, 3000);
  await delay(listenMs); // a bounded MEASUREMENT window for an event that may never come (absence is the observation)
  return { events, enable: await enable };
}
async function freshSession(tag, query = '') {
  await cli(['close'], { capMs: 30000 });
  const n = nonce(tag);
  const nav = await cli(['nav', `${BASE}?n=${n}${query}`, ...(HEADED ? ['--headed'] : [])], { capMs: 60000 });
  const st = await readState();
  const obs = await connect(st.wsEndpoint);
  const target = await waitForTarget(obs, n);
  const s = await target.createCDPSession(); // OBSERVER: Runtime.evaluate / Target.getTargetInfo only
  return { n, nav, st, obs, target, s, port: new URL(st.wsEndpoint.replace(/^ws/, 'http')).port };
}
async function recover(S) { // cleanup only: a browser-initiated reload is the one lever that exists under H1
  if ((await liveness(S.s, 800)) === 'responsive') return 'not-needed';
  const R = await connect(S.st.wsEndpoint); const t = await waitForTarget(R, S.n); const sr = await t.createCDPSession();
  const r = await tsend(sr, 'Page.reload', {}, 10000); await R.disconnect(); return { reload: r, live: await pollLive(S.s, 10000) };
}
const fetchT = (url, ms) => timed(fetch(url, { signal: AbortSignal.timeout(ms) }).then(async (r) => ({ status: r.status, body: (await r.text()).slice(0, 300) })), ms + 200);

try {
  note('E0.env', 'environment', { node: process.version, platform: process.platform, headed: HEADED, cli: CLI });

  // E1 + E2: orphan an alert, then probe it from fresh connections.
  {
    const S = await freshSession('e1');
    note('E0.browser', '/json/version', await fetchT(`http://127.0.0.1:${S.port}/json/version`, 3000));
    const click = await cli(['click', '#alert'], { capMs: 90000 });
    note('E1.click', 'process A: CLI click #alert', click, 'code 0, "Clicked #alert", 4-8 s');
    note('E1.jsonVersion', '/json/version while the dialog is open', await fetchT(`http://127.0.0.1:${S.port}/json/version`, 3000), 'HTTP 200 quickly (browser process)');
    note('E1.jsonList', '/json/list while the dialog is open', await fetchT(`http://127.0.0.1:${S.port}/json/list`, 3000), 'HTTP 200, lists the page');
    note('E1.live0', 'observer Runtime.evaluate(1)', await liveness(S.s, 2000), 'blocked');
    const samples = []; const until = Date.now() + 35000;
    while (Date.now() < until) { samples.push(await liveness(S.s, 2000)); await delay(500); }
    note('E1.window35s', 'liveness over 35 s after A exited', { anyResponsive: samples.includes('responsive'), samples: samples.length }, 'never responsive');

    const B = await connect(S.st.wsEndpoint); const tB = await waitForTarget(B, S.n); const sB = await tB.createCDPSession();
    const en = await enableAndListen(sB, 1500);
    note('E2.pageEnable', 'fresh session Page.enable: dialogOpening re-emitted?', { opening: en.events.filter((e) => e.ev === 'opening'), enable: en.enable }, 'no event; enable times out');
    note('E2.getFrameTree', 'Page.getFrameTree', await tsend(sB, 'Page.getFrameTree', undefined, 3000), 'timeout');
    note('E2.runtimeEnable', 'Runtime.enable', await tsend(sB, 'Runtime.enable', undefined, 3000), 'timeout');
    note('E2.navHistory', 'Page.getNavigationHistory', await tsend(sB, 'Page.getNavigationHistory', undefined, 3000), 'resolved');
    note('E2.targetInfo', 'Target.getTargetInfo', await tsend(sB, 'Target.getTargetInfo', undefined, 3000), 'resolved');
    const shot = await tsend(sB, 'Page.captureScreenshot', { format: 'png' }, 8000);
    note('E2.screenshot', 'Page.captureScreenshot', { status: shot.status, ms: shot.ms, bytes: shot.value?.data?.length, error: shot.error }, 'unknown: recorded');
    const C = await connect(S.st.wsEndpoint);
    note('E2.pagesInit', 'browser.pages() while the dialog is open', await timed(C.pages().then((p) => p.length), 15000), 'timeout (FrameManager.initialize)');
    await C.disconnect();
    const h = await tsend(sB, 'Page.handleJavaScriptDialog', { accept: true }, 3000);
    note('E2.handle', 'fresh session handleJavaScriptDialog(accept)', h, 'rejected "No dialog is showing"');
    const after = await liveness(S.s, 2000);
    note('E2.afterHandle', 'liveness after the fresh handle', after, 'blocked');
    if (after === 'responsive') note('E2.record', 'page record', await record(S.s, S.n), 'alert opening + returned');
    else {
      const sB2 = await tB.createCDPSession(); const en2 = await enableAndListen(sB2, 1500);
      note('E2.handle2', 'second fresh session enable+handle', { events: en2.events, h: await tsend(sB2, 'Page.handleJavaScriptDialog', { accept: true }, 3000), live: await liveness(S.s, 2000) });
      note('E2.reloadRecovery', 'browser-initiated Page.reload as recovery', { ...(await recover(S)), record: await record(S.s, S.n) });
    }
    await B.disconnect(); await S.obs.disconnect();
  }

  // E3: the REAL next CLI command against an orphaned confirm (slow: up to ~7 min).
  if (!SKIP_SLOW) {
    const S = await freshSession('e3');
    await cli(['click', '#confirm'], { capMs: 90000 });
    const before = { pid: S.st.chromePid, pages: pageUrls(S.obs), live: await liveness(S.s, 2000) };
    const snap = await cli(['snap'], { capMs: 420000 });
    let st1 = null; try { st1 = await readState(); } catch {}
    note('E3.snap', 'real CLI snap after an orphaned confirm', { snap, before, pidAfter: st1?.chromePid, selfHealed: before.pid !== st1?.chromePid, pagesAfter: S.obs.connected ? pageUrls(S.obs) : 'observer disconnected (chrome killed?)' },
      '~180 s hang (protocolTimeout), then a new blank tab OR self-heal kill');
    if (S.obs.connected) { note('E3.recover', 'cleanup', await recover(S)); await S.obs.disconnect(); }
  }

  // E4: a holder that was Page-enabled BEFORE the dialog opened (warden viability).
  {
    const S = await freshSession('e4');
    const H = await connect(S.st.wsEndpoint); const tH = await waitForTarget(H, S.n); const sH = await tH.createCDPSession();
    const evs = []; sH.on('Page.javascriptDialogOpening', (e) => evs.push({ type: e.type, message: e.message, defaultPrompt: e.defaultPrompt }));
    note('E4.enableBefore', 'holder Page.enable on a free page', await tsend(sH, 'Page.enable', undefined, 5000), 'resolved');
    note('E4.clickA', 'process A: click #confirm', await cli(['click', '#confirm'], { capMs: 90000 }));
    note('E4.event', 'holder saw dialogOpening', evs.slice(), '1 confirm');
    note('E4.blockedAfterA', 'observer liveness after A exited', await liveness(S.s, 2000), 'blocked');
    const h = await tsend(sH, 'Page.handleJavaScriptDialog', { accept: true }, 5000);
    const live = await pollLive(S.s, 5000);
    note('E4.handle', 'pre-enabled holder handles after A exited', { h, live }, 'resolved + responsive');
    note('E4.record', 'page record', live === 'responsive' ? await record(S.s, S.n) : null, 'confirm returned true');
    evs.length = 0;
    note('E4b.clickA', 'process A: click #prompt', await cli(['click', '#prompt'], { capMs: 90000 }));
    note('E4b.event', 'holder saw the prompt', evs.slice());
    await H.disconnect(); // every pre-enabled holder is now gone
    const F = await connect(S.st.wsEndpoint); const tF = await waitForTarget(F, S.n); const sF = await tF.createCDPSession();
    const enF = await enableAndListen(sF, 1500);
    note('E4b.handleAfterHoldersGone', 'fresh session after all holders detached', { events: enF.events, h: await tsend(sF, 'Page.handleJavaScriptDialog', { accept: true, promptText: 'x' }, 3000), live: await liveness(S.s, 2000) }, 'rejected, blocked');
    note('E4b.recover', 'cleanup', await recover(S)); await F.disconnect(); await S.obs.disconnect();
  }

  // E5: in-process eval baseline.
  { const S = await freshSession('e5'); note('E5.evalConfirm', 'CLI eval confirm()', await cli(['eval', "confirm('s1 eval')"], { capMs: 90000 }), '~30 s, prints false'); await S.obs.disconnect(); }

  // E6: beforeunload via CLI nav (activation via a real CLI click), without activation, and between commands.
  {
    const S = await freshSession('e6');
    note('E6.arm', 'click #arm-bu', await cli(['click', '#arm-bu']));
    const r = await cli(['nav', `${BASE}?n=${S.n}&landed=1`], { capMs: 90000 });
    note('E6.nav', 'nav away from a beforeunload page', { ...r, pages: pageUrls(S.obs) }, 'code 0, ~3 s extra, landed=1');
    note('E6.record', 'page record', await record(S.s, S.n), 'armed, fired, landed');
    await S.obs.disconnect();
  }
  {
    const S = await freshSession('e6b');
    await tsend(S.s, 'Runtime.evaluate', { expression: "document.getElementById('arm-bu').click()" }, 3000);
    note('E6b.noActivation', 'nav after arming WITHOUT a user gesture', await cli(['nav', `${BASE}?n=${S.n}&landed=1`], { capMs: 90000 }), 'fast; no dialog');
    note('E6b.record', 'page record', await record(S.s, S.n)); await S.obs.disconnect();
  }
  {
    const S = await freshSession('e6c');
    await cli(['click', '#arm-bu']);
    await tsend(S.s, 'Runtime.evaluate', { expression: `setTimeout(() => { location.href = ${JSON.stringify(`${BASE}?n=${S.n}&landed=1`)} }, 1500)` }, 3000);
    note('E6c.blocked', 'renderer-initiated nav with beforeunload, no CLI attached', await pollBlocked(S.s, 10000), 'blocked');
    const F = await connect(S.st.wsEndpoint); const tF = await waitForTarget(F, S.n); const sF = await tF.createCDPSession();
    const en = await enableAndListen(sF, 1500);
    note('E6c.fresh', 'fresh enable+handle(accept)', { events: en.events, h: await tsend(sF, 'Page.handleJavaScriptDialog', { accept: true }, 3000), live: await pollLive(S.s, 3000) });
    note('E6c.recover', 'cleanup', await recover(S)); await F.disconnect(); await S.obs.disconnect();
  }

  // E7: a timer dialog that opens while NO process is attached; E7b: a holder enabled before it fires.
  {
    const S = await freshSession('e7', '&timerKind=confirm&timerMs=6000');
    note('E7.blocked', 'timer confirm opened with nobody attached', await pollBlocked(S.s, 15000), 'blocked');
    const F = await connect(S.st.wsEndpoint); const tF = await waitForTarget(F, S.n); const sF = await tF.createCDPSession();
    const en = await enableAndListen(sF, 1500);
    note('E7.fresh', 'fresh enable+handle', { events: en.events, h: await tsend(sF, 'Page.handleJavaScriptDialog', { accept: true }, 3000), live: await liveness(S.s, 2000) }, 'same as E2');
    note('E7.recover', 'cleanup', await recover(S)); await F.disconnect(); await S.obs.disconnect();
  }
  {
    const S = await freshSession('e7b', '&timerKind=confirm&timerMs=6000');
    const H = await connect(S.st.wsEndpoint); const tH = await waitForTarget(H, S.n); const sH = await tH.createCDPSession();
    const got = new Promise((res) => sH.on('Page.javascriptDialogOpening', res));
    await tsend(sH, 'Page.enable', undefined, 5000);
    const ev = await timed(got, 15000);
    note('E7b.holder', 'pre-enabled holder receives and handles a timer confirm', { ev, h: await tsend(sH, 'Page.handleJavaScriptDialog', { accept: true }, 3000), live: await pollLive(S.s, 3000), record: await record(S.s, S.n) }, 'event, resolved, true');
    await H.disconnect(); await S.obs.disconnect();
  }

  // E8: is another tab responsive while tab 1 is blocked?
  {
    const S = await freshSession('e8'); const n2 = nonce('e8b');
    await cli(['newtab', `${BASE}?n=${n2}`]);
    const t2 = await waitForTarget(S.obs, n2); const s2 = await t2.createCDPSession();
    await tsend(S.s, 'Runtime.evaluate', { expression: "setTimeout(() => document.getElementById('confirm').click(), 0)" }, 3000);
    note('E8.tab1', 'tab 1 after a synthetic confirm', await pollBlocked(S.s, 5000), 'blocked');
    note('E8.tab2', 'tab 2 liveness', await liveness(s2, 2000), 'recorded');
    note('E8.recover', 'cleanup', await recover(S)); await S.obs.disconnect();
  }

  // E9: is Page.addScriptToEvaluateOnNewDocument session-scoped (decision 1c)?
  {
    const S = await freshSession('e9'); const I = await connect(S.st.wsEndpoint); const tI = await waitForTarget(I, S.n); const sI = await tI.createCDPSession();
    note('E9.add', 'addScriptToEvaluateOnNewDocument', await tsend(sI, 'Page.addScriptToEvaluateOnNewDocument', { source: 'window.__s1inj = 1' }, 5000));
    await I.disconnect();
    await cli(['nav', `${BASE}?n=${S.n}&after=1`]);
    note('E9.afterDetach', 'injected global after its session detached + new document', await tsend(S.s, 'Runtime.evaluate', { expression: 'String(window.__s1inj)', returnByValue: true }, 3000), '"undefined"');
    await S.obs.disconnect();
  }
} finally {
  await cli(['close'], { capMs: 30000 });
  server.close();
  const O = (id) => results.find((r) => r.id === id)?.observed;
  const O5 = O('E1.jsonVersion')?.status === 'resolved' && O('E1.jsonVersion')?.value?.status === 200;
  const O3 = O('E1.live0');
  const O1 = (O('E2.pageEnable')?.opening?.length ?? 0) > 0;
  const O2 = O('E2.handle')?.status === 'resolved' && O('E2.afterHandle') === 'responsive';
  const O8 = O('E4.handle')?.h?.status === 'resolved' && O('E4.handle')?.live === 'responsive';
  let branch;
  if (!O5) branch = 'STOP';
  else if (O3 === 'responsive') branch = O8 ? 'W' : 'X';   // the liveness probe can't detect a dialog, so detection must be event/holder based
  else if (O1 && O2) branch = 'D';
  else if (!O1 && O2) branch = 'D-hint';
  else if (O8) branch = 'W';
  else branch = 'X';
  await fs.writeFile(OUT, JSON.stringify({ decision: { branch, O1, O2, O3, O5, O8 }, results }, null, 2));
  console.log(`\nDECISION: branch ${branch}  (O1=${O1} O2=${O2} O3=${O3} O5=${O5} O8=${O8}) -> ${OUT}`);
  for (const name of await fs.readdir(os.tmpdir())) {
    if (!name.startsWith('sutradhar-cli-') || tmpBefore.has(name)) continue;
    for (let i = 0; i < 8; i++) { try { await fs.rm(path.join(os.tmpdir(), name), { recursive: true, force: true }); break; } catch { await delay(300 * (i + 1)); } }
  }
  await fs.rm(STATE_DIR, { recursive: true, force: true });
}
