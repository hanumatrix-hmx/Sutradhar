// audit-3 live probe runner. Surfaces: mcp | bundle | cli | sdk (argv[2]); optional case filter argv[3] (comma list of ids).
// ROOT env selects which built tree to drive (default: this worktree). Ground truth: an INDEPENDENT pixel oracle (compositor
// screenshot of the real page, counting the token's unique colour #ff00fe) plus the construction label.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import os from 'node:os';
import { startServer } from './a3-server.mjs';
import { CASES as C1 } from './a3-cases.mjs';
import { CASES2 } from './a3-cases2.mjs';
import { CASES3 } from './a3-cases3.mjs';
import { CASES4 } from './a3-cases4.mjs';
const CASES = [...C1, ...CASES2, ...CASES3, ...CASES4];
const here = path.dirname(fileURLToPath(import.meta.url));
const WT = path.resolve(here, '../../../../../../..');
const ROOT = process.env.ROOT || WT;
const req = createRequire(path.join(WT, 'packages', 'browser', 'package.json'));
const puppeteer = req('puppeteer-core');
const { PNG } = req(path.join(WT, 'node_modules/.pnpm/pngjs@7.0.0/node_modules/pngjs'));
const surface = process.argv[2] || 'mcp';
const filter = (process.argv[3] || '').split(',').filter(Boolean);
const OUT = process.env.OUT || path.join(here, '..', `live-${surface}.jsonl`);
const PIDS = path.join(here, '..', 'pids-started.txt');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const HARD = setTimeout(() => { console.error('HARD TIMEOUT 18min'); process.exit(3); }, 18 * 60 * 1000);
const logPid = (pid, what) => fs.appendFileSync(PIDS, `${new Date().toISOString()} pid=${pid} ${what} root=${ROOT}\n`);
fs.writeFileSync(OUT, '');
const out = (o) => { fs.appendFileSync(OUT, JSON.stringify(o) + '\n'); };
const chromePath = () => {
  const r = spawnSync(process.execPath, ['-e', `import(${JSON.stringify(pathToFileURL(path.join(WT, 'packages/browser/dist/index.js')).href)}).then(m=>console.log(new m.BrowserLauncher().findExecutablePath()))`], { encoding: 'utf8' });
  return r.stdout.trim();
};
const tokOf = () => 'QA3X' + Array.from({ length: 8 }, () => 'ABCDEFGHJKLMNPRSTUVWXYZ'[Math.floor(Math.random() * 23)]).join('');
async function pixels(page) {
  const buf = await page.screenshot({ type: 'png' });
  const png = PNG.sync.read(Buffer.from(buf));
  let n = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    const r = png.data[i], g = png.data[i + 1], b = png.data[i + 2];
    if (r >= 245 && g <= 12 && b >= 244) n++;
  }
  return n;
}
function mcpClient(entry) {
  const child = spawn(process.execPath, [entry], { stdio: ['pipe', 'pipe', 'pipe'] });
  logPid(child.pid, `mcp ${entry}`);
  let buf = ''; let id = 1; const pend = new Map();
  child.stdout.on('data', (c) => {
    buf += c.toString('utf8'); let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!l) continue;
      let m; try { m = JSON.parse(l); } catch { continue; }
      if (m.id !== undefined && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); if (m.error) p.rej(new Error(JSON.stringify(m.error))); else p.res(m.result); }
    }
  });
  child.stderr.on('data', () => {});
  const call = (method, params, ms = 90000) => new Promise((res, rej) => {
    const i = id++; pend.set(i, { res, rej });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: i, method, params }) + '\n');
    setTimeout(() => { if (pend.has(i)) { pend.delete(i); rej(new Error(`timeout ${method}`)); } }, ms);
  });
  const notify = (method, params) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  const tool = async (name, args, ms) => {
    const r = await call('tools/call', { name, arguments: args }, ms);
    const t = r.content?.[0]?.text ?? ''; let j; try { j = JSON.parse(t); } catch { j = undefined; }
    return { json: j, text: t, isError: !!r.isError };
  };
  return { child, call, notify, tool };
}
function runCli(argv, env, ms = 120000) {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, [path.join(ROOT, 'packages/cli/dist/cli.js'), ...argv], { env, windowsHide: true, cwd: env.__CWD });
    logPid(c.pid, `cli ${argv[0]}`);
    let so = '', se = '';
    c.stdout.on('data', (x) => (so += x)); c.stderr.on('data', (x) => (se += x));
    const t = setTimeout(() => { try { c.kill(); } catch {} }, ms);
    c.on('close', (code) => { clearTimeout(t); resolve({ code, stdout: so.trim(), stderr: se.trim() }); });
  });
}
function grade(c, tier, verified, pxAfter) {
  const pixelApplies = c.pixel !== false && !(c.label === 'counted' && c.id.startsWith('C-'));
  const oracle = pixelApplies ? (pxAfter > 0 ? 'painted' : 'not-painted') : 'n/a';
  let verdict;
  if (c.label === 'excluded') verdict = verified === true ? 'FALSE-VERIFIED' : tier === 'contradicted' ? 'ok' : 'ok-failclosed';
  else if (c.label === 'counted') verdict = tier === 'contradicted' ? 'FALSE-CONTRADICTED' : verified === true ? 'ok' : 'unverifiable-on-rendered';
  else if (c.label === 'counted-or-unavailable') verdict = tier === 'contradicted' ? 'FALSE-CONTRADICTED' : 'ok';
  else verdict = `info:${tier}`;
  let oracleAgrees = true;
  if (pixelApplies && c.label === 'excluded') oracleAgrees = pxAfter === 0;
  if (pixelApplies && c.label === 'counted') oracleAgrees = pxAfter > 0;
  return { verdict, oracle, oracleAgrees };
}
const server = await startServer(new Map(CASES.map((c) => [c.id, c])));
const list = CASES.filter((c) => filter.length === 0 || filter.includes(c.id));
const caseUrl = (c, tok) => `${server.origin}/case?id=${encodeURIComponent(c.id)}&tok=${tok}`;
async function waitReady(p, c) {
  await p.waitForFunction(() => window.__a3ready === 1 && document.readyState === 'complete', { timeout: 60000 });
  const t0 = performance.now();
  while (p.frames().length < 1 + (c.frames || 0) && performance.now() - t0 < 8000) await delay(50);
  await delay(c.big ? 1500 : 700);
}
let observer, mcp, cliEnv, sdkBrowser, sdkPage, sdk;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'a3-obs-'));
if (surface === 'mcp' || surface === 'bundle') {
  observer = await puppeteer.launch({ executablePath: chromePath(), headless: true, userDataDir: profile, args: ['--no-sandbox'], defaultViewport: { width: 1100, height: 900 } });
  logPid(observer.process()?.pid, 'observer chrome');
  mcp = mcpClient(path.join(ROOT, surface === 'mcp' ? 'packages/mcp-server/dist/cli.js' : 'packages/sutradhar/dist/mcp-cli.js'));
  await mcp.call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'a3', version: '1' } });
  mcp.notify('notifications/initialized');
  const att = await mcp.tool('browser.attach', { endpoint: observer.wsEndpoint() });
  mcp.sessionId = att.json.sessionId;
} else if (surface === 'cli') {
  const st = fs.mkdtempSync(path.join(os.tmpdir(), 'a3-cli-state-'));
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'a3-cli-work-'));
  cliEnv = { ...process.env, SUTRADHAR_CLI_STATE_DIR: st, __CWD: work };
  cliEnv.stateDir = st;
} else {
  sdk = await import(pathToFileURL(path.join(ROOT, 'packages/sutradhar/dist/index.js')).href);
  sdkBrowser = await sdk.launch({ headless: true });
  observer = await puppeteer.connect({ browserWSEndpoint: sdkBrowser.getWsEndpoint(), defaultViewport: null });
  logPid('sdk-launched(closed via browser.close)', 'sdk chrome');
  sdkPage = (await sdkBrowser.pages())[0];
}
const obsPage = async () => { const ps = await observer.pages(); return ps.find((p) => p.url().includes('/case?id=')) ?? ps.at(-1); };
for (const c of list) {
  const tok = tokOf();
  const want = c.expect ? c.expect(tok) : tok;
  const row = { surface, id: c.id, label: c.label, tok, want };
  try {
    let res, t0, ms;
    if (surface === 'mcp' || surface === 'bundle') {
      await mcp.tool('browser.navigate', { sessionId: mcp.sessionId, url: caseUrl(c, tok) }, 120000);
      const p = await obsPage(); await waitReady(p, c);
      row.pxBefore = c.pixel === false ? null : await pixels(p);
      t0 = performance.now();
      const r = await mcp.tool('browser.click', { sessionId: mcp.sessionId, target: '#go', expect: { text: want } }, 120000);
      ms = performance.now() - t0;
      res = r.json; row.isError = r.isError; if (!res) row.raw = r.text.slice(0, 300);
      row.pxAfter = c.pixel === false ? null : await pixels(p);
      row.framesAfter = p.frames().length;
    } else if (surface === 'cli') {
      await runCli(['nav', caseUrl(c, tok)], cliEnv);
      if (!observer) { const s = JSON.parse(fs.readFileSync(path.join(cliEnv.stateDir, 'state.json'), 'utf8')); observer = await puppeteer.connect({ browserWSEndpoint: s.wsEndpoint, defaultViewport: null }); }
      const p = await obsPage(); await waitReady(p, c);
      row.pxBefore = c.pixel === false ? null : await pixels(p);
      t0 = performance.now();
      const r = await runCli(['click', '#go', '--json', '--expect-text', want], cliEnv);
      ms = performance.now() - t0;
      row.exit = r.code; try { res = JSON.parse(r.stdout); } catch { row.raw = r.stdout.slice(0, 300) + ' | ' + r.stderr.slice(0, 200); }
      row.pxAfter = c.pixel === false ? null : await pixels(p);
    } else {
      await sdkPage.goto(caseUrl(c, tok));
      const p = await obsPage(); await waitReady(p, c);
      row.pxBefore = c.pixel === false ? null : await pixels(p);
      t0 = performance.now();
      let err; try { res = await sdkPage.click('#go', { expect: { text: want } }); } catch (e) { err = e; res = e.result; }
      ms = performance.now() - t0;
      row.threw = err ? err.name : null;
      row.pxAfter = c.pixel === false ? null : await pixels(p);
    }
    const v = res?.verification;
    row.ms = Math.round(ms);
    row.success = res?.success; row.verified = v?.verified; row.tier = v?.evidence?.tier;
    row.expectCheck = v?.evidence?.checks?.find((x) => x.check === 'expect.text');
    Object.assign(row, grade(c, row.tier, row.verified, row.pxAfter));
    if (surface === 'cli') row.exitOk = row.verified === true ? row.exit === 0 : row.tier === 'contradicted' ? row.exit === 4 : true;
    if (surface === 'sdk') row.throwOk = row.verified === true ? row.threw === null : row.threw === 'ExpectationFailedError';
  } catch (e) { row.error = String(e.message || e).slice(0, 300); row.verdict = 'ERROR'; }
  out(row);
  console.log(`[${surface}] ${row.verdict} ${c.id} tier=${row.tier} px=${row.pxBefore}->${row.pxAfter} ${row.ms}ms ${row.oracleAgrees === false ? 'ORACLE-DISAGREES' : ''} ${row.exitOk === false || row.throwOk === false ? 'SURFACE-MISMATCH' : ''} ${row.error || ''}`);
  await delay(1100);
}
try { if (mcp) mcp.child.kill(); } catch {}
try { if (surface === 'cli') { await observer?.disconnect(); await runCli(['close'], cliEnv); } } catch {}
try { if (sdkBrowser) { await observer.disconnect(); await sdkBrowser.close(); } } catch {}
try { if (surface === 'mcp' || surface === 'bundle') await observer.close(); } catch {}
server.close(); clearTimeout(HARD);
const rows = fs.readFileSync(OUT, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const tally = {}; for (const r of rows) tally[r.verdict] = (tally[r.verdict] || 0) + 1;
console.log('SUMMARY', surface, JSON.stringify(tally), 'oracleDisagree=', rows.filter((r) => r.oracleAgrees === false).map((r) => r.id).join(','));
process.exit(0);
