// Auditor-2 control: raw puppeteer-core (no Sutradhar) on the same 8-cross-origin-frame page.
// Per frame: does frame.evaluate answer within 1500 ms? Also: which frames hang, and does the main frame answer?
// Usage: node multi-oopif-raw.mjs <repoRoot> <outJsonl> <nFrames>
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const [repoRoot, outFile, nArg] = process.argv.slice(2);
const N = Number(nArg ?? 8);
const require_ = createRequire(path.join(repoRoot, 'packages', 'browser', 'package.json'));
const puppeteer = require_('puppeteer-core');
const { BrowserLauncher } = await import(pathToFileURL(path.join(repoRoot, 'packages', 'browser', 'dist', 'index.js')).href);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const HARD = setTimeout(() => { console.error('HARD DEADLINE'); process.exit(3); }, 10 * 60 * 1000);
let port = 0;
const handler = (req, res) => {
  const u = new URL(req.url, 'http://x');
  const send = (b) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(b); };
  if (u.pathname === '/tf') return send('<!doctype html><p>' + (u.searchParams.get('t') ?? '') + '</p>');
  if (u.pathname === '/main') { let fr = ''; for (let i = 0; i < N; i++) fr += '<iframe src="http://localhost:' + port + '/tf?t=XOFRAME' + i + 'TXT&r=' + u.searchParams.get('r') + '"></iframe>'; return send('<!doctype html><html><body><p>MAINTEXTOK</p>' + fr + '</body></html>'); }
  res.writeHead(404); res.end();
};
const s4 = http.createServer(handler); await new Promise((r) => s4.listen(0, '127.0.0.1', r)); port = s4.address().port;
const s6 = http.createServer(handler); await new Promise((r) => { s6.once('error', r); s6.listen(port, '::1', r); });
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'fr207-a2-raw-'));
const b = await puppeteer.launch({ executablePath: new BrowserLauncher().findExecutablePath(), headless: true, userDataDir: profile });
console.log('PIDS', JSON.stringify({ chrome: b.process()?.pid, self: process.pid }));
const rows = [];
for (let rep = 0; rep < 6; rep++) {
  const p = await b.newPage();
  await p.goto('http://127.0.0.1:' + port + '/main?r=' + rep, { waitUntil: 'load' });
  await delay(1500);
  const res = await Promise.all(p.frames().map(async (f) => {
    const t0 = performance.now();
    const r = await Promise.race([f.evaluate(() => document.body.innerText.slice(0, 20)).then((x) => 'ok:' + x).catch((e) => 'err:' + e.message.slice(0, 60)), delay(1500).then(() => 'HANG')]);
    return { main: f === p.mainFrame(), oopif: f.isOOPFrame?.(), r, ms: Math.round(performance.now() - t0) };
  }));
  const row = { rep, frames: res.length, hung: res.filter((x) => x.r === 'HANG').length, mainOk: res.find((x) => x.main)?.r?.startsWith('ok'), detail: res.map((x) => x.r).join(' | ') };
  rows.push(row); console.log(JSON.stringify(row).slice(0, 400));
  await p.close();
}
await fs.writeFile(outFile, rows.map((r) => JSON.stringify(r)).join(String.fromCharCode(10)) + String.fromCharCode(10));
await b.close(); s4.close(); s6.close(); await fs.rm(profile, { recursive: true, force: true }).catch(() => {});
clearTimeout(HARD); process.exit(0);
