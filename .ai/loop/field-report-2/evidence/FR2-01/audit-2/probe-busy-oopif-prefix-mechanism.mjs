// audit-2: what the PRE-fix mechanism (resolveElement's main-frame head start: Puppeteer
// mainFrame.waitForSelector(pierce/..., {visible:true, timeout: min(timeoutMs,1000)})) does under the same busy-OOPIF condition.
import http from 'node:http'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import { createRequire } from 'node:module';
const here = path.dirname(fileURLToPath(import.meta.url)); const repoRoot = path.resolve(here, '../../../../../..');
const puppeteer = createRequire(path.join(repoRoot, 'packages/browser/package.json'))('puppeteer-core');
const { BrowserLauncher } = await import((await import('node:url')).pathToFileURL(path.join(repoRoot, 'packages/browser/dist/index.js')).href);
const server = http.createServer((req, res) => { res.setHeader('content-type', 'text/html'); if (req.url.startsWith('/frame')) res.end('<script>window.__busy=(ms)=>{const t=Date.now();while(Date.now()-t<ms){}}</script>'); else res.end(`<div id="toast" style="display:none">t</div><iframe src="http://localhost:${server.address().port}/frame"></iframe>`); });
await new Promise((r) => server.listen(0, r));
const b = await puppeteer.launch({ executablePath: new BrowserLauncher().findExecutablePath(), headless: true });
const [p] = await b.pages();
await p.goto(`http://127.0.0.1:${server.address().port}/`); await new Promise((r) => setTimeout(r, 500));
const f = p.frames().find((x) => x.url().includes('/frame'));
f.evaluate(() => window.__busy(2000)).catch(() => {});
await p.evaluate("setTimeout(() => { document.getElementById('toast').style.display='block' }, 500)");
const t0 = Date.now();
const h = await p.mainFrame().waitForSelector('pierce/#toast', { visible: true, timeout: 1000 }).catch((e) => null);
console.log(JSON.stringify({ mechanism: 'pre-fix main-frame head start (rAF visible:true)', found: !!h, ms: Date.now() - t0 }));
await b.close(); server.close(); process.exit(0);
