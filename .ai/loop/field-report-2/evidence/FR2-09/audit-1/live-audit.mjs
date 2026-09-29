// FR2-09 audit-1: independent live verification (auditor-written, NOT the Executor's script).
// Own fixtures (served in-script), real Chrome, real SutradharRuntime + real MCP server.
// Observer = a puppeteer-core connection to the same Chrome, used for ground truth.
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../../../..');
const imp = (p) => import(pathToFileURL(path.join(repo, p)).href);
const puppeteer = (await imp('packages/browser/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js')).default;
const { SutradharRuntime } = await imp('packages/capability-runtime/dist/index.js');
const { BrowserLauncher } = await imp('packages/browser/dist/index.js');

let fails = 0;
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== undefined ? ' :: ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`);
}
const note = (s) => console.log(`NOTE ${s}`);

// ── fixtures ────────────────────────────────────────────────────────────────────────────────
let P = 0;
const BUSY_SCRIPT = `<script>
window.__busy=(ms)=>{const t=Date.now();while(Date.now()-t<ms){}};
addEventListener('message',(e)=>{if(e.data&&e.data.busy)setTimeout(()=>__busy(e.data.busy),0);});
</script>`;
const pages = {
  // main page: 3-level nested shadow in main doc, same-origin named frame (itself nesting a
  // cross-origin frame, which nests a srcdoc frame = 3 iframe levels), a named OOPIF, an unnamed
  // srcdoc frame, an XFO-denied frame, and a long/special-char-named frame.
  '/main.html': () => `<!doctype html><html><head><title>audit main</title></head><body>
<button id="top">Top button</button>
<outer-app id="root"></outer-app>
<iframe name="checkout" src="/inner.html?token=SECRET123#frag" width="400" height="300"></iframe>
<iframe name="remote" src="http://localhost:${P}/remote.html?q=1" width="300" height="200"></iframe>
<iframe srcdoc="<button>Srcdoc thing</button>" width="200" height="60"></iframe>
<iframe name="deny" src="http://localhost:${P}/deny" width="200" height="60"></iframe>
<iframe name="this-is-a-really-long-frame-name-over-30" srcdoc="<button>Longname btn</button>" width="200" height="60"></iframe>
<script>
customElements.define('outer-app', class extends HTMLElement { connectedCallback(){ const r=this.attachShadow({mode:'open'}); r.innerHTML='<button>Shadow one</button><mid-el class="wrap  big"></mid-el>'; }});
customElements.define('mid-el', class extends HTMLElement { connectedCallback(){ const r=this.attachShadow({mode:'open'}); r.innerHTML='<input aria-label="Shadow two"><leaf-el id="le af&quot;x"></leaf-el>'; }});
customElements.define('leaf-el', class extends HTMLElement { connectedCallback(){ const r=this.attachShadow({mode:'open'}); r.innerHTML='<button>Shadow three</button>'; }});
</script></body></html>`,
  '/inner.html': () => `<!doctype html><html><body>
<input aria-label="Card num"><button>Submit order</button>
<card-box id="cb"></card-box>
<iframe name="lvl2" src="http://localhost:${P}/lvl2.html" width="300" height="120"></iframe>
<script>customElements.define('card-box', class extends HTMLElement { connectedCallback(){ const r=this.attachShadow({mode:'open'}); r.innerHTML='<input aria-label="Security code">'; }});</script>
</body></html>`,
  '/lvl2.html': () => `<!doctype html><html><body><button>Level two</button>
<iframe name="lvl3" srcdoc="<button>Level three</button>" width="200" height="60"></iframe></body></html>`,
  '/remote.html': () => `<!doctype html><html><body><button>Remote go</button><input aria-label="Remote field">${BUSY_SCRIPT}</body></html>`,
  // busy page: named OOPIF that busy-loops on message, a SECOND same-site (localhost) sibling
  // frame (same renderer process → blocked too), and a 127.0.0.1 frame scanned after both.
  '/busypage.html': () => `<!doctype html><html><head><title>audit busy</title></head><body>
<button>Main alive</button>
<iframe name="busyx" src="http://localhost:${P}/remote.html?b=1" width="300" height="100"></iframe>
<iframe name="sib" src="http://localhost:${P}/remote.html?b=2" width="300" height="100"></iframe>
<iframe name="after" src="/lvl2.html" width="300" height="100"></iframe>
</body></html>`,
  '/samebusy.html': () => `<!doctype html><html><head><title>audit same busy</title></head><body>
<button>Main alive</button>
<iframe name="samex" src="/remote.html?same=1" width="300" height="100"></iframe></body></html>`,
  // flip page: a named frame that keeps navigating between two docs every few ms.
  '/flippage.html': () => `<!doctype html><html><head><title>audit flip</title></head><body>
<button>Main alive</button>
<iframe name="flip" src="/flipA.html" width="300" height="100"></iframe></body></html>`,
  '/flipA.html': () => `<!doctype html><html><body><button>Doc A button</button><script>setTimeout(()=>location.replace('/flipB.html'),15)</script></body></html>`,
  '/flipB.html': () => `<!doctype html><html><body><button>Doc B button</button><script>setTimeout(()=>location.replace('/flipA.html'),15)</script></body></html>`,
};
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/deny') {
    res.writeHead(200, { 'content-type': 'text/html', 'x-frame-options': 'DENY' });
    return res.end('<button>Should never render</button>');
  }
  const f = pages[u.pathname];
  if (!f) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(f());
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
P = server.address().port;
// localhost must also resolve to this server: listen on ::1/127.0.0.1 — Chrome resolves localhost to 127.0.0.1 too.
const base = `http://127.0.0.1:${P}`;
note(`server ${base}`);

