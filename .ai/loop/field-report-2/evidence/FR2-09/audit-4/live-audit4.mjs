// FR2-09 audit-4: independent live checks of fix-3's CDP-unreachableUrl recovery (GAP-154).
// Own fixtures / own redirect mechanisms (NOT the Executor's 302/jsredir/target= set):
//   A1  meta-refresh redirect -> cross-origin CSP frame-ancestors 'none'
//   A2  two-hop 307 -> 301 redirect chain -> cross-origin XFO SAMEORIGIN
//   A3  SAME-ORIGIN frame blocked by CSP frame-ancestors 'none' (not XFO)
//   A4  SAME-ORIGIN frame blocked by XFO DENY (control for A3)
//   A5  blocked (A) then re-navigated by the parent via target= to a SECOND blocked URL (B);
//       iframe.src still says A -> does CDP report B (latest) or A (stale)?
//   A6  blocked (A) then re-navigated via iframe.src = B (src attr updated too)
//   A7  blocked frame NESTED inside a cross-origin OOPIF (grandchild)
//   A8  blocked, then re-navigated to a fine page -> must be a normal frame, no placeholder
//  Fallback path (mode argv[2]):
//   'cdp-reject'  : CdpCDPSession.prototype.send rejects Page.getFrameTree (CDP fails)
//   'no-client'   : CdpFrame 'client' getter returns undefined (simulates a Puppeteer bump
//                   removing the @internal getter)
//   'normal'      : no patching
import http from 'node:http'; import fs from 'node:fs/promises'; import os from 'node:os'; import path from 'node:path';
import { pathToFileURL } from 'node:url';
const mode = process.argv[2] ?? 'normal';
const repo = 'E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041';
const imp = (p) => import(pathToFileURL(path.join(repo, p)).href);
const pptrDir = 'packages/browser/node_modules/puppeteer-core/lib/puppeteer';
const puppeteer = (await imp(`${pptrDir}/puppeteer-core.js`)).default;
let getFrameTreeCalls = 0; let clientGetterCalls = 0;
{
  const { CdpCDPSession } = await imp(`${pptrDir}/cdp/CdpSession.js`);
  const orig = CdpCDPSession.prototype.send;
  CdpCDPSession.prototype.send = function (method, ...rest) {
    if (method === 'Page.getFrameTree') {
      getFrameTreeCalls++;
      if (mode === 'cdp-reject' && new Error().stack.includes('recoverBlockedFrameUnreachableUrl')) {
        return Promise.reject(new Error('audit-4 simulated CDP failure'));
      }
    }
    return orig.call(this, method, ...rest);
  };
  const { CdpFrame } = await imp(`${pptrDir}/cdp/Frame.js`);
  const desc = Object.getOwnPropertyDescriptor(CdpFrame.prototype, 'client');
  Object.defineProperty(CdpFrame.prototype, 'client', {
    configurable: true,
    get() {
      if (new Error().stack.includes('recoverBlockedFrameUnreachableUrl')) {
        clientGetterCalls++;
        if (mode === 'no-client') return undefined;
      }
      return desc.get.call(this);
    },
  });
}
const { SutradharRuntime } = await imp('packages/capability-runtime/dist/index.js');
const { BrowserLauncher } = await imp('packages/browser/dist/index.js');

let P = 0;
const H = (b) => `<!doctype html><html><body>${b}</body></html>`;
const LH = () => `http://localhost:${P}`; const IP = () => `http://127.0.0.1:${P}`;
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const send = (body, headers = {}) => { res.writeHead(200, { 'content-type': 'text/html', ...headers }); res.end(body); };
  switch (u.pathname) {
    case '/csp-none': return send(H('<button>csp secret</button>'), { 'content-security-policy': "frame-ancestors 'none'" });
    case '/xfo-so': return send(H('<button>so secret</button>'), { 'x-frame-options': 'SAMEORIGIN' });
    case '/xfo-deny': return send(H('<button>deny secret</button>'), { 'x-frame-options': 'DENY' });
    case '/fine': return send(H('<button>fine inner</button>'));
    case '/meta': return send(`<!doctype html><html><head><meta http-equiv="refresh" content="0;url=${LH()}/csp-none?via=meta"></head><body>redirecting</body></html>`);
    case '/hop1': res.writeHead(307, { location: `${IP()}/hop2` }); return res.end();
    case '/hop2': res.writeHead(301, { location: `${LH()}/xfo-so?via=chain` }); return res.end();
    // A cross-origin (localhost) OOPIF whose own child is blocked (grandchild of main).
    case '/outer': return send(H(`<button>outer btn</button><iframe name="gc" src="${IP()}/xfo-deny?via=grandchild"></iframe>`));
    case '/main': return send(H(`<button>Main</button>
<iframe name="a1" src="${IP()}/meta"></iframe>
<iframe name="a2" src="${IP()}/hop1"></iframe>
<iframe name="a3" src="${IP()}/csp-none?via=sameorigin-csp"></iframe>
<iframe name="a4" src="${IP()}/xfo-deny?via=sameorigin-xfo"></iframe>
<iframe name="a5" src="${LH()}/xfo-deny?step=A5-first"></iframe>
<iframe name="a6" id="a6" src="${LH()}/csp-none?step=A6-first"></iframe>
<iframe name="a7" src="${LH()}/outer"></iframe>
<iframe name="a8" src="${LH()}/xfo-deny?step=A8-first"></iframe>
<a id="nav5" href="${LH()}/csp-none?step=A5-second" target="a5">nav5</a>
<a id="nav8" href="${LH()}/fine?step=A8-second" target="a8">nav8</a>`));
  }
  res.writeHead(404); res.end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r)); P = server.address().port;
