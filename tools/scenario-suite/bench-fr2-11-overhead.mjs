// FR2-11 overhead measurement (spec L9): the mean per-call cost that RECORDING adds to a runtime call, on the BUILT dist.
// Same code path, two variants in one process, alternating rounds so drift hits both equally:
//   recorded : runtime.eval() as shipped (withHistory -> tab.recordAction -> sanitizeHistoryEntry -> session ring)
//   bypassed : the same runtime.eval() with withHistory replaced by a pass-through (what the call cost before FR2-11)
// Also times tab.recordAction() alone with a realistic verification-bearing entry. Monotonic clock (performance.now) only.
// Run: node tools/scenario-suite/bench-fr2-11-overhead.mjs   -> prints one JSON object; exit 1 if the mean overhead is >= 1 ms.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = (pkg) => pathToFileURL(path.join(here, '..', '..', 'packages', pkg, 'dist', 'index.js')).href;
const { SutradharRuntime } = await import(dist('capability-runtime'));
const { BrowserSession } = await import(dist('browser'));
const { createSessionId } = await import(dist('contracts'));

const page = {
  isClosed: () => false,
  url: () => 'https://a.test/x?token=abc',
  title: async () => 't',
  on() { return page; },
  setRequestInterception: async () => {},
  evaluate: async () => 1,
};
const runtime = new SutradharRuntime();
const session = new BrowserSession(createSessionId('bench'));
runtime.getSessionManager().getSession = () => session;
await session.adoptExistingPage(page);
const tab = session.getTabs()[0];

const N = 3000;
const ROUNDS = 7;
const original = runtime.withHistory;
const passthrough = async (_tab, _meta, _isAr, run) => run();
const time = async (variant) => {
  runtime.withHistory = variant === 'recorded' ? original : passthrough;
  const t0 = performance.now();
  for (let i = 0; i < N; i++) await runtime.eval('bench', `${i}+1`);
  return (performance.now() - t0) / N;
};
await time('recorded'); // warm-up both paths
await time('bypassed');
const rec = [];
const byp = [];
for (let r = 0; r < ROUNDS; r++) {
  rec.push(await time('recorded'));
  byp.push(await time('bypassed'));
}
runtime.withHistory = original;
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

const entry = {
  actionType: 'navigate', success: true, executionTimeMs: 12, timestamp: new Date().toISOString(), target: 'https://a.test/p?token=abc', url: 'https://a.test/p?token=abc',
  verification: { verified: true, urlChanged: true, elementFound: true, confidence: 0.9, reason: "'navigate' verified: a new document committed at https://a.test/p?token=abc",
    evidence: { tier: 'verified', checks: [
      { check: 'navigate.document', outcome: 'pass', expected: 'new-document or url change', observed: 'new-document', detail: 'a new document committed at https://a.test/p?token=abc' },
      { check: 'navigate.http-status', outcome: 'pass', expected: '<400', observed: 200 } ] } },
};
const M = 20000;
const t1 = performance.now();
for (let i = 0; i < M; i++) tab.recordAction(entry);
const recordActionMeanMs = (performance.now() - t1) / M;

const overheadMs = median(rec) - median(byp);
const out = {
  calls: N, rounds: ROUNDS,
  recordedMeanMsPerCall: Number(median(rec).toFixed(5)),
  bypassedMeanMsPerCall: Number(median(byp).toFixed(5)),
  recordingOverheadMsPerCall: Number(overheadMs.toFixed(5)),
  recordActionAloneMeanMs: Number(recordActionMeanMs.toFixed(5)),
  perRoundRecorded: rec.map((x) => Number(x.toFixed(5))),
  perRoundBypassed: byp.map((x) => Number(x.toFixed(5))),
  boundMs: 1,
};
console.log(JSON.stringify(out, null, 2));
process.exitCode = overheadMs < 1 ? 0 : 1;
