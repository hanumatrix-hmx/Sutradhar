// FR2-09 audit-3 E6: same as E5 but the runtime is attached BEFORE the in-frame navigations happen
// (a long-lived session, like a running MCP server), to test D8 detection on a stale frame.url().
// Original E5 header: does recoverBlockedFrameSrc report the URL that was actually BLOCKED, or the
// iframe's src attribute when the two differ? (server 302 redirect; in-frame JS redirect; link target)
import http from 'node:http'; import fs from 'node:fs/promises'; import os from 'node:os'; import path from 'node:path';
import { pathToFileURL } from 'node:url';
const repo = 'E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041';
const imp = (p) => import(pathToFileURL(path.join(repo, p)).href);
const puppeteer = (await imp('packages/browser/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js')).default;
const { SutradharRuntime } = await imp('packages/capability-runtime/dist/index.js');
const { BrowserLauncher } = await imp('packages/browser/dist/index.js');
let P = 0;
const H = (b) => `<!doctype html><html><body>${b}</body></html>`;
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/xfo-deny') { res.writeHead(200, { 'content-type': 'text/html', 'x-frame-options': 'DENY' }); return res.end(H('<button>deny secret</button>')); }
  if (u.pathname === '/redir') { res.writeHead(302, { location: `http://localhost:${P}/xfo-deny?via=302` }); return res.end(); }
  if (u.pathname === '/jsredir') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(H(`<script>location.href='http://localhost:${P}/xfo-deny?via=js'</script>`)); }
  if (u.pathname === '/ok') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(H('<button>OK inner</button>')); }
  if (u.pathname === '/main') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(H(`<button>Main</button>
<iframe name="r302" src="http://127.0.0.1:${P}/redir"></iframe>
<iframe name="rjs" src="http://127.0.0.1:${P}/jsredir"></iframe>
<iframe name="t" src="http://127.0.0.1:${P}/ok"></iframe>
<a id="nav" href="http://localhost:${P}/xfo-deny?via=link" target="t">go</a>`)); }
  res.writeHead(404); res.end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r)); P = server.address().port;
const prof = await fs.mkdtemp(path.join(os.tmpdir(), 'fr2-09-audit3-e5-'));
const b = await puppeteer.launch({ executablePath: new BrowserLauncher().findExecutablePath(), headless: true, userDataDir: prof, args: ['--no-sandbox'] });
const pg = (await b.pages())[0];
await pg.goto(`http://127.0.0.1:${P}/ok?n=${Date.now()}`, { waitUntil: 'networkidle0' });
const rt = new SutradharRuntime(); const { sessionId } = await rt.attach({ endpoint: b.wsEndpoint() });
await rt.navigate(sessionId, `http://127.0.0.1:${P}/main?n=${Date.now()}`);
await new Promise((r) => setTimeout(r, 1500));
await rt.click(sessionId, '#nav').catch((e) => console.log('click err', String(e)));
await new Promise((r) => setTimeout(r, 2000));
const t0 = Date.now();
const s = await rt.snapshot(sessionId, undefined, 200, { includeNodes: true });
console.log('snapshot ms', Date.now() - t0);
const truth = await pg.evaluate(() => [...document.querySelectorAll('iframe')].map((f) => ({ name: f.name, srcAttr: f.src })));
console.log('--- iframe src attributes (parent DOM) ---\n' + JSON.stringify(truth));
console.log('--- listing ---\n' + s.interactiveElements);
console.log('--- skippedFrames ---\n' + JSON.stringify(s.skippedFrames, null, 2));
const ask = { r302: 'via=302', rjs: 'via=js', t: 'via=link' };
for (const [n, marker] of Object.entries(ask)) {
  const e = s.skippedFrames.find((f) => f.name === n);
  const ok = !!e && e.url.includes(marker);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${n}: skipped url is the URL actually blocked (localhost ...${marker}) :: ${JSON.stringify(e)}`);
}
await b.close(); server.close(); await fs.rm(prof, { recursive: true, force: true }).catch(() => {});
