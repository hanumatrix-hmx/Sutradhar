// Auditor adversarial case (a) GAP-003: wait_for_selector visible/hidden on a NON-foreground tab.
// Modes: puppeteer.launch headless (Puppeteer default args), CLI-style spawn headless=new, CLI-style
// spawn headed (exact spawn-chrome.ts arg set: no --disable-renderer-backgrounding etc.).
// Waits are driven through the real built SutradharRuntime (attach → waitForSelector on tab A),
// while tab B is brought to front by an independent observer connection.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../../../..');
const req = createRequire(path.join(repoRoot, 'packages/browser/package.json'));
const puppeteer = req('puppeteer-core');
const { SutradharRuntime } = await import(pathToFileURL(path.join(repoRoot, 'packages/capability-runtime/dist/index.js')));
const { BrowserLauncher } = await import(pathToFileURL(path.join(repoRoot, 'packages/browser/dist/index.js')));
const FIXTURE = pathToFileURL(path.join(repoRoot, 'tools/scenario-suite/fixtures/fr2-01-wait-states.html')).href;
const chromePath = process.env.CHROME_PATH || new BrowserLauncher().findExecutablePath();
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const modes = (process.argv[2] || 'pptr-headless,cli-headless,cli-headed').split(',');
const out = [];

function freePort() {
  return new Promise((res) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
}
async function rmRetry(d) { for (let i = 0; i < 10; i++) { try { await fs.rm(d, { recursive: true, force: true }); return; } catch { await delay(400); } } console.log('COULD NOT REMOVE', d); }

async function startBrowser(mode, dir) {
  if (mode === 'pptr-headless') {
    const b = await puppeteer.launch({ executablePath: chromePath, headless: true, userDataDir: dir });
    return { ws: b.wsEndpoint(), close: () => b.close(), pid: b.process()?.pid };
  }
  const port = await freePort();
  const args = [`--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check'];
  if (mode === 'cli-headless') args.push('--headless=new');
  const child = spawn(chromePath, args, { detached: true, stdio: 'ignore' });
  let ws;
  for (let i = 0; i < 50 && !ws; i++) {
    try { ws = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl; } catch { await delay(200); }
  }
  return { ws, pid: child.pid, close: async () => { try { const b = await puppeteer.connect({ browserWSEndpoint: ws }); await b.close(); } catch {} try { process.kill(child.pid); } catch {} } };
}

async function oneCase(mode, runtime, sid, obs, tabIdA, pageA, pageB, { label, target, state, trigger, background }) {
  await pageA.goto(`${FIXTURE}?n=${Date.now()}${Math.random()}#manual`);
  await pageA.waitForFunction(() => !!window.__fx);
  if (background) await pageB.bringToFront(); else await pageA.bringToFront();
  await delay(300);
  const vis = await pageA.evaluate(() => [document.visibilityState, document.hasFocus()]);
  // rAF liveness probe in A: how many rAF callbacks fire in 500ms
  const rafCount = await pageA.evaluate(() => new Promise((r) => { let n = 0; const t0 = performance.now(); (function f() { n++; if (performance.now() - t0 < 500) requestAnimationFrame(f); })(); setTimeout(() => r(n), 600); }));
  const sentAt = Date.now();
  const p = runtime.waitForSelector(sid, target, 6000, tabIdA, state).then((r) => ({ r, at: Date.now() }));
  await delay(1000);
  const trigAt = Date.now();
  await pageA.evaluate(trigger);
  const { r, at } = await p;
  const truth = await pageA.evaluate((sel) => { const el = document.querySelector(sel); if (!el) return 'absent'; const s = getComputedStyle(el), b = el.getBoundingClientRect(); return (!['hidden','collapse'].includes(s.visibility) && b.width > 0 && b.height > 0) ? 'visible' : 'hidden'; }, target);
  const rec = { mode, label, background, visibilityState: vis[0], rafCallsIn500ms: rafCount, success: r.success, error: r.error?.slice(0, 160), latencyAfterTriggerMs: at - trigAt, totalMs: at - sentAt, retriesUsed: r.retriesUsed, truthAtEnd: truth };
  console.log(JSON.stringify(rec));
  out.push(rec);
}

for (const mode of modes) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `fr2-01-audit-gap003-${mode}-`));
  const br = await startBrowser(mode, dir);
  const obs = await puppeteer.connect({ browserWSEndpoint: br.ws, defaultViewport: null });
  const pageA = (await obs.pages())[0] ?? (await obs.newPage());
  await pageA.goto(`${FIXTURE}?init=1#manual`);
  const pageB = await obs.newPage();
  await pageB.goto('data:text/html,<h1>foreground tab B</h1>');
  const runtime = new SutradharRuntime();
  const { sessionId: sid } = await runtime.attach({ endpoint: br.ws });
  const tabs = await runtime.listTabs(sid);
  const tabA = tabs.find((t) => t.url.startsWith(FIXTURE));
  try {
    for (const background of [false, true]) {
      await oneCase(mode, runtime, sid, obs, tabA.id, pageA, pageB, { label: 'visible-toast', target: '#toast', state: 'visible', trigger: () => window.__fx.reveal('toast'), background });
      await oneCase(mode, runtime, sid, obs, tabA.id, pageA, pageB, { label: 'hidden-banner', target: '#banner', state: 'hidden', trigger: () => window.__fx.hide('banner'), background });
      await oneCase(mode, runtime, sid, obs, tabA.id, pageA, pageB, { label: 'attached-late(control,mutation-poll)', target: '#late', state: 'attached', trigger: () => window.__fx.insert('late'), background });
    }
  } catch (e) { console.log('CASE ERROR', mode, e.message); out.push({ mode, error: e.message }); }
  await runtime.shutdown(sid).catch(() => {});
  obs.disconnect();
  await br.close();
  await delay(800);
  await rmRetry(dir);
}
await fs.writeFile(path.join(here, 'adv-gap003-results.json'), JSON.stringify(out, null, 2));
process.exit(0);
