// FR2-01 audit-6: independent adversarial live probe (harness adapted from audit-5/probe-a5.mjs).
// Drives the REAL built MCP server (packages/mcp-server/dist/cli.js) over stdio, attached to a Chrome
// this script launches (--site-per-process), with an independent puppeteer-core observer used to
// establish ground truth and inject adversarial conditions. SDK cases use packages/sutradhar/dist.
//
// Hosts: main page on 127.0.0.1; iframes on localhost and 127.0.0.2 -> distinct sites -> separate
// OOPIF renderer processes, so a busy loop in one does not block the other or the main frame.
//
// Run: node .ai/loop/field-report-2/evidence/FR2-01/audit-6/probe-a6.mjs [caseIdPrefixes...]
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../../../..');
const require_ = createRequire(path.join(repoRoot, 'packages', 'browser', 'package.json'));
const puppeteer = require_('puppeteer-core');
const only = process.argv.slice(2);
const want = (id) => only.length === 0 || only.some((o) => id.startsWith(o));
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const BUSY = `<script>window.__busy=(ms)=>{const t=Date.now();while(Date.now()-t<ms){}};</script>`;
const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'text/html');
  const u = new URL(req.url, 'http://x');
  const port = server.address().port;
  const f1 = `<iframe id="f1" src="http://localhost:${port}/frame"></iframe>`;
  const f2 = `<iframe id="f2" src="http://127.0.0.2:${port}/frame2"></iframe>`;
  const fx = `<iframe id="fx" src="http://localhost:${port}/framex"></iframe>`;
  const fxh = `<iframe id="fxh" src="http://localhost:${port}/framexhidden"></iframe>`;
  switch (u.pathname) {
    case '/frame':
      return res.end(`<div id="inframe">in frame</div>${BUSY}`);
    case '/frame2':
      return res.end(`<div id="inframe2">in frame 2</div>${BUSY}`);
    // iframe holding a VISIBLE #x
    case '/framex':
      return res.end(`<div id="x">visible x inside iframe</div>${BUSY}`);
    // iframe holding a HIDDEN #x
    case '/framexhidden':
      return res.end(`<div id="x" style="display:none">hidden x inside iframe</div>${BUSY}`);
    // audit-5 A1 replica: #banner genuinely hidden in main frame; unrelated OOPIF made busy
    case '/a1':
      return res.end(`<div id="banner" style="display:none">banner</div>${f1}${BUSY}`);
    // V1: same, but TWO unrelated OOPIFs (different sites/processes) busy simultaneously
    case '/v1':
      return res.end(`<div id="banner" style="display:none">banner</div>${f1}${f2}${BUSY}`);
    // V2: #banner hidden in main frame, the MAIN frame itself is made busy
    case '/v2':
      return res.end(`<div id="banner" style="display:none">banner</div>${f1}${BUSY}`);
    // audit-5 A2 replica: #present exists, page's getComputedStyle throws for it
    case '/a2':
      return res.end(`<div id="present">I exist</div>
<script>const o=window.getComputedStyle;window.getComputedStyle=function(el){if(el&&el.id==='present')throw new Error('hostile page override');return o.apply(this,arguments);};</script>`);
    // V3a: delayed async-ish error: getComputedStyle for #present burns 120ms (inside the 250ms bound) THEN throws
    case '/v3a':
      return res.end(`<div id="present">I exist</div>${BUSY}
<script>const o=window.getComputedStyle;window.getComputedStyle=function(el){if(el&&el.id==='present'){window.__busy(120);throw new Error('late hostile');}return o.apply(this,arguments);};</script>`);
    // V3b: error only after 400ms (beyond the 250ms per-frame bound) -> timeout path
    case '/v3b':
      return res.end(`<div id="present">I exist</div>${BUSY}
<script>const o=window.getComputedStyle;window.getComputedStyle=function(el){if(el&&el.id==='present'){window.__busy(400);throw new Error('very late hostile');}return o.apply(this,arguments);};</script>`);
    // V3c: getComputedStyle starts throwing only 1500ms AFTER load (error begins mid-wait)
    case '/v3c':
      return res.end(`<div id="present">I exist</div>
<script>const o=window.getComputedStyle;let armed=false;setTimeout(()=>{armed=true},1500);window.getComputedStyle=function(el){if(armed&&el&&el.id==='present')throw new Error('armed hostile');return o.apply(this,arguments);};</script>`);
    // audit-5 A3 replica
    case '/a3':
    case '/a3control': {
      const hostile = u.pathname === '/a3'
        ? `<script>const o=window.getComputedStyle;window.getComputedStyle=function(el){if(el&&el.dataset&&el.dataset.hostile)throw new Error('hostile');return o.apply(this,arguments);};</script>`
        : '';
      return res.end(`<div class="dup" style="display:none">first</div><div class="dup" data-hostile="1">second, visible</div>${hostile}`);
    }
    // C2a: #x HIDDEN in main frame; a busy OOPIF holds a VISIBLE #x
    case '/c2a':
      return res.end(`<div id="x" style="display:none">hidden x in main</div>${fx}${BUSY}`);
    // C2b: #x VISIBLE in main frame (main made busy); an OOPIF holds a HIDDEN #x
    case '/c2b':
      return res.end(`<div id="x">visible x in main</div>${fxh}${BUSY}`);
    // C1: #banner genuinely HIDDEN in main; an unrelated iframe is detached/re-attached every 15ms
    case '/c1':
      return res.end(`<div id="banner" style="display:none">banner</div><div id="host"></div>
<script>let n=0;setInterval(()=>{const h=document.getElementById('host');h.innerHTML='';const f=document.createElement('iframe');f.src='http://localhost:${port}/frame?'+(n++);h.appendChild(f);},15);</script>`);
    // T: #stay VISIBLE, never hides; tab will be closed mid hidden-wait
    case '/t':
      return res.end(`<div id="stay">always visible</div>`);
    default:
      return res.end('<p>root</p>');
  }
});
await new Promise((r) => server.listen(0, '0.0.0.0', r));
const port = server.address().port;

