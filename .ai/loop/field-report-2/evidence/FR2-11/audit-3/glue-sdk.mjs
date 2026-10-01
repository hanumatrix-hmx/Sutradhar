// AUDIT-3 SDK bundle repro of A3-F1 (second URL's userinfo in a whitespace-free token is stored).
import fs from 'node:fs/promises'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
import { here, startServer } from './lib.mjs';
const repo = path.resolve(here, '../../../../../..');
const sdk = await import(pathToFileURL(path.join(repo, 'packages/sutradhar/dist/index.js')).href);
const srv = await startServer();
const browser = await sdk.launch({ headless: true });
try {
  const page = (await browser.pages())[0];
  await page.goto(srv.origin + '/p');
  try { await page.evaluate("throw new Error(JSON.stringify({api:'https://h.test/x',db:'postgres://admin:A3Csdkgluepw@db:5432/app'}))"); } catch (e) { /* caller sees the raw error */ }
  const rep = browser.runtime.getActionHistoryReport(browser.sessionId, { scope: 'session' });
  const s = JSON.stringify(rep);
  const out = { leak: /A3Csdkgluepw/.test(s), stored: rep.entries.map((e) => [e.actionType, e.target, e.error]) };
  await fs.writeFile(path.join(here, 'glue-sdk.json'), JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out));
} finally { await browser.close().catch(() => {}); await srv.close(); }
