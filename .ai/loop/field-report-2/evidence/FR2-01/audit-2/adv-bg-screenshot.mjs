import path from 'node:path'; import os from 'node:os'; import fs from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url'; import { createRequire } from 'node:module';
const here = path.dirname(fileURLToPath(import.meta.url)); const repoRoot = path.resolve(here, '../../../../../..');
const puppeteer = createRequire(path.join(repoRoot, 'packages/browser/package.json'))('puppeteer-core');
const { BrowserLauncher } = await import(pathToFileURL(path.join(repoRoot, 'packages/browser/dist/index.js')));
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fr2-01-audit-shot-'));
const b = await puppeteer.launch({ executablePath: new BrowserLauncher().findExecutablePath(), headless: true, userDataDir: dir, protocolTimeout: 30000 });
const [a] = await b.pages(); await a.goto(pathToFileURL(path.join(here, 'adv-singleframe.html')).href);
const bb = await b.newPage(); await bb.goto('data:text/html,B');
console.log('A visibility', await a.evaluate('document.visibilityState'));
await a.evaluate("window.__fx.reveal('toast')"); let t = Date.now(); try { await a.screenshot({ encoding: 'base64' }); console.log('screenshot ok', Date.now() - t); } catch (e) { console.log('screenshot failed', Date.now() - t, e.message.slice(0, 120)); }
await b.close(); await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
