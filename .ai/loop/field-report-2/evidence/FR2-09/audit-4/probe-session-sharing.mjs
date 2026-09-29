// FR2-09 audit-4: does any blocked (chrome-error) child frame ever SHARE its CDP session with the
// main frame (the "whole-tree" branch of findFrameTreeNode)? If yes, findFrameTreeNode's frameId
// matching is load-bearing live; if every blocked frame always gets its own session, the root is
// always the match. Also covers: network-refused same-origin frame, sandboxed frame, about:blank
// child navigated to a blocked URL by the parent, and a same-origin non-blocked child (control).
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
  if (u.pathname === '/csp-none') return send(H('x'), { 'content-security-policy': "frame-ancestors 'none'" });
  if (u.pathname === '/fine') return send(H('<button>fine</button>'));
  if (u.pathname === '/main') return send(H(`<button>M</button>
<iframe name="so-xfo" src="/xfo-deny?c=so-xfo"></iframe>
<iframe name="so-csp" src="/csp-none?c=so-csp"></iframe>
<iframe name="so-fine" src="/fine"></iframe>
<iframe name="refused" src="http://127.0.0.1:1/refused"></iframe>
<iframe name="sbx" sandbox src="/xfo-deny?c=sandboxed"></iframe>
<iframe name="blank" id="blank"></iframe>`));
  res.writeHead(404); res.end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r)); P = server.address().port;
const prof = await fs.mkdtemp(path.join(os.tmpdir(), 'fr2-09-audit4-s-'));
const b = await puppeteer.launch({ executablePath: new BrowserLauncher().findExecutablePath(), headless: true, userDataDir: prof, args: ['--no-sandbox'] });
const pg = (await b.pages())[0];
await pg.goto(`http://127.0.0.1:${P}/main`, { waitUntil: 'networkidle0' });
await pg.evaluate((u) => { document.getElementById('blank').src = u; }, `http://127.0.0.1:${P}/xfo-deny?c=blank-then-blocked`);
await new Promise((r) => setTimeout(r, 2000));
const main = pg.mainFrame();
const mainTree = (await main.client.send('Page.getFrameTree')).frameTree;
const walk = (t, o = []) => { o.push({ id: t.frame.id, name: t.frame.name, url: t.frame.url, unreachableUrl: t.frame.unreachableUrl }); (t.childFrames || []).forEach((c) => walk(c, o)); return o; };
console.log('main-session tree:', JSON.stringify(walk(mainTree), null, 1));
for (const f of pg.frames()) {
  if (f === main) continue;
  const shared = f.client === main.client;
  const root = (await f.client.send('Page.getFrameTree')).frameTree;
  console.log(JSON.stringify({ name: f.name(), pptrUrl: f.url(), sharesMainSession: shared, rootIsSelf: root.frame.id === f._id, rootUnreachable: root.frame.unreachableUrl ?? null }));
}
const rt = new SutradharRuntime(); const { sessionId } = await rt.attach({ endpoint: b.wsEndpoint() });
const s = await rt.snapshot(sessionId, undefined, 200, { includeNodes: true });
console.log('--- Sutradhar listing (fresh attach) ---\n' + s.interactiveElements);
console.log('--- skippedFrames ---\n' + JSON.stringify(s.skippedFrames));
await b.close(); server.close(); await fs.rm(prof, { recursive: true, force: true }).catch(() => {});
process.exit(0);
