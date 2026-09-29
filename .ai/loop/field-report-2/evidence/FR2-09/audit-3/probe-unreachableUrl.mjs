// audit-3: is CDP Page.getFrameTree's `unreachableUrl` a correct alternative signal for a blocked
// frame's real target (incl. redirect / navigated-away cases where iframe.src is stale)?
import http from 'node:http'; import fs from 'node:fs/promises'; import os from 'node:os'; import path from 'node:path';
import { pathToFileURL } from 'node:url';
const repo = 'E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041';
const imp = (p) => import(pathToFileURL(path.join(repo, p)).href);
const puppeteer = (await imp('packages/browser/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js')).default;
const { BrowserLauncher } = await imp('packages/browser/dist/index.js');
let P = 0; const H = (b) => `<!doctype html><html><body>${b}</body></html>`;
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/xfo-deny') { res.writeHead(200, { 'content-type': 'text/html', 'x-frame-options': 'DENY' }); return res.end('x'); }
  if (u.pathname === '/redir') { res.writeHead(302, { location: `http://localhost:${P}/xfo-deny?via=302` }); return res.end(); }
  if (u.pathname === '/jsredir') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(H(`<script>location.href='http://localhost:${P}/xfo-deny?via=js'</script>`)); }
  if (u.pathname === '/ok') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(H('ok')); }
  if (u.pathname === '/main') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(H(`
<iframe name="direct" src="http://localhost:${P}/xfo-deny?via=direct"></iframe>
<iframe name="r302" src="http://127.0.0.1:${P}/redir"></iframe>
<iframe name="rjs" src="http://127.0.0.1:${P}/jsredir"></iframe>
<iframe name="t" src="http://127.0.0.1:${P}/ok"></iframe><a id="nav" href="http://localhost:${P}/xfo-deny?via=link" target="t">go</a>`)); }
  res.writeHead(404); res.end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r)); P = server.address().port;
const prof = await fs.mkdtemp(path.join(os.tmpdir(), 'fr2-09-audit3-u-'));
const b = await puppeteer.launch({ executablePath: new BrowserLauncher().findExecutablePath(), headless: true, userDataDir: prof, args: ['--no-sandbox'] });
const pg = (await b.pages())[0];
await pg.goto(`http://127.0.0.1:${P}/main`, { waitUntil: 'networkidle0' });
await pg.click('#nav'); await new Promise((r) => setTimeout(r, 2000));
const c = await pg.createCDPSession();
const { frameTree } = await c.send('Page.getFrameTree');
const walk = (t, out = []) => { out.push({ name: t.frame.name, url: t.frame.url, unreachableUrl: t.frame.unreachableUrl }); (t.childFrames || []).forEach((x) => walk(x, out)); return out; };
console.log('main-session tree:', JSON.stringify(walk(frameTree)));
// OOPIF/error-page frames live on their own CDP session: ask each frame's own client.
for (const f of pg.frames()) {
  try {
    const t = (await f.client.send('Page.getFrameTree')).frameTree;
    const all = walk(t);
    const me = all.find((x) => x.name === f.name()) ?? all[0];
    console.log(JSON.stringify({ puppeteerName: f.name(), puppeteerUrl: f.url(), cdp: me }));
  } catch (e) { console.log(JSON.stringify({ puppeteerName: f.name(), err: String(e).slice(0, 120) })); }
}
await b.close(); server.close(); await fs.rm(prof, { recursive: true, force: true }).catch(() => {});
