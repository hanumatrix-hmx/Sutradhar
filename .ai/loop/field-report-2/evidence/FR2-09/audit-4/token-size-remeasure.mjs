// Auditor's independent token-size estimate (Done-when bullet 5), since run-1 recorded none.
// Pre-change text is DERIVED from the post-change listing by removing exactly what the FR2-09
// formatter diff adds (the " in iframe D (url)" bracket suffix, the " (shadow: …)" line suffix,
// and "[iframe … — not inspectable]"/"[N more iframes…]" placeholder lines). Valid because D3 keeps
// ids unchanged on normal pages and those three additions are the formatter's only textual change.
import fs from 'node:fs/promises'; import os from 'node:os'; import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)); const repo = path.resolve(here, '../../../../../..');
const imp = (p) => import(pathToFileURL(path.join(repo, p)).href);
const { SutradharRuntime } = await imp('packages/capability-runtime/dist/index.js');
const fx = ['aria-menu', 'fr2-01-singleframe', 'fr2-01-wait-states', 'grounding-completeness', 'prob043-keyboard', 'prompt-injection']
  .map((f) => path.join(repo, 'tools/scenario-suite/fixtures', f + '.html'))
  .concat(['nested-shadow-in-iframe', 'interactive-detection', 'closed-shadow'].map((f) => path.join(repo, 'tools/engine-comparison/hard-fixtures', f + '.html')));
const rt = new SutradharRuntime();
const { sessionId } = await rt.launch({ launch: { headless: true } });
const rows = [];
for (const f of fx) {
  const url = pathToFileURL(f).href + `?n=${Date.now()}` + (f.includes('wait-states') ? '#manual' : '');
  await rt.navigate(sessionId, url);
  await new Promise((r) => setTimeout(r, 800));
  const post = (await rt.snapshot(sessionId)).interactiveElements;
  const pre = post.split('\n').filter((l) => !/^\[(iframe |\d+ more iframe)/.test(l))
    .map((l) => l.replace(/^\[#(\d+) in iframe [^\]]*\]/, '[#$1]').replace(/ \(shadow: [^)]*\)$/, '')).join('\n');
  const d = ((post.length - pre.length) / pre.length) * 100;
  rows.push({ fixture: path.basename(f), pre: pre.length, post: post.length, deltaPct: +d.toFixed(2), preTok: Math.ceil(pre.length / 4), postTok: Math.ceil(post.length / 4), identical: pre === post });
  if (pre !== post) console.log(`--- ${path.basename(f)} post ---\n${post}`);
}
await rt.shutdown(sessionId);
console.table(rows);
await fs.writeFile(path.join(here, 'token-size-audit.json'), JSON.stringify(rows, null, 2));
process.exit(0);
