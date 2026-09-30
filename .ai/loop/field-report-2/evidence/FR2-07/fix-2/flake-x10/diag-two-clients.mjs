// diagnostic (GAP-325): two CDP clients on one Chrome (A launched it = the harness observer; B connected later = the product
// "browser.attach"). B navigates a page with N parse-time cross-origin frames. Per client, per frame: does evaluate answer
// within 3 s, and does a hung frame recover later? Usage: node diag-two-clients.mjs <repoRoot> <N> <reps>
import fs from 'node:fs/promises'; import os from 'node:os'; import path from 'node:path'; import http from 'node:http';
import { createRequire } from 'node:module'; import { pathToFileURL } from 'node:url';
const repoRoot = process.argv[2]; const N = Number(process.argv[3] ?? 8); const REPS = Number(process.argv[4] ?? 5);
const require_ = createRequire(path.join(repoRoot, 'packages', 'browser', 'package.json'));
const puppeteer = require_('puppeteer-core');
const { BrowserLauncher } = await import(pathToFileURL(path.join(repoRoot, 'packages', 'browser', 'dist', 'index.js')).href);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const HARD = setTimeout(() => process.exit(3), 600000);
let port = 0;
const handler = (req, res) => { const u = new URL(req.url, 'http://x'); const send = (b) => { res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }); res.end(b); };
  if (u.pathname === '/tf') return send('<!doctype html><p>' + u.searchParams.get('t') + '</p>');
  if (u.pathname === '/main') { let fr = ''; for (let i = 0; i < N; i++) fr += '<iframe src="http://localhost:' + port + '/tf?t=F' + i + '&r=' + u.searchParams.get('r') + '"></iframe>'; return send('<!doctype html><body><p>MAIN</p>' + fr); }
  res.writeHead(404); res.end(); };
const s4 = http.createServer(handler); await new Promise((r) => s4.listen(0, '127.0.0.1', r)); port = s4.address().port;
const s6 = http.createServer(handler); await new Promise((r) => { s6.once('error', r); s6.listen(port, '::1', r); });
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'fr207-diag2-'));
const A = await puppeteer.launch({ executablePath: new BrowserLauncher().findExecutablePath(), headless: true, userDataDir: profile });
const B = await puppeteer.connect({ browserWSEndpoint: A.wsEndpoint(), defaultViewport: null });
console.log('chrome pid', A.process()?.pid);
const probe = async (page) => Promise.all(page.frames().filter((f) => f !== page.mainFrame()).map(async (f, i) => {
  const r = await Promise.race([f.evaluate(() => document.body.innerText).then(() => 'ok', () => 'err'), delay(3000).then(() => 'HANG')]); return r === 'ok' ? '.' : 'H'; }));
for (let rep = 0; rep < REPS; rep++) {
  const bp = (await B.pages())[0];
  await bp.goto('http://127.0.0.1:' + port + '/main?r=' + rep, { waitUntil: 'domcontentloaded' });
  await delay(1500);
  const ap = (await A.pages()).find((p) => p.url().includes('/main?r=' + rep));
  const [a1, b1] = await Promise.all([probe(ap), probe(bp)]);
  // alternatives on A's silent frames: raw CDP Runtime.evaluate WITHOUT a contextId (session-default context), isolated realm
  const alt = [];
  for (const f of ap.frames().filter((x) => x !== ap.mainFrame())) {
    const std = await Promise.race([f.evaluate(() => 1).then(() => 'ok', () => 'err'), delay(1500).then(() => 'HANG')]);
    if (std !== 'HANG') continue;
    const raw = await Promise.race([f.client.send('Runtime.evaluate', { expression: 'document.body.innerText', returnByValue: true }).then((r) => 'raw-ok:' + JSON.stringify(r.result?.value ?? r.exceptionDetails?.text), (e) => 'raw-err:' + e.message.slice(0, 40)), delay(3000).then(() => 'raw-HANG')]);
    const iso = await Promise.race([f.isolatedRealm().evaluate(() => document.body.innerText).then((v) => 'iso-ok:' + v, (e) => 'iso-err'), delay(3000).then(() => 'iso-HANG')]);
    alt.push(f.url().slice(-8) + ' ' + raw + ' ' + iso);
  }
  console.log('   alternatives on hung frames:', alt.join(' || ') || '(none hung)');
  await delay(3000);
  const [a2, b2] = await Promise.all([probe(ap), probe(bp)]);
  console.log('rep', rep, 'A(observer)@1.5s', a1.join(''), '@+8s', a2.join(''), '| B(product)@1.5s', b1.join(''), '@+8s', b2.join(''));
}
await B.disconnect(); await A.close(); s4.close(); s6.close(); await fs.rm(profile, { recursive: true, force: true }).catch(() => {}); clearTimeout(HARD); process.exit(0);
