// AUDIT-4 SDK bundle check of F1 / F2 (packages/sutradhar/dist/index.js; history via browser.runtime.getActionHistoryReport, G-A).
import fs from 'node:fs/promises'; import path from 'node:path'; import http from 'node:http'; import { pathToFileURL } from 'node:url';
import { here, repo, can } from './lib4.mjs';
const sdk = await import(pathToFileURL(path.join(repo, 'packages/sutradhar/dist/index.js')).href);
const server = http.createServer((q, s) => s.writeHead(200, { 'content-type': 'text/html' }).end('<title>s4</title><p>x</p>'));
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port; const O = 'http://127.0.0.1:' + port;
const browser = await sdk.launch({ headless: true });
const out = {};
try {
  const page = (await browser.pages())[0];
  await page.goto(O + '/p?pw=P%40ssA4Csdknav1x');
  try { await page.evaluate("throw new Error('PGPASSWORD=Sup3r@A4Csdkerr2x')"); } catch (e) { out.callerErr = can(e.message); }
  await page.goto('http://admin:pa%3FA4Usdkui3x@127.0.0.1:' + port + '/p');
  await page.goto(O + '/p?token=A4Xsdkctl4x');
  const rep = browser.runtime.getActionHistoryReport(browser.sessionId, { scope: 'session' });
  out.historyCanaries = can(JSON.stringify(rep));
  out.entries = rep.entries.map((e) => [e.actionType, e.target, e.url, e.error, e.verification?.reason]);
} finally { await browser.close().catch(() => {}); server.close(); }
await fs.writeFile(path.join(here, 'sdk4.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
