// FR2-07 fix-2 step 0 SPIKE. Real Chrome via puppeteer-core. Confirms:
//  (a) frame.frameElement() reaches same-origin, srcdoc, sandboxed and cross-origin (OOPIF) frames
//  (b) Range.getClientRects() is empty for display:none / content-visibility:hidden text, non-empty for rendered text
//  (c) computed visibility is inherited (parent element's computed visibility suffices)
//  (d) a visibility:hidden <iframe> element is detectable from the PARENT side
// Usage: node spike.mjs <repoRoot>
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const repoRoot = process.argv[2];
const require_ = createRequire(path.join(repoRoot, 'packages', 'browser', 'package.json'));
const puppeteer = require_('puppeteer-core');
const { BrowserLauncher } = await import(pathToFileURL(path.join(repoRoot, 'packages', 'browser', 'dist', 'index.js')).href);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const HARD = setTimeout(() => { console.error('HARD DEADLINE'); process.exit(3); }, 5 * 60 * 1000);
let port = 0;
const handler = (req, res) => {
  const u = new URL(req.url, 'http://x');
  const send = (b) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(b); };
  const xo = 'http://localhost:' + port;
  if (u.pathname === '/inner') return send('<!doctype html><p id="t">INNER-' + u.searchParams.get('n') + '</p>');
  if (u.pathname === '/main') {
    return send(`<!doctype html><html><body>
<p id="rendered">RENDEREDTXT</p>
<div id="dn" style="display:none">DISPLAYNONETXT</div>
<div id="cv" style="content-visibility:hidden">CVHIDDENTXT</div>
<div id="vh" style="visibility:hidden">VISHIDDENTXT<span id="vhchild">CHILDINHERITS</span><span id="vhvis" style="visibility:visible">CHILDOVERRIDES</span></div>
<iframe id="same" src="/inner?n=same"></iframe>
<iframe id="srcdoc" srcdoc="<p>INNER-srcdoc</p>"></iframe>
<iframe id="sandbox" sandbox="" srcdoc="<p>INNER-sandbox</p>"></iframe>
<iframe id="xo" src="${xo}/inner?n=xo"></iframe>
<iframe id="xo-vh" style="visibility:hidden" src="${xo}/inner?n=xovh"></iframe>
<iframe id="same-vh" style="visibility:hidden" src="/inner?n=samevh"></iframe>
<iframe id="xo-dn" style="display:none" src="${xo}/inner?n=xodn"></iframe>
<div style="visibility:hidden"><iframe id="xo-anc-vh" src="${xo}/inner?n=xoancvh"></iframe></div>
</body></html>`);
  }
  res.writeHead(404); res.end();
};
const s4 = http.createServer(handler); await new Promise((r) => s4.listen(0, '127.0.0.1', r)); port = s4.address().port;
const s6 = http.createServer(handler); await new Promise((r) => { s6.once('error', r); s6.listen(port, '::1', r); });
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'fr207-fix2-spike-'));
const b = await puppeteer.launch({ executablePath: new BrowserLauncher().findExecutablePath(), headless: true, userDataDir: profile });
console.log('PIDS', JSON.stringify({ chrome: b.process()?.pid, self: process.pid }));
const out = { a: [], b: [], c: [], d: [] };
try {
  const p = await b.newPage();
  await p.setViewport({ width: 1000, height: 800 });
  await p.goto('http://127.0.0.1:' + port + '/main', { waitUntil: 'load' });
  await delay(1500);
  // (a) frameElement reaches each frame
  for (const f of p.frames()) {
    if (f === p.mainFrame()) continue;
    let r;
    try {
      const h = await Promise.race([f.frameElement(), delay(3000).then(() => 'HANG')]);
      if (h === 'HANG') r = 'HANG';
      else if (!h) r = 'null';
      else {
        // judge from the PARENT side: evaluate in the parent frame on the element handle
        const info = await h.evaluate((el) => {
          const cs = getComputedStyle(el);
          return { id: el.id, tag: el.tagName, visibility: cs.visibility, display: cs.display, rects: el.getClientRects().length, w: Math.round(el.getBoundingClientRect().width) };
        });
        r = { ok: true, info };
      }
    } catch (e) { r = 'ERR:' + String(e.message).slice(0, 100); }
    out.a.push({ url: f.url().slice(0, 60), oopif: f.isOOPFrame?.(), r });
  }
  // (b)/(c) Range rects + visibility of the parent element, in the main frame
  out.b = await p.mainFrame().evaluate(() => {
    const rows = [];
    for (const id of ['rendered', 'dn', 'cv', 'vh', 'vhchild', 'vhvis']) {
      const el = document.getElementById(id);
      const tn = [...el.childNodes].find((n) => n.nodeType === 3) ?? el.firstChild;
      const rg = document.createRange(); rg.selectNodeContents(tn);
      rows.push({ id, text: tn.textContent, rangeRects: rg.getClientRects().length, parentVisibility: getComputedStyle(tn.parentElement).visibility, parentDisplay: getComputedStyle(tn.parentElement).display, elementRects: el.getClientRects().length });
    }
    return rows;
  });
  // (b) inside a frame: rects of its own text
  for (const f of p.frames()) {
    if (f === p.mainFrame()) continue;
    let r;
    try {
      r = await Promise.race([f.evaluate(() => { const t = document.querySelector('p').firstChild; const rg = document.createRange(); rg.selectNodeContents(t); return { text: t.textContent, rangeRects: rg.getClientRects().length, visibility: getComputedStyle(t.parentElement).visibility }; }), delay(3000).then(() => 'HANG')]);
    } catch (e) { r = 'ERR:' + String(e.message).slice(0, 100); }
    out.c.push({ url: f.url().slice(0, 60), r });
  }
} finally {
  await b.close(); s4.close(); s6.close(); await fs.rm(profile, { recursive: true, force: true }).catch(() => {});
}
console.log('(a)+(d) frameElement() per frame, judged from parent side:'); for (const x of out.a) console.log(JSON.stringify(x));
console.log('(b)+(c) text node Range rects and parent visibility (main frame):'); for (const x of out.b) console.log(JSON.stringify(x));
console.log('(b) in-frame Range rects of the frame own text (frame is judged separately from parent):'); for (const x of out.c) console.log(JSON.stringify(x));
clearTimeout(HARD); process.exit(0);