// ── browser ─────────────────────────────────────────────────────────────────────────────────
const exe = new BrowserLauncher().findExecutablePath();
const prof = await fs.mkdtemp(path.join(os.tmpdir(), 'fr2-09-audit-'));
const observer = await puppeteer.launch({ executablePath: exe, headless: true, userDataDir: prof, args: ['--no-sandbox'] });
const opage = (await observer.pages())[0];
await opage.goto(`${base}/main.html?n=${Date.now()}`, { waitUntil: 'networkidle0' });

const rt = new SutradharRuntime();
const { sessionId } = await rt.attach({ endpoint: observer.wsEndpoint() });

async function truthIds() {
  // every element stamped with the CURRENT generation of its own document, per frame
  const out = [];
  for (const f of opage.frames()) {
    try {
      const r = await f.evaluate(() => {
        const cur = document.documentElement.getAttribute('data-sd-current-gen');
        const ids = [];
        const walk = (root) => {
          for (const el of root.querySelectorAll('*')) {
            if (el.getAttribute('data-sd-node-id') && el.getAttribute('data-sd-gen') === cur) {
              let chain = []; let rn = el.getRootNode();
              while (rn && rn.host) { chain.unshift(rn.host.tagName.toLowerCase()); rn = rn.host.getRootNode(); }
              ids.push({ id: +el.getAttribute('data-sd-node-id'), text: (el.textContent || el.getAttribute('aria-label') || '').trim(), chain });
            }
            if (el.shadowRoot) walk(el.shadowRoot);
          }
        };
        walk(document);
        return { cur, ids };
      });
      out.push({ url: f.url(), name: f.name(), isMain: f === opage.mainFrame(), ...r });
    } catch (e) { out.push({ url: f.url(), name: f.name(), err: String(e.message).slice(0, 80) }); }
  }
  return out;
}

