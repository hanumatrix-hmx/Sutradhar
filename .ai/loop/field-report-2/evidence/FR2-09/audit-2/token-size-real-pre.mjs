// FR2-09 audit-2: token-size gate with a REAL pre-change baseline (not derived by stripping).
// PRE  = the main checkout's built dist (master, dom-semantic-engine.ts last touched at 474baed,
//        identical to this worktree's HEAD for packages/browser/src/dom; verified no frame-labels.js
//        and no "in iframe" text in its dom-semantic-engine.js).
// POST = this worktree's freshly built dist.
// Both runtimes load the SAME fixture file:// URLs (this worktree's paths), so URL header lengths match.
import fs from 'node:fs/promises'; import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../../../..');
const mainRepo = 'E:/HMX_Projects/Internal_Projects/PinchTab';
const { SutradharRuntime: PostRT } = await import(pathToFileURL(path.join(repo, 'packages/capability-runtime/dist/index.js')).href);
const { SutradharRuntime: PreRT } = await import(pathToFileURL(path.join(mainRepo, 'packages/capability-runtime/dist/index.js')).href);
const fx = ['aria-menu', 'fr2-01-singleframe', 'fr2-01-wait-states', 'grounding-completeness', 'prob043-keyboard', 'prompt-injection']
  .map((f) => path.join(repo, 'tools/scenario-suite/fixtures', f + '.html'))
  .concat(['nested-shadow-in-iframe', 'interactive-detection', 'closed-shadow'].map((f) => path.join(repo, 'tools/engine-comparison/hard-fixtures', f + '.html')));
const NONCE = '1790000000000'; // fixed nonce: identical URL length for pre and post
async function collect(RT) {
  const rt = new RT(); const { sessionId } = await rt.launch({ launch: { headless: true } });
  const out = {};
  for (const f of fx) {
    const url = pathToFileURL(f).href + `?n=${NONCE}` + (f.includes('wait-states') ? '#manual' : '');
    await rt.navigate(sessionId, url);
    await new Promise((r) => setTimeout(r, 800));
    const s = await rt.snapshot(sessionId);
    let ax = null; try { ax = (await rt.axSnapshot(sessionId)).listing; } catch (e) { ax = 'ERR ' + e.message; }
    out[path.basename(f)] = { ie: s.interactiveElements, ax };
  }
  await rt.shutdown(sessionId); return out;
}
const pre = await collect(PreRT); const post = await collect(PostRT);
const ids = (t) => [...t.matchAll(/^\[#(\d+)/gm)].map((m) => m[1]).join(',');
const derive = (p) => p.split('\n').filter((l) => !/^\[(iframe |\d+ more iframe)/.test(l))
  .map((l) => l.replace(/^\[#(\d+) in iframe [^\]]*\]/, '[#$1]').replace(/ \(shadow: [^)]*\)$/, '')).join('\n');
const rows = []; let dump = '';
for (const k of Object.keys(pre)) {
  const a = pre[k].ie, b = post[k].ie;
  rows.push({ fixture: k, realPre: a.length, post: b.length, deltaPct: +(((b.length - a.length) / a.length) * 100).toFixed(2),
    derivedPreEqualsRealPre: derive(b) === a, byteIdentical: a === b, idsIdentical: ids(a) === ids(b),
    axPre: pre[k].ax?.length, axPost: post[k].ax?.length });
  dump += `===== ${k} PRE =====\n${a}\n===== ${k} POST =====\n${b}\n===== ${k} AX PRE =====\n${pre[k].ax}\n===== ${k} AX POST =====\n${post[k].ax}\n\n`;
}
console.table(rows);
await fs.writeFile(path.join(here, 'token-size-real-pre.json'), JSON.stringify(rows, null, 2));
await fs.writeFile(path.join(here, 'token-size-real-pre-listings.txt'), dump);
process.exit(0);
