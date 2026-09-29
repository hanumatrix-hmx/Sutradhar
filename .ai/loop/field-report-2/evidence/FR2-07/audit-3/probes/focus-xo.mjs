// audit-3: browser.focus on an input inside a cross-origin frame, with extra cross-origin frames present at PARSE time
// listed BEFORE (or AFTER) the target frame. Run against ROOT (default worktree). Observer reads activeElement in the target frame.
import fs from 'node:fs'; import path from 'node:path'; import http from 'node:http'; import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process'; import { createRequire } from 'node:module'; import { pathToFileURL, fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)); const WT = path.resolve(here, '../../../../../../..'); const ROOT = process.env.ROOT || WT;
const LABEL = process.env.LABEL || 'head'; const REPS = Number(process.env.REPS || 10);
const req = createRequire(path.join(WT, 'packages/browser/package.json')); const puppeteer = req('puppeteer-core');
const OUT = path.join(here, '..', `focus-xo-${LABEL}.jsonl`); fs.writeFileSync(OUT, '');
const PIDS = path.join(here, '..', 'pids-started.txt'); const logPid = (p, w) => fs.appendFileSync(PIDS, `${new Date().toISOString()} pid=${p} ${w} root=${ROOT}\n`);
const HARD = setTimeout(() => { console.error('HARD TIMEOUT'); process.exit(3); }, 15 * 60 * 1000);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
let port = 0;
const h = (rq, rs) => {
  const u = new URL(rq.url, 'http://x'); const send = (b) => { rs.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }); rs.end(b); };
  if (u.pathname === '/t') return send(`<!doctype html><body><p>txt ${u.searchParams.get('k')}</p></body>`);
  if (u.pathname === '/in') return send(`<!doctype html><body><input id="xo-in" value=""></body>`);
  if (u.pathname === '/main') {
    const xo = `http://localhost:${port}`; const n = u.searchParams.get('n');
    const extra = `<iframe style="display:none" src="${xo}/t?k=hid${n}"></iframe><iframe width="200" height="50" src="${xo}/t?k=vis${n}"></iframe>`;
    const target = `<iframe width="300" height="60" src="${xo}/in?role=target${n}"></iframe>`;
    return send(`<!doctype html><body><h1>m</h1>${u.searchParams.get('order') === 'before' ? extra + target : target + extra}</body>`);
  }
  rs.writeHead(404); rs.end();
};
const s1 = http.createServer(h); await new Promise((r) => s1.listen(0, '127.0.0.1', r)); port = s1.address().port;
const s2 = http.createServer(h); await new Promise((r) => s2.listen(port, '::1', r)).catch(() => {});
const exe = spawnSync(process.execPath, ['-e', `import(${JSON.stringify(pathToFileURL(path.join(WT, 'packages/browser/dist/index.js')).href)}).then(m=>console.log(new m.BrowserLauncher().findExecutablePath()))`], { encoding: 'utf8' }).stdout.trim();
const obs = await puppeteer.launch({ executablePath: exe, headless: true, userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'a3-fx-')), args: ['--no-sandbox'] });
logPid(obs.process()?.pid, 'focus-xo observer chrome');
const child = spawn(process.execPath, [path.join(ROOT, 'packages/mcp-server/dist/cli.js')], { stdio: ['pipe', 'pipe', 'ignore'] }); logPid(child.pid, 'focus-xo mcp');
let buf = ''; let id = 1; const pend = new Map();
child.stdout.on('data', (c) => { buf += c; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(l); if (pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } } catch {} } });
const call = (method, params) => new Promise((res) => { const i = id++; pend.set(i, res); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: i, method, params }) + '\n'); setTimeout(() => { if (pend.has(i)) { pend.delete(i); res({ timeout: true }); } }, 60000); });
const tool = async (name, args) => { const m = await call('tools/call', { name, arguments: args }); if (m.timeout) return { timeout: true }; const t = m.result?.content?.[0]?.text ?? ''; try { return JSON.parse(t); } catch { return { text: t.slice(0, 300), isError: m.result?.isError }; } };
await call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'a3f', version: '1' } });
child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
const sid = (await tool('browser.attach', { endpoint: obs.wsEndpoint() })).sessionId;
for (const order of ['before', 'after']) {
  for (let r = 0; r < REPS; r++) {
    const n = `${order}${r}x${Math.random().toString(36).slice(2, 6)}`;
    await tool('browser.navigate', { sessionId: sid, url: `http://127.0.0.1:${port}/main?order=${order}&n=${n}` });
    const pages = await obs.pages(); const p = pages.find((x) => x.url().includes('/main?')) ?? pages.at(-1);
    const t0 = performance.now(); while (p.frames().length < 4 && performance.now() - t0 < 8000) await delay(50);
    await delay(500);
    const f = await tool('browser.focus', { sessionId: sid, target: '#xo-in' });
    const tf = p.frames().find((x) => x.url().includes(`role=target${n}`));
    const active = tf ? await Promise.race([tf.evaluate(() => document.activeElement?.id || document.activeElement?.tagName), delay(3000).then(() => 'observer-timeout')]).catch((e) => 'observer-err ' + e.message) : 'no-target-frame';
    const parentActive = await p.evaluate(() => { const a = document.activeElement; return a ? (a.tagName + ' ' + (a.getAttribute('src') || '').replace(/^.*role=/, 'role=')) : null; }).catch((e) => 'err ' + e.message);
    const row = { parentActive, label: LABEL, order, rep: r, frameOrder: p.frames().slice(1).map((x) => new URL(x.url()).pathname + new URL(x.url()).search.slice(0, 12)), success: f.success, tier: f.verification?.evidence?.tier, error: f.error?.slice(0, 120) ?? f.text, observerActive: active };
    fs.appendFileSync(OUT, JSON.stringify(row) + '\n'); console.log(JSON.stringify(row));
    await delay(1100);
  }
}
child.kill(); await obs.close(); s1.close(); s2.close(); clearTimeout(HARD); process.exit(0);
