// Auditor-2: does expect.text go unverifiable on a page with several cross-origin frames present at
// parse time when Sutradhar is the ONLY CDP client (SDK launch, no observer attached)?
// Usage: node multi-oopif-sdk.mjs <repoRoot> <outJsonl> <nFrames>
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
const [repoRoot, outFile, nArg] = process.argv.slice(2);
const N = Number(nArg ?? 3);
const sdk = await import(pathToFileURL(path.join(repoRoot, 'packages', 'sutradhar', 'dist', 'index.js')).href);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const HARD = setTimeout(() => { console.error('HARD DEADLINE'); process.exit(3); }, 12 * 60 * 1000);
let port = 0;
const handler = (req, res) => {
  const u = new URL(req.url, 'http://x');
  const send = (b) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(b); };
  if (u.pathname === '/tf') return send('<!doctype html><p>' + (u.searchParams.get('t') ?? '') + '</p>');
  if (u.pathname === '/main') {
    let fr = '';
    for (let i = 0; i < N; i++) fr += '<iframe src="http://localhost:' + port + '/tf?t=XOFRAME' + i + 'TXT&r=' + u.searchParams.get('r') + '"></iframe>';
    return send('<!doctype html><html><body><button id="noop">noop</button><p>MAINTEXTOK</p>' + fr + '</body></html>');
  }
  res.writeHead(404); res.end();
};
const s4 = http.createServer(handler); await new Promise((r) => s4.listen(0, '127.0.0.1', r)); port = s4.address().port;
const s6 = http.createServer(handler); await new Promise((r) => { s6.once('error', r); s6.listen(port, '::1', r); });
const browser = await sdk.launch({ headless: true });
const rows = [];
try {
  for (let rep = 0; rep < 6; rep++) {
    const page = await browser.newPage('http://127.0.0.1:' + port + '/main?r=' + rep);
    await delay(1500);
    for (const text of ['MAINTEXTOK', 'XOFRAME' + (N - 1) + 'TXT']) {
      let res, err;
      try { res = await page.click('#noop', { expect: { text } }); } catch (e) { err = e; }
      const r = res ?? err?.result;
      const ec = r?.verification?.evidence?.checks?.find((c) => c.check === 'expect.text');
      const row = { N, rep, text, threw: err?.name ?? null, tier: r?.verification?.evidence?.tier, outcome: ec?.outcome, detail: ec?.detail };
      rows.push(row); console.log(JSON.stringify(row));
      await delay(1100);
    }
    await page.close?.();
  }
} finally { await browser.close(); }
await fs.writeFile(outFile, rows.map((r) => JSON.stringify(r)).join(String.fromCharCode(10)) + String.fromCharCode(10));
console.log('SUMMARY unverifiable', rows.filter((r) => r.tier === 'unverifiable').length, '/', rows.length);
s4.close(); s6.close(); clearTimeout(HARD); process.exit(0);
