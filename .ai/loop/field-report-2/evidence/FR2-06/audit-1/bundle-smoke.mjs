// FR2-06 audit-1: bundle smoke (spec §5 "Bundle smoke", skipped by the Executor) against the
// freshly rebuilt packages/sutradhar/dist/mcp-cli.js (esbuild output).
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..', '..', '..', '..');
const FIXTURE_URL = pathToFileURL(path.join(here, 'fixture-audit.html')).href;
const req = createRequire(path.join(repoRoot, 'packages', 'browser', 'package.json'));
const puppeteer = req('puppeteer-core');
const { BrowserLauncher } = await import(pathToFileURL(path.join(repoRoot, 'packages', 'browser', 'dist', 'index.js')));
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'fr2-06-audit1-bundle-'));
const observer = await puppeteer.launch({ executablePath: new BrowserLauncher().findExecutablePath(), headless: true, userDataDir: profile, args: ['--no-sandbox'] });
const child = spawn(process.execPath, [path.join(repoRoot, 'packages', 'sutradhar', 'dist', 'mcp-cli.js')], { stdio: ['pipe', 'pipe', 'pipe'] });
let buf = '';
let id = 1;
const pending = new Map();
child.stdout.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const l = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    try {
      const m = JSON.parse(l);
      if (pending.has(m.id)) (pending.get(m.id)(m), pending.delete(m.id));
    } catch {}
  }
});
child.stderr.on('data', () => {});
const call = (method, params) => new Promise((res) => { const k = id++; pending.set(k, (m) => res(m.result ?? m.error)); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: k, method, params }) + '\n'); });
const tool = (name, a) => call('tools/call', { name, arguments: a });
const text = (r) => r?.content?.[0]?.text ?? '';
const cases = [];
try {
  await call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'a', version: '1' } });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const { sessionId } = JSON.parse(text(await tool('browser.attach', { endpoint: observer.wsEndpoint() })));
  await tool('browser.navigate', { sessionId, url: `${FIXTURE_URL}?t=${Date.now()}` });
  const page = (await observer.pages()).find((p) => p.url().startsWith(FIXTURE_URL));
  await page.waitForFunction(() => window.__a && window.__a.ready);
  let t0 = Date.now();
  let r = await tool('browser.click', { sessionId, target: 'text=Submit' });
  cases.push({ case: 'bundle-playwright', ms: Date.now() - t0, pass: r.isError === true && /Playwright-style/.test(text(r)), text: text(r).slice(0, 120) });
  t0 = Date.now();
  r = JSON.parse(text(await tool('browser.click', { sessionId, target: 'div[' })));
  cases.push({ case: 'bundle-invalid-css-probe-serialized', ms: Date.now() - t0, retriesUsed: r.retriesUsed, err: r.error?.slice(0, 140), pass: r.success === false && r.retriesUsed === 0 && /is not a valid selector/.test(r.error ?? '') });
  r = JSON.parse(text(await tool('browser.click', { sessionId, target: 'xpath///button[@id="plain-btn"]' })));
  const last = await page.evaluate(() => window.__a.clicks.slice(-1)[0]);
  cases.push({ case: 'bundle-xpath-prefix-click', success: r.success, last, pass: r.success === true && last === 'plain-btn' });
  await tool('browser.shutdown', { sessionId });
} finally {
  child.stdin.end();
  child.kill();
  await observer.close().catch(() => {});
  for (let i = 0; i < 6; i++) { try { await fs.rm(profile, { recursive: true, force: true }); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }
}
for (const c of cases) console.log(c.pass ? 'PASS' : 'FAIL', JSON.stringify(c));
await fs.writeFile(path.join(here, 'bundle-smoke-cases.json'), JSON.stringify(cases, null, 2));
process.exit(0);
