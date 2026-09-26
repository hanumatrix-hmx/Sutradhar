// Live-verify script for FR2-02 (extract_data live values) — drives the REAL BUILT worktree
// artifacts (packages/mcp-server/dist/cli.js, packages/capability-runtime/dist/index.js, and
// the sutradhar bundle) against a real Chrome, using an INDEPENDENT puppeteer-core observer
// connection to verify the tool's own report against real DOM state — never trusting the
// tool's own output alone. See .ai/loop/field-report-2/evidence/FR2-02/spec.md §5.
//
// Run: node tools/scenario-suite/verify-fr2-02-extract-live.mjs
// Requires: `pnpm build` (or `turbo run build`) already run in this worktree.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..');
// GAP-132-fix process finding: this defaulted to the shared, committed FR2-02 evidence
// directory, so simply running the script with no env var set silently overwrote it — the same
// issue found and fixed for verify-fr2-01-wait-states.mjs's EVIDENCE_DIR. The default is now a
// fresh scratch directory under the OS temp dir — never a path under `.ai/loop/` — so a run
// can never clobber committed evidence by accident. Pass `SUTRADHAR_FR2_02_EVIDENCE_DIR`
// explicitly to write into a real (new, not-yet-existing) round directory on purpose.
const EVIDENCE_DIR =
  process.env.SUTRADHAR_FR2_02_EVIDENCE_DIR ??
  path.join(os.tmpdir(), `sutradhar-fr2-02-verify-${Date.now()}`);
if (!process.env.SUTRADHAR_FR2_02_EVIDENCE_DIR) {
  console.warn(
    `[verify-fr2-02-extract-live] SUTRADHAR_FR2_02_EVIDENCE_DIR not set — writing evidence to a ` +
      `scratch directory instead of any committed .ai/loop/ evidence: ${EVIDENCE_DIR}`,
  );
}
const FIXTURE_PATH = path.join(here, 'fixtures', 'fr2-02-extract-live.html');
const FIXTURE_URL = pathToFileURL(FIXTURE_PATH).href;

const require_ = createRequire(path.join(repoRoot, 'packages', 'browser', 'package.json'));
const puppeteer = require_('puppeteer-core');

// ── helpers copied verbatim from verify-fr2-01-wait-states.mjs (per spec §5 — not imported or
// refactored into a shared module; that consolidation is a logged minor gap for after Phase 1)
function freshUrl() {
  return `${FIXTURE_URL}?t=${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const results = { mcp: [], runtime: [], bundle: [] };
const cleanupDirs = [];
let overallOk = true;

function record(surface, entry) {
  results[surface].push(entry);
  if (!entry.pass) overallOk = false;
  const tag = entry.pass ? 'PASS' : 'FAIL';
  console.log(`[${surface}] ${tag} ${entry.case}${entry.pass ? '' : ' — ' + (entry.detail ?? '')}`);
}

async function writeJsonl(name, arr) {
  const lines = arr.map((e) => JSON.stringify(e)).join('\n') + (arr.length ? '\n' : '');
  await fs.writeFile(path.join(EVIDENCE_DIR, name), lines, 'utf-8');
}

async function resolveChromeExecutablePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const mod = await import(pathToFileURL(path.join(repoRoot, 'packages', 'browser', 'dist', 'index.js')));
  const launcher = new mod.BrowserLauncher();
  const p = launcher.findExecutablePath();
  if (!p) throw new Error('No Chrome/Edge executable found — set CHROME_PATH.');
  return p;
}

async function countLingeringChromeProcesses(needlePaths) {
  if (process.platform !== 'win32' || needlePaths.length === 0) return { count: 0, matches: [] };
  const { spawnSync } = await import('node:child_process');
  const script =
    "Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'chrome|msedge' } | " +
    "ForEach-Object { \"$($_.ProcessId)`t$($_.CommandLine)\" }";
  const r = spawnSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024 });
  const lines = (r.stdout || '').split('\n').filter(Boolean);
  const matches = lines.filter((line) => needlePaths.some((p) => p && line.includes(p)));
  return { count: matches.length, matches };
}

async function rmWithRetry(dir, attempts = 5) {
  for (let i = 0; i < attempts; i++) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
      return;
    } catch (e) {
      if (i === attempts - 1) {
        console.warn(`[cleanup] could not remove ${dir}: ${e.message}`);
        return;
      }
      await delay(300);
    }
  }
}

function makeMcpClient(serverPath) {
  const child = spawn(process.execPath, [serverPath], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stdoutBuf = '';
  let nextId = 1;
  const pending = new Map();
  const stderrLog = [];
  child.stdout.on('data', (chunk) => {
    stdoutBuf += chunk.toString('utf8');
    let idx;
    while ((idx = stdoutBuf.indexOf('\n')) >= 0) {
      const line = stdoutBuf.slice(0, idx).trim();
      stdoutBuf = stdoutBuf.slice(idx + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.id !== undefined && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(`JSON-RPC error: ${JSON.stringify(msg.error)}`));
        else resolve(msg.result);
      }
    }
  });
  child.stderr.on('data', (d) => stderrLog.push(d.toString('utf8')));

  function call(method, params, timeoutMs = 60000) {
    const id = nextId++;
    const req = { jsonrpc: '2.0', id, method, params };
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      child.stdin.write(JSON.stringify(req) + '\n');
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`timeout waiting for response to ${method} (id=${id})`));
        }
      }, timeoutMs);
    });
  }
  function notify(method, params) {
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }
  async function callTool(name, args) {
    return call('tools/call', { name, arguments: args });
  }
  return { child, call, notify, callTool, stderrLog };
}

