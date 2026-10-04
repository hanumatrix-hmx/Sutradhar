// S4 step 1: produce frame-call-sites.md (one row per sites.txt key) from the source. Classification is rule-based on the
// hit's source line (+ previous line for multi-line chains), with explicit per-site rules for every Frame / Page-plain-delegator
// receiver; any hit no rule claims is UNCLASSIFIED and the script exits 1 (so a new site can never be silently SAFE).
// The same rules run on the pre-fix and post-fix trees: an UNSAFE pattern is recognised by its text (an unwrapped call), and
// its fixed form (inside frameCall / an async IIFE) is recognised as SAFE-fixed.
// Usage: node classify-sites.mjs <sites.txt> <out.md> <repo root>
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const [sitesFile, outFile, root] = process.argv.slice(2);
const rows = readFileSync(sitesFile, 'utf8').split('\n').filter(Boolean).map((l) => l.split(' ')[0]);
const cache = new Map();
const src = (f) => { if (!cache.has(f)) cache.set(f, readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n').split('\n')); return cache.get(f); };

const HANDLE_REASON = 'throws only after an explicit dispose(); this code never uses the handle after disposing it (dispose happens only when a handle is discarded or in a later finally/cleanup)';
const R = {
  comment: ['non-code', 'SAFE', 'inside a comment/JSDoc/string literal; not a call'],
  inpage: ['in-page DOM', 'SAFE', 'runs inside the browser page (DOM element method), not a Puppeteer call'],
  runtime: ['non-Puppeteer', 'SAFE', 'SutradharRuntime/SDK method or CLI wrapper, not a Puppeteer Frame/Page'],
  dom: ['non-Puppeteer', 'SAFE', 'browser DOM / React ref method in the frontend package, not Puppeteer'],
  getter: ['non-Puppeteer', 'SAFE', 'Dialog/Target/ConsoleMessage .type() getter: not decorated, never throws on frame detach'],
  keyboard: ['non-Puppeteer (Keyboard/Mouse)', 'SAFE', 'Keyboard/Mouse method: async, CDP-session based, not throwIfDetached'],
  pageAsync: ['Page-async', 'SAFE', 'Page.evaluate/title/screenshot/goto are `async` (a detached main frame is a rejection) and are awaited/handled by the enclosing async function'],
  pageDeleg: ['Page-plain-delegator', 'SAFE', 'throws synchronously only if the MAIN frame is detached (page gone); called with `await` directly inside an async function, so it is an ordinary rejection of that function (no abandoned promise)'],
  handle: ['ElementHandle-JSHandle', 'SAFE', HANDLE_REASON],
};
const rules = []; // {file, line (on the trimmed hit line), prev (on the trimmed previous line) | null, spec}
const rule = (file, line, spec, prev = null) => rules.push({ file: new RegExp(file), line: new RegExp(line), prev: prev && new RegExp(prev), spec });

const FIXED = ['Frame', 'SAFE', "fixed in S4: the call runs inside frameCall (async), so Puppeteer's synchronous throwIfDetached throw is a rejection and the existing handling applies"];
// ---- browser-action-engine.ts
rule('browser-action-engine', '^\\.waitForSelector\\(fullSelector, \\{ visible: options\\.visible, timeout: timeoutMs \\}\\)', ['Frame', 'UNSAFE', '`.catch(() => null)` is chained on the call: the synchronous throw happens before there is a promise (single-frame path)'], '^return only$');
rule('browser-action-engine', '^\\.waitForSelector\\(fullSelector, \\{ visible: options\\.visible, timeout: mainFrameTimeoutMs \\}\\)', ['Frame', 'UNSAFE', '`.catch(() => null)` chained on the call: sync throw escapes (head start)'], '^const mainFrameMatch = await mainFrame$');
rule('browser-action-engine', '^\\.waitForSelector\\(fullSelector, \\{$', ['Frame', 'UNSAFE', '`.catch(() => null)` chained on the call: a frame captured at pass start can detach while an earlier frame is probed (kayak churn)'], '^const match = await frame$');
rule('browser-action-engine', '^f\\.waitForSelector\\(', FIXED);
rule('browser-action-engine', '^const probe = frame\\.evaluate\\(selectorSyntaxProbeInPage', ['Frame', 'SAFE', "inside probeSelectorSyntax's try/catch (returns null = \"can't run\" outcome); nothing was abandoned before the throw"]);
rule('browser-action-engine', '^const real = frame\\.\\$\\(fullSelector\\);', ['Frame', 'SAFE', 'first statement of async raceFrameProbe: the sync throw is a rejection of raceFrameProbe, which its only caller pierceFirstMatch wraps in try/catch (same handling as a rejected $); no promise or timer exists yet to abandon']);
rule('browser-action-engine', '^frame\\.\\$\\$eval\\(fullSelector', ['Frame', 'SAFE', 'argument of raceBounded inside the per-frame `try` of an async arrow: a sync throw lands in the same catch as a rejected $$eval (context-destroyed -> null, else unconfirmed); nothing abandoned']);
// ---- dom-semantic-engine.ts
rule('dom-semantic-engine', '^const scrape = frame\\.evaluate\\(scrapeFrame', ['Frame', 'UNSAFE', 'promise created OUTSIDE the per-frame try: a child detached while an earlier frame was scraped throws past the D6 catch into the outer catch-all (empty graph)']);
rule('dom-semantic-engine', '^f\\.evaluate\\(scrapeFrame', FIXED);
rule('dom-semantic-engine', '^const handle = await raceFrameTimeout\\(frame\\.frameElement\\(\\)', ['Frame', 'SAFE', "inside recoverBlockedFrameSrc's try/catch (documented never-throws: returns undefined); the sync throw is caught there like a rejection"]);
// ---- execution-verifier.ts, condition-wait.ts
rule('execution-verifier', '^handle = await f\\.frameElement\\(\\);', ['Frame', 'SAFE', 'inside try/catch in an async IIFE (own = unjudgeable); same handling as a rejection']);
rule('execution-verifier', '^return \\(await f\\.evaluate\\(visibleTextContainsInPage', ['Frame', 'SAFE', 'inside the async IIFE passed to bounded(): the sync throw rejects the IIFE promise, bounded() maps it to failed']);
rule('condition-wait', '^const v = await page\\.mainFrame\\(\\)\\.evaluate\\(wrapJsCondition', ['Frame', 'SAFE', 'directly awaited inside a try whose catch classifies transient frame errors (isTransientContextError) exactly like a rejection']);
// ---- post-conditions.ts
rule('post-conditions', '^const owner = await c\\.frameElement\\(\\);', ['Frame', 'SAFE', "inside the per-child try/catch of matchChildFrame (\"a frame we can't reach is simply not the match\")"]);
rule('post-conditions', '^let info: TargetInfo.*frame\\.evaluate\\(activeInfoInPage\\)', ['Frame', 'SAFE', 'inside async `run` that observeFocusForKey passes to bounded(): rejection -> `{error}` outcome']);
rule('post-conditions', '^info = await frame\\.evaluate\\(activeInfoInPage\\)', ['Frame', 'SAFE', 'inside async `run` passed to bounded() (same as above)']);
rule('post-conditions', "^if \\(info\\.kind === 'element'\\) await frame\\.evaluate\\(armKeyListenerInPage", ['Frame', 'SAFE', 'inside async `run` passed to bounded() (same as above)']);
rule('post-conditions', "^await bounded\\(pre\\.frame\\.evaluate\\(readKeyObservationInPage, pre\\.token, ''\\)", ['Frame', 'UNSAFE', '`bounded(frame.evaluate(...))`: the call runs before bounded(), so a sync throw rejects disposeKeyObservation, documented "never throws"']);
rule('post-conditions', '^const r = await bounded\\(pre\\.frame\\.evaluate\\(readKeyObservationInPage', ['Frame', 'UNSAFE', '`bounded(frame.evaluate(...))`: sync throw bypasses bounded() and rejects finishKeyObservation instead of recording navigated/postError']);
rule('post-conditions', '^page\\.mainFrame\\(\\)\\.evaluate\\(\\(\\) => \\{', ['Frame', 'UNSAFE', '`bounded(page.mainFrame().evaluate(...))`: sync throw rejects NavigationProbe.finish']);
rule('post-conditions', '^const r = await bounded\\(arm\\.frame\\.evaluate\\(readPointInPage', ['Frame', 'UNSAFE', '`bounded(frame.evaluate(...))`: sync throw rejects finishPointObservation']);
rule('post-conditions', '^const r = await bounded\\(frame\\.evaluate\\(armUploadListenerInPage', ['Frame', 'UNSAFE', '`bounded(frame.evaluate(...))`: sync throw rejects observeUploadTargets']);
rule('post-conditions', '^await bounded\\(arm\\.frame\\.evaluate\\(readUploadObservationInPage', ['Frame', 'UNSAFE', '`bounded(frame.evaluate(...))`: sync throw rejects removeUploadListener, documented best-effort cleanup']);
rule('post-conditions', '^f\\.evaluate\\(', FIXED);
rule('post-conditions', '^(const r = await bounded\\()?frameCall\\(.*\\(f\\) => f\\.evaluate\\(', FIXED);
rule('post-conditions', '^const r = await frame\\.evaluate\\(armPointInPage', ['Frame', 'SAFE', 'inside async `run` passed to bounded() (observePoint)']);
rule('post-conditions', '^const last = await frame\\.evaluate\\(readUploadObservationInPage', ['Frame', 'SAFE', 'inside async `run` passed to bounded() (finishUploadObservation)']);
rule('post-conditions', '^const fin = await frame\\.evaluate\\(readUploadObservationInPage', ['Frame', 'SAFE', 'inside async `run` passed to bounded() (finishUploadObservation)']);
// ElementHandle receivers the generic rules do not name (all inside a try, handle disposed only afterwards in a finally)
rule('dom-semantic-engine', '^const src = await raceFrameTimeout\\(handle\\.evaluate\\(', ['ElementHandle-JSHandle', 'SAFE', 'handle from frameElement(), used inside try before the finally that disposes it; ' + HANDLE_REASON]);
rule('execution-verifier', '^if \\(handle\\) own = \\(await handle\\.evaluate\\(', ['ElementHandle-JSHandle', 'SAFE', 'handle from frameElement(), used inside try before the finally that disposes it; ' + HANDLE_REASON]);
rule('post-conditions', '^const hit = await owner\\.evaluate\\(', ['ElementHandle-JSHandle', 'SAFE', 'owner from frameElement() inside the per-child try; never disposed before the call']);
// ---- capability-runtime runtime.ts
rule('capability-runtime/src/runtime', '^handle = await current\\.\\$\\(normalized\\);', ['Frame (hops after the first) / Page', 'SAFE', "directly awaited inside resolveFrame's try/catch, which rethrows non-syntax errors untouched: identical to a rejection"]);
rule('capability-runtime/src/runtime', '\\(await target\\.evaluate\\(extractFieldsInPage', ['Frame / Page', 'SAFE', 'directly awaited in async extractData; a sync throw is a rejection of extractData, same as a rejected evaluate (no wrapper or abandoned promise)']);
rule('capability-runtime/src/runtime', '\\(await target\\.evaluate\\(code as unknown as string\\)', ['Frame / Page', 'SAFE', 'directly awaited in async eval(); same as above']);
rule('capability-runtime/src/runtime', 'Promise\\.all\\(\\[page\\.waitForFileChooser\\(\\), page\\.click\\(selector\\)\\]\\)', ['Page-plain-delegator', 'UNSAFE', 'array element: a sync throw (main frame detached) escapes BEFORE Promise.all attaches handlers, abandoning waitForFileChooser() (later unhandled rejection)']);
rule('capability-runtime/src/runtime', 'Promise\\.all\\(\\[page\\.waitForFileChooser\\(\\), \\(async \\(\\) => page\\.click\\(selector\\)\\)\\(\\)\\]\\)', ['Page-plain-delegator', 'SAFE', 'fixed in S4: the click runs in an async IIFE, so a sync throw is a rejection that Promise.all and the surrounding catch handle; waitForFileChooser() is never abandoned']);
rule('browser-tab', '^await this\\.page!\\.(click|type|hover)\\(', R.pageDeleg);
// runtime wrappers
rule('cli/src/cli\\.ts|mcp-server/src/tools\\.ts|sutradhar/src/page\\.ts', '(^|\\W)(this\\.)?runtime\\.(click|type|focus|hover|waitForSelector|dragAndDrop|screenshot)\\(', R.runtime);
rule('sutradhar/src/page\\.ts', '^await this\\.runtime\\.(click|type)\\(', R.runtime);
rule('capability-runtime/src/runtime', 'await this\\.(type|screenshot)\\(sessionId', R.runtime);

const generic = (file, text, prev) => {
  const t = text.trim(); const p = prev.trim();
  if (/^(\*|\/\*|\/\/)/.test(t)) return R.comment;
  if (/^['"`]/.test(t)) return R.comment; // string-literal continuation line (tool descriptions)
  if (file.startsWith('packages/frontend')) return R.dom;
  if (/^(ta|el)\.(focus|select|click)\(/.test(t)) return R.inpage;
  if (/\b(dialog|pendingDialog|target|msg|t)\.type\(\)/.test(t)) return R.getter;
  if (/(keyboard|mouse)\.(press|click|type)\(/.test(t)) return R.keyboard;
  if (/\b(page|this\.page!?|tab\.page\??|tab\.page\?)\.(evaluate|title|screenshot|goto)\(/.test(t)) return R.pageAsync;
  if (/^\.(evaluate|title)\(/.test(t) && /^(const \w+ = await )?page$/.test(p)) return R.pageAsync;
  if (/^(const \w+ = await |return \(?await |await |const \[[^\]]*\] = await |return )?(handle|target|source)\.(evaluate|click|press|type|select|focus|tap|hover|drag|drop|scrollIntoView)\(/.test(t)) return R.handle;
  if (/runHandleOp\([^)]*\(\) => handle\.(select|focus|tap)\(/.test(t)) return R.handle;
  if (/^\.evaluate\(/.test(t) && /^handle$/.test(p)) return R.handle;
  if (/^(const \w+ = await )?(page|tab\.page)\.(evaluate|screenshot)\(/.test(t) || /^page\.(evaluate|screenshot)\(/.test(t) || /^return page\.evaluate\(/.test(t) || /^const \[.*\] = await page\.evaluate/.test(t)) return R.pageAsync;
  if (/^(const \w+ = )?\(?await (tab\.page\?|page|this\.page)\./.test(t)) return R.pageAsync;
  if (/^(title: \(await page\.title|return \(await page\.title|this\.currentTitle = await this\.page\.title|const response = await this\.page\.goto)/.test(t)) return R.pageAsync;
  return null;
};

const out = [];
let unclassified = 0;
const counts = { SAFE: 0, UNSAFE: 0 };
for (const key of rows) {
  const m = /^(.*):(\d+):(\d+)$/.exec(key);
  const [, file, line] = m; const L = src(file); const cur = L[Number(line) - 1] ?? ''; const prev = L[Number(line) - 2] ?? '';
  const t = cur.trim(); const tp = prev.trim();
  let spec = null;
  for (const r of rules) {
    if (!r.file.test(file) || !r.line.test(t)) continue;
    if (r.prev && !r.prev.test(tp)) continue;
    spec = r.spec; break;
  }
  // a "fixed" label is only believed when frameCall( really encloses the hit (this line or the 4 lines above)
  if (spec === FIXED && !L.slice(Math.max(0, Number(line) - 5), Number(line)).join('\n').includes('frameCall(')) spec = null;
  if (!spec) spec = generic(file, cur, prev);
  if (!spec) { unclassified++; spec = ['?', 'UNCLASSIFIED', 'no rule claims this site: classify it by hand']; }
  if (spec[1] === 'SAFE' || spec[1] === 'UNSAFE') counts[spec[1]]++;
  out.push(`| ${key} | ${spec[0]} | ${spec[1]} | ${spec[2].replace(/\|/g, '\\|')} |`);
}
const head = `# S4 call-site inventory (every call in packages/*/src of a method that can throw synchronously)\n\nSource: \`sites.txt\` (${rows.length} keys, \`list-sites.mjs\`); methods: \`sync-throw-methods.txt\`. Columns: file:line:col | receiver type | SAFE/UNSAFE | reason.\nSAFE = a synchronous throw ends up in exactly the handling a rejection of the same call gets. UNSAFE = it escapes that handling.\nTotals: SAFE ${counts.SAFE}, UNSAFE ${counts.UNSAFE}, UNCLASSIFIED ${unclassified}.\n\n| key | receiver | class | reason |\n|---|---|---|---|\n`;
writeFileSync(outFile, head + out.join('\n') + '\n');
console.log(`rows=${rows.length} SAFE=${counts.SAFE} UNSAFE=${counts.UNSAFE} UNCLASSIFIED=${unclassified}`);
process.exit(unclassified === 0 ? 0 : 1);
