// FR2-07 fix-2 step 0 addendum: Range rects were NON-empty for content-visibility:hidden text (spike.mjs (b)).
// Probe which primitive DOES reject it: Element.checkVisibility() on the nearest non-display:contents ancestor.
import fs from 'node:fs/promises'; import os from 'node:os'; import path from 'node:path';
import { createRequire } from 'node:module'; import { pathToFileURL } from 'node:url';
const repoRoot = process.argv[2];
const require_ = createRequire(path.join(repoRoot, 'packages', 'browser', 'package.json'));
const puppeteer = require_('puppeteer-core');
const { BrowserLauncher } = await import(pathToFileURL(path.join(repoRoot, 'packages', 'browser', 'dist', 'index.js')).href);
const HARD = setTimeout(() => process.exit(3), 120000);
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'fr207-fix2-spike2-'));
const b = await puppeteer.launch({ executablePath: new BrowserLauncher().findExecutablePath(), headless: true, userDataDir: profile });
console.log('chrome', await b.version());
const p = await b.newPage();
await p.setContent(`<body>
<p id="rendered">R</p>
<div id="cv" style="content-visibility:hidden">CV<span id="cvchild">CVCHILD</span></div>
<div id="cvauto" style="content-visibility:auto">CVAUTO</div>
<div id="dc" style="display:contents">DC</div>
<details id="det"><summary>s</summary><p id="detp">DETCLOSED</p></details>
<details open><summary>s</summary><p id="detopen">DETOPEN</p></details>
<div id="zero" style="width:0;height:0;overflow:hidden">ZERO</div>
<div id="hid" hidden>HID</div>
<div id="op" style="opacity:0">OP</div>
<div id="off" style="position:absolute;left:-9999px">OFF</div>
<div id="hostcv"></div><script>const h=document.getElementById('hostcv');h.style.contentVisibility='hidden';const sr=h.attachShadow({mode:'open'});sr.appendChild(document.createTextNode('SHADOWBARECV'));</script>
<div id="hostvis"></div><script>const h2=document.getElementById('hostvis');const sr2=h2.attachShadow({mode:'open'});sr2.appendChild(document.createTextNode('SHADOWBARE'));</script>
</body>`);
const rows = await p.evaluate(() => {
  const out = [];
  const tnOf = (root, id) => { const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) if (n.textContent.trim() && n.parentElement && (id ? (n.parentElement.id === id) : true)) return n; };
  for (const id of ['rendered', 'cv', 'cvchild', 'cvauto', 'dc', 'detp', 'detopen', 'zero', 'hid', 'op', 'off']) {
    const el = document.getElementById(id);
    const tn = tnOf(el, null) ?? el.firstChild;
    const rg = document.createRange(); rg.selectNodeContents(tn);
    let e = tn.parentElement; while (e && getComputedStyle(e).display === 'contents' && e.parentElement) e = e.parentElement;
    out.push({ id, rangeRects: rg.getClientRects().length, parentCV: tn.parentElement.checkVisibility(), nearestNonContentsCV: e.checkVisibility(), nearestCVAutoOpt: e.checkVisibility({ contentVisibilityAuto: true }), parentDisplay: getComputedStyle(tn.parentElement).display, parentContentVisibility: getComputedStyle(tn.parentElement).contentVisibility });
  }
  for (const [hid] of [['hostcv'], ['hostvis']]) {
    const host = document.getElementById(hid);
    const tn = host.shadowRoot.firstChild; const rg = document.createRange(); rg.selectNodeContents(tn);
    out.push({ id: hid + '(bare text in shadow)', rangeRects: rg.getClientRects().length, hostCV: host.checkVisibility(), parentElementIsNull: tn.parentElement === null });
  }
  return out;
});
for (const r of rows) console.log(JSON.stringify(r));
await b.close(); await fs.rm(profile, { recursive: true, force: true }).catch(() => {}); clearTimeout(HARD); process.exit(0);
