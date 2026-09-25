// audit-2: non-finite / oversized timeoutMs (reachable via CLI `wait <ref> abc` -> Number('abc') = NaN,
// and via the SDK's `timeout` option). Does the new Node-side polling loop terminate?
import path from 'node:path'; import fs from 'node:fs'; import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)); const repoRoot = path.resolve(here, '../../../../../..');
const { SutradharRuntime } = await import(pathToFileURL(path.join(repoRoot, 'packages/capability-runtime/dist/index.js')));
const MAIN = pathToFileURL(path.join(repoRoot, 'tools/scenario-suite/fixtures/fr2-01-wait-states.html')).href;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const rt = new SutradharRuntime();
const { sessionId: sid, activeTabId: tid } = await rt.launch({ launch: { headless: true } });
const page = rt.sessionManager.getSession(sid).getTab(tid).page;
await page.goto(MAIN + '#manual');
// count CDP traffic as a proxy for "is something still polling"
let cdpCalls = 0;
const client = page._client?.() ?? null;
const conn = page.browser()._connection ?? null;
const origSend = conn?._rawSend?.bind(conn);
if (conn && origSend) conn._rawSend = (...a) => { cdpCalls++; return origSend(...a); };
const out = [];
for (const [label, t, state] of [['NaN-visible', NaN, 'visible'], ['NaN-hidden', NaN, 'hidden'], ['Infinity-visible', Infinity, 'visible'], ['3e9-visible', 3e9, 'visible']]) {
  const t0 = Date.now();
  const r = await rt.waitForSelector(sid, '#never', t, tid, state === 'hidden' ? 'hidden' : state);
  const took = Date.now() - t0;
  const c0 = cdpCalls; await delay(3000); const c1 = cdpCalls;
  const rec = { label, success: r.success, retriesUsed: r.retriesUsed, error: r.error?.slice(0, 160), tookMs: took, cdpCallsIn3sAfterReturn: c1 - c0, cdpHookInstalled: !!origSend };
  console.log('RESULT ' + JSON.stringify(rec)); out.push(rec);
}
fs.writeFileSync(path.join(here, 'probe-nan-timeout-results.json'), JSON.stringify(out, null, 2));
await rt.shutdown(sid).catch(() => {});
process.exit(0);