function makeMcpClient(serverPath) {
  const child = spawn(process.execPath, [serverPath], { stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '';
  let nextId = 1;
  const pending = new Map();
  child.stdout.on('data', (c) => {
    buf += c.toString('utf8');
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let m;
      try { m = JSON.parse(line); } catch { continue; }
      if (m.id !== undefined && pending.has(m.id)) {
        const { resolve, reject } = pending.get(m.id);
        pending.delete(m.id);
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
      }
    }
  });
  child.stderr.on('data', () => {});
  const call = (method, params, t = 90000) => {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      setTimeout(() => pending.has(id) && (pending.delete(id), reject(new Error('rpc timeout ' + method))), t);
    });
  };
  return {
    child, call,
    notify: (method, params) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n'),
    callTool: (name, args) => call('tools/call', { name, arguments: args }),
  };
}
const text = (r) => r.content?.[0]?.text ?? '';
const parse = (r) => { try { return JSON.parse(text(r)); } catch { return { raw: text(r), isError: r.isError }; } };

const mod = await import(pathToFileURL(path.join(repoRoot, 'packages', 'browser', 'dist', 'index.js')));
const chromePath = process.env.CHROME_PATH ?? new mod.BrowserLauncher().findExecutablePath();
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fr2-01-a6-'));
const browser = await puppeteer.launch({ executablePath: chromePath, headless: true, userDataDir: profile, args: ['--no-sandbox', '--site-per-process'] });
const mcp = makeMcpClient(path.join(repoRoot, 'packages', 'mcp-server', 'dist', 'cli.js'));
await mcp.call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'a6', version: '1' } });
mcp.notify('notifications/initialized');
const att = parse(await mcp.callTool('browser.attach', { endpoint: browser.wsEndpoint() }));
const sessionId = att.sessionId;
const out = [];
const rec = (o) => { out.push(o); console.log('RESULT ' + JSON.stringify(o)); };

async function nav(p) {
  const url = `http://127.0.0.1:${port}${p}${p.includes('?') ? '&' : '?'}n=${Math.random()}`;
  await mcp.callTool('browser.navigate', { sessionId, url });
  await delay(500);
  const pages = await browser.pages();
  return pages.find((pg) => pg.url().startsWith(url.split('?')[0])) ?? pages[pages.length - 1];
}
const wfs = (args) => mcp.callTool('browser.wait_for_selector', { sessionId, maxRetries: 0, ...args });
const frameBy = (page, frag) => page.frames().find((f) => f.url().includes(frag));
const busyFor = (frame, ms) => frame.evaluate((ms) => { setTimeout(() => window.__busy(ms), 0); }, ms).catch(() => {});
const errOf = (res) => res.error ?? res.raw ?? '';
const HINT_STILL_VISIBLE = /Hint: The element is still visible/;
const HINT_EXISTS_HIDDEN = /Hint: The element exists but is hidden/;

