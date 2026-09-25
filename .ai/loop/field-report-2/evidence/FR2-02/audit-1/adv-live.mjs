// FR2-02 audit-1: independent adversarial live checks (auditor-authored, not the Executor's script).
// Runtime (packages/capability-runtime/dist) + MCP bundle (packages/sutradhar/dist/mcp-cli.js),
// both attached to an independent puppeteer-core observer Chrome.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..', '..', '..', '..');
const require_ = createRequire(path.join(repoRoot, 'packages', 'browser', 'package.json'));
const puppeteer = require_('puppeteer-core');
const FIX = pathToFileURL(path.join(here, 'adv-fixture.html')).href;
const out = [];
let fails = 0;
function rec(c, expected, observed, pass, note) {
  out.push({ case: c, expected, observed, pass, note });
  if (!pass) fails++;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${c}${note ? ' — ' + note : ''}\n   observed: ${JSON.stringify(observed)}`);
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const { BrowserLauncher } = await import(pathToFileURL(path.join(repoRoot, 'packages', 'browser', 'dist', 'index.js')));
const chromePath = process.env.CHROME_PATH ?? new BrowserLauncher().findExecutablePath();
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'fr2-02-audit1-adv-'));
const observer = await puppeteer.launch({ executablePath: chromePath, headless: true, userDataDir: profile, args: ['--no-sandbox'] });
const mod = await import(pathToFileURL(path.join(repoRoot, 'packages', 'capability-runtime', 'dist', 'index.js')));
const rt = new mod.SutradharRuntime({ logger: { debug() {}, info() {}, warn() {}, error() {} } });
const { sessionId: sid } = await rt.attach({ endpoint: observer.wsEndpoint() });

async function x(fields, frameSelector, opts) {
  try { return { ok: true, data: await rt.extractData(sid, fields, undefined, frameSelector, opts) }; }
  catch (e) { return { ok: false, name: e.name, message: e.message }; }
}

try {
  await rt.navigate(sid, `${FIX}?t=${Date.now()}`);
  const page = (await observer.pages()).find((p) => p.url().startsWith(FIX));
  await page.waitForFunction(() => window.__adv?.ready, { timeout: 5000 });

  // ── (C12) option visibility via owning select, live in headless Chrome ──
  const rects = await page.evaluate(() => Object.fromEntries(
    ['#sel-visible option', '#sel-none option', '#sel-in-hidden-parent option', '#sel-vishidden option', '#sel-listbox option', '#dl option']
      .map((s) => [s, Array.from(document.querySelectorAll(s)).map((o) => { const r = o.getBoundingClientRect(); return [r.width, r.height]; })])));
  const selRects = await page.evaluate(() => Object.fromEntries(['#sel-visible', '#sel-none', '#sel-in-hidden-parent', '#sel-vishidden', '#sel-listbox']
    .map((s) => { const el = document.querySelector(s); const r = el.getBoundingClientRect(); return [s, { w: r.width, h: r.height, vis: getComputedStyle(el).visibility }]; })));
  const c12 = await x({
    vis: { selector: '#sel-visible option' }, none: { selector: '#sel-none option' },
    parent: { selector: '#sel-in-hidden-parent option' }, vh: { selector: '#sel-vishidden option' },
    list: { selector: '#sel-listbox option' }, dl: { selector: '#dl option' }, og: { selector: '#sel-listbox optgroup' },
  }, undefined, { visibleOnly: true });
  const c12all = await x({ none: { selector: '#sel-none option' }, parent: { selector: '#sel-in-hidden-parent option' }, dl: { selector: '#dl option' } });
  rec('C12 option visibleOnly judged by owning select (live)',
    { vis: ['Vis One', 'Vis Two'], none: [], parent: [], vh: [], list: ['List One', 'List Two', 'List Three'], dl: [], og: ['List Three'] },
    { c12, optionRects: rects, selectRects: selRects },
    c12.ok && eq(c12.data, { vis: ['Vis One', 'Vis Two'], none: [], parent: [], vh: [], list: ['List One', 'List Two', 'List Three'], dl: [], og: ['List Three'] }),
    'og = optgroup auto-read uses innerText');
  rec('C12b hidden options still returned without visibleOnly',
    { none: ['None One', 'None Two'], parent: ['Parent One'], dl: ['DL One'] }, c12all,
    c12all.ok && eq(c12all.data, { none: ['None One', 'None Two'], parent: ['Parent One'], dl: ['DL One'] }));

  // ── (a) select multiple with several selected ──
  await rt.selectOptions(sid, '#multi', ['b', 'c', 'd']);
  const obsMulti = await page.evaluate(() => Array.from(document.querySelector('#multi').selectedOptions).map((o) => o.value));
  const m = await x({
    none: { selector: '#multi' }, value: { selector: '#multi', attribute: 'value' },
    chkVal: { selector: '#multi option:checked', attribute: 'value' }, chkNone: { selector: '#multi option:checked' },
    sel: { selector: '#multi option', attribute: 'selected' }, attrSel: { selector: '#multi option', attribute: 'attr:selected' },
  });
  rec('(a) select multiple: value = first selected only; option:checked gives all; selected per option',
    { none: ['b'], value: ['b'], chkVal: ['b', 'c', 'd'], chkNone: ['B', 'C', 'D'], sel: ['false', 'true', 'true', 'true'], attrSel: ['', '', '', ''] },
    { m, obsMulti },
    m.ok && eq(obsMulti, ['b', 'c', 'd']) && eq(m.data, { none: ['b'], value: ['b'], chkVal: ['b', 'c', 'd'], chkNone: ['B', 'C', 'D'], sel: ['false', 'true', 'true', 'true'], attrSel: ['', '', '', ''] }));

  // ── (b) shadow DOM not pierced ──
  const sh = await x({ a: { selector: '#shadow-in' }, b: { selector: '.in-shadow' }, c: { selector: '#host #shadow-in' }, d: { selector: '#host' } });
  const shPierce = await x({ p: { selector: 'pierce/#shadow-in' } });
  const shObs = await page.evaluate(() => document.querySelector('#host').shadowRoot.querySelector('#shadow-in').value);
  rec('(b) shadow DOM not pierced (light-DOM selectors return []; pierce/ rejected with prefix note)',
    { a: [], b: [], c: [], d: [''], pierce: 'error w/ prefix note' }, { sh, shPierce, shObs },
    sh.ok && eq(sh.data, { a: [], b: [], c: [], d: [''] }) && !shPierce.ok && shPierce.message.includes("does not support Puppeteer's pierce/") && shObs === 'shadow-markup',
    'd: innerText of a shadow host with no light children is "" — shadow content is not read through the host either');

  // ── (c) attr:checked returns RAW attribute, not live boolean ──
  await rt.click(sid, '#cb-plain');   // live true, no attribute
  await rt.click(sid, '#cb-markup');  // live false, attribute still present
  await rt.click(sid, '#rr2');        // rr1 live false (attr present), rr2 live true (no attr)
  const obsCb = await page.evaluate(() => ({
    plain: [document.querySelector('#cb-plain').checked, document.querySelector('#cb-plain').getAttribute('checked')],
    markup: [document.querySelector('#cb-markup').checked, document.querySelector('#cb-markup').getAttribute('checked')],
  }));
  const cb = await x({
    livePlain: { selector: '#cb-plain', attribute: 'checked' }, attrPlain: { selector: '#cb-plain', attribute: 'attr:checked' },
    liveMarkup: { selector: '#cb-markup', attribute: 'checked' }, attrMarkup: { selector: '#cb-markup', attribute: 'attr:checked' },
    liveR: { selector: 'input[name=rr]', attribute: 'checked' }, attrR: { selector: 'input[name=rr]', attribute: 'attr:checked' },
    attrValSel: { selector: '#sel-visible', attribute: 'attr:value' }, attrValueRadio: { selector: 'input[name=rr]', attribute: 'attr:value' },
    liveValueRadio: { selector: 'input[name=rr]', attribute: 'value' },
  });
  rec('(c) attr:checked = raw markup attribute string, independent of live state',
    { livePlain: ['true'], attrPlain: [''], liveMarkup: ['false'], attrMarkup: [''], liveR: ['false', 'true'], attrR: ['', ''], attrValSel: [''], attrValueRadio: ['one', ''], liveValueRadio: ['one', 'on'] },
    { cb, obsCb },
    cb.ok && eq(cb.data, { livePlain: ['true'], attrPlain: [''], liveMarkup: ['false'], attrMarkup: [''], liveR: ['false', 'true'], attrR: ['', ''], attrValSel: [''], attrValueRadio: ['one', ''], liveValueRadio: ['one', 'on'] }),
    'boolean attr checked="" / bare "checked" markup: getAttribute returns "" for a bare attribute — indistinguishable from absent');

  // (c2) distinguish present-but-empty from absent: bare `checked` markup gives "" — same as absent.
  const bare = await page.evaluate(() => [document.querySelector('#cb-markup').hasAttribute('checked'), document.querySelector('#cb-markup').getAttribute('checked')]);
  rec('(c2) note: bare boolean attribute reads "" via attr:, same as absent (spec-literal getAttribute ?? "")', 'recorded', bare, true);

  // ── (d) invalid selectors: ALL collected, in order, no partial data, one hint ──
  const inv = await x({ ok1: { selector: 'h1' }, bad1: { selector: '.a[' }, ok2: { selector: '#pw' }, bad2: { selector: 'text=Buy' }, bad3: { selector: 'div:has-text("x")' }, bad4: { selector: '' } });
  const invLines = inv.ok ? [] : inv.message.split('\n').filter((l) => l.startsWith('Invalid selector for field'));
  rec('(d) 4 invalid of 6 fields: all 4 named in order, no data, exactly one hint, plain Error',
    ['bad1', 'bad2', 'bad3', 'bad4'], { inv, invLines },
    !inv.ok && inv.name === 'Error' && eq(invLines.map((l) => l.match(/field "([^"]+)"/)[1]), ['bad1', 'bad2', 'bad3', 'bad4']) && inv.message.split('Use standard CSS or a snapshot node id').length === 2 && !/^SyntaxError/.test(inv.message));

  // N3 (not live-run by Executor): each Playwright-style selector separately
  const n3 = {};
  for (const s of ['text=Buy', 'button >> text=OK', 'role=button', 'div:has-text("x")', 'internal:text="x"']) n3[s] = await x({ bad: { selector: s } });
  rec('N3 Playwright-style selectors each rejected with hint (live)', 'all ok:false with Playwright-style hint', n3,
    Object.values(n3).every((r) => !r.ok && /Playwright-style/.test(r.message) && /Invalid selector for field "bad"/.test(r.message)));

  // N11 (not live-run by Executor): unknown session
  let n11;
  try { await rt.extractData('no-such-session', { a: { selector: 'h1' } }); n11 = { ok: true }; } catch (e) { n11 = { ok: false, name: e.name, ctor: e.constructor.name, message: e.message }; }
  rec('N11 unknown session -> BrowserNotAvailableError (live runtime)', 'BrowserNotAvailableError', n11, !n11.ok && n11.ctor === 'BrowserNotAvailableError');

  // N5 on eval (spec requires extract AND eval; Executor's script only ran extract)
  let n5eval;
  try { await rt.eval(sid, '1+1', undefined, 'iframe['); n5eval = { ok: true }; } catch (e) { n5eval = { ok: false, message: e.message }; }
  rec('N5 eval frameSelector "iframe[" -> wrapped actionable error (live runtime)', /^Invalid frameSelector "iframe\[" \(from the full chain "iframe\["\) — /.source, n5eval,
    !n5eval.ok && /^Invalid frameSelector "iframe\[" \(from the full chain "iframe\["\) — /.test(n5eval.message) && /Playwright-style/.test(n5eval.message) && !/SyntaxError:/.test(n5eval.message));

  // ── extra angles ──
  await rt.click(sid, '#pw'); await rt.type(sid, '#pw', 's3cret');
  await rt.click(sid, '#spaced'); await rt.type(sid, '#spaced', 'live-spaced');
  const misc = await x({
    pw: { selector: '#pw' }, num: { selector: '#num' },
    attrSpace: { selector: '#spaced', attribute: 'attr: value' }, attrTrail: { selector: '#spaced', attribute: 'attr:value ' },
    attrUpperPrefix: { selector: '#spaced', attribute: 'Attr:value' }, attrOk: { selector: '#spaced', attribute: 'attr:value' },
    closedDetails: { selector: '#in-details' }, closedDetailsVis: { selector: '#in-details', visibleOnly: true },
    __proto__x: { selector: 'h1' },
  });
  rec('extra: password live, number, attr: whitespace handling, closed <details>',
    'recorded (see notes)', misc, misc.ok && misc.data.pw[0] === 's3cret' && misc.data.attrOk[0] === 'markup-spaced',
    `attr:" value" -> ${JSON.stringify(misc.data?.attrSpace)}, attr:"value " -> ${JSON.stringify(misc.data?.attrTrail)}, "Attr:value" -> ${JSON.stringify(misc.data?.attrUpperPrefix)}`);

  // frame: live checkbox + option visibility inside frame
  const f = page.frames().find((fr) => fr !== page.mainFrame());
  await f.evaluate(() => { document.querySelector('#fcb').checked = true; });
  const fr = await x({ c: { selector: '#fcb', attribute: 'checked' }, a: { selector: '#fcb', attribute: 'attr:checked' }, o: { selector: '#fsel option', visibleOnly: true }, oAll: { selector: '#fsel option' } }, '#f');
  rec('frame: live checked + attr + option-in-hidden-select visibleOnly inside frame', { c: ['true'], a: [''], o: [], oAll: ['FO'] }, fr,
    fr.ok && eq(fr.data, { c: ['true'], a: [''], o: [], oAll: ['FO'] }));
} finally {
  await rt.shutdown(sid).catch(() => {});
  await observer.close().catch(() => {});
  await fs.rm(profile, { recursive: true, force: true }).catch(() => {});
}

// ── MCP bundle: multi-invalid + attr:checked through the esbuild bundle ──
{
  const profile2 = await fs.mkdtemp(path.join(os.tmpdir(), 'fr2-02-audit1-advb-'));
  const obs2 = await puppeteer.launch({ executablePath: chromePath, headless: true, userDataDir: profile2, args: ['--no-sandbox'] });
  const child = spawn(process.execPath, [path.join(repoRoot, 'packages', 'sutradhar', 'dist', 'mcp-cli.js')], { stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = ''; let id = 1; const pend = new Map();
  child.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); try { const m = JSON.parse(l); if (pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } } catch {} } });
  const call = (method, params) => new Promise((r) => { const i = id++; pend.set(i, r); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: i, method, params }) + '\n'); });
  const tool = async (name, args) => (await call('tools/call', { name, arguments: args })).result;
  try {
    await call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'audit', version: '1' } });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    const sidB = JSON.parse((await tool('browser.attach', { endpoint: obs2.wsEndpoint() })).content[0].text).sessionId;
    await tool('browser.navigate', { sessionId: sidB, url: `${FIX}?t=b${Date.now()}` });
    const p2 = (await obs2.pages()).find((p) => p.url().startsWith(FIX));
    await p2.waitForFunction(() => window.__adv?.ready, { timeout: 5000 });
    const r = await tool('browser.extract_data', { sessionId: sidB, fields: { good: { selector: 'h1' }, b1: { selector: '.a[' }, b2: { selector: 'a[[' }, b3: { selector: 'role=button' } } });
    const t = r.content[0].text;
    rec('bundle MCP: 3 invalid fields all named, isError, no data, no Hint: duplicate', 'b1,b2,b3', { isError: r.isError, text: t },
      r.isError === true && t.startsWith('extract_data failed: Invalid selector for field "b1"') && t.includes('"b2"') && t.includes('"b3"') && !t.includes('Hint:') && t.split('Use standard CSS').length === 2);
    await tool('browser.click', { sessionId: sidB, target: '#cb-markup' });
    const r2 = JSON.parse((await tool('browser.extract_data', { sessionId: sidB, fields: { live: { selector: '#cb-markup', attribute: 'checked' }, raw: { selector: '#cb-markup', attribute: 'attr:checked' }, has: { selector: '#cb-markup[checked]' } } })).content[0].text);
    rec('bundle MCP: attr:checked raw vs live after real click', { live: ['false'], raw: [''], has: ['1 match'] }, r2, eq(r2.live, ['false']) && eq(r2.raw, ['']) && r2.has.length === 1);
    await tool('browser.shutdown', { sessionId: sidB });
  } finally {
    child.stdin.end(); child.kill();
    await obs2.close().catch(() => {});
    await fs.rm(profile2, { recursive: true, force: true }).catch(() => {});
  }
}

const ps = spawnSync('powershell', ['-NoProfile', '-Command', "Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'chrome' -and $_.CommandLine -match 'fr2-02-audit1-adv' } | Measure-Object | % Count"], { encoding: 'utf8' });
const lingering = Number((ps.stdout || '0').trim());
console.log(`lingering chrome with audit profile: ${lingering}`);
await fs.writeFile(path.join(here, 'adv-live.jsonl'), out.map((o) => JSON.stringify(o)).join('\n') + '\n');
console.log(`\n${out.length - fails}/${out.length} pass`);
process.exitCode = fails || lingering ? 1 : 0;
