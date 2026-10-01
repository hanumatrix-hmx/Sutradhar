// AUDIT-1 privacy canary probe, SDK bundle (packages/sutradhar/dist/index.js); history read through browser.runtime (G-A: no public SDK API).
import fs from 'node:fs/promises'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
import { here, startServer, canariesIn } from './lib.mjs';
const repo = path.resolve(here, '../../../../../..');
const sdk = await import(pathToFileURL(path.join(repo, 'packages/sutradhar/dist/index.js')).href);
const srv = await startServer();
const browser = await sdk.launch({ headless: true });
const out = {};
try {
  const page = (await browser.pages())[0];
  await page.goto(`http://sdk:CNRYsdkpass@127.0.0.1:${srv.port}/p?token=CNRYsdkq#CNRYsdkfrag`);
  await page.type('#pw', 'CNRYsdktype');
  out.evalResult = await page.evaluate("document.getElementById('pw').value");
  try { await page.type('#mangle', 'CNRYsdkmangle'); } catch (e) { out.mangleErr = String(e.message).slice(0, 120); }
  await page.goto(`http://127.0.0.1:${srv.port}/p?ids[]=1&token=CNRYsdkbracket`);
  const rep = browser.runtime.getActionHistoryReport(browser.sessionId, { scope: 'session' });
  const text = JSON.stringify(rep);
  out.leaks = canariesIn(text);
  out.types = rep.entries.map((e) => e.actionType + ':' + e.success);
  out.bracketReason = rep.entries.at(-1)?.verification?.reason;
  await fs.writeFile(path.join(here, 'privacy-sdk.json'), JSON.stringify({ out, rep }, null, 1));
  console.log(JSON.stringify(out, null, 1));
} finally { await browser.close().catch(() => {}); await srv.close(); }
