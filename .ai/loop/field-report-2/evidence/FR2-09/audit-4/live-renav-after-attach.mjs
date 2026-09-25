// FR2-09 audit-4: blocked frame re-navigates to a SECOND, different blocked URL AFTER the runtime
// already attached (long-lived session, the GAP-157 timing shape). Key question for GAP-154:
// can a stale FIRST url ever be reported as 'confirmed'? Two variants per re-nav mechanism:
//   cross-origin (localhost frame on a 127.0.0.1 page -> own OOPIF session)
//   same-origin  (127.0.0.1 frame -> shares the main session, whole-tree branch)
// and two mechanisms: parent sets iframe.src, parent uses a target= link (src unchanged).
import http from 'node:http'; import fs from 'node:fs/promises'; import os from 'node:os'; import path from 'node:path';
import { pathToFileURL } from 'node:url';
const repo = 'E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041';
const imp = (p) => import(pathToFileURL(path.join(repo, p)).href);
const puppeteer = (await imp('packages/browser/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js')).default;
const { BrowserLauncher } = await imp('packages/browser/dist/index.js');
const { SutradharRuntime } = await imp('packages/capability-runtime/dist/index.js');
let P = 0; const H = (b) => `<!doctype html><html><body>${b}</body></html>`;
const LH = () => `http://localhost:${P}`; const IP = () => `http://127.0.0.1:${P}`;
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const send = (body, h = {}) => { res.writeHead(200, { 'content-type': 'text/html', ...h }); res.end(body); };
  if (u.pathname === '/xfo-deny') return send(H('x'), { 'x-frame-options': 'DENY' });
  if (u.pathname === '/csp-none') return send(H('x'), { 'content-security-policy': "frame-ancestors 'none'" });
  if (u.pathname === '/main') return send(H(`<button>M</button>
<iframe name="xo-src" id="xo-src" src="${LH()}/xfo-deny?s=xo-src-FIRST"></iframe>
<iframe name="xo-link" src="${LH()}/xfo-deny?s=xo-link-FIRST"></iframe>
<iframe name="so-src" id="so-src" src="${IP()}/xfo-deny?s=so-src-FIRST"></iframe>
<iframe name="so-link" src="${IP()}/xfo-deny?s=so-link-FIRST"></iframe>
<a id="l1" href="${LH()}/csp-none?s=xo-link-SECOND" target="xo-link">l1</a>
<a id="l2" href="${IP()}/csp-none?s=so-link-SECOND" target="so-link">l2</a>`));
  res.writeHead(404); res.end();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r)); P = server.address().port;
const prof = await fs.mkdtemp(path.join(os.tmpdir(), 'fr2-09-audit4-r-'));
const b = await puppeteer.launch({ executablePath: new BrowserLauncher().findExecutablePath(), headless: true, userDataDir: prof, args: ['--no-sandbox'] });
const pg = (await b.pages())[0];
await pg.goto(`${IP()}/main`, { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 1000));
const rt = new SutradharRuntime(); const { sessionId } = await rt.attach({ endpoint: b.wsEndpoint() });
const s1 = await rt.snapshot(sessionId, undefined, 200, { includeNodes: true });
console.log('--- snapshot 1 (before re-nav) ---\n' + JSON.stringify(s1.skippedFrames.map((f) => [f.name, f.url, f.urlConfidence])));
await pg.evaluate((a, c) => { document.getElementById('xo-src').src = a; document.getElementById('so-src').src = c; }, `${LH()}/csp-none?s=xo-src-SECOND`, `${IP()}/csp-none?s=so-src-SECOND`);
await pg.click('#l1'); await pg.click('#l2');
await new Promise((r) => setTimeout(r, 2500));
const truth = {};
for (const f of pg.frames()) { if (f === pg.mainFrame()) continue; try { const t = (await f.client.send('Page.getFrameTree')).frameTree; const find = (n) => n.frame.id === f._id ? n : (n.childFrames || []).map(find).find(Boolean); truth[f.name()] = find(t)?.frame.unreachableUrl; } catch (e) { truth[f.name()] = String(e).slice(0, 60); } }
console.log('--- ground truth unreachableUrl (audit script\'s own puppeteer connection) ---\n' + JSON.stringify(truth));
const s2 = await rt.snapshot(sessionId, undefined, 200, { includeNodes: true });
console.log('--- snapshot 2 (same long-lived session, after re-nav) ---\n' + s2.interactiveElements + '\n' + JSON.stringify(s2.skippedFrames.map((f) => [f.name, f.url, f.urlConfidence])));
let staleConfirmed = 0;
for (const f of s2.skippedFrames) {
  if (f.urlConfidence === 'confirmed' && /FIRST/.test(f.url ?? '')) { staleConfirmed++; console.log('DEFECT stale-confirmed', JSON.stringify(f)); }
}
for (const n of ['xo-src', 'xo-link', 'so-src', 'so-link']) {
  const e = s2.skippedFrames.find((f) => f.name === n);
  console.log(`${n}: ${e ? `${e.url} [${e.urlConfidence ?? 'no-confidence'}] ${/SECOND/.test(e.url) ? 'LATEST' : /FIRST/.test(e.url) ? 'STALE' : 'OTHER'}` : 'ABSENT from snapshot (GAP-157 shape)'}`);
}
// And a FRESH attach after the re-nav, for comparison.
const rt2 = new SutradharRuntime(); const { sessionId: sid2 } = await rt2.attach({ endpoint: b.wsEndpoint() });
const s3 = await rt2.snapshot(sid2, undefined, 200, { includeNodes: true });
console.log('--- snapshot 3 (FRESH attach after re-nav) ---\n' + JSON.stringify(s3.skippedFrames.map((f) => [f.name, f.url, f.urlConfidence])));
console.log(`STALE-CONFIRMED COUNT: ${staleConfirmed}`);
await b.close(); server.close(); await fs.rm(prof, { recursive: true, force: true }).catch(() => {});
process.exit(0);