function textOf(result) {
  return result.content?.[0]?.text ?? '';
}
function jsonOf(result) {
  return JSON.parse(textOf(result));
}

// ── shared observer-side ground truth helpers ──────────────────────────────────────────────
async function oldSemantics(page, selector, attribute) {
  return page.evaluate(
    (sel, attr) => {
      const els = Array.from(document.querySelectorAll(sel));
      return els.map((el) => (attr ? el.getAttribute(attr) ?? '' : (el.textContent ?? '').trim()));
    },
    selector,
    attribute,
  );
}

async function observerInnerText(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    return typeof el.innerText === 'string' ? el.innerText.trim() : (el.textContent ?? '').trim();
  }, selector);
}

// ── MCP driver ──────────────────────────────────────────────────────────────────────────────
async function makeMcpDriver() {
  const serverPath = path.join(repoRoot, 'packages', 'mcp-server', 'dist', 'cli.js');
  const chromePath = await resolveChromeExecutablePath();
  const scratchProfile = await fs.mkdtemp(path.join(os.tmpdir(), 'fr2-02-mcp-observer-'));
  cleanupDirs.push(scratchProfile);

  const observerBrowser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    userDataDir: scratchProfile,
    args: ['--no-sandbox'],
  });
  const wsEndpoint = observerBrowser.wsEndpoint();

  const mcp = makeMcpClient(serverPath);
  await mcp.call('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'fr2-02-verify', version: '1.0' },
  });
  mcp.notify('notifications/initialized');

  const attachResult = jsonOf(await mcp.callTool('browser.attach', { endpoint: wsEndpoint }));
  const sessionId = attachResult.sessionId;
  let currentPage = null;

  async function navFresh() {
    await mcp.callTool('browser.navigate', { sessionId, url: freshUrl() });
    const pages = await observerBrowser.pages();
    const page = pages.find((p) => p.url().startsWith(FIXTURE_URL)) ?? pages[pages.length - 1];
    await page.waitForFunction(() => window.__fx2 && window.__fx2.ready, { timeout: 5000 }).catch(() => {});
    currentPage = page;
    return page;
  }

  async function type(selector, text) {
    await mcp.callTool('browser.click', { sessionId, target: selector });
    await mcp.callTool('browser.type', { sessionId, target: selector, value: text });
  }

  async function click(selector) {
    await mcp.callTool('browser.click', { sessionId, target: selector });
  }

  async function selectOption(selector, value) {
    await mcp.callTool('browser.select_option', { sessionId, target: selector, value });
  }

  async function selectOptions(selector, values) {
    await mcp.callTool('browser.select_options', { sessionId, target: selector, values });
  }

  async function evalJs(code) {
    return jsonOf(await mcp.callTool('browser.eval', { sessionId, code })).result;
  }

  async function extract(fields, opts = {}) {
    try {
      const raw = await mcp.callTool('browser.extract_data', {
        sessionId,
        fields,
        frameSelector: opts.frameSelector,
        visibleOnly: opts.visibleOnly,
      });
      if (raw.isError) {
        return { ok: false, errorText: textOf(raw), errorName: 'ToolError' };
      }
      return { ok: true, data: jsonOf(raw) };
    } catch (e) {
      return { ok: false, errorText: e.message, errorName: 'JSONRPCError' };
    }
  }

  async function extractRawResult(fields, opts = {}) {
    const res = await mcp.callTool('browser.extract_data', {
      sessionId,
      fields,
      frameSelector: opts.frameSelector,
      visibleOnly: opts.visibleOnly,
    });
    return res;
  }

  async function snapshot() {
    return textOf(await mcp.callTool('browser.snapshot', { sessionId }));
  }

  async function shutdown() {
    await mcp.callTool('browser.shutdown', { sessionId }).catch(() => {});
    mcp.child.stdin.end();
    mcp.child.kill();
    await observerBrowser.close().catch(() => {});
    await rmWithRetry(scratchProfile);
  }

  return {
    name: 'mcp',
    navFresh,
    type,
    click,
    selectOption,
    selectOptions,
    evalJs,
    extract,
    extractRawResult,
    snapshot,
    shutdown,
    getPage: () => currentPage,
    observerBrowser,
  };
}