try {
  // ═══ S1: DOM snapshot labels on main.html ══════════════════════════════════════════════
  const s1 = await rt.snapshot(sessionId, undefined, 200, { includeNodes: true });
  const L = s1.interactiveElements.split('\n');
  console.log('--- S1 listing ---\n' + s1.interactiveElements);
  const line = (re) => L.find((l) => re.test(l));
  check('S1a main light-DOM line has no label', /^\[#\d+\] button "Top button"$/.test(line(/Top button/) ?? ''), line(/Top button/));
  check('S1b shadow depth1', / \(shadow: outer-app#root\)$/.test(line(/"Shadow one"/) ?? ''), line(/"Shadow one"/));
  check('S1c shadow depth2 uses first class, sanitized', / \(shadow: outer-app#root > mid-el\.wrap\)$/.test(line(/"Shadow two"/) ?? ''), line(/"Shadow two"/));
  check('S1d shadow depth3 → outer > … > inner, host id sanitized to [\\w-]', / \(shadow: outer-app#root > … > leaf-el#leafx\)$/.test(line(/"Shadow three"/) ?? ''), line(/"Shadow three"/));
  const ckFirst = line(/in iframe "checkout"/);
  check('S1e same-origin named frame: first line has URL with query+fragment dropped', /^\[#\d+ in iframe "checkout" \(http:\/\/127\.0\.0\.1:\d+\/inner\.html\)\] /.test(ckFirst ?? ''), ckFirst);
  check('S1f secret query value never printed in listing', !s1.interactiveElements.includes('SECRET123'));
  const ckLines = L.filter((l) => l.includes('in iframe "checkout"'));
  check('S1g checkout later lines omit URL', ckLines.length >= 3 && ckLines.slice(1).every((l) => /^\[#\d+ in iframe "checkout"\] /.test(l)), ckLines);
  check('S1h iframe+shadow co-occur', /^\[#\d+ in iframe "checkout"\] input "Security code" \(shadow: card-box#cb\)$/.test(line(/Security code/) ?? ''), line(/Security code/));
  check('S1i OOPIF named remote listed with localhost URL', /^\[#\d+ in iframe "remote" \(http:\/\/localhost:\d+\/remote\.html\)\] button "Remote go"$/.test(line(/Remote go/) ?? ''), line(/Remote go/));
  check('S1j srcdoc unnamed → numeric designator + about:srcdoc', /^\[#\d+ in iframe \d+ \(about:srcdoc\)\] button "Srcdoc thing"$/.test(line(/Srcdoc thing/) ?? ''), line(/Srcdoc thing/));
  check('S1k 2-level nested OOPIF (lvl2 inside checkout) labelled', /^\[#\d+ in iframe "lvl2" \(http:\/\/localhost:\d+\/lvl2\.html\)\] button "Level two"$/.test(line(/Level two/) ?? ''), line(/Level two/));
  check('S1l 3-level nested srcdoc (lvl3) labelled', /^\[#\d+ in iframe "lvl3" \(about:srcdoc\)\] button "Level three"$/.test(line(/Level three/) ?? ''), line(/Level three/));
  check('S1m long name sanitized to ≤30 chars in designator', /in iframe "this-is-a-really-long-frame-na"/.test(line(/Longname btn/) ?? ''), line(/Longname btn/));
  const denyLine = L.find((l) => l.includes('"deny"'));
  check('S1n XFO-denied frame → error-page placeholder', /^\[iframe "deny" \S+ — not inspectable\] \(browser error page: blocked or failed to load\)$/.test(denyLine ?? ''), denyLine);
  note(`XFO placeholder origin shown: ${denyLine}`);
  check('S1o "Should never render" content not listed', !s1.interactiveElements.includes('Should never render'));
  const hdr = +/Interactive elements \((\d+)\)/.exec(s1.interactiveElements)[1];
  check('S1p header count == number of [#N lines', hdr === L.filter((l) => /^\[#\d+[\] ]/.test(l)).length, { hdr });

  // structured
  const byText = (t) => s1.nodes.find((n) => (n.accessibleName ?? '').includes(t));
  const ck = byText('Card num'), l2 = byText('Level two'), l3 = byText('Level three');
  check('S1q structured frame.url keeps full URL incl query+fragment', ck?.frame?.url?.endsWith('/inner.html?token=SECRET123#frag'), ck?.frame);
  check('S1r lvl2 parentIndex == checkout index', l2?.frame?.parentIndex === ck?.frame?.index && ck?.frame?.parentIndex === undefined, { ck: ck?.frame, l2: l2?.frame });
  check('S1s lvl3 parentIndex == lvl2 index', l3?.frame?.parentIndex === l2?.frame?.index, l3?.frame);
  check('S1t main nodes have no frame key; light-DOM nodes have no shadowHosts key', !('frame' in byText('Top button')) && !('shadowHosts' in byText('Top button')));
  check('S1u shadowHosts full chain (3) in structured form', JSON.stringify(byText('Shadow three')?.shadowHosts) === JSON.stringify(['outer-app#root', 'mid-el.wrap', 'leaf-el#leafx']), byText('Shadow three')?.shadowHosts);
  check('S1v skippedFrames has deny error-page', s1.skippedFrames?.some((s) => s.name === 'deny' && s.reason === 'error-page'), s1.skippedFrames);

  // ADV-b: id uniqueness and truth
  const ids = s1.nodes.map((n) => n.id);
  check('ADV-b1 structured ids unique', new Set(ids).size === ids.length, ids);
  const truth = await truthIds();
  note("truth frames: " + JSON.stringify(truth.map((t) => ({ name: t.name, url: t.url, err: t.err, ids: (t.ids ?? []).map((x) => x.id) }))));
  const tIds = truth.flatMap((t) => (t.ids ?? []).map((x) => ({ ...x, frameUrl: t.url, frameName: t.name, isMain: t.isMain })));
  const dup = tIds.filter((x, i) => tIds.findIndex((y) => y.id === x.id) !== i);
  check('ADV-b2 no id stamped (current gen) in two different frames/elements', dup.length === 0, dup);
  // every listed [#N in iframe D] lives in the frame named D (or main if unlabelled)
  const mism = [];
  for (const l of L) {
    const m = /^\[#(\d+)( in iframe ("([^"]*)"|\d+|\?))?/.exec(l);
    if (!m) continue;
    const t = tIds.find((x) => x.id === +m[1]);
    if (!t) { mism.push({ l, why: 'no truth element' }); continue; }
    if (!m[2] && !t.isMain) mism.push({ l, why: 'unlabelled but in child frame ' + t.frameUrl });
    if (m[4] !== undefined && !t.frameName.startsWith(m[4])) mism.push({ l, why: 'frame name ' + t.frameName });
    const sh = /\(shadow: (.*)\)$/.exec(l);
    if (!sh && t.chain.length) mism.push({ l, why: 'missing shadow ' + t.chain });
    if (sh && !sh[1].startsWith(t.chain[0])) mism.push({ l, why: 'shadow mismatch ' + t.chain });
  }
  check('ADV-b3 observer ground truth: every label points at the right frame/shadow', mism.length === 0, mism);

  // modes
  const nt = (await rt.snapshot(sessionId, undefined, 200, { noText: true })).interactiveElements;
  check('S1w noText: designator kept, no URL, no shadow', /^\[#\d+ in iframe "checkout"\] input$/m.test(nt) && !nt.includes('(http') && !nt.includes('(shadow:'), nt.split('\n').slice(3, 8));
  check('S1x noText still has placeholder', nt.includes('— not inspectable]'));
  const io = (await rt.snapshot(sessionId, undefined, 200, { idsOnly: true })).interactiveElements;
  check('S1y idsOnly: node lines exactly [#N], placeholder kept', io.split('\n').slice(3).every((l) => /^\[#\d+\]$/.test(l) || /not inspectable/.test(l)) && io.includes('not inspectable'));

  // actionability via id (OOPIF + shadow-in-frame)
  const remoteId = /^\[#(\d+)/.exec(line(/Remote go/))[1];
  const rc = await rt.click(sessionId, remoteId);
  check('S1z click by id into OOPIF succeeds', rc.success !== false, rc);
  const secId = /^\[#(\d+)/.exec(line(/Security code/))[1];
  await rt.type(sessionId, secId, '424');
  const typed = await opage.frames().find((f) => f.name() === 'checkout').evaluate(() => document.querySelector('card-box').shadowRoot.querySelector('input').value);
  check('S1za type by id into shadow-in-iframe', typed === '424', typed);

  // ═══ S2: ax_snapshot nesting ═══════════════════════════════════════════════════════════
  const ax = await rt.axSnapshot(sessionId);
  console.log('--- S2 ax listing ---\n' + ax.listing);
  const AX = ax.listing.split('\n');
  const ai = (re) => AX.findIndex((l) => re.test(l));
  const iCk = ai(/^\[iframe "checkout" \(http:\/\/127\.0\.0\.1:\d+\/inner\.html\)\]$/);
  const iL2 = ai(/^  \[iframe "lvl2" \(http:\/\/localhost:\d+\/lvl2\.html\)\]$/);
  const iL2b = ai(/^    \[button\] "Level two"$/);
  const iL3 = ai(/^    \[iframe "lvl3" \(about:srcdoc\)\]$/);
  const iL3b = ai(/^      \[button\] "Level three"$/);
  check('ADV-c1 ax: checkout header at depth 0', iCk >= 0);
  check('ADV-c2 ax: lvl2 header at depth 1 under checkout', iL2 > iCk);
  check('ADV-c3 ax: lvl2 content at depth 2', iL2b > iL2);
  check('ADV-c4 ax: lvl3 header at depth 2 under lvl2', iL3 > iL2);
  check('ADV-c5 ax: lvl3 content at depth 3', iL3b > iL3);
  check('ADV-c6 ax: OOPIF remote grouped', ai(/^\[iframe "remote" \(http:\/\/localhost:\d+\/remote\.html\)\]$/) >= 0 && ai(/^  \[button\] "Remote go"$/) >= 0);
  check('ADV-c7 ax: no fallback note on healthy page', !ax.listing.includes('iframes not included'));
  const axLong = AX.find((l) => l.includes('Longname') ) ;
  const axLongHdr = AX[AX.indexOf(axLong) - 1];
  note(`ax long-name frame header: ${axLongHdr}`);
  check('ADV-e ax designator for long (>30 char) name matches DOM snapshot designator ("this-is-a-really-long-frame-na")', /\[iframe "this-is-a-really-long-frame-na"/.test(axLongHdr ?? ''), axLongHdr);
  check('S2 ax: shadow content present, no shadow labels (D12)', ax.listing.includes('"Shadow three"') && !ax.listing.includes('shadow:'));

  // ═══ S3: busy OOPIF timeout + sibling same-site frame ══════════════════════════════════
  await opage.goto(`${base}/busypage.html?n=${Date.now()}`, { waitUntil: 'networkidle0' });
  const warm = await rt.snapshot(sessionId, undefined, 200, { includeNodes: true });
  note('warm busypage listing:\n' + warm.interactiveElements);
  await opage.evaluate(() => document.querySelector('iframe[name=busyx]').contentWindow.postMessage({ busy: 14000 }, '*'));
  await new Promise((r) => setTimeout(r, 300));
  let t0 = Date.now();
  const s3 = await rt.snapshot(sessionId, undefined, 200, { includeNodes: true });
  const s3ms = Date.now() - t0;
  console.log(`--- S3 busy listing (${s3ms}ms) ---\n` + s3.interactiveElements);
  check('S3a busy OOPIF placeholder with 5000ms', /^\[iframe "busyx" http:\/\/localhost:\d+ — not inspectable\] \(timed out after 5000ms\)$/m.test(s3.interactiveElements));
  check('S3b main still listed', s3.interactiveElements.includes('"Main alive"'));
  const sibTimedOut = s3.skippedFrames.some((s) => s.name === 'sib' && s.reason === 'timeout');
  note(`ADV-d same-site sibling "sib" also timed out: ${sibTimedOut}; total elapsed ${s3ms}ms`);
  check('ADV-d snapshot bounded at ~5s even with TWO frames sharing the busy renderer (spec N10: ≤ ~6.5s)', s3ms < 6500, { s3ms, sibTimedOut });
  const afterNode = s3.nodes.find((n) => n.frame?.name === 'after');
  const mainMax = Math.max(...s3.nodes.filter((n) => !n.frame).map((n) => n.id));
  check('S3c ids after the timed-out frame jump by the reserved 300', afterNode && afterNode.id >= mainMax + 300, { mainMax, after: afterNode?.id });
  // ax during busy
  await opage.evaluate(() => document.querySelector('iframe[name=busyx]').contentWindow.postMessage({ busy: 9000 }, '*'));
  await new Promise((r) => setTimeout(r, 7000 - (Date.now() - t0 - s3ms) > 0 ? 0 : 0));
  // wait for first busy period to end, then trigger a fresh one for ax
  await new Promise((r) => setTimeout(r, Math.max(0, 14000 - (Date.now() - t0)) + 500));
  await opage.evaluate(() => document.querySelector('iframe[name=busyx]').contentWindow.postMessage({ busy: 9000 }, '*'));
  await new Promise((r) => setTimeout(r, 300));
  t0 = Date.now();
  const axb = await rt.axSnapshot(sessionId);
  const axms = Date.now() - t0;
  console.log(`--- S3 ax busy (${axms}ms) ---\n` + axb.listing);
  check('S3d ax bounded (<7000ms) with fallback note', axms < 7000 && /\[iframes not included — reading an iframe's accessibility tree timed out after 5000ms\]$/.test(axb.listing), { axms });
  await new Promise((r) => setTimeout(r, 9500));
  // late-completing abandoned scrapes have now stamped; check no current-gen dup ids
  const tb = await truthIds();
  const allB = tb.flatMap((t) => (t.ids ?? []).map((x) => ({ id: x.id, f: t.name || 'main', gen: t.cur })));
  note('post-busy truth: ' + JSON.stringify(allB));
  const lastGen = String(Math.max(...allB.map((x) => +x.gen)));
  const g = allB.filter((x) => x.gen === lastGen);
  check('S3e no duplicate ids in the latest generation after late stamps land', new Set(g.map((x) => x.id)).size === g.length, g);
  const re = await rt.snapshot(sessionId, undefined, 200, { includeNodes: true });
  check('S3f re-snapshot after busy lists busyx normally', re.skippedFrames.length === 0 && /in iframe "busyx"/.test(re.interactiveElements), re.skippedFrames);

  // ═══ S4: same-origin busy iframe (Executor-flagged limitation) ═════════════════════════
  await opage.goto(`${base}/samebusy.html?n=${Date.now()}`, { waitUntil: 'networkidle0' });
  await opage.evaluate(() => document.querySelector('iframe[name=samex]').contentWindow.postMessage({ busy: 8000 }, '*'));
  await new Promise((r) => setTimeout(r, 300));
  t0 = Date.now();
  const s4 = await rt.snapshot(sessionId, undefined, 200, { includeNodes: true });
  const s4ms = Date.now() - t0;
  console.log(`--- S4 same-origin busy (${s4ms}ms) ---\n` + s4.interactiveElements);
  note(`LIMITATION-REPRO same-origin busy iframe: snapshot took ${s4ms}ms (busy 8000ms), skipped=${JSON.stringify(s4.skippedFrames)}`);
  check('S4 limitation reproduced: same-process busy frame is NOT bounded by the 5s timeout', s4ms > 6500, { s4ms });

  // ═══ S5: frame navigating away mid-scrape (ADV-a) ══════════════════════════════════════
  await opage.goto(`${base}/flippage.html?n=${Date.now()}`, { waitUntil: 'load' });
  const flipStats = { runs: 0, listedA: 0, listedB: 0, navigated: 0, error: 0, wrongUrl: [], threw: 0, other: [] };
  for (let i = 0; i < 60; i++) {
    let s;
    try { s = await rt.snapshot(sessionId, undefined, 200, { includeNodes: true }); } catch (e) { flipStats.threw++; continue; }
    flipStats.runs++;
    for (const n of s.nodes.filter((n) => n.frame?.name === 'flip')) {
      const isA = n.accessibleName.includes('Doc A');
      isA ? flipStats.listedA++ : flipStats.listedB++;
      const urlDoc = n.frame.url.includes('flipA') ? 'A' : n.frame.url.includes('flipB') ? 'B' : '?';
      if ((isA ? 'A' : 'B') !== urlDoc) flipStats.wrongUrl.push({ name: n.accessibleName, url: n.frame.url });
    }
    for (const sk of s.skippedFrames) {
      if (sk.reason === 'navigated') flipStats.navigated++;
      else if (sk.reason === 'error') { flipStats.error++; flipStats.other.push(sk.detail); }
      else flipStats.other.push(sk.reason);
    }
    await new Promise((r) => setTimeout(r, 7));
  }
  console.log('--- S5 flip stats ---\n' + JSON.stringify(flipStats, null, 1));
  check('ADV-a1 snapshot never throws while a frame navigates continuously', flipStats.threw === 0, flipStats.threw);
  check('ADV-a2 no node labelled with the OTHER document\'s URL (stale/wrong frame label)', flipStats.wrongUrl.length === 0, flipStats.wrongUrl.slice(0, 5));
  note(`ADV-a3 mid-scrape outcomes: navigated=${flipStats.navigated} error=${flipStats.error} other=${JSON.stringify([...new Set(flipStats.other)])}`);

  // ═══ S6: MCP surface smoke (skipped-frames JSON block + description) ═══════════════════
  await opage.goto(`${base}/main.html?n=${Date.now()}`, { waitUntil: 'networkidle0' });
  const child = spawn(process.execPath, [path.join(repo, 'packages/mcp-server/dist/cli.js')], { stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = ''; const pend = new Map(); let nid = 1;
  child.stdout.on('data', (c) => { buf += c; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); try { const m = JSON.parse(l); pend.get(m.id)?.(m); pend.delete(m.id); } catch {} } });
  const call = (method, params) => new Promise((res) => { const id = nid++; pend.set(id, res); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  const tool = async (name, args) => (await call('tools/call', { name, arguments: args })).result;
  await call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'audit', version: '1' } });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const list = (await call('tools/list', {})).result.tools;
  const snapDesc = list.find((t) => t.name === 'browser.snapshot').description;
  check('S6a MCP snapshot description has in iframe / (shadow: / not inspectable / ^\\[#(\\d+)', ['in iframe', '(shadow:', 'not inspectable', '^\\[#(\\d+)'].every((s) => snapDesc.includes(s)));
  const sid = JSON.parse((await tool('browser.attach', { endpoint: observer.wsEndpoint() })).content[0].text).sessionId;
  const mt = (await tool('browser.snapshot', { sessionId: sid, includeNodes: true, maxElements: 200 })).content[0].text;
  check('S6b MCP snapshot text has OOPIF label', /\[#\d+ in iframe "remote" \(http:\/\/localhost:\d+\/remote\.html\)\] button "Remote go"/.test(mt));
  check('S6c MCP Skipped frames (JSON) block after Structured nodes', /Structured nodes \(JSON\):[\s\S]*\n\nSkipped frames \(JSON\):\n\[.*"error-page"/.test(mt));
  const mtNo = (await tool('browser.snapshot', { sessionId: sid, maxElements: 200 })).content[0].text;
  check('S6d MCP without includeNodes has no JSON blocks', !mtNo.includes('Skipped frames (JSON)') && !mtNo.includes('Structured nodes'));
  const ma = (await tool('browser.ax_snapshot', { sessionId: sid })).content[0].text;
  check('S6e MCP ax_snapshot shows nested iframe headers', /\n  \[iframe "lvl2"/.test(ma) && /\n    \[iframe "lvl3"/.test(ma));
  child.stdin.end(); child.kill();
} catch (e) {
  fails++;
  console.log('FATAL ' + (e.stack || e));
} finally {
  await observer.close().catch(() => {});
  server.close();
  await fs.rm(prof, { recursive: true, force: true }).catch(() => {});
}
await fs.writeFile(path.join(here, 'live-audit-results.json'), JSON.stringify(results, null, 2));
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed, ${fails} failed`);
process.exit(0);
