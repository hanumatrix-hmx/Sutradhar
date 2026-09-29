// Auditor's independent live probes over the BUILT MCP server (stdio), with an independent
// puppeteer-core observer connected to the same Chrome as ground truth.
// Usage: node mcp-probes.mjs <repoRoot> <outJsonl> [--server=<path to mcp cli.js>]
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { startAuditServer } from './audit-server.mjs';

const repoRoot = process.argv[2];
const outFile = process.argv[3];
const serverArg = process.argv.find((a) => a.startsWith('--server='));
const serverPath = serverArg ? serverArg.slice(9) : path.join(repoRoot, 'packages', 'mcp-server', 'dist', 'cli.js');
const require_ = createRequire(path.join(repoRoot, 'packages', 'browser', 'package.json'));
const puppeteer = require_('puppeteer-core');
const { BrowserLauncher } = await import(pathToFileURL(path.join(repoRoot, 'packages', 'browser', 'dist', 'index.js')).href);
const chromePath = process.env.CHROME_PATH || new BrowserLauncher().findExecutablePath();
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const rows = [];
const pids = [];
const HARD_DEADLINE = setTimeout(() => { console.error('HARD DEADLINE (15 min) hit'); process.exit(3); }, 15 * 60 * 1000);

function rec(id, expectation, ok, data) {
  const row = { id, expectation, pass: !!ok, ...data };
  rows.push(row);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id} :: ${expectation} :: ${JSON.stringify(data).slice(0, 600)}`);
}

function mcpClient(env) {
  const child = spawn(process.execPath, [serverPath], { stdio: ['pipe', 'pipe', 'pipe'], env });
  pids.push(child.pid);
  let buf = ''; let next = 1; const pend = new Map();
  child.stdout.on('data', (c) => {
    buf += c.toString('utf8'); let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue; let m; try { m = JSON.parse(line); } catch { continue; }
      if (m.id !== undefined && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
    }
  });
  child.stderr.on('data', () => {});
  const call = (method, params, t = 90000) => new Promise((res, rej) => {
    const id = next++; pend.set(id, { res, rej });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    setTimeout(() => { if (pend.has(id)) { pend.delete(id); rej(new Error('timeout ' + method)); } }, t);
  });
  return { child, call, notify: (m, p) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: m, params: p }) + '\n') };
}

const srv = await startAuditServer();
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'fr207-audit-obs-'));
const dlRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'fr207-audit-dl-'));
const upDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fr207-audit-up-'));
const upFile = path.join(upDir, 'audit-upload.txt');
await fs.writeFile(upFile, 'x'.repeat(777));
const observer = await puppeteer.launch({ executablePath: chromePath, headless: true, userDataDir: profile, args: ['--no-sandbox'], defaultViewport: { width: 1100, height: 900 } });
pids.push(observer.process()?.pid);
console.log('PIDS', JSON.stringify(pids));
const mcp = mcpClient({ ...process.env, SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS: dlRoot });
await mcp.call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'fr207-auditor', version: '1' } });
mcp.notify('notifications/initialized');
const tl = await mcp.call('tools/list', {});
const attach = JSON.parse((await mcp.call('tools/call', { name: 'browser.attach', arguments: { endpoint: observer.wsEndpoint() } })).content[0].text);
const sessionId = attach.sessionId;
const raw = (name, a = {}) => mcp.call('tools/call', { name, arguments: { sessionId, ...a } });
const tool = async (name, a = {}) => { const r = await raw(name, a); let j; try { j = JSON.parse(r.content[0].text); } catch { j = undefined; } return { r, j, isError: !!r.isError, text: r.content?.[0]?.text }; };
const V = (j) => j?.verification;
const tier = (j) => j?.verification?.evidence?.tier;
const short = (j) => ({ success: j?.success, verified: V(j)?.verified, confidence: V(j)?.confidence, tier: tier(j), reason: V(j)?.reason, checks: V(j)?.evidence?.checks });
let n = 0;
const obsPage = async (prefix) => { for (let i = 0; i < 50; i++) { const ps = await observer.pages(); const p = ps.find((x) => x.url().startsWith(prefix)); if (p) return p; await delay(100); } throw new Error('observer page not found ' + prefix); };
async function fresh() {
  await delay(1100); // stay clear of the pre-existing 1000ms duplicate-action guard
  const url = `${srv.origin}/p.html?n=${++n}`;
  await tool('browser.navigate', { url });
  const p = await obsPage(url);
  await p.waitForFunction(() => window.__a && window.__a.ready, { timeout: 8000 });
  for (let i = 0; i < 50; i++) { if (p.frames().some((f) => f.url().includes('/xo.html'))) break; await delay(100); }
  await delay(200);
  return p;
}
const safe = async (id, fn) => { try { await fn(); } catch (e) { rec(id, 'probe ran', false, { error: String(e?.stack ?? e).slice(0, 500) }); } };

rec('T0.tools-count', '24 tools with expect (total count recorded, compared to baseline separately)', tl.tools.filter((t) => t.inputSchema?.properties?.expect).length === 24, { count: tl.tools.length, withExpect: tl.tools.filter((t) => t.inputSchema?.properties?.expect).length });

// press_key
await safe('K.txt', async () => {
  const p = await fresh();
  await tool('browser.focus', { target: '#txt' });
  const { j } = await tool('browser.press_key', { key: 'q' });
  const val = await p.$eval('#txt', (e) => e.value);
  rec('K.txt', 'verified and observer value=q', j.success && V(j).verified === true && tier(j) === 'verified' && val === 'q', { ...short(j), observerValue: val });
});
await safe('K.body-NEG', async () => {
  const p = await fresh();
  await p.evaluate(() => document.activeElement && document.activeElement.blur());
  const { j } = await tool('browser.press_key', { key: 'q' });
  rec('K.body-NEG', 'unverifiable, verified:false', j.success && V(j).verified === false && tier(j) === 'unverifiable', short(j));
});
await safe('K.body+trivial-expect', async () => {
  const p = await fresh();
  await p.evaluate(() => document.activeElement && document.activeElement.blur());
  const { j } = await tool('browser.press_key', { key: 'q', expect: { urlChanged: false } });
  rec('K.body+trivial-expect', 'RECORD tier (expect urlChanged:false on a no-focus press)', true, short(j));
});
await safe('K.readonly-NEG', async () => {
  const p = await fresh();
  const f = await tool('browser.focus', { target: '#ro' });
  const { j } = await tool('browser.press_key', { key: 'q' });
  const val = await p.$eval('#ro', (e) => e.value);
  rec('K.readonly-NEG', 'contradicted, observer value x', j.success && V(j).verified === false && tier(j) === 'contradicted' && val === 'x', { ...short(j), observerValue: val, focusTier: tier(f.j) });
});
await safe('K.resetter-NEG', async () => {
  const p = await fresh();
  await tool('browser.focus', { target: '#resetter' });
  const { j } = await tool('browser.press_key', { key: 'q' });
  const val = await p.$eval('#resetter', (e) => e.value);
  rec('K.resetter-NEG', 'input handler resets value -> contradicted, observer value empty', j.success && V(j).verified === false && tier(j) === 'contradicted' && val === '', { ...short(j), observerValue: val });
});
await safe('K.oopif', async () => {
  const p = await fresh();
  const xf = p.frames().find((f) => f.url().includes('/xo.html'));
  await xf.$eval('#xin', (e) => e.focus());
  const { j } = await tool('browser.press_key', { key: 'z' });
  const val = await xf.$eval('#xin', (e) => e.value);
  rec('K.oopif', 'verified:true only if observer sees z (no false pass)', !(V(j).verified === true && val !== 'z'), { ...short(j), observerValue: val });
});

// focus
await safe('F.txt', async () => {
  const p = await fresh();
  const { j } = await tool('browser.focus', { target: '#txt' });
  const a = await p.evaluate(() => document.activeElement?.id);
  rec('F.txt', 'verified and activeElement=txt', V(j).verified === true && a === 'txt', { ...short(j), observerActive: a });
});
await safe('F.nofocus-NEG', async () => {
  const p = await fresh();
  const { j } = await tool('browser.focus', { target: '#nofocus' });
  const a = await p.evaluate(() => document.activeElement?.tagName);
  rec('F.nofocus-NEG', 'success:true, contradicted', j.success && V(j).verified === false && tier(j) === 'contradicted' && a !== 'DIV', { ...short(j), observerActive: a });
});
await safe('F.disabled-NEG', async () => {
  const p = await fresh();
  const { j } = await tool('browser.focus', { target: '#dis' });
  const a = await p.evaluate(() => document.activeElement?.id);
  rec('F.disabled-NEG', 'not verified:true (disabled input cannot take focus)', V(j)?.verified !== true && a !== 'dis', { ...short(j), error: j?.error, observerActive: a });
});

// wait_for_selector
await safe('W.visible', async () => {
  await fresh();
  const { j } = await tool('browser.wait_for_selector', { target: '#txt', timeoutMs: 3000 });
  rec('W.visible', 'verified', V(j).verified === true && tier(j) === 'verified', short(j));
});
await safe('W.hidden-typo-NEG', async () => {
  await fresh();
  const { j } = await tool('browser.wait_for_selector', { target: '#no-such-thing-xyz', timeoutMs: 2000, state: 'hidden' });
  rec('W.hidden-typo-NEG', 'unverifiable (vacuous)', j.success && V(j).verified === false && tier(j) === 'unverifiable', short(j));
});
await safe('W.visible-on-hidden-NEG', async () => {
  await fresh();
  const { j } = await tool('browser.wait_for_selector', { target: '#hidden-host', timeoutMs: 1500 });
  rec('W.visible-on-hidden-NEG', 'action-failed (display:none never visible)', j.success === false && tier(j) === 'action-failed', short(j));
});

// expect.text visibility semantics
for (const [id, text, want] of [
  ['X.display-none-NEG', 'DISPLAY-NONE-TEXT', 'contradicted'],
  ['X.visibility-hidden-NEG', 'VIS-HIDDEN-TEXT', 'contradicted'],
  ['X.shadow-in-hidden-host-NEG', 'SHADOW-HIDDEN-TEXT', 'contradicted'],
  ['X.hidden-iframe-NEG', 'IFRAME-HIDDEN-TEXT', 'contradicted'],
  ['X.visible', 'plain div', 'verified'],
]) {
  await safe(id, async () => {
    await fresh();
    const { j } = await tool('browser.click', { target: '#noop', expect: { text } });
    rec(id, `expect.text ${text} -> ${want}`, j.success && tier(j) === want, short(j));
  });
}

// click_at_point
await safe('P.real', async () => {
  const p = await fresh();
  const { j } = await tool('browser.click_at_point', { x: 100, y: 320 });
  const c = await p.evaluate(() => window.__a.real);
  rec('P.real', 'verified, observer real=1', V(j).verified === true && c === 1, { ...short(j), observer: c });
});
await safe('P.covered', async () => {
  const p = await fresh();
  const { j } = await tool('browser.click_at_point', { x: 260, y: 320 });
  const c = await p.evaluate(() => ({ covered: window.__a.covered, overlay: window.__a.overlay }));
  rec('P.covered', 'verified:true NAMING the overlay (documented decoy semantics); covered=0', c.covered === 0 && (V(j).verified === false || /overlay/.test(V(j).reason)), { ...short(j), observer: c });
});
await safe('P.covered+expect-NEG', async () => {
  const p = await fresh();
  const { j } = await tool('browser.click_at_point', { x: 260, y: 320, expect: { text: 'COVERED CLICKED' } });
  const c = await p.evaluate(() => window.__a.covered);
  rec('P.covered+expect-NEG', 'contradicted via expect.text', j.success && tier(j) === 'contradicted' && c === 0, { ...short(j), observer: c });
});
await safe('P.offscreen-NEG', async () => {
  await fresh();
  const { j } = await tool('browser.click_at_point', { x: 5000, y: 5000 });
  rec('P.offscreen-NEG', 'contradicted no element', j.success && tier(j) === 'contradicted', short(j));
});
await safe('P.capture-swallowed', async () => {
  const p = await fresh();
  const { j } = await tool('browser.click_at_point', { x: 100, y: 420 });
  const c = await p.evaluate(() => window.__a.swallowCapture);
  rec('P.capture-swallowed', 'RECORD (page stops click at window capture before our listener)', true, { ...short(j), observer: c });
});
await safe('P.oopif', async () => {
  const p = await fresh();
  const xf = p.frames().find((f) => f.url().includes('/xo.html'));
  const before = await xf.evaluate(() => window.__xb);
  const { j } = await tool('browser.click_at_point', { x: 460, y: 330 });
  await delay(300);
  const after = await xf.evaluate(() => window.__xb);
  const parent = await p.evaluate(() => window.__a.xo);
  rec('P.oopif', 'verified:true implies frame counter +1; never false verified', !(V(j).verified === true && after !== before + 1), { ...short(j), frameCounter: [before, after], parentMsgs: parent });
});

// drag_at_points
await safe('G.offscreen-NEG', async () => {
  await fresh();
  const { j } = await tool('browser.drag_at_points', { fromX: 5000, fromY: 5000, toX: 100, toY: 100 });
  rec('G.offscreen-NEG', 'contradicted', j.success && tier(j) === 'contradicted', short(j));
});
await safe('G.onpage', async () => {
  await fresh();
  const { j } = await tool('browser.drag_at_points', { fromX: 50, fromY: 700, toX: 150, toY: 750 });
  rec('G.onpage', 'verified (delivery)', j.success && tier(j) === 'verified', short(j));
});

// upload_file_via_trigger
await safe('U.trigger', async () => {
  const p = await fresh();
  const { j, isError, text } = await tool('browser.upload_file_via_trigger', { target: '#trig', filePath: upFile });
  const out = await p.$eval('#out', (e) => e.textContent);
  rec('U.trigger', 'verified; observer out=audit-upload.txt:777', V(j)?.verified === true && out === 'audit-upload.txt:777', { ...short(j), observer: out, isError, text: isError ? text : undefined });
});
await safe('U.detached-NEG', async () => {
  const p = await fresh();
  const { j, isError, text } = await tool('browser.upload_file_via_trigger', { target: '#trig-detached', filePath: upFile });
  await delay(300);
  const got = await p.evaluate(() => window.__detGot);
  rec('U.detached-NEG', 'unverifiable (never verified:true, never contradicted)', j?.success && tier(j) === 'unverifiable', { ...short(j), observerDetGot: got, isError, text: isError ? text : undefined });
});

// screenshot
await safe('S.screenshot', async () => {
  await fresh();
  const r = await raw('browser.screenshot', {});
  const second = r.content?.[1]?.text ? JSON.parse(r.content[1].text) : undefined;
  rec('S.screenshot', 'content[0] image, content[1] unverifiable', r.content?.[0]?.type === 'image' && second?.verification?.evidence?.tier === 'unverifiable', { second: second?.verification });
});

// navigation
await safe('N.navigate-ok', async () => {
  await fresh();
  const { j } = await tool('browser.navigate', { url: `${srv.origin}/a?n=${++n}` });
  rec('N.navigate-ok', 'verified new document', V(j).verified === true, short(j));
});
for (const code of [404, 500]) {
  await safe(`N.http${code}-NEG`, async () => {
    const { j, isError, text } = await tool('browser.navigate', { url: `${srv.origin}/status/${code}?n=${++n}` });
    rec(`N.http${code}-NEG`, 'contradicted HTTP', !isError && tier(j) === 'contradicted' && /HTTP/.test(V(j).reason), { ...short(j), isError, text: isError ? text : undefined });
  });
}
await safe('N.http204-NEG', async () => {
  await tool('browser.navigate', { url: `${srv.origin}/a?n=${++n}` });
  const { j, isError, text } = await tool('browser.navigate', { url: `${srv.origin}/status/204?n=${++n}` });
  rec('N.http204-NEG', '204 (no commit) must never be verified:true', isError || V(j)?.verified !== true, { ...short(j), isError, text: isError ? text?.slice(0, 300) : undefined, url: j?.url });
});
await safe('N.redirect+expect', async () => {
  const { j } = await tool('browser.navigate', { url: `${srv.origin}/redirect?n=${++n}`, expect: { url: '/b' } });
  rec('N.redirect+expect-NEG', 'expect.url /b on redirect to /a -> contradicted', j.success !== false && tier(j) === 'contradicted', short(j));
});
await safe('N.reload', async () => {
  const p0 = await fresh();
  const t0 = await p0.evaluate(() => performance.timeOrigin);
  const { j } = await tool('browser.reload', {});
  const p1 = await obsPage(srv.origin + '/p.html');
  const t1 = await p1.evaluate(() => performance.timeOrigin);
  rec('N.reload', 'verified and observer timeOrigin changed', V(j).verified === true && t1 !== t0, { ...short(j), t0, t1 });
});
await safe('N.back-nohistory-NEG', async () => {
  const nt = await tool('browser.new_tab', {});
  const tabId = nt.j?.tabId ?? nt.j?.id;
  const { j, isError, text } = await tool('browser.go_back', tabId ? { tabId } : {});
  rec('N.back-nohistory-NEG', 'contradicted no history entry', !isError && !!j.verification && tier(j) === 'contradicted', { ...short(j), isError, text: isError ? text : undefined, newTab: nt.j });
  const fwd = await tool('browser.go_forward', tabId ? { tabId } : {});
  rec('N.forward-end-NEG', 'contradicted no forward entry', !fwd.isError && tier(fwd.j) === 'contradicted', { ...short(fwd.j), isError: fwd.isError, text: fwd.isError ? fwd.text : undefined });
  if (tabId) await tool('browser.close_tab', { tabId });
});
await safe('N.back-ok', async () => {
  await tool('browser.navigate', { url: `${srv.origin}/a?n=${++n}` });
  await tool('browser.navigate', { url: `${srv.origin}/b?n=${++n}` });
  const { j } = await tool('browser.go_back', {});
  rec('N.back-ok', 'verified, url /a', V(j).verified === true && /\/a\?/.test(j.url), short(j));
  const f = await tool('browser.go_forward', {});
  rec('N.forward-ok', 'verified, url /b', V(f.j).verified === true && /\/b\?/.test(f.j.url), short(f.j));
});

// clipboard
await safe('C.clipboard', async () => {
  await tool('browser.grant_permissions', { origin: srv.origin, permissions: ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write'] });
  await tool('browser.navigate', { url: `${srv.origin}/a?n=${++n}` });
  const a = await tool('browser.set_clipboard', { text: 'AUDIT-SENTINEL-1' });
  rec('C.plain', 'verified', V(a.j)?.verified === true, short(a.j));
  await tool('browser.navigate', { url: `${srv.origin}/spoof.html?n=${++n}` });
  const b = await tool('browser.set_clipboard', { text: 'AUDIT-NEW-2' });
  rec('C.spoof-noop-NEG', 'contradicted (isolated read sees sentinel)', b.j?.success && tier(b.j) === 'contradicted', short(b.j));
  const bs = await tool('browser.set_clipboard', { text: 'AUDIT-SENTINEL-1' });
  rec('C.spoof-noop-same-value', 'RECORD: no-op write of a value the clipboard already holds', true, short(bs.j));
  await tool('browser.navigate', { url: `${srv.origin}/evil.html?n=${++n}` });
  const c = await tool('browser.set_clipboard', { text: 'AUDIT-NEW-3' });
  rec('C.evil-replace-NEG', 'contradicted (page wrote a different value)', c.j?.success && tier(c.j) === 'contradicted', short(c.j));
  const g = await tool('browser.get_clipboard', {});
  rec('C.get', 'get_clipboard carries verification', !!g.j?.verification, { textLen: g.j?.text?.length, ...short(g.j) });
  const leak = JSON.stringify([a.j?.verification, b.j?.verification, c.j?.verification, g.j?.verification]);
  rec('C.no-leak', 'verification never contains clipboard text (D11)', !/AUDIT-|EVIL-REPLACED/.test(leak), {});
});

// download
await safe('D.download', async () => {
  const dlDir = await fs.mkdtemp(path.join(dlRoot, 'd-'));
  await tool('browser.navigate', { url: `${srv.origin}/dlpage?n=${++n}` });
  const { j } = await tool('browser.download_file', { target: '#dl', downloadDir: dlDir });
  const out = j?.output ?? j?.outputData;
  const p = out?.downloadedPath;
  const st = p ? await fs.stat(p).catch(() => null) : null;
  rec('D.download', 'verified; fs.stat size 4321', V(j)?.verified === true && st?.size === 4321, { ...short(j), path: p, statSize: st?.size, output: out, error: j?.error });
  await tool('browser.navigate', { url: `${srv.origin}/dlpage?n=${++n}` });
  const z = await tool('browser.download_file', { target: '#dl0', downloadDir: dlDir });
  const p0 = (z.j?.output ?? z.j?.outputData)?.downloadedPath;
  const st0 = p0 ? await fs.stat(p0).catch(() => null) : null;
  rec('D.zero-NEG', 'success:true, contradicted 0 bytes; observer size 0', z.j?.success && tier(z.j) === 'contradicted' && st0?.size === 0, { ...short(z.j), statSize: st0?.size, error: z.j?.error });
});

// contract sweep and no primitive overrides
await safe('Z.no-overrides', async () => {
  const p = await fresh();
  await tool('browser.focus', { target: '#txt' });
  await tool('browser.press_key', { key: 'a' });
  await tool('browser.click_at_point', { x: 100, y: 320 });
  await tool('browser.click', { target: '#noop', expect: { text: 'plain div' } });
  await tool('browser.upload_file_via_trigger', { target: '#trig', filePath: upFile });
  const r = await p.evaluate(() => {
    const nat = (f) => typeof f === 'function' && /\[native code\]/.test(Function.prototype.toString.call(f));
    const leftovers = Object.keys(window).filter((k) => /^__sd/.test(k));
    const marks = Array.from(document.querySelectorAll('*')).filter((e) => Object.keys(e).some((k) => /^__sd/.test(k))).map((e) => e.id);
    return {
      addEventListener: nat(EventTarget.prototype.addEventListener),
      focus: nat(HTMLElement.prototype.focus),
      elementFromPoint: nat(Document.prototype.elementFromPoint),
      writeText: nat(navigator.clipboard.writeText),
      activeElementGetter: nat(Object.getOwnPropertyDescriptor(Document.prototype, 'activeElement').get),
      leftovers, marks,
    };
  });
  const ok = r.addEventListener && r.focus && r.elementFromPoint && r.writeText && r.activeElementGetter && r.leftovers.length === 0 && r.marks.length === 0;
  rec('Z.no-overrides', 'no page primitives overridden, no leftover __sd globals/expandos', ok, r);
});

await safe('Z.sweep', async () => {
  await fresh();
  const calls = [
    ['browser.click', { target: '#noop' }], ['browser.type', { target: '#txt', value: 'hi' }], ['browser.hover', { target: '#noop' }],
    ['browser.scroll', { direction: 'down', amount: 10 }], ['browser.right_click', { target: '#noop' }], ['browser.click_by_text', { text: 'noop' }],
    ['browser.click_by_role', { role: 'button', name: 'noop' }], ['browser.touch_tap', { target: '#noop' }],
    ['browser.fill_form', { fields: { '#txt': 'v' } }], ['browser.hover', { target: '#does-not-exist' }],
  ];
  const out = [];
  for (const [name, a] of calls) {
    const { j, isError, text } = await tool(name, a);
    let v = j?.verification;
    if (name === 'browser.fill_form') { const vals = Object.values(j?.results ?? j ?? {}); v = vals[0]?.verification; }
    const keysOk = v && ['verified', 'urlChanged', 'elementFound', 'confidence', 'reason', 'evidence'].every((k) => k in v) && typeof v.reason === 'string' && v.reason.length > 0;
    out.push({ name, isError, keysOk: !!keysOk, tier: v?.evidence?.tier, text: isError ? text?.slice(0, 200) : undefined });
  }
  rec('Z.sweep', 'every result has verification{verified,urlChanged,elementFound,confidence,reason,evidence}', out.every((o) => o.keysOk), { out });
});

await fs.writeFile(outFile, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
console.log('SUMMARY', rows.filter((r) => r.pass).length, '/', rows.length);
try { await raw('browser.shutdown', {}); } catch {}
mcp.child.stdin.end();
await delay(500);
try { mcp.child.kill(); } catch {}
await observer.close();
await srv.close();
for (const d of [profile, dlRoot, upDir]) await fs.rm(d, { recursive: true, force: true }).catch(() => {});
clearTimeout(HARD_DEADLINE);
process.exit(0);