// ── runtime driver ──────────────────────────────────────────────────────────────────────────
async function makeRuntimeDriver() {
  const mod = await import(pathToFileURL(path.join(repoRoot, 'packages', 'capability-runtime', 'dist', 'index.js')));
  const chromePath = await resolveChromeExecutablePath();
  const scratchProfile = await fs.mkdtemp(path.join(os.tmpdir(), 'fr2-02-runtime-observer-'));
  cleanupDirs.push(scratchProfile);

  const observerBrowser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    userDataDir: scratchProfile,
    args: ['--no-sandbox'],
  });
  const wsEndpoint = observerBrowser.wsEndpoint();

  const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };
  const runtime = new mod.SutradharRuntime({ logger: silentLogger });
  const { sessionId } = await runtime.attach({ endpoint: wsEndpoint });
  let currentPage = null;

  async function navFresh() {
    await runtime.navigate(sessionId, freshUrl());
    const pages = await observerBrowser.pages();
    const page = pages.find((p) => p.url().startsWith(FIXTURE_URL)) ?? pages[pages.length - 1];
    await page.waitForFunction(() => window.__fx2 && window.__fx2.ready, { timeout: 5000 }).catch(() => {});
    currentPage = page;
    return page;
  }

  async function type(selector, text) {
    await runtime.click(sessionId, selector);
    await runtime.type(sessionId, selector, text);
  }
  async function click(selector) {
    await runtime.click(sessionId, selector);
  }
  async function selectOption(selector, value) {
    await runtime.selectOption(sessionId, selector, value);
  }
  async function selectOptions(selector, values) {
    await runtime.selectOptions(sessionId, selector, values);
  }
  async function evalJs(code) {
    return runtime.eval(sessionId, code);
  }
  async function extract(fields, opts = {}) {
    try {
      const data = await runtime.extractData(sessionId, fields, undefined, opts.frameSelector, {
        visibleOnly: opts.visibleOnly,
      });
      return { ok: true, data };
    } catch (e) {
      return { ok: false, errorText: e.message, errorName: e.name };
    }
  }
  async function snapshot() {
    return runtime.snapshot(sessionId);
  }
  async function shutdown() {
    await runtime.shutdown(sessionId).catch(() => {});
    await observerBrowser.close().catch(() => {});
    await rmWithRetry(scratchProfile);
  }

  return {
    name: 'runtime',
    navFresh,
    type,
    click,
    selectOption,
    selectOptions,
    evalJs,
    extract,
    snapshot,
    shutdown,
    getPage: () => currentPage,
    observerBrowser,
  };
}

