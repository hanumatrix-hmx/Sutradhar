// FR2-12 audit-4: GAP-274 session-leak fix, exercised against the BUILT dist with injected
// failures at every point after createCDPSession() resolves. No browser: fake page/tab objects,
// the same technique as runtime.spec.ts but written independently. Hard cap per case 15s.
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
if (!here.replace(/\\/g, '/').endsWith('/evidence/FR2-12/audit-4')) throw new Error('wrong dir');
const root = path.resolve(here, '..', '..', '..', '..', '..', '..');
const { SutradharRuntime } = await import(pathToFileURL(path.join(root, 'packages', 'capability-runtime', 'dist', 'index.js')));
const URL_ = 'http://127.0.0.1:1/x';
const cap = (p, ms) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('CAP ' + ms)), ms))]);

function mk({ send, on, detach, navigate, evaluate, screenshot, createThrows, createRejects }) {
  const stats = { created: 0, detached: 0, detachCalls: 0 };
  const listeners = new Map();
  const cdp = {
    send: send ?? (async () => undefined),
    on: on ?? ((e, cb) => { listeners.set(e, [...(listeners.get(e) ?? []), cb]); }),
    detach: async () => { stats.detachCalls++; if (detach) await detach(); stats.detached++; },
  };
  const page = {
    createCDPSession: () => {
      if (createThrows) throw new Error('create sync throw');
      if (createRejects) return Promise.reject(new Error('create reject'));
      stats.created++; return Promise.resolve(cdp);
    },
    screenshot: screenshot ?? (async () => 'iVBORw0KGgo='),
    evaluate: evaluate ?? (async () => ({ issues: [], webVitals: { lcpMs: 1, cls: 0, fcpMs: 1, ttfbMs: 1 }, timeOrigin: Date.now(), pageWasHidden: false })),
    url: () => URL_,
    title: async () => 'T',
  };
  const tab = { id: 't', observingSince: '2020-01-01T00:00:00.000Z', getConsoleLogs: () => [], getPageErrors: () => [], getNetworkLog: () => [], getPendingDialog: () => null, getTitle: async () => 'T', title: async () => 'T' };
  const runtime = new SutradharRuntime();
  runtime.resolveTab = () => ({ tab });
  runtime.requirePage = () => page;
  runtime.readTitle = async () => 'T';
  runtime.navigate = navigate ?? (async () => ({ tabId: 't', url: URL_, title: 'T' }));
  return { runtime, stats, listeners };
}

const cases = {
  'Page.enable never resolves': { send: (m) => (m === 'Page.enable' ? new Promise(() => {}) : Promise.resolve()) },
  'Page.enable rejects late (1.5s, after bound)': { send: (m) => (m === 'Page.enable' ? new Promise((_, r) => setTimeout(() => r(new Error('late')), 1500)) : Promise.resolve()) },
  'Page.enable rejects immediately': { send: (m) => (m === 'Page.enable' ? Promise.reject(new Error('x')) : Promise.resolve()) },
  'send throws synchronously': { send: () => { throw new Error('sync send throw'); } },
  'Network.enable never resolves': { send: (m) => (m === 'Network.enable' ? new Promise(() => {}) : Promise.resolve()) },
  'getFrameTree never resolves': { send: (m) => (m === 'Page.getFrameTree' ? new Promise(() => {}) : Promise.resolve()) },
  'client.on throws synchronously': { on: () => { throw new Error('on throws'); } },
  'navigate throws': { navigate: async () => { throw new Error('nav failed'); } },
  'navigate throws after hanging Page.enable': { send: (m) => (m === 'Page.enable' ? new Promise(() => {}) : Promise.resolve()), navigate: async () => { throw new Error('nav failed'); } },
  'detach rejects': { detach: async () => { throw new Error('detach failed'); } },
  'evaluate throws (post-detach)': { evaluate: async () => { throw new Error('eval failed'); } },
  'createCDPSession sync throw': { createThrows: true },
  'createCDPSession rejects': { createRejects: true },
};
const out = {};
let unhandled = 0;
process.on('unhandledRejection', (e) => { unhandled++; out.__unhandled = (out.__unhandled ?? []).concat(String(e?.message ?? e)); });
for (const [name, c] of Object.entries(cases)) {
  const { runtime, stats } = mk(c);
  const t0 = Date.now();
  let res;
  try { await cap(runtime.audit('s', { url: URL_, settleMs: 0 }), 15000); res = 'ok'; } catch (e) { res = 'threw: ' + e.message; }
  await new Promise((r) => setTimeout(r, 1700)); // let late rejections surface
  out[name] = { ms: Date.now() - t0 - 1700, res, ...stats, leak: stats.created !== stats.detachCalls };
  console.log(name, JSON.stringify(out[name]));
}
out.__unhandledCount = unhandled;
await fs.writeFile(path.join(here, 'probe-leak-paths.json'), JSON.stringify(out, null, 2));
console.log('unhandled rejections:', unhandled);
process.exit(0);
