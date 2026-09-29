// FR2-09 fix-1 — GAP-146 live regression check: confirms `snapshot()` and `ax_snapshot()` now
// render frame designators CONSISTENTLY for a page with two frame names that only collide
// AFTER sanitization (identical first 30 characters, distinct raw names) — the exact case
// audit-1 found rendering inconsistently (numeric in one tool, a seemingly-unique quoted name
// in the other) because ax-snapshot.ts built its uniqueness list from RAW names.
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../../../..');
const imp = (p) => import(pathToFileURL(path.join(repo, p)).href);
const { SutradharRuntime } = await imp('packages/capability-runtime/dist/index.js');

const prefix = 'a'.repeat(30);
const html = `<!doctype html><html><body>
<button id="main-btn">Main</button>
<iframe name="${prefix}ONE" srcdoc="<button id='b1'>One</button>"></iframe>
<iframe name="${prefix}TWO" srcdoc="<button id='b2'>Two</button>"></iframe>
</body></html>`;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(html);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;

const rt = new SutradharRuntime();
const { sessionId } = await rt.launch({ launch: { headless: true } });
await rt.navigate(sessionId, `http://127.0.0.1:${port}/?n=${Date.now()}`);
await new Promise((r) => setTimeout(r, 300));

const snap = await rt.snapshot(sessionId);
const ax = await rt.axSnapshot(sessionId);

console.log('--- snapshot() interactiveElements ---');
console.log(snap.interactiveElements);
console.log('--- ax_snapshot() listing ---');
console.log(ax.listing);

const snapHasQuoted = snap.interactiveElements.includes(`"${prefix}`);
const axHasQuoted = ax.listing.includes(`"${prefix}`);
const snapNumeric = /\[#\d+ in iframe 1\]|\[#\d+ in iframe 1 /.test(snap.interactiveElements) || snap.interactiveElements.includes('in iframe 1');
const axNumeric = ax.listing.includes('[iframe 1') && ax.listing.includes('[iframe 2');

const results = {
  snapHasQuotedName: snapHasQuoted,
  axHasQuotedName: axHasQuoted,
  consistent: snapHasQuoted === axHasQuoted,
  bothFellBackToNumeric: !snapHasQuoted && !axHasQuoted,
  snapUsesNumericDesignators: snap.interactiveElements.includes('in iframe 1') && snap.interactiveElements.includes('in iframe 2'),
  axUsesNumericDesignators: axNumeric,
};
console.log('--- GAP-146 regression check result ---');
console.log(JSON.stringify(results, null, 2));

await rt.shutdown(sessionId);
await server.close();

if (!results.consistent || !results.bothFellBackToNumeric) {
  console.error('GAP-146 REGRESSION: snapshot() and ax_snapshot() disagree, or one still shows a quoted (ambiguous) name.');
  process.exit(1);
}
console.log('GAP-146 fix confirmed live: both tools consistently fall back to numeric designators.');
process.exit(0);