// ── case runner: same logical cases run against a driver, recording into `surfaceKey` ───────
async function runCases(driver, surfaceKey) {
  const page = await driver.navFresh();

  // C1: live typed value on a plain text input with no prior attribute.
  {
    await driver.type('#name', 'Ada Lovelace');
    const r1 = await driver.extract({ a: { selector: '#name' } });
    const r2 = await driver.extract({ b: { selector: '#name', attribute: 'value' } });
    const old = await oldSemantics(page, '#name');
    const pass =
      r1.ok && r2.ok && JSON.stringify(r1.data.a) === JSON.stringify(['Ada Lovelace']) &&
      JSON.stringify(r2.data.b) === JSON.stringify(['Ada Lovelace']) && JSON.stringify(old) !== JSON.stringify(['Ada Lovelace']);
    record(surfaceKey, {
      case: 'C1-typed-input-live-value',
      expected: '["Ada Lovelace"] both ways; old textContent semantics differ',
      observed: { r1: r1.data, r2: r2.data, old },
      oldSemanticsWouldReturn: old,
      pass,
    });
  }

  // C2: attr vs live divergence on a pre-filled input.
  {
    await driver.type('#prefilled', 'live-typed');
    const value = await driver.extract({ v: { selector: '#prefilled', attribute: 'value' } });
    const upper = await driver.extract({ v: { selector: '#prefilled', attribute: 'VALUE' } });
    const attr = await driver.extract({ v: { selector: '#prefilled', attribute: 'attr:value' } });
    const none = await driver.extract({ v: { selector: '#prefilled' } });
    const old = await oldSemantics(page, '#prefilled', 'value');
    const pass =
      JSON.stringify(value.data.v) === JSON.stringify(['live-typed']) &&
      JSON.stringify(upper.data.v) === JSON.stringify(['live-typed']) &&
      JSON.stringify(attr.data.v) === JSON.stringify(['markup-default']) &&
      JSON.stringify(none.data.v) === JSON.stringify(['live-typed']) &&
      JSON.stringify(old) === JSON.stringify(['markup-default']);
    record(surfaceKey, {
      case: 'C2-prefilled-attr-vs-live',
      expected: 'value/VALUE/none live; attr:value markup default',
      observed: { value: value.data, upper: upper.data, attr: attr.data, none: none.data, old },
      oldSemanticsWouldReturn: old,
      pass,
    });
  }

  // C3: textarea live value vs attr default.
  {
    await driver.type('#notes', 'new notes');
    const none = await driver.extract({ v: { selector: '#notes' } });
    const attr = await driver.extract({ v: { selector: '#notes', attribute: 'attr:value' } });
    const old = await oldSemantics(page, '#notes');
    const pass =
      JSON.stringify(none.data.v) === JSON.stringify(['new notes']) &&
      JSON.stringify(attr.data.v) === JSON.stringify(['']) &&
      JSON.stringify(old) === JSON.stringify(['default notes']);
    record(surfaceKey, {
      case: 'C3-textarea-live-vs-attr',
      expected: 'none -> live text; attr:value -> "" (textarea has no value attribute)',
      observed: { none: none.data, attr: attr.data, old },
      oldSemanticsWouldReturn: old,
      pass,
    });
  }

  // C4: checkbox checked state (live vs markup vs no-attribute value).
  {
    await driver.evalJs("document.querySelector('#cb-js').checked = true; document.querySelector('#cb-markup').checked = false;");
    await driver.click('#cb-click');
    const checked = await driver.extract({
      a: { selector: '#cb-js', attribute: 'checked' },
      b: { selector: '#cb-markup', attribute: 'checked' },
      c: { selector: '#cb-load', attribute: 'checked' },
      d: { selector: '#cb-click', attribute: 'checked' },
    });
    const checkedCaps = await driver.extract({ a: { selector: '#cb-js', attribute: 'Checked' } });
    const attrChecked = await driver.extract({
      a: { selector: '#cb-js', attribute: 'attr:checked' },
      b: { selector: '#cb-markup', attribute: 'attr:checked' },
      c: { selector: '#cb-load', attribute: 'attr:checked' },
      d: { selector: '#cb-click', attribute: 'attr:checked' },
    });
    const none = await driver.extract({ a: { selector: '#cb-js' } });
    const observerChecked = await page.evaluate(() => ({
      js: document.querySelector('#cb-js').checked,
      markup: document.querySelector('#cb-markup').checked,
    }));
    const pass =
      JSON.stringify(checked.data) === JSON.stringify({ a: ['true'], b: ['false'], c: ['true'], d: ['true'] }) &&
      JSON.stringify(checkedCaps.data.a) === JSON.stringify(['true']) &&
      JSON.stringify(attrChecked.data) === JSON.stringify({ a: [''], b: ['checked'], c: [''], d: [''] }) &&
      JSON.stringify(none.data.a) === JSON.stringify(['on']) &&
      observerChecked.js === true && observerChecked.markup === false;
    record(surfaceKey, {
      case: 'C4-checkbox-checked-live-vs-attr',
      expected: 'checked -> live booleans; attr:checked -> markup only; none -> value "on"',
      observed: { checked: checked.data, checkedCaps: checkedCaps.data, attrChecked: attrChecked.data, none: none.data, observerChecked },
      observerTruth: observerChecked,
      pass,
    });
  }

  // C5: radio group.
  {
    await driver.click('#r2');
    const res = await driver.extract({ r: { selector: 'input[name=r]', attribute: 'checked' } });
    const pass = JSON.stringify(res.data.r) === JSON.stringify(['false', 'true']);
    record(surfaceKey, { case: 'C5-radio-group-checked', expected: '["false","true"]', observed: res.data, pass });
  }

  // C6: single-select value/options + a JS-driven select.
  {
    await driver.selectOption('#single', 'b');
    const value = await driver.extract({ v: { selector: '#single' } });
    const none = await driver.extract({ v: { selector: '#single' } });
    const attrValue = await driver.extract({ v: { selector: '#single', attribute: 'attr:value' } });
    const optSelected = await driver.extract({ v: { selector: '#single option', attribute: 'selected' } });
    const optNone = await driver.extract({ v: { selector: '#single option' } });
    const optValue = await driver.extract({ v: { selector: '#single option', attribute: 'value' } });
    const jsSelectValue = await driver.extract({ v: { selector: '#js-select' } });
    const jsOptSelected = await driver.extract({ v: { selector: '#js-select option', attribute: 'selected' } });
    const jsOptAttrSelected = await driver.extract({ v: { selector: '#js-select option', attribute: 'attr:selected' } });
    const oldNone = await oldSemantics(page, '#single');
    const pass =
      JSON.stringify(value.data.v) === JSON.stringify(['b']) &&
      JSON.stringify(none.data.v) === JSON.stringify(['b']) &&
      JSON.stringify(attrValue.data.v) === JSON.stringify(['']) &&
      JSON.stringify(optSelected.data.v) === JSON.stringify(['false', 'true', 'false']) &&
      JSON.stringify(optNone.data.v) === JSON.stringify(['Alpha', 'Beta', 'Gamma']) &&
      JSON.stringify(optValue.data.v) === JSON.stringify(['a', 'b', 'Gamma']) &&
      JSON.stringify(jsSelectValue.data.v) === JSON.stringify(['y']) &&
      JSON.stringify(jsOptSelected.data.v) === JSON.stringify(['false', 'true']) &&
      JSON.stringify(jsOptAttrSelected.data.v) === JSON.stringify(['selected', '']) &&
      // old textContent-based semantics concatenate every option's text (whitespace from the
      // fixture's own indentation included) instead of returning the live selected value.
      oldNone[0].replace(/\s+/g, '') === 'AlphaBetaGamma' && JSON.stringify(oldNone) !== JSON.stringify(value.data.v);
    record(surfaceKey, {
      case: 'C6-select-and-options',
      expected: 'select_option->b; option selected/value/text tracked; js-select live vs markup selected',
      observed: {
        value: value.data, none: none.data, attrValue: attrValue.data, optSelected: optSelected.data,
        optNone: optNone.data, optValue: optValue.data, jsSelectValue: jsSelectValue.data,
        jsOptSelected: jsOptSelected.data, jsOptAttrSelected: jsOptAttrSelected.data, oldNone,
      },
      oldSemanticsWouldReturn: oldNone,
      pass,
    });
  }

  // C7: multi-select.
  {
    await driver.selectOptions('#multi', ['x', 'z']);
    const value = await driver.extract({ v: { selector: '#multi', attribute: 'value' } });
    const checkedOpts = await driver.extract({ v: { selector: '#multi option:checked', attribute: 'value' } });
    const pass = JSON.stringify(value.data.v) === JSON.stringify(['x']) && JSON.stringify(checkedOpts.data.v) === JSON.stringify(['x', 'z']);
    record(surfaceKey, {
      case: 'C7-multi-select',
      expected: 'value -> first selected only; option:checked -> all selected',
      observed: { value: value.data, checkedOpts: checkedOpts.data },
      pass,
    });
  }

  // C8: contenteditable.
  {
    await driver.click('#editor');
    await driver.type('#editor', 'Edited text');
    const none = await driver.extract({ v: { selector: '#editor' } });
    const value = await driver.extract({ v: { selector: '#editor', attribute: 'value' } });
    const observerText = await observerInnerText(page, '#editor');
    const pass = JSON.stringify(none.data.v) === JSON.stringify([observerText]) && JSON.stringify(value.data.v) === JSON.stringify(['']);
    record(surfaceKey, {
      case: 'C8-contenteditable',
      expected: 'none matches observer innerText; value (no attribute) -> ""',
      observed: { none: none.data, value: value.data, observerText },
      observerTruth: observerText,
      pass,
    });
  }

  // C9: href stays raw.
  {
    const href = await driver.extract({ v: { selector: '#rel-link', attribute: 'href' } });
    const attrHref = await driver.extract({ v: { selector: '#rel-link', attribute: 'attr:href' } });
    const none = await driver.extract({ v: { selector: '#rel-link' } });
    const observerAbs = await page.evaluate(() => document.querySelector('#rel-link').href);
    const pass =
      JSON.stringify(href.data.v) === JSON.stringify(['/docs/page?x=1']) &&
      JSON.stringify(attrHref.data.v) === JSON.stringify(['/docs/page?x=1']) &&
      JSON.stringify(none.data.v) === JSON.stringify(['Docs']) &&
      observerAbs !== '/docs/page?x=1';
    record(surfaceKey, {
      case: 'C9-href-raw',
      expected: 'href/attr:href relative, unresolved; observer .href absolute differs',
      observed: { href: href.data, attrHref: attrHref.data, none: none.data, observerAbs },
      observerTruth: observerAbs,
      pass,
    });
  }

  // C10: innerText visibility semantics (done-when case).
  {
    const none = await driver.extract({ v: { selector: '.msg' } });
    const visOnly = await driver.extract({ v: { selector: '.msg' } }, { visibleOnly: true });
    const mixed = await driver.extract({ v: { selector: '#mixed' } });
    const withScript = await driver.extract({ v: { selector: '#with-script' } });
    const upper = await driver.extract({ v: { selector: '#upper' } });
    const multiline = await driver.extract({ v: { selector: '#multiline' } });
    const obsUpper = await observerInnerText(page, '#upper');
    const obsMultiline = await observerInnerText(page, '#multiline');
    const pass =
      none.data.v.length === 5 &&
      none.data.v[0] === 'Visible message' &&
      none.data.v[1] === 'SECRET-DISPLAY-NONE' &&
      none.data.v[4] === 'SECRET-ANCESTOR' &&
      JSON.stringify(visOnly.data.v) === JSON.stringify(['Visible message']) &&
      !JSON.stringify(visOnly.data).includes('SECRET-') &&
      JSON.stringify(mixed.data.v) === JSON.stringify(['Visible part']) &&
      JSON.stringify(withScript.data.v) === JSON.stringify(['Shown']) &&
      JSON.stringify(upper.data.v) === JSON.stringify([obsUpper]) &&
      JSON.stringify(multiline.data.v) === JSON.stringify([obsMultiline]) &&
      obsUpper === 'MIXED CASE' && obsMultiline === 'Line A\nLine B';
    record(surfaceKey, {
      case: 'C10-innertext-visibility (DONE-WHEN)',
      expected: 'none returns all 5 incl. hidden text; visibleOnly drops all SECRET-; mixed/script/case/multiline as observed',
      observed: { none: none.data, visOnly: visOnly.data, mixed: mixed.data, withScript: withScript.data, upper: upper.data, multiline: multiline.data, obsUpper, obsMultiline },
      observerTruth: { obsUpper, obsMultiline },
      pass,
    });
  }

  // C11: visibleOnly precedence (call-level vs per-field override).
  {
    const callTrue = await driver.extract({ msg: { selector: '.msg' }, csrf: { selector: '#csrf', visibleOnly: false } }, { visibleOnly: true });
    const callUnsetFieldTrue = await driver.extract({ msg: { selector: '.msg', visibleOnly: true } });
    const csrfCallOnly = await driver.extract({ csrf: { selector: '#csrf' } }, { visibleOnly: true });
    const pass =
      JSON.stringify(callTrue.data.csrf) === JSON.stringify(['tok123']) &&
      JSON.stringify(callTrue.data.msg) === JSON.stringify(['Visible message']) &&
      JSON.stringify(callUnsetFieldTrue.data.msg) === JSON.stringify(['Visible message']) &&
      JSON.stringify(csrfCallOnly.data.csrf) === JSON.stringify([]);
    record(surfaceKey, {
      case: 'C11-visibleOnly-precedence',
      expected: 'field override beats call-level; call-level alone still applies when field unset',
      observed: { callTrue: callTrue.data, callUnsetFieldTrue: callUnsetFieldTrue.data, csrfCallOnly: csrfCallOnly.data },
      pass,
    });
  }

  // C13: opacity/offscreen still "visible" under the rule.
  {
    const res = await driver.extract({ g: { selector: '#ghost' }, o: { selector: '#offscreen-msg' } }, { visibleOnly: true });
    const pass = res.data.g.length === 1 && res.data.o.length === 1;
    record(surfaceKey, { case: 'C13-opacity-offscreen-still-visible', expected: 'both returned under visibleOnly', observed: res.data, pass });
  }

  // C14: frameSelector.
  {
    let frameTypeNote = null;
    try {
      await driver.type('#f', 'noop'); // will fail to resolve a selector inside the frame from the top level; caught below
    } catch {
      /* expected — #f is the iframe itself on the top level, not the field inside it */
    }
    // Type into the frame's own #fi via the observer directly (cross-iframe typing through the
    // click/type tools targets top-level selectors; reaching inside srcdoc iframes needs the
    // frame's own execution context) — recorded as a separate finding per spec §5's C14 note.
    const frame = page.frames().find((f) => f.url().startsWith('data:') || f.name() === '');
    const iframeFrame = page.frames().find((f) => f !== page.mainFrame());
    if (iframeFrame) {
      await iframeFrame.evaluate(() => {
        document.querySelector('#fi').value = 'in-frame';
      });
      frameTypeNote = 'typed #fi via observer frame.evaluate — click/type tools do not target inside a srcdoc iframe by top-level selector';
    }
    const inFrame = await driver.extract(
      { v: { selector: '#fi' }, a: { selector: '#fi', attribute: 'attr:value' }, m: { selector: '.fmsg', visibleOnly: true } },
      { frameSelector: '#f' },
    );
    const topLevel = await driver.extract({ v: { selector: '#fi' } });
    const pass =
      JSON.stringify(inFrame.data.v) === JSON.stringify(['in-frame']) &&
      JSON.stringify(inFrame.data.a) === JSON.stringify(['frame-markup']) &&
      JSON.stringify(inFrame.data.m) === JSON.stringify(['frame visible']) &&
      JSON.stringify(topLevel.data.v) === JSON.stringify([]);
    record(surfaceKey, {
      case: 'C14-frameSelector',
      expected: 'in-frame live value, markup attr, visible-only frame message; top-level sees nothing',
      observed: { inFrame: inFrame.data, topLevel: topLevel.data },
      finding: frameTypeNote,
      pass,
    });
  }

  // C15: shadow DOM not pierced.
  {
    const res = await driver.extract({ v: { selector: '.in-shadow' } });
    const existsInShadow = await page.evaluate(() => !!document.querySelector('#host').shadowRoot.querySelector('.in-shadow'));
    const pass = JSON.stringify(res.data.v) === JSON.stringify([]) && existsInShadow === true;
    record(surfaceKey, { case: 'C15-shadow-not-pierced', expected: '[] from light DOM; observer confirms it exists in shadow root', observed: { res: res.data, existsInShadow }, pass });
  }

  // C16: numeric snapshot-node-id selector.
  {
    await driver.snapshot(); // exercises the real tool call; the stamped id is read from the observer below for robustness against listing-format drift
    const nodeId = await page.evaluate(() => document.querySelector('#name').getAttribute('data-sd-node-id'));
    let pass = false;
    let res = null;
    if (nodeId) {
      res = await driver.extract({ v: { selector: nodeId } });
      pass = JSON.stringify(res.data.v) === JSON.stringify(['Ada Lovelace']);
    }
    record(surfaceKey, {
      case: 'C16-numeric-snapshot-node-id',
      expected: 'extract by the stamped snapshot node id reads the same live value',
      observed: { nodeId, res: res && res.data },
      pass,
    });
  }

  // C17: plain heading text, old-semantics-equivalent case.
  {
    const res = await driver.extract({ v: { selector: 'h1' } });
    const old = await oldSemantics(page, 'h1');
    const pass = JSON.stringify(res.data.v) === JSON.stringify(['FR2-02 extract_data live values']) && JSON.stringify(res.data.v) === JSON.stringify(old);
    record(surfaceKey, { case: 'C17-plain-heading', expected: 'same as old textContent semantics for plain static text', observed: { res: res.data, old }, pass });
  }

  // C18: 5000-row perf case.
  {
    const t0 = Date.now();
    const res = await driver.extract({ rows: { selector: '.row' } });
    const ms = Date.now() - t0;
    const pass = res.data.rows.length === 5000 && res.data.rows[0] === 'Row 0' && ms <= 5000;
    record(surfaceKey, { case: 'C18-5000-rows-perf', expected: 'length 5000, first "Row 0", <= 5000ms', observed: { length: res.data.rows.length, first: res.data.rows[0], ms }, ms, pass });
  }

  // C19: observer-driven mutation is picked up live.
  {
    await page.evaluate(() => {
      document.querySelector('#cb-js').checked = false;
      document.querySelector('#name').value = 'changed';
    });
    const checked = await driver.extract({ v: { selector: '#cb-js', attribute: 'checked' } });
    const name = await driver.extract({ v: { selector: '#name' } });
    const pass = JSON.stringify(checked.data.v) === JSON.stringify(['false']) && JSON.stringify(name.data.v) === JSON.stringify(['changed']);
    record(surfaceKey, { case: 'C19-observer-mutation-picked-up', expected: '["false"], ["changed"]', observed: { checked: checked.data, name: name.data }, pass });
  }

  // ── Negative cases (N1-N11 subset — MCP/runtime both) ──────────────────────────────────────
  {
    const res = await driver.extract({ bad: { selector: '.price[' } });
    const pass = !res.ok && /Invalid selector for field "bad": "\.price\[/.test(res.errorText) && /is not a valid selector/i.test(res.errorText) && /Playwright-style/.test(res.errorText);
    record(surfaceKey, { case: 'N1-invalid-selector', expected: 'error naming field/selector + Playwright-style hint', observed: res, pass });
  }
  {
    const res = await driver.extract({ ok: { selector: 'h1' }, bad: { selector: '.x[' }, bad2: { selector: 'a[[' } });
    const pass = !res.ok && res.errorText.includes('"bad"') && res.errorText.includes('"bad2"') && res.errorText.split('Use standard CSS').length - 1 === 1;
    record(surfaceKey, { case: 'N2-multiple-invalid-no-partial', expected: 'both bad fields named, exactly one hint, no partial data', observed: res, pass });
  }
  {
    const res = await driver.extract({ bad: { selector: 'pierce/#x' } });
    const pass = !res.ok && res.errorText.includes("does not support Puppeteer's pierce/");
    record(surfaceKey, { case: 'N4-pierce-prefix-note', expected: 'prefix note present', observed: res, pass });
  }
  {
    const res = await driver.extract({ v: { selector: 'h1' } }, { frameSelector: 'iframe[' });
    const pass = !res.ok && /Invalid frameSelector "iframe\[" \(from the full chain "iframe\["\)/.test(res.errorText);
    record(surfaceKey, { case: 'N5-invalid-frameSelector', expected: 'frameSelector-specific error naming hop and chain', observed: res, pass });
  }
  {
    const res = await driver.extract({ v: { selector: 'h1' } }, { frameSelector: '#nope' });
    const pass = !res.ok && /No element matched frameSelector "#nope"/.test(res.errorText);
    record(surfaceKey, { case: 'N6-unmatched-frameSelector-unchanged', expected: 'existing "No element matched" message unchanged', observed: res, pass });
  }
  {
    const res = await driver.extract({ bad: { selector: '#a', attribute: 'attr:' } });
    const pass = !res.ok && /needs an attribute name/.test(res.errorText);
    record(surfaceKey, { case: 'N7-attr-colon-no-name', expected: 'needs an attribute name error', observed: res, pass });
  }
  {
    const res = await driver.extract({ v: { selector: '' } });
    const pass = !res.ok;
    record(surfaceKey, { case: 'N10-empty-selector', expected: 'invalid-selector error', observed: res, pass });
  }
  {
    const res = await driver.extract({ v: { selector: '#does-not-exist' } });
    const pass = res.ok && JSON.stringify(res.data.v) === JSON.stringify([]);
    record(surfaceKey, { case: 'N12-no-match-not-an-error', expected: '[], not an error', observed: res, pass });
  }
  {
    const res = await driver.extract({ v: { selector: '#m2' } }, { visibleOnly: true });
    const pass = res.ok && JSON.stringify(res.data.v) === JSON.stringify([]);
    record(surfaceKey, { case: 'N13-hidden-only-under-visibleOnly', expected: '[], not an error', observed: res, pass });
  }
}

