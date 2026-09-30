// diagnostic: with N cross-origin frames at parse time, which step hangs: frameElement() or frame.evaluate()?
import fs from 'node:fs/promises'; import os from 'node:os'; import path from 'node:path'; import http from 'node:http';
import { createRequire } from 'node:module'; import { pathToFileURL } from 'node:url';
const repoRoot = process.argv[2]; const N = Number(process.argv[3] ?? 8);
const require_ = createRequire(path.join(repoRoot, 'packages', 'browser', 'package.json'));
const puppeteer = require_('puppeteer-core');
const { BrowserLauncher } = await import(pathToFileURL(path.join(repoRoot, 'packages', 'browser', 'dist', 'index.js')).href);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const HARD = setTimeout(() => process.exit(3), 240000);
let port = 0;
const handler = (req, res) => { const u = new URL(req.url, 'http://x'); const send = (b) => { res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }); res.end(b); };
  if (u.pathname === '/tf') return send('<!doctype html><p>' + u.searchParams.get('t') + '</p>');
  if (u.pathname === '/main') { let fr = ''; for (let i = 0; i < N; i++) fr += '<iframe src="http://localhost:' + port + '/tf?t=F' + i + '&r=' + u.searchParams.get('r') + '"></iframe>'; return send('<!doctype html><body><p>MAIN</p>' + fr); }
  res.writeHead(404); res.end(); };
const s4 = http.createServer(handler); await new Promise((r) => s4.listen(0, '127.0.0.1', r)); port = s4.address().port;
const s6 = http.createServer(handler); await new Promise((r) => { s6.once('error', r); s6.listen(port, '::1', r); });
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'fr207-diag-'));
const b = await puppeteer.launch({ executablePath: new BrowserLauncher().findExecutablePath(), headless: true, userDataDir: profile });
console.log('chrome pid', b.process()?.pid);
for (let rep = 0; rep < 4; rep++) {
  const p = await b.newPage();
  await p.goto('http://127.0.0.1:' + port + '/main?r=' + rep, { waitUntil: 'load' });
  const rows = await Promise.all(p.frames().filter((f) => f !== p.mainFrame()).map(async (f, i) => {
    const t0 = performance.now(); const race = (pr) => Promise.race([pr.then(() => 'ok', (e) => 'err:' + e.message.slice(0, 40)), delay(3000).then(() => 'HANG')]);
    const fe = await race(f.frameElement()); const t1 = performance.now();
    const ev = await race(f.evaluate(() => document.body.innerText)); const t2 = performance.now();
    return `${i}:fe=${fe}(${Math.round(t1 - t0)}ms) ev=${ev}(${Math.round(t2 - t1)}ms)`;
  }));
  console.log('rep', rep, rows.join(' | '));
  await p.close();
}
await b.close(); s4.close(); s6.close(); await fs.rm(profile, { recursive: true, force: true }).catch(() => {}); clearTimeout(HARD); process.exit(0);
