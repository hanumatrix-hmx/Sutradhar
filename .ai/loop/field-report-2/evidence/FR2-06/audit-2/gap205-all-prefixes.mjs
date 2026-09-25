// FR2-06 audit-2: GAP-205 re-verification against the BUILT dist, every engine prefix in
// ENGINE_PREFIX_RE (text|role|css|xpath|aria|pierce|id|data-testid|data-test-id|data-test),
// with case/whitespace/pierce-wrapped variants. Expected strings are written out BY HAND from
// spec §2.1 row 5 (not derived from the implementation's own template) and compared exactly.
// Also checks the full InvalidSelectorError.message via the runtime's normalizeTarget.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const root = process.cwd();
const d = await import(pathToFileURL(path.join(root, 'packages/browser/dist/actions/selector-dialect.js')).href);
const rt = await import(pathToFileURL(path.join(root, 'packages/capability-runtime/dist/index.js')).href);

const E = {
  text: `"text=" is Playwright selector-engine syntax (Puppeteer's own text query is spelled "text/").`,
  role: `"role=" is Playwright selector-engine syntax.`,
  css: `"css=" is Playwright's explicit CSS-engine prefix; drop it and pass the CSS itself.`,
  xpath: `"xpath=" is not supported; use the slash form "xpath/".`,
  aria: `"aria=" is not supported; use the slash form "aria/".`,
  pierce: `"pierce=" is not supported; use the slash form "pierce/".`,
  id: `"id=" is a Playwright attribute-engine prefix; use a CSS attribute selector such as [id="…"].`,
  'data-testid': `"data-testid=" is a Playwright attribute-engine prefix; use a CSS attribute selector such as [data-testid="…"].`,
  'data-test-id': `"data-test-id=" is a Playwright attribute-engine prefix; use a CSS attribute selector such as [data-test-id="…"].`,
  'data-test': `"data-test=" is a Playwright attribute-engine prefix; use a CSS attribute selector such as [data-test="…"].`,
};
const payload = { text: 'Submit', role: 'button', css: 'button', xpath: '//button', aria: 'Submit', pierce: '#x', id: 'main', 'data-testid': 'go', 'data-test-id': 'go', 'data-test': 'go' };
const variants = (p) => [
  `${p}=${payload[p]}`,
  `${p.toUpperCase()}=${payload[p]}`,
  `${p[0].toUpperCase()}${p.slice(1)}=${payload[p]}`,
  `${p} =${payload[p]}`,
  `${p}  = ${payload[p]}`,
  `${p}\t=${payload[p]}`,
  `  ${p}=${payload[p]}  `,
  `pierce/${p}=${payload[p]}`,
  `pierce/ ${p}=${payload[p]}`,
  `${p}=`,
  `${p}==x`,
];
let pass = 0, fail = 0;
const out = [];
for (const p of Object.keys(E)) {
  for (const s of variants(p)) {
    const m = d.detectForeignSelectorDialect(s);
    let full = null;
    try { rt.normalizeTarget(s); } catch (e) { full = e.message; }
    const expectedFull = `Invalid selector "${s}" — ${E[p]} ${d.SELECTOR_SYNTAX_HINT}`;
    const ok = m?.rule === 'engine-prefix' && m.reason === E[p] && full === expectedFull;
    ok ? pass++ : fail++;
    out.push(`${ok ? 'PASS' : 'FAIL'} ${JSON.stringify(s)} rule=${m?.rule} reason=${JSON.stringify(m?.reason ?? null)}${ok ? '' : ' EXPECTED=' + JSON.stringify(E[p]) + ' FULL=' + JSON.stringify(full)}`);
  }
}
// Doubled "==" / "=/" must never appear in ANY engine-prefix reason (the literal GAP-205 symptom).
const doubled = out.filter((l) => /==\\?"|=\/\\?"/.test(l.split('reason=')[1]?.split(' EXPECTED')[0] ?? ''));
out.push(`doubled-equals-occurrences-in-reasons: ${doubled.length}`);
// The advised replacement form must itself NOT be rejected by the detector (the self-contradiction).
for (const k of ['xpath', 'aria', 'pierce']) {
  const advised = `${k}/${k === 'xpath' ? '//button' : k === 'pierce' ? '#x' : 'Submit'}`;
  const m = d.detectForeignSelectorDialect(advised);
  const ok = m === null;
  ok ? pass++ : fail++;
  out.push(`${ok ? 'PASS' : 'FAIL'} advised-form ${JSON.stringify(advised)} accepted by detector -> ${JSON.stringify(m)}`);
}
out.push(`TOTAL pass=${pass} fail=${fail}`);
console.log(out.join('\n'));