// ── MCP-only schema-level negative case (N8/N9 — validated by the MCP schema, not the runtime) ─
async function runMcpSchemaNegatives(driver) {
  {
    const raw = await driver.extractRawResult({ v: { selector: 'h1' } }, { visibleOnly: 'yes' });
    const pass = raw.isError === true;
    record('mcp', { case: 'N8-visibleOnly-schema-rejection-top-level', expected: 'schema rejection, isError', observed: raw, pass });
  }
  {
    // The MCP SDK validates tool input against the zod schema and, on failure, returns a
    // normal tool-call result with isError:true (not a thrown JSON-RPC protocol error) — same
    // shape as the top-level visibleOnly rejection above, just for a per-field schema failure.
    const raw = await driver.extractRawResult({ v: { selector: 'h1', visibleOnly: 'yes' } });
    const pass = raw.isError === true;
    record('mcp', { case: 'N8-visibleOnly-schema-rejection-per-field', expected: 'schema rejection, isError, never reaches data', observed: raw, pass });
  }
  {
    const raw = await driver.extractRawResult({});
    const pass = raw.isError === true && textOf(raw).includes('fields must have at least one entry');
    record('mcp', { case: 'N9-empty-fields-refine', expected: 'existing refine message, isError', observed: raw, pass });
  }
}

