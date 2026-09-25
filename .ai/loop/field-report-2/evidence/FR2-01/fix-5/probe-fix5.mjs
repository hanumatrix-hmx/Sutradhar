// FR2-01 audit-5: independent adversarial live probe. NOT a reuse of the Executor's fixtures.
// Drives the REAL built MCP server (packages/mcp-server/dist/cli.js) over stdio -- the user-facing
// surface -- attached to a Chrome this script launches itself, with an independent puppeteer-core
// observer connection used to (1) establish ground truth and (2) inject adversarial conditions
// (busy OOPIF, hostile page overrides, frame churn, tab close).
//
// Main page served on 127.0.0.1, iframe on localhost -> different site -> separate (OOPIF) renderer.
//
// Run: node .ai/loop/field-report-2/evidence/FR2-01/audit-5/probe-a5.mjs [caseIds...]
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
  const frame = `<iframe id="f" src="http://localhost:${port}/frame"></iframe>`;
  switch (u.pathname) {
    case '/frame':
      return res.end(`<div id="inframe">in frame</div>${BUSY}`);
    // A1: target genuinely hidden in main frame; unrelated OOPIF will be made permanently busy.
    case '/a1':
      return res.end(`<div id="banner" style="display:none">banner</div>${frame}${BUSY}`);
    // A2: target PRESENT in main frame, but the page's own getComputedStyle throws for it.
    case '/a2':
      return res.end(`<div id="present">I exist</div>
<script>const o=window.getComputedStyle;window.getComputedStyle=function(el){if(el&&el.id==='present')throw new Error('hostile page override');return o.apply(this,arguments);};</script>`);
    // A3: two .dup matches; first display:none, second visible; page's getComputedStyle throws for the second.
    case '/a3':
    case '/a3control': {
      const hostile = u.pathname === '/a3'
        ? `<script>const o=window.getComputedStyle;window.getComputedStyle=function(el){if(el&&el.dataset&&el.dataset.hostile)throw new Error('hostile');return o.apply(this,arguments);};</script>`
        : '';
      return res.end(`<div class="dup" style="display:none">first</div><div class="dup" data-hostile="1">second, visible</div>${hostile}`);
    }
    // A4: target VISIBLE in main frame the whole time; an iframe is detached/re-attached in a tight loop.
    case '/a4':
      return res.end(`<div id="stay">always visible</div><div id="host"></div>
<script>let n=0;setInterval(()=>{const h=document.getElementById('host');h.innerHTML='';const f=document.createElement('iframe');f.src='http://localhost:${port}/frame?'+(n++);h.appendChild(f);},15);</script>`);
    // A5: element appears late (never before tab close) -- attached wait, tab closed mid-wait.
    case '/a5':
      return res.end(`<div id="x">x</div><script>setTimeout(()=>{const d=document.createElement('div');d.id='late';document.body.appendChild(d);},4000)</script>`);
    // A6: element in main frame is hidden; wait visible; a SAME-page OOPIF is busy -> visible-timeout diagnosis message
    case '/a6':
      return res.end(`<div id="ghost" style="display:none">ghost</div>${frame}${BUSY}`);
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
    child,
    call,
    notify: (method, params) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n'),
    callTool: (name, args) => call('tools/call', { name, arguments: args }),
  };
}
const text = (r) => r.content?.[0]?.text ?? '';
const parse = (r) => { try { return JSON.parse(text(r)); } catch { return { raw: text(r), isError: r.isError }; } };

const mod = await import(pathToFileURL(path.join(repoRoot, 'packages', 'browser', 'dist', 'index.js')));
const chromePath = process.env.CHROME_PATH ?? new mod.BrowserLauncher().findExecutablePath();
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fr2-01-a5-'));
const browser = await puppeteer.launch({ executablePath: chromePath, headless: true, userDataDir: profile, args: ['--no-sandbox', '--site-per-process'] });
const mcp = makeMcpClient(path.join(repoRoot, 'packages', 'mcp-server', 'dist', 'cli.js'));
await mcp.call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'a5', version: '1' } });
mcp.notify('notifications/initialized');
const att = parse(await mcp.callTool('browser.attach', { endpoint: browser.wsEndpoint() }));
const sessionId = att.sessionId;
const out = [];
const rec = (o) => { out.push(o); console.log('RESULT ' + JSON.stringify(o)); };

async function nav(p) {
  const url = `http://127.0.0.1:${port}${p}${p.includes('?') ? '&' : '?'}n=${Math.random()}`;
  await mcp.callTool('browser.navigate', { sessionId, url });
  await delay(400);
  const pages = await browser.pages();
  return pages.find((pg) => pg.url().startsWith(url.split('?')[0])) ?? pages[pages.length - 1];
}
const wfs = (args) => mcp.callTool('browser.wait_for_selector', { sessionId, maxRetries: 0, ...args });
const oopifOf = (page) => page.frames().find((f) => f.url().includes('/frame'));
const busyFor = (frame, ms) => frame.evaluate((ms) => { setTimeout(() => window.__busy(ms), 0); }, ms).catch(() => {});
const truthVisible = (frame, sel) => frame.evaluate((s) => {
  const el = document.querySelector(s); if (!el) return null;
  const cs = Object.getPrototypeOf(window).constructor ? null : null; void cs;
  const r = el.getBoundingClientRect();
  return { exists: true, display: el.style.display || 'default', w: r.width, h: r.height };
}, sel).catch((e) => 'observer-error: ' + e.message);

