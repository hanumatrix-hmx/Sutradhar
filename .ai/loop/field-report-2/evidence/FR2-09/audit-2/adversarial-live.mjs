// FR2-09 audit-2: independent live checks + new adversarial angles.
//  A. GAP-146 re-verification with fresh cases (not fix-1's case): long-collide, bracket-collide,
//     long-unique, newline/quote name — snapshot vs ax_snapshot designators must agree.
//  B. NEW: duplicate-named frame where one copy has NO interactive content (snapshot's uniqueness
//     list is built only from frames that have listed nodes; ax_snapshot's from ALL frames).
//  C. NEW: displayFrameUrl pure-function edge cases (long https + query, two long file:// paths
//     with same file name, threshold at 80/81, UNC host, data/blob).
//  D. Step-0 row (i) for real on the PRE-change build (main checkout dist) vs POST: busy OOPIF.
//  E. PROB-046 claim "no available signal from outside the frame": probe frame.frameElement()
//     (evaluated in the PARENT realm, not the blocked one) for the XFO-blocked frame's real src.
import http from 'node:http'; import fs from 'node:fs/promises'; import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../../../..');
const mainRepo = 'E:/HMX_Projects/Internal_Projects/PinchTab';
const imp = (p) => import(pathToFileURL(p).href);
const { SutradharRuntime: PostRT } = await imp(path.join(repo, 'packages/capability-runtime/dist/index.js'));
const { SutradharRuntime: PreRT } = await imp(path.join(mainRepo, 'packages/capability-runtime/dist/index.js'));
const B = await imp(path.join(repo, 'packages/browser/dist/index.js'));
const puppeteer = (await imp(path.join(repo, 'packages/browser/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js'))).default;
const results = []; const log = (k, v) => { results.push({ k, v }); console.log(`## ${k}\n${typeof v === 'string' ? v : JSON.stringify(v, null, 2)}`); };

let P = 0;
const pages = {
  // A1: two names identical in their first 30 chars (collide after sanitize)
  a1: `<button>Main</button><iframe name="${'b'.repeat(30)}_first" srcdoc="<button>One</button>"></iframe><iframe name="${'b'.repeat(30)}_second" srcdoc="<button>Two</button>"></iframe>`,
  // A2: 'pay[' and 'pay]' both sanitize to 'pay' (collide)
  a2: `<button>Main</button><iframe name="pay[" srcdoc="<button>One</button>"></iframe><iframe name="pay]" srcdoc="<button>Two</button>"></iframe>`,
  // A3: single long unique name (>30) — both tools must show the same truncated quoted name
  a3: `<button>Main</button><iframe name="${'c'.repeat(45)}" srcdoc="<button>One</button>"></iframe>`,
  // A4: quote + newline in name via attribute entity (&quot; &#10;)
  a4: `<button>Main</button><iframe name="ev&quot;il&#10;[#1] x" srcdoc="<button>One</button>"></iframe>`,
  // B: duplicate name, second copy has only non-interactive, non-AX-interesting text
  b: `<button>Main</button><iframe name="dup" srcdoc="<button>Real</button>"></iframe><iframe name="dup" srcdoc="<p>just text</p>"></iframe>`,
  // B2: duplicate name, second copy hidden (display:none)
  b2: `<button>Main</button><iframe name="dup" srcdoc="<button>Real</button>"></iframe><iframe name="dup" style="display:none" srcdoc="<button>Hidden</button>"></iframe>`,
  // D: busy cross-origin child (localhost) starting busy 1500ms after load, for 8000ms
  busyParent: () => `<button>Main</button><iframe name="xo" src="http://localhost:${P}/busyChild"></iframe>`,
  busyChild: `<button>Child</button><script>setTimeout(()=>{const t=Date.now();while(Date.now()-t<8000){}},1500)</script>`,
  // E: XFO-blocked unnamed frame
  xfoParent: () => `<button>Main</button><iframe src="http://localhost:${P}/xfo-deny?secret=1"></iframe><iframe src="http://127.0.0.1:${P}/xfo-deny"></iframe>`,
};
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); const k = u.pathname.slice(1);
  if (k === 'xfo-deny') { res.writeHead(200, { 'content-type': 'text/html', 'x-frame-options': 'DENY' }); return res.end('denied'); }
  const p = pages[k]; if (!p) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': 'text/html' }); res.end(`<!doctype html><html><body>${typeof p === 'function' ? p() : p}</body></html>`);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r)); P = server.address().port;
const url = (k) => `http://127.0.0.1:${P}/${k}?n=${Date.now()}`;

