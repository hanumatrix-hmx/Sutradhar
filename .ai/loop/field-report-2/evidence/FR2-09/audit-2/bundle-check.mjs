// FR2-09 audit-2: spec section 5.5 "Bundle" surface — never exercised by run-1, audit-1 or fix-1.
// Proves esbuild's bundle (packages/sutradhar/dist/index.js, freshly built) keeps scrapeFrame /
// extractAndStampEventListenerElement serializable for frame.evaluate, and emits frame + shadow labels
// (depth-3 chain, OOPIF frame label, a shadow node inside an iframe, and a click on the OOPIF button).
import http from 'node:http'; import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../../../..');
const sd = await import(pathToFileURL(path.join(repo, 'packages/sutradhar/dist/index.js')).href);
let P = 0; let clicked = null;
const shadowDefs = `<script>
customElements.define('pay-shell',class extends HTMLElement{connectedCallback(){this.attachShadow({mode:'open'}).innerHTML='<button>Depth one</button><card-field class="cvc"></card-field>'}});
customElements.define('card-field',class extends HTMLElement{connectedCallback(){this.attachShadow({mode:'open'}).innerHTML='<input aria-label="Depth two"><x-inner id="deep"></x-inner>'}});
customElements.define('x-inner',class extends HTMLElement{connectedCallback(){this.attachShadow({mode:'open'}).innerHTML='<button>Depth three</button>'}});
</script>`;
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/clicked') { clicked = u.searchParams.get('id'); res.end('ok'); return; }
  res.writeHead(200, { 'content-type': 'text/html' });
  if (u.pathname === '/child') return res.end(`<!doctype html><button id="pay-btn" onclick="fetch('/clicked?id=pay-btn')">Pay</button><pay-shell id="shell"></pay-shell>${shadowDefs}`);
  res.end(`<!doctype html><button>Main</button><pay-shell id="shell"></pay-shell>${shadowDefs}<iframe name="xo" src="http://localhost:${P}/child?role=xo&token=SECRET"></iframe>`);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r)); P = server.address().port;
const browser = await sd.launch({ headless: true });
const page = await browser.newPage(`http://127.0.0.1:${P}/?n=${Date.now()}`);
await new Promise((r) => setTimeout(r, 1000));
const snap = await page.snapshot();
console.log(snap.interactiveElements);
const lines = snap.interactiveElements.split('\n');
const payLine = lines.find((l) => /in iframe "xo".*button "Pay"/.test(l));
const checks = {
  depth1: lines.some((l) => /^\[#\d+\] button "Depth one" \(shadow: pay-shell#shell\)$/.test(l)),
  depth2: lines.some((l) => /input .*\(shadow: pay-shell#shell > card-field\.cvc\)$/.test(l) && !l.includes('in iframe')),
  depth3: lines.some((l) => /^\[#\d+\] button "Depth three" \(shadow: pay-shell#shell > … > x-inner#deep\)$/.test(l)),
  oopifLabelWithUrlNoQuery: lines.some((l) => l.includes(`in iframe "xo" (http://localhost:${P}/child)`)) && !snap.interactiveElements.includes('SECRET'),
  iframePlusShadowCooccur: lines.some((l) => /in iframe "xo"\] button "Depth three" \(shadow: pay-shell#shell > … > x-inner#deep\)$/.test(l)),
};
const id = payLine?.match(/^\[#(\d+)/)?.[1];
await page.click(id);
await new Promise((r) => setTimeout(r, 500));
checks.clickOopifPayById = clicked === 'pay-btn';
console.log(JSON.stringify({ payLine, id, checks, allPass: Object.values(checks).every(Boolean) }, null, 2));
await browser.close(); server.close(); process.exit(0);
