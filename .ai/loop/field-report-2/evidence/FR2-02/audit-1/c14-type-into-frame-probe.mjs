// Probe: does the real type tool reach #fi inside the srcdoc iframe by plain selector? (tests run-1's C14 "finding" note)
import path from 'node:path'; import os from 'node:os'; import fs from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url'; import { createRequire } from 'node:module';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..', '..', '..', '..');
const puppeteer = createRequire(path.join(root, 'packages', 'browser', 'package.json'))('puppeteer-core');
const { BrowserLauncher } = await import(pathToFileURL(path.join(root, 'packages', 'browser', 'dist', 'index.js')));
const prof = await fs.mkdtemp(path.join(os.tmpdir(), 'fr2-02-audit1-c14-'));
const b = await puppeteer.launch({ executablePath: new BrowserLauncher().findExecutablePath(), headless: true, userDataDir: prof, args: ['--no-sandbox'] });
const { SutradharRuntime } = await import(pathToFileURL(path.join(root, 'packages', 'capability-runtime', 'dist', 'index.js')));
const rt = new SutradharRuntime({ logger: { debug() {}, info() {}, warn() {}, error() {} } });
const { sessionId } = await rt.attach({ endpoint: b.wsEndpoint() });
const fx = pathToFileURL(path.join(root, 'tools', 'scenario-suite', 'fixtures', 'fr2-02-extract-live.html')).href + '?t=' + Date.now();
const res = {};
try {
  await rt.navigate(sessionId, fx);
  const page = (await b.pages()).find((p) => p.url().startsWith(fx.split('?')[0]));
  await page.waitForFunction(() => window.__fx2?.ready, { timeout: 5000 });
  try { res.click = await rt.click(sessionId, '#fi'); } catch (e) { res.clickErr = e.message; }
  try { res.type = await rt.type(sessionId, '#fi', 'in-frame'); } catch (e) { res.typeErr = e.message; }
  const fr = page.frames().find((f) => f !== page.mainFrame());
  res.observerFrameValue = await fr.evaluate(() => document.querySelector('#fi').value);
  res.extract = await rt.extractData(sessionId, { v: { selector: '#fi' }, a: { selector: '#fi', attribute: 'attr:value' } }, undefined, '#f');
} finally { await rt.shutdown(sessionId).catch(() => {}); await b.close(); await fs.rm(prof, { recursive: true, force: true }).catch(() => {}); }
console.log(JSON.stringify(res, null, 1));
