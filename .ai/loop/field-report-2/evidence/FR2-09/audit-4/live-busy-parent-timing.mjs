// FR2-09 audit-4: GAP-156's latency concern under fix-3. A cross-origin OOPIF parent that is
// BUSY (8s sync loop) contains 3 blocked children. fix-2's worst case was ~1s serial per blocked
// child (frameElement() needs the busy parent's realm). fix-3 now tries CDP Page.getFrameTree
// first (browser-side, should not need the busy renderer) -> expect confirmed results with no
// extra ~1s-per-child cost. Measures snapshot wall time and each child's confidence.
import http from 'node:http'; import fs from 'node:fs/promises'; import os from 'node:os'; import path from 'node:path';
import { pathToFileURL } from 'node:url';
const repo = 'E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041';
const imp = (p) => import(pathToFileURL(path.join(repo, p)).href);
const puppeteer = (await imp('packages/browser/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js')).default;
const { BrowserLauncher } = await imp('packages/browser/dist/index.js');
const { SutradharRuntime } = await imp('packages/capability-runtime/dist/index.js');
let P = 0; const H = (b) => `<!doctype html><html><body>${b}</body></html>`;
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const send = (body, h = {}) => { res.writeHead(200, { 'content-type': 'text/html', ...h }); res.end(body); };
  if (u.pathname === '/xfo-deny') return send(H('x'), { 'x-frame-options': 'DENY' });
  if (u.pathname === '/busy') return send(H(`<button>busy btn</button>
<iframe name="k1" src="http://127.0.0.1:${P}/xfo-deny?k=1"></iframe>
<iframe name="k2" src="http://127.0.0.1:${P}/xfo-deny?k=2"></iframe>
<iframe name="k3" src="http://127.0.0.1:${P}/xfo-deny?k=3"></iframe>
<script>addEventListener('message', (e) => { if (e.data === 'spin') { const t = Date.now(); while (Date.now() - t < 8000) {} } });</script>`));
  if (u.pathname === '/main') return send(H(`<button>M</button><iframe name="busyp" id="bp" src="http://localhost:${P}/busy"></iframe>`));
  res.writeHead(404); res.end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r)); P = server.address().port;
const prof = await fs.mkdtemp(path.join(os.tmpdir(), 'fr2-09-audit4-b-'));
const b = await puppeteer.launch({ executablePath: new BrowserLauncher().findExecutablePath(), headless: true, userDataDir: prof, args: ['--no-sandbox'] });
const pg = (await b.pages())[0];
await pg.goto(`http://127.0.0.1:${P}/main`, { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 800));
const rt = new SutradharRuntime(); const { sessionId } = await rt.attach({ endpoint: b.wsEndpoint() });
const idle0 = Date.now(); const sIdle = await rt.snapshot(sessionId, undefined, 200, { includeNodes: true }); const idleMs = Date.now() - idle0;
console.log(`idle snapshot ms=${idleMs}`, JSON.stringify(sIdle.skippedFrames.map((f) => [f.name, f.reason, f.url, f.urlConfidence])));
await pg.evaluate(() => document.getElementById('bp').contentWindow.postMessage('spin', '*'));
await new Promise((r) => setTimeout(r, 200));
const t0 = Date.now(); const s = await rt.snapshot(sessionId, undefined, 200, { includeNodes: true }); const ms = Date.now() - t0;
console.log(`busy-parent snapshot ms=${ms}`);
console.log(s.interactiveElements);
console.log(JSON.stringify(s.skippedFrames.map((f) => [f.name, f.reason, f.url, f.urlConfidence])));
await new Promise((r) => setTimeout(r, 8500));
await b.close(); server.close(); await fs.rm(prof, { recursive: true, force: true }).catch(() => {});
process.exit(0);
