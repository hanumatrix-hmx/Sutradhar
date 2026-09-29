// audit-5: independent live check of GAP-127's disclosure, going through Sutradhar's REAL
// BrowserLauncher.launch() (built dist, what SDK/MCP/CLI use) rather than only importing
// DEFAULT_LAUNCH_ARGS, plus Playwright's own plain chromium.launch() if available.
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const repo = process.cwd();
const { BrowserLauncher } = await import(pathToFileURL(path.join(repo, 'packages/browser/dist/launcher/browser-launcher.js')).href);
const launcher = new BrowserLauncher();
const inst = await launcher.launch({ headless: true });
const b = inst.puppeteerBrowser;
const p = await b.newPage();
const wd = await p.evaluate(() => navigator.webdriver);
const ua = await b.userAgent();
const cdp = await p.createCDPSession();
const { arguments: argv } = await cdp.send('Browser.getBrowserCommandLine');
console.log(`Sutradhar BrowserLauncher.launch(): navigator.webdriver=${wd} | HeadlessChrome UA=${/HeadlessChrome/.test(ua)} | --enable-automation=${argv.includes('--enable-automation')} | AutomationControlled flag=${argv.some(a => /AutomationControlled/.test(a))}`);
await inst.close();
try {
  const req = createRequire(path.join(repo, 'tools/engine-comparison/package.json'));
  const { chromium } = req('playwright-core');
  const pb = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const pp = await pb.newPage();
  console.log(`Playwright plain chromium.launch(): navigator.webdriver=${await pp.evaluate(() => navigator.webdriver)}`);
  await pb.close();
} catch (e) { console.log('Playwright not runnable here:', e.message.split('\n')[0]); }
