// Diagnose ADV-b3: why did the observer find no element for the lvl2 (nested OOPIF) id?
import http from 'node:http'; import fs from 'node:fs/promises'; import os from 'node:os'; import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)); const repo = path.resolve(here, '../../../../../..');
const imp = (p) => import(pathToFileURL(path.join(repo, p)).href);
const puppeteer = (await imp('packages/browser/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js')).default;
const { SutradharRuntime } = await imp('packages/capability-runtime/dist/index.js');
const { BrowserLauncher } = await imp('packages/browser/dist/index.js');
let P;
const pages = {
 '/main.html': () => `<button>Top</button><iframe name="checkout" src="/inner.html"></iframe>`,
 '/inner.html': () => `<button>Submit</button><iframe name="lvl2" src="http://localhost:${P}/lvl2.html"></iframe>`,
 '/lvl2.html': () => `<button>Level two</button>`,
};
const server = http.createServer((q, r) => { const f = pages[new URL(q.url,'http://x').pathname]; r.writeHead(f?200:404,{'content-type':'text/html'}); r.end(f?f():''); });
await new Promise((r) => server.listen(0, '127.0.0.1', r)); P = server.address().port;
const prof = await fs.mkdtemp(path.join(os.tmpdir(), 'fr2-09-probe-'));
const b = await puppeteer.launch({ executablePath: new BrowserLauncher().findExecutablePath(), headless: true, userDataDir: prof });
const pg = (await b.pages())[0];
await pg.goto(`http://127.0.0.1:${P}/main.html`, { waitUntil: 'networkidle0' });
const rt = new SutradharRuntime(); const { sessionId } = await rt.attach({ endpoint: b.wsEndpoint() });
const s = await rt.snapshot(sessionId, undefined, 200, { includeNodes: true });
console.log(s.interactiveElements);
for (const f of pg.frames()) {
  try { console.log('FRAME', f.name(), f.url(), JSON.stringify(await f.evaluate(() => [document.documentElement.getAttribute('data-sd-current-gen'), [...document.querySelectorAll('[data-sd-node-id]')].map(e => [e.getAttribute('data-sd-node-id'), e.getAttribute('data-sd-gen'), e.textContent])]))); }
  catch (e) { console.log('FRAME', f.name(), f.url(), 'ERR', e.message.slice(0, 100)); }
}
console.log('observer frames:', pg.frames().length, 'runtime nodes:', s.nodes.map(n => [n.id, n.frame?.name]));
await b.close(); server.close(); await fs.rm(prof, { recursive: true, force: true }).catch(() => {});