const prof = await fs.mkdtemp(path.join(os.tmpdir(), 'fr2-09-audit4-'));
const b = await puppeteer.launch({ executablePath: new BrowserLauncher().findExecutablePath(), headless: true, userDataDir: prof, args: ['--no-sandbox'] });
const pg = (await b.pages())[0];
await pg.goto(`${IP()}/main`, { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 1000)); // let meta refresh fire
await pg.click('#nav5'); await pg.click('#nav8');
await pg.evaluate((u) => { document.getElementById('a6').src = u; }, `${LH()}/xfo-so?step=A6-second`);
await new Promise((r) => setTimeout(r, 2500));
// Ground truth straight from Chrome (independent of Sutradhar's code path): each frame's own session.
const truth = {};
for (const f of pg.frames()) {
  try { const t = (await f.client.send('Page.getFrameTree')).frameTree; const find = (n) => n.frame.id === f._id ? n : (n.childFrames || []).map(find).find(Boolean);
    const me = find(t); truth[f.name() || '(main)'] = { pptrUrl: f.url(), cdpUrl: me?.frame.url, unreachableUrl: me?.frame.unreachableUrl }; } catch (e) { truth[f.name()] = { err: String(e).slice(0, 80) }; }
}
getFrameTreeCalls = 0; clientGetterCalls = 0;
const srcAttrs = await pg.evaluate(() => Object.fromEntries([...document.querySelectorAll('iframe')].map((f) => [f.name, f.src])));
const rt = new SutradharRuntime(); const { sessionId } = await rt.attach({ endpoint: b.wsEndpoint() });
const t0 = Date.now();
const s = await rt.snapshot(sessionId, undefined, 200, { includeNodes: true });
const ms = Date.now() - t0;
console.log(`MODE=${mode} snapshotMs=${ms} getFrameTreeCallsDuringSnapshot=${getFrameTreeCalls} clientGetterCallsFromRecovery=${clientGetterCalls}`);
console.log('--- ground truth (Chrome CDP per-frame session, read by the audit script itself) ---');
console.log(JSON.stringify(truth, null, 1));
console.log('--- parent iframe src attributes ---\n' + JSON.stringify(srcAttrs, null, 1));
console.log('--- listing ---\n' + s.interactiveElements);
console.log('--- skippedFrames ---\n' + JSON.stringify(s.skippedFrames, null, 1));
let fails = 0;
const check = (n, ok, d) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${n} :: ${JSON.stringify(d)}`); };
const sk = (n) => s.skippedFrames.find((f) => f.name === n);
const expectConf = mode === 'normal' ? 'confirmed' : 'likely';
const expected = {
  a1: { normal: `${LH()}/csp-none?via=meta`, fallback: `${IP()}/meta` },
  a2: { normal: `${LH()}/xfo-so?via=chain`, fallback: `${IP()}/hop1` },
  a3: { normal: `${IP()}/csp-none?via=sameorigin-csp`, fallback: `${IP()}/csp-none?via=sameorigin-csp` },
  a4: { normal: `${IP()}/xfo-deny?via=sameorigin-xfo`, fallback: `${IP()}/xfo-deny?via=sameorigin-xfo` },
  a5: { normal: `${LH()}/csp-none?step=A5-second`, fallback: `${LH()}/xfo-deny?step=A5-first` },
  a6: { normal: `${LH()}/xfo-so?step=A6-second`, fallback: `${LH()}/xfo-so?step=A6-second` },
  gc: { normal: `${IP()}/xfo-deny?via=grandchild`, fallback: `${IP()}/xfo-deny?via=grandchild` },
};
for (const [n, e] of Object.entries(expected)) {
  const got = sk(n);
  const want = mode === 'normal' ? e.normal : e.fallback;
  check(`${n} url`, got?.url === want, { want, got: got?.url, truthUnreachable: truth[n]?.unreachableUrl });
  check(`${n} urlConfidence=${expectConf}`, got?.urlConfidence === expectConf, got?.urlConfidence);
  const lineRe = new RegExp(`\\[iframe "${n}" ${new URL(want).origin.replace(/[.]/g, '\\.')}${expectConf === 'likely' ? ' \\(likely, unconfirmed\\)' : ''} — not inspectable\\]`);
  check(`${n} rendered line`, lineRe.test(s.interactiveElements), s.interactiveElements.split('\n').find((l) => l.includes(`"${n}"`)));
}
check('a8 (blocked then navigated to a fine page) is a normal frame, no placeholder', !sk('a8') && /fine inner/.test(s.interactiveElements), sk('a8') ?? 'no placeholder');
check('a7 outer OOPIF itself scraped normally', !sk('a7') && /outer btn/.test(s.interactiveElements), sk('a7') ?? 'ok');
check('no blocked-frame secret leaked', !/secret/.test(s.interactiveElements), null);
if (mode !== 'normal') check('fallback path actually exercised (recovery touched patched API)', mode === 'no-client' ? clientGetterCalls > 0 : getFrameTreeCalls > 0, { getFrameTreeCalls, clientGetterCalls });
console.log(`OVERALL ${fails === 0 ? 'PASS' : `FAIL (${fails})`}`);
await b.close(); server.close(); await fs.rm(prof, { recursive: true, force: true }).catch(() => {});
process.exit(0);
