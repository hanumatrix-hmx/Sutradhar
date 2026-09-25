// audit-2: a cross-origin (out-of-process) iframe whose renderer main thread is busy for 8s.
// Main page on 127.0.0.1, iframe on localhost (different site -> separate renderer under site isolation).
// Question: the new Node-side polling awaits frame.$ with NO per-probe bound. Does one busy frame stall
// the whole wait past its timeoutMs, and does the generic outer-race message come back?
import http from 'node:http'; import path from 'node:path'; import fs from 'node:fs'; import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)); const repoRoot = path.resolve(here, '../../../../../..');
const { SutradharRuntime } = await import(pathToFileURL(path.join(repoRoot, 'packages/capability-runtime/dist/index.js')));
const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'text/html');
  if (req.url.startsWith('/frame')) {
    res.end(`<div id="inframe">in frame</div><script>window.__busy = (ms) => { const t = Date.now(); while (Date.now() - t < ms) {} };</script>`);
  } else {
    const port = server.address().port;
    res.end(`<div id="banner">banner</div><div id="toast" style="display:none">toast</div>
<iframe id="f" src="http://localhost:${port}/frame"></iframe>
<script>window.__fx = { events: [] };</script>`);
  }
});
await new Promise((r) => server.listen(0, r));
// also listen on localhost for the iframe (same server, IPv4 loopback name differs -> different site)
const port = server.address().port;
const rt = new SutradharRuntime();
const { sessionId: sid, activeTabId: tid } = await rt.launch({ launch: { headless: true } });
const page = rt.sessionManager.getSession(sid).getTab(tid).page;
const out = [];
for (const [label, sel, state, trig] of [
  ['hidden-main-banner-while-oopif-busy', '#banner', 'hidden', "document.getElementById('banner').style.display='none'"],
  ['visible-main-toast-while-oopif-busy', '#toast', 'visible', "document.getElementById('toast').style.display='block'"],
  ['visible-never-while-oopif-busy', '#nope', 'visible', ''],
]) {
  await page.goto(`http://127.0.0.1:${port}/?n=${Math.random()}`);
  await new Promise((r) => setTimeout(r, 500));
  const frames = page.frames();
  const f = frames.find((fr) => fr.url().includes('/frame'));
  const oopif = f ? f._id !== page.mainFrame()._id && (f.client !== page.mainFrame().client) : null;
  // make the iframe renderer busy for 8s starting now (fire-and-forget)
  f?.evaluate(() => window.__busy(2000)).catch(() => {});
  if (trig) await page.evaluate(`setTimeout(() => { ${trig} }, 500)`);
  const t0 = Date.now();
  const r = await rt.waitForSelector(sid, sel, 3000, tid, state);
  const rec = { label, frames: frames.length, iframeFound: !!f, iframeUrl: f?.url(), success: r.success, retriesUsed: r.retriesUsed, error: r.error?.slice(0, 200), totalMs: Date.now() - t0 };
  console.log('RESULT ' + JSON.stringify(rec)); out.push(rec);
  await new Promise((r) => setTimeout(r, 2500));
}
fs.writeFileSync(path.join(here, 'probe-busy-oopif-2s-results.json'), JSON.stringify(out, null, 2));
await rt.shutdown(sid).catch(() => {});
server.close();
process.exit(0);