// ── bundle smoke: run a small subset against the esbuild-serialized MCP CLI bundle ───────────
async function runBundleSmoke() {
  const bundlePath = path.join(repoRoot, 'packages', 'sutradhar', 'dist', 'mcp-cli.js');
  const chromePath = await resolveChromeExecutablePath();
  const scratchProfile = await fs.mkdtemp(path.join(os.tmpdir(), 'fr2-02-bundle-observer-'));
  cleanupDirs.push(scratchProfile);
  const observerBrowser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    userDataDir: scratchProfile,
    args: ['--no-sandbox'],
  });
  const wsEndpoint = observerBrowser.wsEndpoint();
  const mcp = makeMcpClient(bundlePath);
  await mcp.call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'fr2-02-bundle', version: '1.0' } });
  mcp.notify('notifications/initialized');
  const attachResult = jsonOf(await mcp.callTool('browser.attach', { endpoint: wsEndpoint }));
  const sessionId = attachResult.sessionId;

  await mcp.callTool('browser.navigate', { sessionId, url: freshUrl() });
  const pages = await observerBrowser.pages();
  const page = pages.find((p) => p.url().startsWith(FIXTURE_URL)) ?? pages[pages.length - 1];
  await page.waitForFunction(() => window.__fx2 && window.__fx2.ready, { timeout: 5000 }).catch(() => {});

  // N1 (bundle): invalid selector.
  {
    const res = await mcp.callTool('browser.extract_data', { sessionId, fields: { bad: { selector: '.price[' } } });
    const pass = res.isError === true && textOf(res).startsWith('extract_data failed: Invalid selector for field "bad": ".price["');
    record('bundle', { case: 'N1-bundle-invalid-selector', expected: 'same error shape through the esbuild bundle', observed: res, pass });
  }

  // C1 (bundle): live typed value.
  {
    await mcp.callTool('browser.click', { sessionId, target: '#name' });
    await mcp.callTool('browser.type', { sessionId, target: '#name', value: 'Ada Lovelace' });
    const res = jsonOf(await mcp.callTool('browser.extract_data', { sessionId, fields: { a: { selector: '#name' } } }));
    const pass = JSON.stringify(res.a) === JSON.stringify(['Ada Lovelace']);
    record('bundle', { case: 'C1-bundle-live-typed-value', expected: '["Ada Lovelace"]', observed: res, pass });
  }

  // C4 subset (bundle): live checkbox.
  {
    await mcp.callTool('browser.eval', { sessionId, code: "document.querySelector('#cb-js').checked = true;" });
    const res = jsonOf(await mcp.callTool('browser.extract_data', { sessionId, fields: { a: { selector: '#cb-js', attribute: 'checked' } } }));
    const pass = JSON.stringify(res.a) === JSON.stringify(['true']);
    record('bundle', { case: 'C4-bundle-live-checkbox', expected: '["true"]', observed: res, pass });
  }

  // C10 subset (bundle): visibleOnly.
  {
    const res = jsonOf(await mcp.callTool('browser.extract_data', { sessionId, fields: { v: { selector: '.msg' } }, visibleOnly: true }));
    const pass = JSON.stringify(res.v) === JSON.stringify(['Visible message']);
    record('bundle', { case: 'C10-bundle-visibleOnly', expected: '["Visible message"]', observed: res, pass });
  }

  await mcp.callTool('browser.shutdown', { sessionId }).catch(() => {});
  mcp.child.stdin.end();
  mcp.child.kill();
  await observerBrowser.close().catch(() => {});
  await rmWithRetry(scratchProfile);
}

