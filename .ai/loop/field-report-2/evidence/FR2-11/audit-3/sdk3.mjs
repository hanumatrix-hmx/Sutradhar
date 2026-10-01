// AUDIT-3 SDK bundle probe (packages/sutradhar/dist/index.js); history via browser.runtime (no public SDK history API, G-A).
import fs from 'node:fs/promises'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
import { here, startServer } from './lib.mjs';
const repo = path.resolve(here, '../../../../../..');
const sdk = await import(pathToFileURL(path.join(repo, 'packages/sutradhar/dist/index.js')).href);
const can = (t) => [...new Set((String(t).match(/a3[cld][a-z0-9]+/gi) ?? []).map((x) => x.toLowerCase()))];
const srv = await startServer();
const browser = await sdk.launch({ headless: true });
const out = {};
try {
  const page = (await browser.pages())[0];
  await page.goto('http://u:A3Csdkui@127.0.0.1:' + srv.port + '/p?token=A3Csdkq#A3Csdkf');
  await page.goto('http://127.0.0.1:' + srv.port + '/p%3Fx%3DA3Csdkenc');
  try { await page.goto('com.example.app:/cb#A3Csdkcs'); } catch (e) { out.csErr = can(e.message); }
  try { await page.goto('about:blank#A3Csdkab'); } catch (e) { out.abErr = can(e.message); }
  await page.goto('http://127.0.0.1:' + srv.port + '/p');
  out.evalReturned = can(await page.evaluate("'A3Csdk' + 'res1'"));
  try { await page.evaluate("throw new Error('Bearer A3Lsdkbear x;A3Csdkerr')"); } catch (e) { out.evalErrCaller = can(e.message); }
  try { await page.click('a[href="/p?c=A3Csdksel"]', { timeoutMs: 1500 }); } catch (e) { out.clickErrCaller = can(e.message); }
  await page.type('#pw', 'A3Csdktyped');
  const rep = browser.runtime.getActionHistoryReport(browser.sessionId, { scope: 'session' });
  const all = can(JSON.stringify(rep));
  out.historyClaim = all.filter((x) => x.startsWith('a3c'));
  out.historyLimit = all.filter((x) => x.startsWith('a3l'));
  out.entries = rep.entries.map((e) => [e.actionType, e.success, e.target ?? e.selector, e.error?.slice(0, 80), e.verification?.reason?.slice(0, 90)]);
  await fs.writeFile(path.join(here, 'sdk3.json'), JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out, null, 1));
} finally { await browser.close().catch(() => {}); await srv.close(); }