try {
  // ---- R-A1 (audit-5 A1 replica) + V1 (two busy OOPIFs) + V2 (busy MAIN frame): hidden wait on a genuinely hidden element ----
  for (const [id, p, busyTargets, timeoutMs] of [
    ['RA1-hidden-wait', '/a1', ['/frame'], 1500],
    ['RA1-hidden-checkonce', '/a1', ['/frame'], 0],
    ['V1-two-busy-oopifs-hidden-wait', '/v1', ['/frame', '/frame2'], 1500],
    ['V1-two-busy-oopifs-hidden-checkonce', '/v1', ['/frame', '/frame2'], 0],
    ['V2-busy-main-hidden-wait', '/v2', ['MAIN'], 1500],
    ['V2-busy-main-hidden-checkonce', '/v2', ['MAIN'], 0],
  ]) {
    if (!want(id)) continue;
    const page = await nav(p);
    const frames = busyTargets.map((b) => (b === 'MAIN' ? page.mainFrame() : frameBy(page, b)));
    const truth = await page.evaluate(() => { const e = document.querySelector('#banner'); return getComputedStyle(e).display; });
    for (const f of frames) await busyFor(f, 12000);
    await delay(80);
    const t0 = Date.now();
    const r = await wfs({ target: '#banner', state: 'hidden', timeoutMs });
    const res = parse(r);
    const err = errOf(res);
    rec({ id, truth: `#banner display=${truth} in main frame (genuinely hidden); busy: ${busyTargets.join(',')}`, framesFound: frames.map((f) => !!f),
      success: res.success, totalMs: Date.now() - t0, error: err,
      engineSaysCouldNotVerify: /could not verify/.test(err), falseHintStillVisible: HINT_STILL_VISIBLE.test(err) });
    await delay(12500);
  }

  // ---- R-A2 (audit-5 A2 replica) + V3 (delayed / late-arming errors): visible wait on a PRESENT element whose visibility probe errors ----
  for (const [id, p, timeoutMs] of [
    ['RA2-visible-wait', '/a2', 1000], ['RA2-visible-checkonce', '/a2', 0],
    ['V3a-delayed-throw-120ms-wait', '/v3a', 1000], ['V3a-delayed-throw-120ms-checkonce', '/v3a', 0],
    ['V3b-delayed-throw-400ms-wait', '/v3b', 1000], ['V3b-delayed-throw-400ms-checkonce', '/v3b', 0],
  ]) {
    if (!want(id)) continue;
    const page = await nav(p);
    const exists = await page.evaluate(() => !!document.querySelector('#present'));
    const res = parse(await wfs({ target: '#present', state: 'visible', timeoutMs }));
    const err = errOf(res);
    rec({ id, truth: '#present EXISTS in main frame; page getComputedStyle throws for it (possibly after a delay)', observerSaysExists: exists,
      success: res.success, error: err, falseNoElementFound: /No element found/.test(err), falseNoneVisible: /none is visible/.test(err) });
  }
  // V3c: error arms 1500ms after load -> a hidden wait for #present (VISIBLE) must not falsely succeed
  if (want('V3c')) {
    const page = await nav('/v3c');
    void page;
    const res = parse(await wfs({ target: '#present', state: 'hidden', timeoutMs: 3000 }));
    rec({ id: 'V3c-late-arming-error-hidden-wait', truth: '#present VISIBLE throughout; getComputedStyle starts throwing ~1s into the wait',
      success: res.success, error: errOf(res), output: res.output, falseHiddenSuccess: res.success === true, falseHintStillVisible: HINT_STILL_VISIBLE.test(errOf(res)) });
  }

  // ---- R-A3 (audit-5 A3 replica) ----
  for (const [id, p] of [['RA3-hostile', '/a3'], ['RA3-control', '/a3control']]) {
    if (!want(id)) continue;
    await nav(p);
    const res = parse(await wfs({ target: '.dup', state: 'hidden', timeoutMs: 1000 }));
    rec({ id, truth: 'first .dup display:none, SECOND .dup genuinely visible', success: res.success, output: res.output,
      silentlyReportsNoOtherVisible: res.success === true && res.output?.otherVisibleMatches === undefined && res.output?.otherVisibleMatchesUnknown === undefined });
  }

  // ---- C2: visible-wait TIMEOUT diagnosis when a frame that never answers holds a VISIBLE match ----
  for (const [id, p, busyWhich, timeoutMs] of [
    ['C2a-busy-oopif-has-visible-x-wait', '/c2a', '/framex', 1000],
    ['C2a-busy-oopif-has-visible-x-checkonce', '/c2a', '/framex', 0],
    ['C2b-busy-main-has-visible-x-wait', '/c2b', 'MAIN', 1000],
    ['C2b-busy-main-has-visible-x-checkonce', '/c2b', 'MAIN', 0],
  ]) {
    if (!want(id)) continue;
    const page = await nav(p);
    const busyFrame = busyWhich === 'MAIN' ? page.mainFrame() : frameBy(page, busyWhich);
    // ground truth BEFORE making it busy: which frames hold a visible #x
    const truth = [];
    for (const f of page.frames()) {
      truth.push(await f.evaluate(() => { const e = document.querySelector('#x'); if (!e) return null; const r = e.getBoundingClientRect(); return { url: location.pathname, visible: getComputedStyle(e).visibility !== 'hidden' && r.width > 0 && r.height > 0 }; }).catch((e) => 'obs-err ' + e.message));
    }
    await busyFor(busyFrame, 12000);
    await delay(80);
    const res = parse(await wfs({ target: '#x', state: 'visible', timeoutMs }));
    const err = errOf(res);
    rec({ id, truth: { perFrame: truth, busy: busyWhich, note: 'a VISIBLE #x exists in the busy frame the whole time' },
      success: res.success, error: err,
      falseNoneVisible: /none is visible/.test(err), falseHintExistsButHidden: HINT_EXISTS_HIDDEN.test(err),
      honestUncertainty: /could not be determined|could not verify|did not respond/.test(err) });
    await delay(12500);
  }

  // ---- C1: hidden wait on a genuinely HIDDEN element while an unrelated iframe churns (GAP-114 path) ----
  if (want('C1')) {
    await nav('/c1');
    let trials = 0, success = 0, hardFail = 0, falseStillVisibleHint = 0, engineSaysStillVisible = 0;
    const msgs = {};
    const examples = [];
    for (let i = 0; i < 30; i++) {
      const res = parse(await wfs({ target: '#banner', state: 'hidden', timeoutMs: i % 2 ? 0 : 300 }));
      trials++;
      const err = errOf(res);
      if (res.success) success++;
      else {
        if (/failed waiting for state=hidden/.test(err)) hardFail++;
        if (/is still visible\./.test(err.split('\n')[0])) engineSaysStillVisible++;
        if (HINT_STILL_VISIBLE.test(err)) { falseStillVisibleHint++; if (examples.length < 3) examples.push(err); }
      }
      const k = err.replace(/after \d+ms/, 'after Nms').slice(0, 220);
      msgs[k] = (msgs[k] ?? 0) + 1;
    }
    rec({ id: 'C1-hidden-target-iframe-churn', truth: '#banner display:none in main frame the WHOLE time; churn iframes never contain #banner',
      trials, success, hardFail, engineSaysStillVisible, falseStillVisibleHint, examples, msgs });
  }

  // ---- T: tab closed mid hidden-wait on a VISIBLE element -> any false 'hidden' success? ----
  // Detailed per-trial log: tabId actually used, the close delay, the observer-confirmed state of
  // #stay in THAT tab immediately before close, and the full MCP result for any success.
  if (want('T')) {
    const N = Number(process.env.A6_T_TRIALS ?? 30);
    let trials = 0, falseSuccess = 0;
    const msgs = {};
    const successes = [];
    for (let i = 0; i < N; i++) {
      const nt = parse(await mcp.callTool('browser.new_tab', { sessionId, url: `http://127.0.0.1:${port}/t?i=${i}` }));
      await delay(300);
      const pages = await browser.pages();
      const pg = pages.find((x) => x.url().includes(`/t?i=${i}`));
      const tabId = nt.tabId ?? nt.id;
      const before = pg ? await pg.evaluate(() => { const e = document.querySelector('#stay'); const r = e.getBoundingClientRect(); return !!e && r.width > 0 && r.height > 0; }).catch((e) => 'obs-err ' + e.message) : 'no-observer-page';
      const closeDelay = 20 + ((i * 37) % 400);
      const p = mcp.callTool('browser.wait_for_selector', { sessionId, tabId, target: '#stay', state: 'hidden', timeoutMs: 2000, maxRetries: 0 });
      await delay(closeDelay);
      await pg?.close().catch(() => {});
      const res = parse(await p);
      trials++;
      if (res.success) { falseSuccess++; successes.push({ i, tabId, tabUrl: nt.url, closeDelay, visibleBeforeClose: before, result: res }); }
      const k = errOf(res).replace(/after \d+ms/, 'after Nms').replace(/'[0-9A-F]{16,}'/, "'ID'").slice(0, 220);
      msgs[k] = (msgs[k] ?? 0) + 1;
    }
    rec({ id: 'T-tab-close-mid-hidden-wait', truth: '#stay VISIBLE until the tab is closed; a hidden success is FALSE', trials, falseSuccess, successes, msgs });
  }
} finally {
  fs.writeFileSync(path.join(here, `probe-a6-results${only.length ? '-' + only.join('_') : ''}.json`), JSON.stringify(out, null, 2));
  try { mcp.child.kill(); } catch {}
  await browser.close().catch(() => {});
  server.close();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
}
process.exit(0);
