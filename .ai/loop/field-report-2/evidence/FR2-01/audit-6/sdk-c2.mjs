// FR2-01 audit-6: C2 on the SDK surface (packages/sutradhar/dist). #x hidden in the main frame, a VISIBLE #x
// inside a cross-site iframe that is then made busy. The SDK's Page.waitForSelector throws r.error verbatim.
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../../../..');
const require_ = createRequire(path.join(repoRoot, 'packages', 'browser', 'package.json'));
const puppeteer = require_('puppeteer-core');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const BUSY = `<script>window.__busy=(ms)=>{const t=Date.now();while(Date.now()-t<ms){}};</script>`;
const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'text/html');
  const port = server.address().port;
  if (req.url.startsWith('/framex')) return res.end(`<div id="x">visible x inside iframe</div>${BUSY}`);
  return res.end(`<div id="x" style="display:none">hidden x in main</div><iframe src="http://localhost:${port}/framex"></iframe>`);
});
await new Promise((r) => server.listen(0, '0.0.0.0', r));
const port = server.address().port;
const sdk = await import(pathToFileURL(path.join(repoRoot, 'packages', 'sutradhar', 'dist', 'index.js')));
const browser = await sdk.launch({ headless: true });
const out = [];
try {
  const page = (await browser.pages())[0];
  const observer = await puppeteer.connect({ browserWSEndpoint: browser.getWsEndpoint() });
  for (const timeout of [1000, 0]) {
    await page.goto(`http://127.0.0.1:${port}/c2a?n=${Math.random()}`);
    await delay(600);
    const op = (await observer.pages()).find((p) => p.url().includes('/c2a'));
    const f = op.frames().find((x) => x.url().includes('/framex'));
    const truthIframeVisible = await f.evaluate(() => { const e = document.querySelector('#x'); const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    await f.evaluate(() => { setTimeout(() => window.__busy(12000), 0); });
    await delay(80);
    let err;
    try { await page.waitForSelector('#x', { state: 'visible', timeout }); } catch (e) { err = e.message; }
    out.push({ surface: 'sdk', timeout, truthIframeHasVisibleX: truthIframeVisible, error: err, falseNoneVisible: /none is visible/.test(err ?? '') });
    console.log(JSON.stringify(out[out.length - 1]));
    await delay(12500);
  }
  await observer.disconnect();
} finally {
  fs.writeFileSync(path.join(here, 'sdk-c2-results.json'), JSON.stringify(out, null, 2));
  await browser.close().catch(() => {});
  server.close();
}
process.exit(0);
