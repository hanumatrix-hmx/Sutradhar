// S4 step 1: derive the Puppeteer method names that can throw SYNCHRONOUSLY (decorated with
// throwIfDetached / throwIfDisposed, plus the plain non-async Page delegators over main-frame methods).
// No product code runs. Usage: node list-sync-methods.mjs <out.txt> <puppeteer-core root> [<puppeteer-core root> ...]
// Each root is a `puppeteer-core` package dir; the union over all roots is written (sorted, one per line) and each
// root's own list is written to <out>.<index>.txt. Self-check: the union must contain every name in section 1.3.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const [out, ...roots] = process.argv.slice(2);
if (!out || roots.length === 0) { console.error('usage: list-sync-methods.mjs <out> <root>...'); process.exit(2); }

const MUST = [
  // api/Frame.js decorated
  'frameElement', 'evaluateHandle', 'evaluate', 'locator', '$', '$$', '$eval', '$$eval', 'waitForSelector', 'waitForFunction',
  'content', 'addScriptTag', 'addStyleTag', 'click', 'focus', 'hover', 'select', 'tap', 'type', 'title',
  // cdp/Frame.js adds
  'goto', 'waitForNavigation', 'setContent', 'addPreloadScript', 'addExposedFunctionBinding', 'removeExposedFunctionBinding', 'waitForDevicePrompt',
];

function decoratedNames(file, which) {
  const src = readFileSync(file, 'utf8');
  const names = new Set();
  const re = /_([\w$]+)_decorators = \[\s*(throwIfDetached|throwIfDisposed)\b/g;
  let m;
  while ((m = re.exec(src))) {
    if (which && m[2] !== which) continue;
    names.add(m[1]);
  }
  return names;
}

// Non-async Page methods whose body is `return this.mainFrame().<method>(` (plain delegators: they throw synchronously
// when the MAIN frame itself is detached).
function pageDelegators(file, frameNames) {
  const src = readFileSync(file, 'utf8');
  const names = new Set();
  const re = /^\s{8}(?!async\b)([\w$]+)\([^)]*\) \{\n\s*return this\.mainFrame\(\)\.([\w$]+)\(/gm;
  let m;
  while ((m = re.exec(src))) { if (frameNames.has(m[2])) names.add(m[1]); }
  return names;
}

const union = new Set();
const lines = [];
roots.forEach((root, i) => {
  const lib = `${root}/lib/puppeteer`;
  const files = { frame: `${lib}/api/Frame.js`, cdpFrame: `${lib}/cdp/Frame.js`, page: `${lib}/api/Page.js`, eh: `${lib}/api/ElementHandle.js`, jh: `${lib}/api/JSHandle.js`, dec: `${lib}/util/decorators.js` };
  for (const f of Object.values(files)) if (!existsSync(f)) { console.error(`missing ${f}`); process.exit(2); }
  const pkg = JSON.parse(readFileSync(`${root}/package.json`, 'utf8'));
  // Confirm the wrapper really is a plain (non-async) function that throws synchronously.
  const dec = readFileSync(files.dec, 'utf8');
  const m = /export function throwIfDisposed\([\s\S]*?\n\}\n/.exec(dec);
  if (!m || /async function|async \(/.test(m[0]) || !/throw new Error/.test(m[0])) { console.error(`${root}: throwIfDisposed is not a plain throwing function`); process.exit(3); }
  const mine = new Set([
    ...decoratedNames(files.frame, 'throwIfDetached'), ...decoratedNames(files.cdpFrame, 'throwIfDetached'),
    ...decoratedNames(files.eh), ...decoratedNames(files.jh), ...pageDelegators(files.page, new Set([...decoratedNames(files.frame, 'throwIfDetached'), ...decoratedNames(files.cdpFrame, 'throwIfDetached')])),
  ]);
  const own = [...mine].sort();
  writeFileSync(`${out}.${i}.txt`, own.join('\n') + '\n');
  lines.push(`root ${i}: puppeteer-core ${pkg.version} (${root}) -> ${own.length} names (Frame ${decoratedNames(files.frame, 'throwIfDetached').size}, cdp/Frame ${decoratedNames(files.cdpFrame, 'throwIfDetached').size}, ElementHandle ${decoratedNames(files.eh).size}, JSHandle ${decoratedNames(files.jh).size}, Page plain delegators ${pageDelegators(files.page, new Set([...decoratedNames(files.frame, 'throwIfDetached'), ...decoratedNames(files.cdpFrame, 'throwIfDetached')])).size})`);
  for (const n of mine) union.add(n);
});
const missing = MUST.filter((n) => !union.has(n));
const sorted = [...union].sort();
writeFileSync(out, sorted.join('\n') + '\n');
for (const l of lines) console.log(l);
console.log(`union: ${sorted.length} names`);
if (missing.length) { console.error(`SELF-CHECK FAILED: missing section-1.3 names: ${missing.join(', ')}`); process.exit(1); }
console.log(`self-check OK: all ${MUST.length} section-1.3 names present`);
