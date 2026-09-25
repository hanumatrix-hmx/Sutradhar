// FR2-06 audit-2: auditor's own extra cases for GAP-213 (pierce/ + whitespace) and GAP-210
// (planExtractFields rethrow of non-InvalidSelectorError), beyond fix-1's repros. Pure, no browser.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const root = process.cwd();
const d = await import(pathToFileURL(path.join(root, 'packages/browser/dist/actions/selector-dialect.js')).href);
const ex = await import(pathToFileURL(path.join(root, 'packages/capability-runtime/dist/extract/extract-data.js')).href);
let pass = 0, fail = 0;
const log = (ok, msg) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); };

// GAP-213 must-detect
for (const [s, rule] of [
  ['pierce/\ttext=Submit', 'engine-prefix'],
  ['pierce/\n role=button', 'engine-prefix'],
  ['pierce/   xpath=//a', 'engine-prefix'],
  ['pierce/ //button', 'bare-xpath'],
  ['pierce/ "Submit"', 'quoted-text'],
  ['pierce/ #12', 'node-id-syntax'],
  ['pierce/ [#12]', 'node-id-syntax'],
  ['pierce/ internal:role=button', 'internal'],
  ['pierce/ button >> text=OK', 'chain'],
  ['pierce/ button:has-text("x")', 'pseudo'],
  ['  pierce/  css=button  ', 'engine-prefix'],
]) {
  const m = d.detectForeignSelectorDialect(s);
  log(m?.rule === rule, `detect ${JSON.stringify(s)} -> ${m?.rule} (want ${rule}) reason=${JSON.stringify(m?.reason)}`);
}
// GAP-213 must-NOT-over-reject (valid CSS after pierce/ + whitespace)
for (const s of ['pierce/ #x', 'pierce/  div > span', 'pierce/\tbutton.primary', 'pierce/ [data-testid="go"]', 'pierce/ a[href*="text="]', 'pierce/ ']) {
  const m = d.detectForeignSelectorDialect(s);
  log(m === null, `no-false-positive ${JSON.stringify(s)} -> ${JSON.stringify(m)}`);
}
// xpath/ aria/ text/ payloads with leading space are still never scanned (D4)
for (const s of ['xpath/ //a', 'aria/ text=x', 'text/ role=x']) {
  const m = d.detectForeignSelectorDialect(s);
  log(m === null, `D4-unscanned ${JSON.stringify(s)} -> ${JSON.stringify(m)}`);
}

// GAP-210: non-string selectors -> the ORIGINAL TypeError propagates (not wrapped as an invalid-selector error)
for (const [label, bad] of [['number', 12], ['undefined', undefined], ['object', { css: '#a' }], ['boolean', true]]) {
  let thrown;
  try { ex.planExtractFields({ ok: { selector: 'h1' }, bad: { selector: bad } }); } catch (e) { thrown = e; }
  log(thrown instanceof TypeError && !/Invalid selector for field/.test(thrown.message), `rethrow non-string selector (${label}) -> ${thrown?.name}: ${thrown?.message}`);
}
// GAP-210 ordering: a Playwright field BEFORE a TypeError field -> TypeError still wins (not swallowed into the collection)
{
  let thrown;
  try { ex.planExtractFields({ pw: { selector: 'text=Buy' }, bad: { selector: 7 } }); } catch (e) { thrown = e; }
  log(thrown instanceof TypeError, `Playwright field then non-string field -> ${thrown?.name}: ${thrown?.message?.slice(0, 80)}`);
}
// And the normal collection path still names every Playwright field
{
  let thrown;
  try { ex.planExtractFields({ a: { selector: 'xpath=//x' }, b: { selector: 'id=main' }, c: { selector: 'h1' } }); } catch (e) { thrown = e; }
  const okMsg = /field "a": "xpath=\/\/x" — "xpath=" is not supported; use the slash form "xpath\/"\./.test(thrown?.message) && /field "b": "id=main" — "id=" is a Playwright attribute-engine prefix/.test(thrown?.message);
  log(okMsg, `extract collection uses fixed GAP-205 text: ${JSON.stringify(thrown?.message?.split('\n').slice(0, 2))}`);
}
console.log(`TOTAL pass=${pass} fail=${fail}`);
