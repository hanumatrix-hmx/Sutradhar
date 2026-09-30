// AUDIT-2: SDK bundle, the two live leak shapes (about:blank fragment in the navigate reason, custom-scheme URL in the error).
import fs from 'node:fs/promises'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
import { here, canariesIn } from './lib.mjs';
const repo = path.resolve(here, '../../../../../..');
const sdk = await import(pathToFileURL(path.join(repo, 'packages/sutradhar/dist/index.js')).href);
const browser = await sdk.launch({ headless: true });
const out = {};
try {
  const page = (await browser.pages())[0];
  await page.goto('about:blank#CNRYsdkabout');
  try { await page.goto('com.example.app:/cb#access_token=CNRYsdkcustom'); } catch (e) { out.gotoErr = String(e.message).slice(0, 200); }
  const rep = browser.runtime.getActionHistoryReport(browser.sessionId, { scope: 'session' });
  out.leaks = canariesIn(JSON.stringify(rep));
  out.entries = rep.entries.map((e) => ({ t: e.actionType, target: e.target, error: e.error, reason: e.verification?.reason }));
  await fs.writeFile(path.join(here, 'live-sdk.json'), JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out, null, 1));
} finally { await browser.close().catch(() => {}); }
