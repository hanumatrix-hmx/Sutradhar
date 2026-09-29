import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..', '..', '..', '..');
const CLI = path.join(repoRoot, 'packages/cli/dist/cli.js');
const puppeteer = createRequire(path.join(repoRoot, 'packages/browser/package.json'))('puppeteer-core');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const R = await fs.mkdtemp(path.join(os.tmpdir(), 'fr2-04-g230dbg5-'));
const STATE_ROOT = path.join(R, 'state-root');
const TEMP_ROOT = path.join(R, 'temp');
await fs.mkdir(STATE_ROOT, { recursive: true });
await fs.mkdir(TEMP_ROOT, { recursive: true });

function cli(args, caseDir, { capMs = 90000 } = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn(process.execPath, [CLI, ...args], {
      env: { ...process.env, TEMP: TEMP_ROOT, TMP: TEMP_ROOT, SUTRADHAR_CLI_STATE_DIR: caseDir },
      stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    let out = '', err = '', killed = false;
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    const cap = setTimeout(() => { killed = true; child.kill('SIGKILL'); }, capMs);
    child.on('exit', (code) => { clearTimeout(cap); resolve({ args, code, ms: Date.now() - t0, killedAtCap: killed, stdout: out, stderr: err }); });
  });
}
async function readState(caseDir) { try { return JSON.parse(await fs.readFile(path.join(caseDir, 'state.json'), 'utf-8')); } catch { return undefined; } }
async function connectObserver(ws) { return puppeteer.connect({ browserWSEndpoint: ws, defaultViewport: null }); }
async function waitForTarget(browser, marker, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const t = browser.targets().find((x) => x.type() === 'page' && x.url().includes(marker));
    if (t) return t;
    await delay(100);
  }
  throw new Error('not found');
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/pop') {
    res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
    res.end(`<!doctype html><title>pop</title><script>alert('gap230-${u.searchParams.get('n')}')</script>pop`);
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
  res.end('<!doctype html><title>opener</title>opener');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;
const popupBase = `http://127.0.0.1:${server.address().port}/pop?n=`;

const caseDir = path.join(STATE_ROOT, 'GAP230');
try {
  const n = 'g230dbg5';
  await cli(['nav', `${BASE}?n=${n}`], caseDir);
  const st = await readState(caseDir);
  const obs = await connectObserver(st.wsEndpoint);
  const opener = await waitForTarget(obs, n);
  const os_ = await opener.createCDPSession();
  await os_.send('Runtime.evaluate', { expression: `void window.open('${popupBase}${n}')`, userGesture: true }).catch(() => {});
  await delay(800);
  const acc = await cli(['dialog', 'accept'], caseDir, { capMs: 20000 });
  console.log('accept', acc.code, acc.ms, acc.stdout.trim());
  const tabsAfter = await cli(['tabs'], caseDir, { capMs: 20000 });
  console.log('tabs', tabsAfter.code, tabsAfter.ms, tabsAfter.killedAtCap);
  console.log('tabs STDOUT:', tabsAfter.stdout);
  console.log('tabs STDERR:', tabsAfter.stderr);
  await obs.disconnect().catch(() => {});
  await cli(['close'], caseDir, { capMs: 20000 }).catch(() => {});
} finally {
  server.close();
  // cleanup best-effort skipped in this debug script
  await fs.rm(R, { recursive: true, force: true }).catch(() => {});
}