try {
  // ---- A1: "could not verify" at the MCP user-facing layer: does the hint re-collapse it? ----
  for (const [id, timeoutMs] of [['A1-hidden-wait', 1500], ['A1-hidden-checkonce', 0]]) {
    if (!want(id)) continue;
    const page = await nav('/a1');
    const f = oopifOf(page);
    await busyFor(f, 15000); await delay(50);
    const t0 = Date.now();
    const r = await wfs({ target: '#banner', state: 'hidden', timeoutMs });
    const res = parse(r);
    const err = res.error ?? res.raw ?? '';
    rec({
      id, truth: '#banner is display:none in the main frame the whole time (genuinely hidden); unrelated OOPIF busy',
      oopifFound: !!f, success: res.success, isError: r.isError, totalMs: Date.now() - t0, error: err,
      engineSaysCouldNotVerify: /could not verify/.test(err),
      userFacingHintClaimsStillVisible: /Hint: The element is still visible/.test(err),
    });
    await delay(15500);
  }

  // ---- A2: hostile getComputedStyle -> isHandleVisible 'unknown' (unrecognized error); diagnosis $$eval
  //          also throws -> .catch(()=>null) -> does the final message claim "No element found"? ----
  for (const [id, timeoutMs] of [['A2-visible-wait', 1000], ['A2-visible-checkonce', 0]]) {
    if (!want(id)) continue;
    const page = await nav('/a2');
    const exists = await page.evaluate(() => !!document.querySelector('#present'));
    const r = await wfs({ target: '#present', state: 'visible', timeoutMs });
    const res = parse(r);
    const err = res.error ?? res.raw ?? '';
    const attached = parse(await wfs({ target: '#present', state: 'attached', timeoutMs: 0 }));
    rec({
      id, truth: '#present EXISTS in the main frame (observer confirms), page overrides getComputedStyle to throw for it',
      observerSaysExists: exists, attachedCheckOnceSuccess: attached.success,
      success: res.success, error: err,
      claimsNoElementFound: /No element found/.test(err),
    });
  }

  // ---- A3: countOtherVisibleMatches per-frame error -> silent confirmed zero? ----
  for (const [id, p] of [['A3-hostile', '/a3'], ['A3-control', '/a3control']]) {
    if (!want(id)) continue;
    const page = await nav(p);
    const secondVisible = await page.evaluate(() => { const e = document.querySelectorAll('.dup')[1]; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    const res = parse(await wfs({ target: '.dup', state: 'hidden', timeoutMs: 1000 }));
    rec({
      id, truth: 'first .dup display:none, SECOND .dup genuinely visible', observerSecondVisible: secondVisible,
      success: res.success, output: res.output,
      silentlyReportsNoOtherVisible: res.success === true && res.output?.otherVisibleMatches === undefined && res.output?.otherVisibleMatchesUnknown === undefined,
    });
  }

  // ---- A4: frame churn (detach/re-attach every 15ms) with the target VISIBLE in main frame -> any false 'hidden'? ----
  if (want('A4')) {
    await nav('/a4');
    let falseSuccess = 0, trials = 0, msgs = {};
    for (let i = 0; i < 30; i++) {
      const res = parse(await wfs({ target: '#stay', state: 'hidden', timeoutMs: i % 2 ? 0 : 300 }));
      trials++;
      if (res.success) falseSuccess++;
      const k = (res.error ?? '').replace(/after \d+ms/, 'after Nms').replace(/\n.*/s, '').slice(0, 140);
      msgs[k] = (msgs[k] ?? 0) + 1;
    }
    // also: element ONLY inside churning frames' neighbor? -> visible wait on #inframe should not fail w/ "No element found" when it exists
    let visOk = 0, visMsgs = {};
    for (let i = 0; i < 10; i++) {
      const res = parse(await wfs({ target: '#inframe', state: 'visible', timeoutMs: i % 2 ? 0 : 500 }));
      if (res.success) visOk++;
      else { const k = (res.error ?? '').replace(/after \d+ms/, 'after Nms').replace(/\n.*/s, '').slice(0, 160); visMsgs[k] = (visMsgs[k] ?? 0) + 1; }
    }
    rec({ id: 'A4-frame-churn', truth: '#stay visible in main frame whole time; #inframe exists in each (constantly replaced) iframe', hiddenTrials: trials, hiddenFalseSuccess: falseSuccess, hiddenMsgs: msgs, inframeVisibleSuccesses: visOk + '/10', inframeFailMsgs: visMsgs });
  }

  // ---- A6: visible timeout on present-but-hidden element while unrelated OOPIF is busy ----
  if (want('A6')) {
    const page = await nav('/a6');
    await busyFor(oopifOf(page), 15000); await delay(50);
    const res = parse(await wfs({ target: '#ghost', state: 'visible', timeoutMs: 1000 }));
    rec({ id: 'A6-visible-timeout-diag-busy-oopif', truth: '#ghost exists (display:none) in main frame', success: res.success, error: res.error, claimsNoElementFound: /No element found/.test(res.error ?? '') });
    await delay(15000);
  }

  // ---- A5: tab closed mid attached-wait (resolveElement path, not touched by fix-4) ----
  if (want('A5')) {
    const page = await nav('/a5');
    const t0 = Date.now();
    const p = wfs({ target: '#late', state: 'attached', timeoutMs: 3000 });
    await delay(600);
    await page.close().catch(() => {});
    const res = parse(await p);
    rec({ id: 'A5-tab-closed-mid-attached-wait', truth: 'tab was CLOSED at ~600ms; #late never existed before that', totalMs: Date.now() - t0, success: res.success, error: res.error ?? res.raw, claimsTimedOutNoElementFound: /timed out.*No element found/s.test(res.error ?? res.raw ?? '') });
  }
} finally {
  fs.writeFileSync(path.join(here, `probe-a5-results${only.length ? '-' + only.join('_') : ''}.json`), JSON.stringify(out, null, 2));
  try { mcp.child.kill(); } catch {}
  await browser.close().catch(() => {});
  server.close();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
}
process.exit(0);
