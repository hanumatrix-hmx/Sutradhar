// Auditor-2: GAP-322 / K11 investigation. A page with the builder's cross-origin frame (frame.html: #xo-in)
// PLUS extra cross-origin frames from the SAME cross origin, present at parse time or added after load.
// Drives the real MCP server (attach) and reads ground truth two ways:
//   (a) harness-style: the FIRST frame whose URL starts with the cross origin ($eval '#xo-in')
//   (b) robust: search EVERY frame for '#xo-in'
// Also checks expect.text on main-frame and cross-origin text with several OOPIFs present.
// Usage: node k11-repro.mjs <repoRoot> <outJsonl> <label>
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const [repoRoot, outFile, label] = process.argv.slice(2);
const HERE_REPO = process.env.FIXTURE_REPO ?? repoRoot;
const frameHtml = await fs.readFile(path.join(HERE_REPO, 'tools', 'scenario-suite', 'fixtures', 'fr2-07-frame.html'), 'utf8');
const require_ = createRequire(path.join(repoRoot, 'packages', 'browser', 'package.json'));
const puppeteer = require_('puppeteer-core');
const { BrowserLauncher } = await import(pathToFileURL(path.join(repoRoot, 'packages', 'browser', 'dist', 'index.js')).href);
const chromePath = process.env.CHROME_PATH || new BrowserLauncher().findExecutablePath();
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const HARD = setTimeout(() => { console.error('HARD DEADLINE'); process.exit(3); }, 15 * 60 * 1000);
let port = 0;
const handler = (req, res) => {
  const u = new URL(req.url, 'http://x');
  const send = (b) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(b); };
  const xo = 'http://localhost:' + port;
  if (u.pathname === '/frame.html') return send(frameHtml);
  if (u.pathname === '/textframe.html') return send('<!doctype html><html><body><p>' + (u.searchParams.get('text') ?? '') + '</p></body></html>');
  if (u.pathname === '/main') {
    const mode = u.searchParams.get('mode');
    const extra = [['hid-xo', 'display:none', 'XOHIDDENTXT'], ['vis-xo', '', 'XOVISIBLETXT']];
    const parseFrames = mode === 'parse' || mode === 'parse-before' ? extra.map((e) => '<iframe id="' + e[0] + '" style="' + e[1] + '" src="' + xo + '/textframe.html?text=' + e[2] + '"></iframe>').join('') : '';
    const loadScript = mode === 'load' ? '<script>window.addEventListener("load",function(){[["hid-xo","display:none","XOHIDDENTXT"],["vis-xo","","XOVISIBLETXT"]].forEach(function(p){var f=document.createElement("iframe");f.id=p[0];f.style.cssText=p[1];f.src="' + xo + '/textframe.html?text="+p[2];document.body.appendChild(f);});});</script>' : '';
    const main = '<iframe id="xo" style="width:200px;height:44px" src="' + xo + '/frame.html"></iframe>';
    const body = mode === 'parse-before' ? parseFrames + main : main + parseFrames;
    return send('<!doctype html><html><body><button id="noop">noop</button><p>MAINTEXTOK</p>' + body + loadScript + '<script>window.__r=1</script></body></html>');
  }
  res.writeHead(404); res.end();
};
const s4 = http.createServer(handler); await new Promise((r) => s4.listen(0, '127.0.0.1', r)); port = s4.address().port;
const s6 = http.createServer(handler); await new Promise((r) => { s6.once('error', r); s6.listen(port, '::1', r); });
const origin = 'http://127.0.0.1:' + port; const xo = 'http://localhost:' + port;
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'fr207-a2-k11-'));
const observer = await puppeteer.launch({ executablePath: chromePath, headless: true, userDataDir: profile, args: ['--no-sandbox'] });
const child = spawn(process.execPath, [path.join(repoRoot, 'packages', 'mcp-server', 'dist', 'cli.js')], { stdio: ['pipe', 'pipe', 'pipe'] });
console.log('PIDS', JSON.stringify({ chrome: observer.process()?.pid, mcp: child.pid, self: process.pid, label }));
let buf = ''; let next = 1; const pend = new Map();
child.stdout.on('data', (c) => { buf += c; let i; while ((i = buf.indexOf(String.fromCharCode(10))) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!line) continue; let m; try { m = JSON.parse(line); } catch { continue; } if (pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } } });
child.stderr.on('data', () => {});
const call = (method, params) => new Promise((res, rej) => { const id = next++; pend.set(id, res); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + String.fromCharCode(10)); setTimeout(() => { if (pend.has(id)) { pend.delete(id); rej(new Error('timeout ' + method)); } }, 60000); });
await call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'a2-k11', version: '1' } });
child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + String.fromCharCode(10));
const att = JSON.parse((await call('tools/call', { name: 'browser.attach', arguments: { endpoint: observer.wsEndpoint() } })).result.content[0].text);
const tool = async (name, a) => { const m = await call('tools/call', { name, arguments: { sessionId: att.sessionId, ...a } }); const t = m.result?.content?.[0]?.text ?? JSON.stringify(m.error); let j; try { j = JSON.parse(t); } catch {} return { j, t, isError: !!m.result?.isError }; };
const rows = [];
for (const mode of ['none', 'parse', 'parse-before', 'load']) {
  for (let rep = 0; rep < 3; rep++) {
    await delay(1100);
    const url = origin + '/main?mode=' + mode + '&rep=' + rep;
    await tool('browser.navigate', { url });
    const p = (await observer.pages()).find((x) => x.url() === url);
    await p.waitForFunction(() => window.__r === 1, { timeout: 8000 });
    // wait (bounded, 8s) until every expected cross-origin frame is attached
    const want = mode === 'none' ? 1 : 3;
    const t0 = performance.now();
    while (p.frames().filter((f) => f.url().startsWith(xo)).length < want && performance.now() - t0 < 8000) await delay(100);
    await delay(500);
    const xoFrames = p.frames().filter((f) => f.url().startsWith(xo)).map((f) => f.url().replace(xo, ''));
    const focus = await tool('browser.focus', { target: '#xo-in' });
    const press = await tool('browser.press_key', { key: 'b' });
    let harnessRead; try { const fr = p.frames().find((f) => f.url().startsWith(xo)); harnessRead = await fr.$eval('#xo-in', (e) => e.value); } catch (e) { harnessRead = 'THROWS: ' + String(e.message).slice(0, 90); }
    let robustRead = 'not-found';
    for (const f of p.frames()) { try { const h = await Promise.race([f.$('#xo-in'), delay(2000).then(() => null)]); if (h) { robustRead = await h.evaluate((e) => e.value); break; } } catch {} }
    await delay(1100);
    const clickExpect = (text) => tool('browser.click', { target: '#noop', expect: { text } });
    const e1 = await clickExpect('MAINTEXTOK');
    await delay(1100);
    const e2 = mode === 'none' ? null : await clickExpect('XOVISIBLETXT');
    await delay(1100);
    const e3 = mode === 'none' ? null : await clickExpect('XOHIDDENTXT');
    const tr = (x) => x ? { tier: x.j?.verification?.evidence?.tier, detail: x.j?.verification?.evidence?.checks?.find((c) => c.check === 'expect.text')?.detail } : null;
    const row = { label, mode, rep, xoFrames, focus: { success: focus.j?.success, tier: focus.j?.verification?.evidence?.tier, err: focus.isError ? focus.t.slice(0, 200) : (focus.j?.error ?? undefined) }, press: { success: press.j?.success, tier: press.j?.verification?.evidence?.tier }, harnessRead, robustRead, expectMain: tr(e1), expectXoVisible: tr(e2), expectXoHidden: tr(e3) };
    rows.push(row);
    console.log(JSON.stringify(row));
  }
}
await fs.writeFile(outFile, rows.map((r) => JSON.stringify(r)).join(String.fromCharCode(10)) + String.fromCharCode(10));
try { await tool('browser.shutdown', {}); } catch {}
child.stdin.end(); await delay(500); try { child.kill(); } catch {}
await observer.close(); s4.close(); s6.close();
await fs.rm(profile, { recursive: true, force: true }).catch(() => {});
clearTimeout(HARD); process.exit(0);