// ── main ──────────────────────────────────────────────────────────────────────────────────
async function main() {
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });

  const mcpDriver = await makeMcpDriver();
  try {
    await runCases(mcpDriver, 'mcp');
    await runMcpSchemaNegatives(mcpDriver);
  } finally {
    await mcpDriver.shutdown();
  }

  const runtimeDriver = await makeRuntimeDriver();
  try {
    await runCases(runtimeDriver, 'runtime');
  } finally {
    await runtimeDriver.shutdown();
  }

  await runBundleSmoke();

  await writeJsonl('live-mcp.jsonl', results.mcp);
  await writeJsonl('live-runtime.jsonl', results.runtime);
  await writeJsonl('live-bundle.jsonl', results.bundle);

  // Only this run's OWN observer profile dirs — this script always attaches to an
  // independently-launched observer Chrome (browser.attach), it never calls browser.launch, so
  // no sutradhar-managed "sutradhar-cli-*" profile should exist from this run at all. A blanket
  // "sutradhar-cli-" prefix match (as FR2-01's script uses, since IT does call browser.launch)
  // would instead flag unrelated Chrome processes left over from other sessions on the machine.
  const needlePaths = [...cleanupDirs];
  const chromeCheck = await countLingeringChromeProcesses(needlePaths);
  if (chromeCheck.count > 0) overallOk = false;

  const summary = {
    at: new Date().toISOString(),
    overallOk,
    counts: {
      mcp: { total: results.mcp.length, passed: results.mcp.filter((r) => r.pass).length },
      runtime: { total: results.runtime.length, passed: results.runtime.filter((r) => r.pass).length },
      bundle: { total: results.bundle.length, passed: results.bundle.filter((r) => r.pass).length },
    },
    cleanupDirsAttempted: cleanupDirs,
    lingeringChromeProcesses: chromeCheck,
  };
  await fs.writeFile(path.join(EVIDENCE_DIR, 'live-summary.json'), JSON.stringify(summary, null, 2), 'utf-8');
  console.log(JSON.stringify(summary, null, 2));

  if (!overallOk) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
