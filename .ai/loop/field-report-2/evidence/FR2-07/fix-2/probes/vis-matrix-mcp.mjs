// Auditor-2: visibility attack matrix for expect.text over the BUILT MCP server (stdio; production path),
// attached to a puppeteer-launched Chrome that also serves as an independent observer.
// Usage: node vis-matrix-mcp.mjs <repoRoot> <outJsonl> [--server=<mcp entry>] [--only=id1,id2]
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { startVisServer, cases } from './vis-server.mjs';

const repoRoot = process.argv[2];
const outFile = process.argv[3];
const serverArg = process.argv.find((a) => a.startsWith('--server='));
const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const only = onlyArg ? onlyArg.slice(7).split(',') : null;
const serverPath = serverArg ? serverArg.slice(9) : path.join(repoRoot, 'packages', 'mcp-server', 'dist', 'cli.js');
const require_ = createRequire(path.join(repoRoot, 'packages', 'browser', 'package.json'));
const puppeteer = require_('puppeteer-core');
const browserDist = await import(pathToFileURL(path.join(repoRoot, 'packages', 'browser', 'dist', 'index.js')).href);
const chromePath = process.env.CHROME_PATH || new browserDist.BrowserLauncher().findExecutablePath();
const inPage = browserDist.visibleTextContainsInPage;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const HARD = setTimeout(() => { console.error('HARD DEADLINE 18 min'); process.exit(3); }, 18 * 60 * 1000);
const race = (p, ms) => Promise.race([p, delay(ms).then(() => 'TIMEOUT')]);

function mcpClient(env) {
  const child = spawn(process.execPath, [serverPath], { stdio: ['pipe', 'pipe', 'pipe'], env });
  let buf = ''; let next = 1; const pend = new Map();
  child.stdout.on('data', (c) => {
    buf += c.toString('utf8'); let i;
    while ((i = buf.indexOf(String.fromCharCode(10))) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue; let m; try { m = JSON.parse(line); } catch { continue; }
      if (m.id !== undefined && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
    }
  });
  child.stderr.on('data', () => {});
  const call = (method, params, t = 90000) => new Promise((res, rej) => {
    const id = next++; pend.set(id, { res, rej });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + String.fromCharCode(10));
    setTimeout(() => { if (pend.has(id)) { pend.delete(id); rej(new Error('timeout ' + method)); } }, t);
  });
  return { child, call, notify: (m, p) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: m, params: p }) + String.fromCharCode(10)) };
}

const srv = await startVisServer();
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'fr207-a2-obs-'));
const observer = await puppeteer.launch({ executablePath: chromePath, headless: true, userDataDir: profile, args: ['--no-sandbox'], defaultViewport: { width: 1000, height: 800 } });
const mcp = mcpClient({ ...process.env });
console.log('PIDS', JSON.stringify({ chrome: observer.process()?.pid, mcp: mcp.child.pid, self: process.pid, server: serverPath }));
await mcp.call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'fr207-auditor-2', version: '1' } });
mcp.notify('notifications/initialized');
const attach = JSON.parse((await mcp.call('tools/call', { name: 'browser.attach', arguments: { endpoint: observer.wsEndpoint() } })).content[0].text);
const sessionId = attach.sessionId;
const tool = async (name, a = {}) => { const r = await mcp.call('tools/call', { name, arguments: { sessionId, ...a } }); let j; try { j = JSON.parse(r.content[0].text); } catch { j = undefined; } return { j, isError: !!r.isError, text: r.content?.[0]?.text }; };

const rows = [];
let idx = 0;
for (const [id, want, , expOverride] of cases(srv.xo)) {
  idx++;
  if (only && !only.includes(id)) continue;
  const tok = 'QZ' + String(idx).padStart(2, '0') + 'VXKWRT' + Math.random().toString(36).slice(2, 6).toUpperCase();
  const expectText = expOverride ? expOverride(tok) : tok;
  const url = srv.origin + '/case?id=' + id + '&tok=' + tok;
  try {
    await delay(1100);
    const nav = await tool('browser.navigate', { url });
    const pages = await observer.pages();
    const p = pages.find((x) => x.url() === url);
    if (p) {
      await race(p.waitForFunction(() => window.__ready === 1, { timeout: 8000 }), 9000);
      await delay(700);
    }
    const fl = [];
    if (p) for (const f of p.frames()) {
      const r = await race(f.evaluate(inPage, expectText).catch((e) => 'ERR:' + String(e.message).slice(0, 80)), 2500);
      fl.push({ url: f.url().slice(0, 60), oopif: typeof f.isOOPFrame === 'function' ? f.isOOPFrame() : undefined, r });
    }
    const t0 = performance.now();
    const { j, isError, text } = await tool('browser.click', { target: '#noop', expect: { text: expectText } });
    const ms = Math.round(performance.now() - t0);
    const v = j?.verification;
    const ec = v?.evidence?.checks?.find((c) => c.check === 'expect.text');
    const verified = v?.verified;
    const pass = want === 'hidden' ? verified !== true : want === 'visible' ? verified === true : true;
    const row = { id, want, pass, falseVerified: want === 'hidden' && verified === true, falseNegative: want === 'visible' && verified !== true, success: j?.success, isError, verified, tier: v?.evidence?.tier, expectOutcome: ec?.outcome, expectDetail: ec?.detail, reason: v?.reason?.slice(0, 220), ms, navTier: nav.j?.verification?.evidence?.tier, functionLevel: fl, errText: isError ? text?.slice(0, 200) : undefined };
    rows.push(row);
    console.log((want === 'info' ? 'INFO' : pass ? 'PASS' : 'FAIL') + ' ' + id + ' want=' + want + ' verified=' + verified + ' tier=' + row.tier + ' expect=' + row.expectOutcome + ' ms=' + ms + ' fl=' + JSON.stringify(fl.map((x) => x.r)) + (row.expectDetail ? ' detail=' + row.expectDetail : ''));
  } catch (e) {
    rows.push({ id, want, pass: false, error: String(e?.message ?? e).slice(0, 300) });
    console.log('ERROR ' + id + ' ' + String(e?.message ?? e).slice(0, 200));
  }
}
await fs.writeFile(outFile, rows.map((r) => JSON.stringify(r)).join(String.fromCharCode(10)) + String.fromCharCode(10));
const scored = rows.filter((r) => r.want !== 'info');
console.log('SUMMARY scored', scored.filter((r) => r.pass).length, '/', scored.length, 'falseVerified', JSON.stringify(rows.filter((r) => r.falseVerified).map((r) => r.id)), 'falseNegative', JSON.stringify(rows.filter((r) => r.falseNegative).map((r) => r.id)));
try { await tool('browser.shutdown', {}); } catch {}
mcp.child.stdin.end(); await delay(500); try { mcp.child.kill(); } catch {}
await observer.close(); await srv.close();
await fs.rm(profile, { recursive: true, force: true }).catch(() => {});
clearTimeout(HARD); process.exit(0);
