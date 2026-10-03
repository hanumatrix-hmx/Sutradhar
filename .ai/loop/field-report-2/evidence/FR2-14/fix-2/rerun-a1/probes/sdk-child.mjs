// AUDIT-1 SDK child: runs in cwd = <proj>/a/b. argv: <sdkIndexJs> <port> <mode> <S> <tempMarker>
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromePids } from './procs.mjs';
const [, , SDK, PORT, MODE, S, TEMP] = process.argv;
const { launch } = await import(pathToFileURL(SDK).href);
const url = (h, c) => 'http://' + h + ':' + PORT + '/p?c=' + encodeURIComponent(c);
const out = { mode: MODE, nav: {}, warns: [] };
const ow = console.warn; console.warn = (...a) => { out.warns.push(a.join(' ').slice(0, 300)); };
const opt = {
  allowedDomains: ['127.0.0.2'], viewport: { width: 401, height: 301 }, allowedDownloadRoots: [path.join(S, 'optdl')],
  allowedUploadRoots: [path.join(S, 'optup')], dialogPolicy: { mode: 'dismiss' }, idleTimeoutMs: 0,
};
let o;
if (MODE === 'none' || MODE === 'config') o = { discoverConfig: true };
else if (MODE === 'option' || MODE === 'option+config') o = { discoverConfig: true, ...opt };
else if (MODE === 'optin-off') o = {};
else if (MODE === 'explicit') o = { configFile: path.join(S, 'explicit', 'cfg.json') };
else if (MODE === 'both') o = { configFile: 'x.json', discoverConfig: true };
else if (MODE === 'env-ignored') o = { discoverConfig: true };
else if (MODE === 'report-option') o = { dialogPolicy: { mode: 'report' } };
let browser;
try {
  browser = await launch(o);
  const pages = await browser.pages(); const page = pages[0] ?? (await browser.newPage());
  for (const h of ['127.0.0.2', '127.0.0.3', '127.0.0.4', '127.0.0.5']) {
    try { await page.goto(url(h, MODE + '-h' + h)); out.nav[h] = 'ok'; } catch (e) { out.nav[h] = 'ERR ' + String(e.message).slice(0, 120); }
  }
  const winner = { option: '127.0.0.2', 'option+config': '127.0.0.2', config: '127.0.0.4', 'env-ignored': '127.0.0.4', explicit: '127.0.0.3' }[MODE] ?? '127.0.0.5';
  out.winner = winner;
  await page.goto(url(winner, MODE + '-main'));
  if (['option', 'config', 'option+config'].includes(MODE)) {
    const t = Date.now();
    try { await Promise.race([page.click('#pr'), new Promise((_, r) => setTimeout(() => r(new Error('click>45s')), 45000))]); out.click = 'ok'; } catch (e) { out.click = 'ERR ' + e.message.slice(0, 100); }
    out.clickMs = Date.now() - t;
  }
  try { const d = await page.download('#dl'); out.download = d.path ?? d.savedPath ?? d.filePath ?? JSON.stringify(d).slice(0, 300); } catch (e) { out.download = 'ERR ' + e.message.slice(0, 200); }
  out.up = {};
  for (const [k, f] of [['e', path.join(S, 'optup', 'e.txt')], ['c', path.join(S, 'proj', 'cup', 'c.txt')], ['o', path.join(S, 'other', 'o.txt')]]) {
    await new Promise((r) => setTimeout(r, 1300)); try { await page.uploadFile('#f', f); out.up[k] = 'ok'; } catch (e) { out.up[k] = 'ERR ' + e.message.slice(0, 100); }
  }
  if (['none', 'config', 'option', 'option+config'].includes(MODE)) {
    out.pidsBefore = (await chromePids(TEMP))?.length;
    const end = Date.now() + (MODE === 'config' ? 50000 : 35000); let gone = false;
    while (Date.now() < end) { const p = await chromePids(TEMP); if (p && p.length === 0) { gone = true; break; } await new Promise((r) => setTimeout(r, 500)); }
    out.reaped = gone;
  }
} catch (e) { out.error = (e.name || '') + ': ' + String(e.message).slice(0, 300); }
finally { try { await browser?.close(); } catch {} }
console.warn = ow;
console.log('RESULT ' + JSON.stringify(out));
process.exit(0);
