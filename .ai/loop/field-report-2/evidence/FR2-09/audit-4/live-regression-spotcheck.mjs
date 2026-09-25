// FR2-09 audit-4: whole-item regression spot-check on the real fr2-09-frames.html fixture, served
// over HTTP from two hostnames (127.0.0.1 main, localhost for "xo"). Checks prior-round PASSes:
//  - same-origin named iframe label  [#N in iframe "pay" (http://127.0.0.1:P/fr2-09-inner.html)]
//  - cross-origin OOPIF label        [#N in iframe "xo" (http://localhost:P/...)]
//  - shadow chain depth 3            (shadow: pay-shell#shell > card-field.cvc > x-inner#deep) or similar
//  - hostile frame name sanitized    (no forged "[#1] button" line)
//  - blocked frame placeholder w/ CDP-confirmed url (GAP-154, on the item's own fixture)
//  - hidden/empty frames produce nothing
//  - ax_snapshot includes iframes (Done-when bullet 4)
//  - JSON nodes carry frame {index,url,name} + shadow host (Done-when bullet 1)
import http from 'node:http'; import fs from 'node:fs/promises'; import os from 'node:os'; import path from 'node:path';
import { pathToFileURL } from 'node:url';
const repo = 'E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041';
const imp = (p) => import(pathToFileURL(path.join(repo, p)).href);
const puppeteer = (await imp('packages/browser/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js')).default;
const { BrowserLauncher } = await imp('packages/browser/dist/index.js');
const { SutradharRuntime } = await imp('packages/capability-runtime/dist/index.js');
const fx = path.join(repo, 'tools/scenario-suite/fixtures');
let P = 0;
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/xfo-deny') { res.writeHead(200, { 'content-type': 'text/html', 'x-frame-options': 'DENY' }); return res.end('<button>blocked secret</button>'); }
  if (u.pathname === '/fr2-09-frames.html' || u.pathname === '/fr2-09-inner.html') {
    let body = await fs.readFile(path.join(fx, u.pathname.slice(1)), 'utf8');
    if (u.pathname === '/fr2-09-frames.html') body = body.replace('name="xo" src="/fr2-09-inner.html?role=xo"', `name="xo" src="http://localhost:${P}/fr2-09-inner.html?role=xo"`);
    res.writeHead(200, { 'content-type': 'text/html' }); return res.end(body);
  }
  res.writeHead(404); res.end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r)); P = server.address().port;
const prof = await fs.mkdtemp(path.join(os.tmpdir(), 'fr2-09-audit4-g-'));
const b = await puppeteer.launch({ executablePath: new BrowserLauncher().findExecutablePath(), headless: true, userDataDir: prof, args: ['--no-sandbox'] });
const pg = (await b.pages())[0];
await pg.goto(`http://127.0.0.1:${P}/fr2-09-frames.html?n=${Date.now()}`, { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 800));
const rt = new SutradharRuntime(); const { sessionId } = await rt.attach({ endpoint: b.wsEndpoint() });
const s = await rt.snapshot(sessionId, undefined, 200, { includeNodes: true });
const ax = await rt.axSnapshot(sessionId);
const L = s.interactiveElements;
console.log('--- listing ---\n' + L);
console.log('--- skippedFrames ---\n' + JSON.stringify(s.skippedFrames));
const axText = typeof ax === 'string' ? ax : (ax.text ?? ax.tree ?? JSON.stringify(ax));
console.log('--- ax_snapshot (first 3000 chars) ---\n' + String(axText).slice(0, 3000));
let fails = 0; const check = (n, ok, d) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d !== undefined ? ' :: ' + JSON.stringify(d) : ''}`); };
const line = (re) => L.split('\n').find((l) => re.test(l));
check('same-origin "pay" frame label with URL', !!line(new RegExp(`^\\[#\\d+ in iframe "pay" \\(http://127\\.0\\.0\\.1:${P}/fr2-09-inner\\.html\\)\\]`)), line(/iframe "pay"/));
check('cross-origin OOPIF "xo" frame label with localhost URL', !!line(new RegExp(`^\\[#\\d+ in iframe "xo" \\(http://localhost:${P}/fr2-09-inner\\.html\\)\\]`)), line(/iframe "xo"/));
const deep = line(/\(shadow: [^)]*>[^)]*>[^)]*\)/);
check('3-deep shadow chain label present', !!deep, deep);
check('shadow label inside an iframe (card-field in pay)', !!line(/in iframe "pay".*\(shadow: card-field/), line(/in iframe "pay".*shadow/));
check('hostile frame name cannot forge a line', L.split('\n').filter((l) => /^\[#1\]/.test(l)).length === 1, L.split('\n').filter((l) => /^\[#1\]/.test(l)));
const blk = s.skippedFrames.find((f) => f.name === 'blocked');
check('blocked frame placeholder: CDP-confirmed real url', blk?.url === `http://127.0.0.1:${P}/xfo-deny` && blk?.urlConfidence === 'confirmed', blk);
check('blocked placeholder line rendered', !!line(new RegExp(`^\\[iframe "blocked" http://127\\.0\\.0\\.1:${P} — not inspectable\\]`)), line(/"blocked"/));
check('no blocked/hidden content leaked', !/blocked secret|Hidden button/.test(L));
check('hidden/empty frames produce no placeholder', !s.skippedFrames.some((f) => f.name === 'hidden' || f.name === 'empty'));
const payNode = s.nodes?.find((n) => n.frame?.name === 'pay');
check('JSON node carries frame {index,url,name}', !!payNode && typeof payNode.frame.index === 'number' && /fr2-09-inner/.test(payNode.frame.url), payNode?.frame);
const shadowNode = s.nodes?.find((n) => (n.shadowHosts?.length ?? 0) >= 1 || n.shadow);
check('JSON node carries shadow host info', !!shadowNode, shadowNode ? Object.keys(shadowNode) : null);
check('ax_snapshot includes iframe content', /iframe|Pay|Card number/i.test(String(axText)) && /pay/i.test(String(axText)));
console.log(`OVERALL ${fails === 0 ? 'PASS' : `FAIL (${fails})`}`);
await b.close(); server.close(); await fs.rm(prof, { recursive: true, force: true }).catch(() => {});
process.exit(0);