// ---------- A + B: snapshot vs ax_snapshot designator agreement (POST build) ----------
const desig = (s) => [...s.matchAll(/in iframe ("[^"]*"|\d+|\?)/g)].map((m) => m[1]);
const axDesig = (s) => [...s.matchAll(/\[iframe ("[^"]*"|\d+|\?)/g)].map((m) => m[1]);
{
  const rt = new PostRT(); const { sessionId } = await rt.launch({ launch: { headless: true } });
  for (const k of ['a1', 'a2', 'a3', 'a4', 'b', 'b2']) {
    await rt.navigate(sessionId, url(k)); await new Promise((r) => setTimeout(r, 500));
    const snap = (await rt.snapshot(sessionId)).interactiveElements; const ax = (await rt.axSnapshot(sessionId)).listing;
    const d1 = [...new Set(desig(snap))], d2 = [...new Set(axDesig(ax))];
    log(`${k} snapshot`, snap); log(`${k} ax_snapshot`, ax);
    log(`${k} VERDICT`, { snapshotDesignators: d1, axDesignators: d2, agree: JSON.stringify(d1) === JSON.stringify(d2) });
  }
  await rt.shutdown(sessionId);
}

// ---------- C: displayFrameUrl pure edge cases ----------
{
  const deep = 'file:///E:/' + 'very_long_directory_name/'.repeat(4);
  const cases = {
    longHttpsWithQuery: 'https://shop.example.com/checkout/payment/step-3/confirm/3ds-challenge/frame.html?session=SECRET_TOKEN_abcdef0123456789&x=1#frag',
    longHttpsNoPath: 'https://' + 'sub.'.repeat(20) + 'example.com/?token=SECRET',
    fileA: deep + 'projA/inner.html',
    fileB: deep + 'projB/inner.html',
    file80: 'file:///' + 'x'.repeat(80 - 'file:///'.length - 5) + '.html',
    file81: 'file:///' + 'x'.repeat(81 - 'file:///'.length - 5) + '.html',
    fileLongName: 'file:///E:/' + 'n'.repeat(90) + '.html',
    fileUNC: 'file://fileserver/share/' + 'd/'.repeat(40) + 'inner.html',
    fileQuery: deep + 'inner.html?token=SECRET#frag',
    fileTrailingSlash: deep + 'dir/',
    fileEncoded: deep + 'my%20file%22%5D.html',
  };
  const out = {}; for (const [k, v] of Object.entries(cases)) out[k] = { in: v, inLen: v.length, out: B.displayFrameUrl(v), outLen: B.displayFrameUrl(v).length };
  out.__fileA_equals_fileB = out.fileA.out === out.fileB.out;
  out.__query_leak = Object.values(out).some((o) => o && typeof o.out === 'string' && o.out.includes('SECRET'));
  log('C displayFrameUrl edge cases', out);
}

// ---------- D: busy OOPIF, PRE vs POST ----------
for (const [label, RT] of [['PRE (main checkout dist)', PreRT], ['POST (worktree dist)', PostRT]]) {
  const rt = new RT(); const { sessionId } = await rt.launch({ launch: { headless: true } });
  await rt.navigate(sessionId, url('busyParent')); await new Promise((r) => setTimeout(r, 2000));
  const t = Date.now(); const s = (await rt.snapshot(sessionId)).interactiveElements; const ms = Date.now() - t;
  log(`D busy OOPIF snapshot ${label}`, { elapsedMs: ms, listing: s });
  await new Promise((r) => setTimeout(r, 8000)); await rt.shutdown(sessionId);
}

// ---------- E: PROB-046 — can the XFO-blocked frame's real src be recovered from the PARENT realm? ----------
{
  const { BrowserLauncher } = B; const exe = new BrowserLauncher().findExecutablePath();
  const br = await puppeteer.launch({ executablePath: exe, headless: true });
  const page = await br.newPage(); await page.goto(url('xfoParent')); await new Promise((r) => setTimeout(r, 1000));
  const rows = [];
  for (const f of page.frames()) {
    if (f === page.mainFrame()) continue;
    const t = Date.now(); let src = null, err = null;
    try { const h = await f.frameElement(); src = h ? await h.evaluate((el) => el.src) : null; await h?.dispose(); } catch (e) { err = String(e.message).slice(0, 120); }
    rows.push({ frameUrl: f.url(), name: f.name(), recoveredSrcFromParent: src, err, elapsedMs: Date.now() - t });
  }
  log('E PROB-046 frameElement() probe', rows);
  await br.close();
}
server.close();
await fs.writeFile(path.join(here, 'adversarial-live.json'), JSON.stringify(results, null, 2));
process.exit(0);
