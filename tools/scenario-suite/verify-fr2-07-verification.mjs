// Live-verify script for FR2-07 (a single verification contract). Drives the REAL BUILT worktree
// artifacts (packages/mcp-server/dist/cli.js over stdio, packages/cli/dist/cli.js, the SDK at
// packages/sutradhar/dist/index.js, and the bundle packages/sutradhar/dist/mcp-cli.js) against a
// real Chrome, using an INDEPENDENT puppeteer-core observer connection as ground truth: a case
// passes only when the tool's own verification report agrees with what the observer reads from
// the real page / filesystem / clipboard. See .ai/loop/field-report-2/evidence/FR2-07/spec.md §5-6.
//
// A case marked NEG is an action that superficially "succeeds" while the effect does not happen:
// it must show success:true && verification.verified === false, with the OBSERVER confirming the
// effect really did not happen.
//
// Run:      node tools/scenario-suite/verify-fr2-07-verification.mjs
// Baseline: node tools/scenario-suite/verify-fr2-07-verification.mjs --baseline
//           (drives a PRE-change build given by FR207_BASELINE_ROOT; asserts nothing)
// Filter:   --only=K,F  (case-id prefixes)   --surface=mcp,cli,sdk,bundle
// Requires: `pnpm build` already run in this worktree.
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { startFr207Server } from './fixtures/fr2-07-server.mjs';
import { startDownloadServer } from './fixtures/fr2-05-download-server.mjs';
import { matrixCases } from './fixtures/fr2-07-matrix.mjs';
import { oracleTruth } from './fixtures/fr2-07-oracle.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..');
const EVIDENCE_DIR =
  process.env.SUTRADHAR_FR2_07_EVIDENCE_DIR ??
  path.join(repoRoot, '.ai', 'loop', 'field-report-2', 'evidence', 'FR2-07', 'run-1');
const args = process.argv.slice(2);
const BASELINE = args.includes('--baseline');
const ONLY = (args.find((a) => a.startsWith('--only=')) ?? '').slice(7).split(',').filter(Boolean);
const SURFACES = (args.find((a) => a.startsWith('--surface=')) ?? '--surface=mcp,cli,sdk,bundle').slice(10).split(',');
const ROOT = BASELINE ? process.env.FR207_BASELINE_ROOT : repoRoot;
if (BASELINE && !ROOT) throw new Error('--baseline needs FR207_BASELINE_ROOT (a built pre-change tree)');

const require_ = createRequire(path.join(repoRoot, 'packages', 'browser', 'package.json'));
const puppeteer = require_('puppeteer-core');

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
// GAP-322 / K11: the cross-origin TARGET frame is picked by a unique token in ITS url, never by "the first frame with the right origin"
// (any extra frame from the same origin, listed earlier, made $eval look for #xo-in in the wrong document).
const XO_TARGET = 'role=xo-target';
// audit-2 regression shapes replayed on the CLI and SDK surfaces (the MCP/bundle surfaces run the whole generated matrix)
const SURFACE_MATRIX_IDS = [
  'iframe-cross-origin|visibility-hidden|inner',
  'iframe-same-origin|visibility-hidden|inner',
  'iframe-sandboxed|visibility-hidden|inner',
  'iframe-cross-origin|visibility-hidden|outer',
  'iframe-cross-origin|display-none|inner',
  'iframe-cross-origin|none|-',
  'shadow-bare-text|none|-',
  'shadow-bare-text|display-none|outer',
  'deep-dom|display-none|outer',
];
const results = []; // {surface, case, expected, observed, observerTruth, verification, pass}
const baselineRows = [];
let overallOk = true;
const tempDirs = [];
const spawned = []; // PIDs of every child this script started (never kill anything else)

function wanted(id) {
  return ONLY.length === 0 || ONLY.some((p) => id.startsWith(p));
}

function record(surface, id, pass, data = {}) {
  const entry = { surface, case: id, pass: !!pass, ...data };
  results.push(entry);
  if (!pass) overallOk = false;
  console.log(`[${surface}] ${pass ? 'PASS' : 'FAIL'} ${id}${pass ? '' : ' — ' + JSON.stringify(data.observed ?? data.detail ?? '').slice(0, 400)}`);
}

async function rmWithRetry(dir) {
  for (let i = 0; i < 15; i++) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
      return;
    } catch {
      await delay(400);
    }
  }
}

function resolveChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const r = spawnSync(process.execPath, [
    '-e',
    `import(${JSON.stringify(pathToFileURL(path.join(repoRoot, 'packages', 'browser', 'dist', 'index.js')).href)}).then(m=>console.log(new m.BrowserLauncher().findExecutablePath()))`,
  ], { encoding: 'utf-8' });
  const p = (r.stdout || '').trim();
  if (!p) throw new Error('No Chrome/Edge executable found — set CHROME_PATH.');
  return p;
}

// ── MCP JSON-RPC stdio client (same pattern as verify-fr2-01/05; run-mcp.mjs can't be imported) ──
function makeMcpClient(serverPath, env) {
  const child = spawn(process.execPath, [serverPath], { stdio: ['pipe', 'pipe', 'pipe'], env: env ?? process.env });
  spawned.push(child.pid);
  let buf = '';
  let nextId = 1;
  const pending = new Map();
  child.stdout.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
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
  child.stderr.on('data', () => {});
  const call = (method, params, timeoutMs = 90000) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`timeout waiting for ${method} (id=${id})`));
        }
      }, timeoutMs);
    });
  return {
    child,
    call,
    notify: (method, params) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n'),
    callTool: (name, a) => call('tools/call', { name, arguments: a }),
  };
}
const textOf = (r) => r.content?.[0]?.text ?? '';
const jsonOf = (r) => JSON.parse(textOf(r));
const tierOf = (res) => res?.verification?.evidence?.tier;
const checkOf = (res, id) => res?.verification?.evidence?.checks?.find((c) => c.check === id);
const reasonOf = (res) => res?.verification?.reason ?? '';

// ── CLI driver ──────────────────────────────────────────────────────────────────────────────
const CLI = path.join(repoRoot, 'packages', 'cli', 'dist', 'cli.js');
function runCli(argv, env, timeout = 120000) {
  // Async spawn (NOT spawnSync): the fixture HTTP servers run in this same process, so blocking the event
  // loop would starve Chrome's own requests to them.
  return new Promise((resolve) => {
    const t0 = performance.now();
    const child = spawn(process.execPath, [CLI, ...argv], { env, windowsHide: true, cwd: env.__CWD ?? repoRoot });
    spawned.push(child.pid);
    let stdout = '';
    let stderr = '';
    let done = false;
    child.stdout.on('data', (x) => (stdout += x.toString('utf8')));
    child.stderr.on('data', (x) => (stderr += x.toString('utf8')));
    const finish = (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), code, ms: performance.now() - t0 });
    };
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* already gone */ }
      finish(null);
    }, timeout);
    child.on('close', (code) => finish(code));
  });
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// MCP-driven cases (also reused for the bundle surface with a subset)
// ─────────────────────────────────────────────────────────────────────────────────────────
async function runMcpCases(surface, serverPath, ctx) {
  const { server, dl, chromePath } = ctx;
  const scratchProfile = await fs.mkdtemp(path.join(os.tmpdir(), 'fr2-07-obs-'));
  tempDirs.push(scratchProfile);
  const downloadRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'fr2-07-dlroot-'));
  tempDirs.push(downloadRoot);
  const observer = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    userDataDir: scratchProfile,
    args: ['--no-sandbox'],
    defaultViewport: { width: 1100, height: 900 },
  });
  spawned.push(observer.process()?.pid);
  const mcp = makeMcpClient(serverPath, { ...process.env, SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS: downloadRoot });
  await mcp.call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'fr2-07-verify', version: '1.0' } });
  mcp.notify('notifications/initialized');
  const att = jsonOf(await mcp.callTool('browser.attach', { endpoint: observer.wsEndpoint() }));
  const sessionId = att.sessionId;
  const tool = async (name, a = {}) => {
    const r = await mcp.callTool(name, { sessionId, ...a });
    return { raw: r, json: (() => { try { return jsonOf(r); } catch { return undefined; } })(), isError: !!r.isError, text: textOf(r) };
  };
  const call = async (name, a = {}) => (await tool(name, a)).json;

  const observerPage = async () => {
    const pages = await observer.pages();
    return pages.find((p) => p.url().startsWith(server.origin)) ?? pages[pages.length - 1];
  };
  async function fresh(extra = '') {
    await tool('browser.navigate', { url: server.url('/page.html', undefined, extra) });
    const page = await observerPage();
    await page.waitForFunction(() => window.__fx7 && window.__fx7.ready, { timeout: 8000 });
    // The cross-origin (out-of-process) frame attaches asynchronously: wait until it is live and its button exists.
    const t0 = performance.now();
    for (;;) {
      const fr = page.frames().find((f) => f.url().includes(XO_TARGET));
      if (fr && (await fr.$('#xo-btn').catch(() => null))) break;
      if (performance.now() - t0 > 8000) break;
      await delay(100);
    }
    return page;
  }
  const val = (page, sel) => page.$eval(sel, (e) => e.value);
  const clicks = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__fx7.clicks)));
  const centerOf = (page, sel) =>
    page.$eval(sel, (e) => {
      const r = e.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    });
  const mk = (id, fn) => async () => {
    if (!wanted(id)) return;
    try {
      await fn(id);
    } catch (e) {
      record(surface, id, false, { observed: `case threw: ${e.message}` });
    }
  };
  const C = (id, fn) => cases.push(mk(id, fn));
  const cases = [];

  // ── K: press_key ─────────────────────────────────────────────────────────────────────────
  C('K1', async (id) => {
    const page = await fresh();
    await tool('browser.focus', { target: '#txt' });
    const r = (await tool('browser.press_key', { key: 'a' })).json;
    const truth = await val(page, '#txt');
    record(surface, id, r.success && tierOf(r) === 'verified' && checkOf(r, 'press_key.effect')?.outcome === 'pass' && truth === 'a', {
      expected: 'verified; press_key.effect pass; observer #txt.value === "a"',
      observed: { tier: tierOf(r), reason: reasonOf(r) }, observerTruth: { value: truth }, verification: r.verification,
    });
  });
  const negKey = (id, sel, key, expectTier, reasonSub, truthFn) =>
    C(id, async (cid) => {
      const page = await fresh();
      await tool('browser.focus', { target: sel });
      const r = (await tool('browser.press_key', { key })).json;
      const truth = await truthFn(page);
      record(surface, cid, r.success === true && r.verification?.verified === false && tierOf(r) === expectTier && reasonOf(r).includes(reasonSub) && truth.ok, {
        expected: `success:true, verified:false, tier ${expectTier}, reason ~ "${reasonSub}"`,
        observed: { success: r.success, tier: tierOf(r), reason: reasonOf(r) }, observerTruth: truth, verification: r.verification,
      });
    });
  if (surface !== 'bundle') {
    negKey('K2', '#blocked', 'a', 'contradicted', 'value did not change', async (p) => ({ ok: (await val(p, '#blocked')) === '', value: await val(p, '#blocked') }));
    negKey('K3', '#ro', 'a', 'contradicted', 'readonly', async (p) => ({ ok: (await val(p, '#ro')) === 'x', value: await val(p, '#ro') }));
    negKey('K5', '#swallow', 'a', 'contradicted', 'no trusted keydown', async (p) => ({ ok: (await val(p, '#swallow')) === '', value: await val(p, '#swallow') }));
    negKey('K7', '#trap', 'Tab', 'contradicted', 'did not move focus', async (p) => {
      const id = await p.evaluate(() => document.activeElement && document.activeElement.id);
      return { ok: id === 'trap', activeElement: id };
    });
    C('K4', async (id) => {
      const page = await fresh();
      await tool('browser.focus', { target: '#txt' });
      await page.evaluate(() => document.activeElement.blur());
      const r = (await tool('browser.press_key', { key: 'a' })).json;
      const truth = await val(page, '#txt');
      record(surface, id, r.success && r.verification.verified === false && tierOf(r) === 'unverifiable' && reasonOf(r).includes('no element had focus') && truth === '', {
        expected: 'unverifiable "no element had focus"; observer value unchanged', observed: { tier: tierOf(r), reason: reasonOf(r) }, observerTruth: { value: truth }, verification: r.verification,
      });
    });
    C('K6', async (id) => {
      const page = await fresh();
      await tool('browser.focus', { target: '#tab-a' });
      const r = (await tool('browser.press_key', { key: 'Tab' })).json;
      const active = await page.evaluate(() => document.activeElement && document.activeElement.id);
      record(surface, id, tierOf(r) === 'verified' && reasonOf(r).includes('moved focus') && active === 'tab-b', {
        expected: 'verified "moved focus"; observer activeElement #tab-b', observed: { tier: tierOf(r), reason: reasonOf(r) }, observerTruth: { active }, verification: r.verification,
      });
    });
    C('K8', async (id) => {
      const page = await (async () => { await tool('browser.navigate', { url: server.url('/nav/form') }); return observerPage(); })();
      await tool('browser.focus', { target: '#q' });
      await tool('browser.type', { target: '#q', value: 'x' });
      await tool('browser.focus', { target: '#q' });
      const r = (await tool('browser.press_key', { key: 'Enter' })).json;
      await delay(500);
      const url = (await observerPage()).url();
      record(surface, id, r.success && tierOf(r) === 'verified' && /\/nav\/b\?q=x/.test(url), {
        expected: 'verified (Enter delivered / navigated); observer URL /nav/b?q=x', observed: { tier: tierOf(r), reason: reasonOf(r) }, observerTruth: { url }, verification: r.verification,
      });
    });
    const inFrame = async (id, sel, frameMatch, readFn) => {
      const page = await fresh();
      const f = await tool('browser.focus', { target: sel });
      const r = (await tool('browser.press_key', { key: 'b' })).json;
      const truth = await readFn(page);
      record(surface, id, f.json?.success && tierOf(f.json) === 'verified' && tierOf(r) === 'verified' && truth === 'b', {
        expected: 'focus + press verified; observer reads "b" through the frame/shadow boundary', observed: { focusTier: tierOf(f.json), tier: tierOf(r), reason: reasonOf(r) }, observerTruth: { value: truth }, verification: r.verification,
      });
    };
    C('K9', (id) => inFrame(id, '#shadow-in', null, (p) => p.evaluate(() => document.querySelector('#host').shadowRoot.querySelector('input').value)));
    C('K10', (id) => inFrame(id, '#in-frame', null, async (p) => {
      const fr = p.frames().find((f) => f !== p.mainFrame() && f.url().startsWith('about:srcdoc'));
      return fr ? fr.$eval('#in-frame', (e) => e.value) : 'no-frame';
    }));
    C('K11', (id) => inFrame(id, '#xo-in', null, async (p) => {
      const fr = p.frames().find((f) => f.url().includes(XO_TARGET));
      return fr ? fr.$eval('#xo-in', (e) => e.value) : 'no-frame';
    }));
    C('K12', async (id) => {
      const page = await (async () => { await tool('browser.navigate', { url: server.url('/prob043.html') }); const p = await observerPage(); await p.waitForFunction(() => document.getElementById('ready')?.textContent === 'ready', { timeout: 8000 }); return p; })();
      const KEYS = ['a', 'Z', '5', 'Backspace', 'Delete', 'ArrowLeft', 'Enter'];
      const tiers = {};
      const bad = [];
      const N = 150;
      const order = [...Array(64).keys()].sort(() => Math.random() - 0.5);
      for (let i = 0; i < N; i++) {
        const n = order[i % 64];
        const sel = `#press-${n}`;
        const key = KEYS[Math.floor(Math.random() * KEYS.length)];
        const base = `v${Math.random().toString(36).slice(2, 5)}`;
        const t = await tool('browser.type', { target: sel, value: base });
        if (!t.json?.success) { bad.push({ i, why: 'type failed', t: t.text.slice(0, 200) }); continue; }
        await tool('browser.focus', { target: sel });
        const before = await page.evaluate((s, n2) => ({ v: document.querySelector(s).value, kd: window.__prob043Probe.events[`press-${n2}`].keydown }), sel, n);
        const r = (await tool('browser.press_key', { key })).json;
        const after = await page.evaluate((s, n2) => ({ v: document.querySelector(s).value, kd: window.__prob043Probe.events[`press-${n2}`].keydown }), sel, n);
        const t2 = tierOf(r);
        tiers[t2] = (tiers[t2] ?? 0) + 1;
        const valueChanged = before.v !== after.v;
        const kdUp = after.kd > before.kd;
        if (r.verification.verified && !(valueChanged || kdUp)) bad.push({ i, key, why: 'verified without an observed effect or delivery', before, after, reason: reasonOf(r) });
        if (t2 === 'contradicted' && valueChanged) bad.push({ i, key, why: 'contradicted although the observer saw the value change', before, after, reason: reasonOf(r) });
        if (t2 === 'unverifiable') bad.push({ i, key, why: 'unverifiable on a focused input', reason: reasonOf(r) });
        if (['a', 'Z', '5'].includes(key) && t2 !== 'verified') bad.push({ i, key, why: 'printable key into a text input was not verified', t2, reason: reasonOf(r) });
      }
      record(surface, id, bad.length === 0, {
        expected: `${N} presses: zero verified-without-effect, zero contradicted-with-effect, zero unverifiable`,
        observed: { iterations: N, tiers, mismatches: bad.slice(0, 5), mismatchCount: bad.length },
      });
    });
    C('K13', async (id) => {
      const page = await fresh();
      await tool('browser.focus', { target: '#txt' });
      const ok = (await tool('browser.press_key', { key: 'Enter', expect: { text: 'FR2-07 SAVED' } })).json;
      const page2 = await fresh();
      await tool('browser.focus', { target: '#txt' });
      const bad = (await tool('browser.press_key', { key: 'Enter', expect: { text: 'NOT THERE' } })).json;
      const toastVisible = await page2.$eval('#toast', (e) => e.innerText).catch(() => null);
      record(surface, id,
        ok.success && tierOf(ok) === 'verified' && checkOf(ok, 'expect.text')?.outcome === 'pass' &&
          bad.success === true && tierOf(bad) === 'contradicted' && checkOf(bad, 'expect.text')?.outcome === 'fail',
        { expected: 'Enter + expect present -> verified; expect absent -> contradicted, success stays true', observed: { ok: tierOf(ok), bad: tierOf(bad) }, observerTruth: { toastVisible }, verification: bad.verification });
    });
  } else {
    // bundle subset: K1 (registered above)
  }

  // ── F: focus ─────────────────────────────────────────────────────────────────────────────
  if (surface !== 'bundle') {
    C('F1', async (id) => {
      const page = await fresh();
      const r = (await tool('browser.focus', { target: '#txt' })).json;
      const active = await page.evaluate(() => document.activeElement.id);
      record(surface, id, tierOf(r) === 'verified' && active === 'txt', { expected: 'verified; observer activeElement #txt', observed: { tier: tierOf(r), reason: reasonOf(r) }, observerTruth: { active }, verification: r.verification });
    });
    for (const [id, sel] of [['F2', '#nofocus'], ['F3', '#blur-on-focus']]) {
      C(id, async (cid) => {
        const page = await fresh();
        const r = (await tool('browser.focus', { target: sel })).json;
        const active = await page.evaluate(() => document.activeElement.tagName.toLowerCase());
        record(surface, cid, r.success === true && r.verification.verified === false && tierOf(r) === 'contradicted' && active === 'body', {
          expected: 'NEG: success:true, contradicted; observer activeElement is body', observed: { success: r.success, tier: tierOf(r), reason: reasonOf(r) }, observerTruth: { active }, verification: r.verification,
        });
      });
    }
    for (const [id, sel, finder] of [
      ['F4', '#in-frame', (p) => p.frames().find((f) => f !== p.mainFrame() && f.url().startsWith('about:srcdoc'))],
      ['F5', '#xo-in', (p) => p.frames().find((f) => f.url().includes(XO_TARGET))],
    ]) {
      C(id, async (cid) => {
        const page = await fresh();
        const r = (await tool('browser.focus', { target: sel })).json;
        const fr = finder(page);
        const active = fr ? await fr.evaluate(() => document.activeElement && document.activeElement.id) : 'no-frame';
        record(surface, cid, tierOf(r) === 'verified' && active === sel.slice(1), { expected: 'verified; observer reads the frame document activeElement', observed: { tier: tierOf(r), reason: reasonOf(r) }, observerTruth: { active }, verification: r.verification });
      });
    }
    C('F6', async (id) => {
      const page = await fresh();
      const r = (await tool('browser.focus', { target: '#shadow-in' })).json;
      const active = await page.evaluate(() => document.querySelector('#host').shadowRoot.activeElement?.id);
      record(surface, id, tierOf(r) === 'verified' && active === 'shadow-in', { expected: 'verified; observer shadowRoot.activeElement', observed: { tier: tierOf(r) }, observerTruth: { active }, verification: r.verification });
    });
  }

  // ── D: download (FR2-05 server) ──────────────────────────────────────────────────────────
  if (surface !== 'bundle') {
    const dlCase = async (caseId, opts) => {
      await delay(1100); // duplicate-action guard: the same target (#dl) within 1s is rejected
      await tool('browser.navigate', { url: dl.pageUrl(caseId, opts) });
      return (await tool('browser.download_file', { target: '#dl', downloadDir: downloadRoot })).json;
    };
    C('D1', async (id) => {
      const r = await dlCase('d1', { name: 'fr207-d1.bin' });
      const served = dl.served.filter((s) => s.caseId === 'd1').at(-1);
      const st = r.output?.downloadedPath ? await fs.stat(r.output.downloadedPath).catch(() => null) : null;
      record(surface, id, tierOf(r) === 'verified' && st && st.size === served?.size && r.output.downloadedSizeBytes === st.size, {
        expected: 'verified; reported bytes == observer fs.stat == server ground truth', observed: { tier: tierOf(r), size: r.output?.downloadedSizeBytes, reason: reasonOf(r) },
        observerTruth: { fsSize: st?.size, servedSize: served?.size }, verification: r.verification,
      });
    });
    C('D2', async (id) => {
      const r = await dlCase('d2', { name: 'fr207-d2.bin', empty: true });
      const st = r.output?.downloadedPath ? await fs.stat(r.output.downloadedPath).catch(() => null) : null;
      record(surface, id, r.success === true && r.verification.verified === false && tierOf(r) === 'contradicted' && reasonOf(r).includes('0 bytes') && st?.size === 0, {
        expected: 'NEG: success:true, contradicted "0 bytes"; observer fs.stat size 0', observed: { success: r.success, tier: tierOf(r), reason: reasonOf(r) }, observerTruth: { fsSize: st?.size }, verification: r.verification,
      });
    });
    C('D3', async (id) => {
      const a = await dlCase('d3a', { name: 'fr207-same.bin' });
      const b = await dlCase('d3b', { name: 'fr207-same.bin' });
      // Chrome (CDP download behavior 'allow') overwrote the first file here rather than uniquifying it, so the
      // paths are equal; what FR2-07 must get right is that the SECOND download is judged by its own fresh mtime.
      const st = b.output?.downloadedPath ? await fs.stat(b.output.downloadedPath).catch(() => null) : null;
      record(surface, id, tierOf(a) === 'verified' && tierOf(b) === 'verified' && !reasonOf(b).includes('predates') && !!st && st.size === b.output.downloadedSizeBytes, {
        expected: 'same filename twice: both verified, neither flagged "predates" (paths recorded; distinct paths are a FR2-05 concern)', observed: { a: tierOf(a), b: tierOf(b), pa: a.output?.downloadedPath, pb: b.output?.downloadedPath },
      });
    });
  }

  // ── N: navigation ────────────────────────────────────────────────────────────────────────
  C('N1', async (id) => {
    await tool('browser.navigate', { url: server.url('/nav/a') });
    const page = await observerPage();
    const t0 = await page.evaluate(() => performance.timeOrigin);
    const r = (await tool('browser.navigate', { url: server.url('/nav/b') })).json;
    const t1 = await (await observerPage()).evaluate(() => performance.timeOrigin);
    record(surface, id, tierOf(r) === 'verified' && reasonOf(r).includes('new document') && t1 !== t0, {
      expected: 'verified "new document"; observer timeOrigin changed', observed: { tier: tierOf(r), reason: reasonOf(r) }, observerTruth: { t0, t1 }, verification: r.verification,
    });
  });
  if (surface !== 'bundle') {
    C('N2', async (id) => {
      const url = server.url('/nav/a', 'same');
      await tool('browser.navigate', { url });
      const t0 = await (await observerPage()).evaluate(() => performance.timeOrigin);
      const r = (await tool('browser.navigate', { url })).json;
      const t1 = await (await observerPage()).evaluate(() => performance.timeOrigin);
      record(surface, id, tierOf(r) === 'verified' && t1 !== t0, { expected: 'identical URL again -> verified (new loader); timeOrigin changed', observed: { tier: tierOf(r), reason: reasonOf(r) }, observerTruth: { t0, t1 }, verification: r.verification });
    });
    C('N3', async (id) => {
      await tool('browser.navigate', { url: server.url('/nav/a', 'n3') });
      const r1 = (await tool('browser.navigate', { url: server.url('/nav/a', 'n3') + '#s1' })).json;
      const r2 = (await tool('browser.navigate', { url: server.url('/nav/a', 'n3') + '#s1' })).json;
      record(surface, id, tierOf(r1) === 'verified' && reasonOf(r1).includes('same-document') && tierOf(r2) === 'verified' && reasonOf(r2).includes('already at'), {
        expected: 'hash nav -> same-document verified; repeat -> verified "already at"', observed: { r1: reasonOf(r1), r2: reasonOf(r2) }, verification: r2.verification,
      });
    });
  }
  C('N4', async (id) => {
    await tool('browser.navigate', { url: server.url('/nav/a', 'n4') });
    const tab = (await tool('browser.new_tab')).json;
    const before = (await observer.pages()).map((p) => p.url());
    const rr = await tool('browser.go_back', { tabId: tab.id });
    const r = rr.json ?? { error: rr.text };
    const after = (await observer.pages()).map((p) => p.url());
    record(surface, id, r.success !== false && r.verification?.verified === false && tierOf(r) === 'contradicted' && reasonOf(r).includes('no history entry') && JSON.stringify(before) === JSON.stringify(after), {
      expected: 'NEG: contradicted "no history entry"; observer tab URLs unchanged', observed: { tier: tierOf(r), reason: reasonOf(r), raw: rr.text.slice(0, 400) }, observerTruth: { before, after }, verification: r.verification,
    });
    await tool('browser.close_tab', { tabId: tab.id }).catch(() => {});
    await tool('browser.focus_tab', { tabId: (await tool('browser.list_tabs')).json.tabs[0].id }).catch(() => {});
  });
  if (surface !== 'bundle') {
    C('N5', async (id) => {
      await tool('browser.navigate', { url: server.url('/nav/a', 'n5') });
      const rr = await tool('browser.go_forward');
      const r = rr.json ?? { error: rr.text };
      record(surface, id, tierOf(r) === 'contradicted' && reasonOf(r).includes('no forward history entry'), { expected: 'NEG: go_forward at the end -> contradicted', observed: { tier: tierOf(r), reason: reasonOf(r) }, verification: r.verification });
    });
    C('N6', async (id) => {
      const page = await fresh();
      const before = page.url();
      await tool('browser.click', { target: '#push-same' });
      const r = (await tool('browser.go_back')).json;
      const after = (await observerPage()).url();
      const idx = checkOf(r, 'go_back.history-index');
      record(surface, id, tierOf(r) === 'verified' && after.split('?')[0] === before.split('?')[0] && idx && idx.observed === idx.expected, {
        expected: 'pushState(same URL) then go_back -> verified via history index; URL identical', observed: { tier: tierOf(r), reason: reasonOf(r), idx }, observerTruth: { before, after }, verification: r.verification,
      });
    });
    C('N7', async (id) => {
      const page = await fresh();
      const t0 = await page.evaluate(() => performance.timeOrigin);
      const r = (await tool('browser.reload')).json;
      const t1 = await (await observerPage()).evaluate(() => performance.timeOrigin);
      record(surface, id, tierOf(r) === 'verified' && t1 !== t0, { expected: 'reload -> verified new document; timeOrigin changed', observed: { tier: tierOf(r), reason: reasonOf(r) }, observerTruth: { t0, t1 }, verification: r.verification });
    });
    C('N8', async (id) => {
      const r = (await tool('browser.navigate', { url: server.url('/nav/missing') })).json;
      record(surface, id, r.verification?.verified === false && tierOf(r) === 'contradicted' && reasonOf(r).includes('HTTP 404'), { expected: 'NEG: 404 page -> contradicted "HTTP 404"', observed: { tier: tierOf(r), reason: reasonOf(r) }, verification: r.verification });
    });
    C('N9', async (id) => {
      const ok = (await tool('browser.navigate', { url: server.url('/nav/redirect'), expect: { url: '/nav/login' } })).json;
      const bad = (await tool('browser.navigate', { url: server.url('/nav/redirect'), expect: { url: '/nav/b' } })).json;
      record(surface, id, tierOf(ok) === 'verified' && tierOf(bad) === 'contradicted' && checkOf(bad, 'expect.url')?.outcome === 'fail', { expected: 'redirect + expect.url', observed: { ok: tierOf(ok), bad: tierOf(bad), okReason: reasonOf(ok) }, verification: bad.verification });
    });
    C('N10', async (id) => {
      await fresh();
      const a = (await tool('browser.click', { target: '#hash-link', expect: { urlChanged: false } })).json;
      await fresh();
      await delay(1100); // the duplicate-action guard: same target within 1s is rejected
      const b = (await tool('browser.click', { target: '#noop', expect: { urlChanged: true } })).json;
      await fresh();
      await delay(1100);
      const c = (await tool('browser.click', { target: '#noop', expect: { urlChanged: false } })).json;
      record(surface, id, tierOf(a) === 'contradicted' && tierOf(b) === 'contradicted' && tierOf(c) === 'verified', { expected: 'hash-link urlChanged:false -> contradicted; noop urlChanged:true -> contradicted; noop urlChanged:false -> verified', observed: { a: [tierOf(a), a?.error], b: [tierOf(b), b?.error], c: [tierOf(c), c?.error] } });
    });
  }

  // ── C: clipboard ─────────────────────────────────────────────────────────────────────────
  const grant = () => tool('browser.grant_permissions', { origin: server.origin, permissions: ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write'] });
  const NONCE = Date.now();
  if (surface !== 'bundle') {
    C('C1', async (id) => {
      await grant();
      const page = await fresh();
      const text = `fr2-07-A-${NONCE}`;
      const r = (await tool('browser.set_clipboard', { text })).json;
      const truth = await page.evaluate(() => navigator.clipboard.readText()).catch((e) => `ERR ${e.message}`);
      record(surface, id, r.success && tierOf(r) === 'verified' && truth === text, { expected: 'verified; observer readText equals the value', observed: { tier: tierOf(r), reason: reasonOf(r) }, observerTruth: { matches: truth === text }, verification: r.verification, _leak: JSON.stringify(r.verification) });
      ctx.leakStrings.push([`C1`, JSON.stringify(r.verification), text]);
    });
  }
  C('C2', async (id) => {
    await grant();
    await fresh();
    const sentinel = `AAAA-${NONCE}`; // same length as nv: a length-only comparison must not pass (fix-1 F2)
    const first = (await tool('browser.set_clipboard', { text: sentinel })).json;
    const page = await fresh('spoofClipboard=1');
    const nv = `BBBB-${NONCE}`;
    const r = (await tool('browser.set_clipboard', { text: nv })).json;
    const mainWorld = await page.evaluate(() => navigator.clipboard.readText()).catch((e) => `ERR ${e.message}`);
    const cdp = await page.createCDPSession();
    const tree = await cdp.send('Page.getFrameTree');
    const world = await cdp.send('Page.createIsolatedWorld', { frameId: tree.frameTree.frame.id, worldName: 'observer-truth' });
    const iso = await cdp.send('Runtime.evaluate', { expression: 'navigator.clipboard.readText()', contextId: world.executionContextId, awaitPromise: true, returnByValue: true });
    await cdp.detach();
    record(surface, id,
      tierOf(first) === 'verified' && r.success === true && r.verification.verified === false && tierOf(r) === 'contradicted' &&
        mainWorld === nv && iso.result?.value === sentinel,
      { expected: 'NEG: the spoofing page lies (main-world read returns the new text) but the isolated read still sees the OLD content -> contradicted',
        observed: { first: tierOf(first), tier: tierOf(r), reason: reasonOf(r) }, observerTruth: { mainWorldEqualsNew: mainWorld === nv, isolatedEqualsSentinel: iso.result?.value === sentinel }, verification: r.verification });
    ctx.leakStrings.push(['C2', JSON.stringify(r.verification), sentinel]);
    ctx.leakStrings.push(['C2', JSON.stringify(r.verification), nv]);
  });
  if (surface !== 'bundle') {
    C('C3', async (id) => {
      // A brand-new browser (fresh profile, no grants): read-back is blocked -> unverifiable + grant hint.
      const other = makeMcpClient(serverPath);
      await other.call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'fr2-07-c3', version: '1' } });
      other.notify('notifications/initialized');
      try {
        const l = jsonOf(await other.callTool('browser.launch', { headless: true }));
        await other.callTool('browser.navigate', { sessionId: l.sessionId, url: server.url('/page.html') });
        const r = jsonOf(await other.callTool('browser.set_clipboard', { sessionId: l.sessionId, text: `C3-${NONCE}` }));
        const g = jsonOf(await other.callTool('browser.get_clipboard', { sessionId: l.sessionId }));
        record(surface, id, r.success === true && r.verification.verified === false && tierOf(r) === 'unverifiable' && reasonOf(r).includes('grant_permissions'), {
          expected: 'NEG: no grant -> set_clipboard unverifiable with a grant_permissions hint', observed: { tier: tierOf(r), reason: reasonOf(r), getTier: tierOf(g), getText: g.text }, verification: r.verification,
        });
        record(surface, 'C4a', g.text === '' && g.verification.verified === false && reasonOf(g).includes("NOT the clipboard's content"), {
          expected: 'get_clipboard with no grant: text "" + unverifiable "NOT the clipboard\'s content"', observed: { text: g.text, tier: tierOf(g), reason: reasonOf(g) }, verification: g.verification,
        });
        await other.callTool('browser.shutdown', { sessionId: l.sessionId });
      } finally {
        other.child.stdin.end();
      }
    });
    C('C4', async (id) => {
      await grant();
      const page = await fresh();
      const text = `C4-${NONCE}`;
      await tool('browser.set_clipboard', { text });
      const g = (await tool('browser.get_clipboard')).json;
      const truth = await page.evaluate(() => navigator.clipboard.readText()).catch(() => null);
      record(surface, id, g.text === text && tierOf(g) === 'verified' && truth === text, { expected: 'get_clipboard with the grant: verified and text equals the observer value', observed: { tier: tierOf(g), reason: reasonOf(g), textMatches: g.text === text }, verification: g.verification });
    });
  }

  // ── P: click_at_point / drag_at_points ───────────────────────────────────────────────────
  C('P1', async (id) => {
    const page = await fresh();
    const c = await centerOf(page, '#real-btn');
    const before = (await clicks(page)).real ?? 0;
    const r = (await tool('browser.click_at_point', { x: c.x, y: c.y })).json;
    const after = (await clicks(page)).real ?? 0;
    record(surface, id, tierOf(r) === 'verified' && reasonOf(r).includes('button#real-btn') && after === before + 1, { expected: 'verified naming button#real-btn; observer counter +1', observed: { tier: tierOf(r), reason: reasonOf(r) }, observerTruth: { before, after }, verification: r.verification });
  });
  if (surface !== 'bundle') {
    C('P2', async (id) => {
      const page = await fresh();
      const c = await centerOf(page, '#covered-btn');
      const r = (await tool('browser.click_at_point', { x: c.x, y: c.y })).json;
      const cl = await clicks(page);
      await delay(100);
      const page2 = await fresh();
      const c2 = await centerOf(page2, '#covered-btn');
      const withExpect = (await tool('browser.click_at_point', { x: c2.x, y: c2.y, expect: { text: 'COVERED CLICKED' } })).json;
      record(surface, id,
        tierOf(r) === 'verified' && reasonOf(r).includes('div#decoy-overlay') && (cl.covered ?? 0) === 0 && (cl.decoy ?? 0) === 1 && tierOf(withExpect) === 'contradicted',
        { expected: 'decoy: verified naming div#decoy-overlay (documented semantics); covered counter unchanged; expect.text catches it', observed: { tier: tierOf(r), reason: reasonOf(r), withExpect: tierOf(withExpect) }, observerTruth: cl, verification: withExpect.verification });
    });
    C('P3', async (id) => {
      const page = await fresh();
      const c = await centerOf(page, '#vanish');
      const r = (await tool('browser.click_at_point', { x: c.x, y: c.y })).json;
      const gone = await page.$('#vanish');
      record(surface, id, r.success === true && r.verification.verified === false && tierOf(r) === 'contradicted' && reasonOf(r).includes('landed on') && reasonOf(r).includes('not on button#vanish') && gone === null, {
        expected: 'NEG: contradicted "landed on ..., not on button#vanish"', observed: { tier: tierOf(r), reason: reasonOf(r) }, observerTruth: { elementRemoved: gone === null }, verification: r.verification,
      });
    });
  }
  if (surface === 'bundle') {
    C('P3', async (id) => {
      const page = await fresh();
      const c = await centerOf(page, '#vanish');
      const r = (await tool('browser.click_at_point', { x: c.x, y: c.y })).json;
      record(surface, id, r.success === true && tierOf(r) === 'contradicted' && reasonOf(r).includes('not on button#vanish'), { expected: 'bundle: same as mcp P3', observed: { tier: tierOf(r), reason: reasonOf(r) }, verification: r.verification });
    });
  }
  if (surface !== 'bundle') {
    C('P4', async (id) => {
      await fresh();
      const r = (await tool('browser.click_at_point', { x: 5000, y: 5000 })).json;
      record(surface, id, r.success === true && tierOf(r) === 'contradicted' && reasonOf(r).includes('no element is at'), { expected: 'NEG: (5000,5000) -> contradicted "no element is at"', observed: { tier: tierOf(r), reason: reasonOf(r) }, verification: r.verification });
    });
    C('P5', async (id) => {
      const page = await fresh();
      const fr = page.frames().find((f) => f.url().includes(XO_TARGET));
      const iframeEl = await fr.frameElement();
      const ib = await iframeEl.boundingBox();
      const bb = await (await fr.$('#xo-btn')).boundingBox();
      const x = Math.round(bb.x + bb.width / 2);
      const y = Math.round(bb.y + bb.height / 2);
      void ib;
      const before = await page.evaluate(() => window.__fx7.xoClicks);
      const r = (await tool('browser.click_at_point', { x, y })).json;
      await delay(300);
      const after = await page.evaluate(() => window.__fx7.xoClicks);
      // The invariant: the verdict must AGREE with the observer's independent truth (the frame's own counter, reported by postMessage):
      // verified => counter +1; contradicted => counter unchanged; unverifiable => no claim. A tool that said verified while the counter did not move fails.
      const t = tierOf(r);
      const agrees = (t === 'verified' && after === before + 1) || (t === 'contradicted' && after === before) || t === 'unverifiable';
      record(surface, id, agrees, {
        expected: 'cross-origin frame point: verdict agrees with the frame counter (verified => +1, contradicted => unchanged, else unverifiable)', observed: { tier: t, reason: reasonOf(r) }, observerTruth: { before, after }, verification: r.verification,
      });
    });
    C('P6', async (id) => {
      const page = await fresh();
      const c = await centerOf(page, '#ctx-target');
      const r = (await tool('browser.click_at_point', { x: c.x, y: c.y, button: 'right' })).json;
      const cl = await clicks(page);
      record(surface, id, tierOf(r) === 'verified' && reasonOf(r).includes('contextmenu') && cl.ctx === 1, { expected: 'right click -> verified contextmenu; observer counter 1', observed: { tier: tierOf(r), reason: reasonOf(r) }, observerTruth: cl, verification: r.verification });
    });
    C('P7', async (id) => {
      const page = await fresh();
      const c = await centerOf(page, '#alert-btn');
      const t0 = performance.now();
      const r = (await tool('browser.click_at_point', { x: c.x, y: c.y })).json;
      const ms = performance.now() - t0;
      const ok = ms < 3000 && r.dialogPending?.type === 'alert' && tierOf(r) === 'unverifiable' && reasonOf(r).includes('dialog');
      record(surface, id, ok, { expected: 'returns < 3000ms (GAP-019), dialogPending.type alert, unverifiable naming the dialog', observed: { ms: Math.round(ms), dialogPending: r.dialogPending, tier: tierOf(r), reason: reasonOf(r) }, verification: r.verification });
      await tool('browser.handle_dialog', { action: 'accept' }).catch(() => {});
    });
    C('G1', async (id) => {
      const page = await fresh();
      const c = await centerOf(page, '#drag-pad');
      const r = (await tool('browser.drag_at_points', { fromX: c.x - 50, fromY: c.y - 20, toX: c.x + 50, toY: c.y + 20 })).json;
      const ev = await page.evaluate(() => window.__fx7.events);
      const down = ev.find((e) => e.type === 'mousedown' && e.trusted);
      const up = ev.find((e) => e.type === 'mouseup' && e.trusted && e.target === 'window');
      record(surface, id, tierOf(r) === 'verified' && down && up && Math.abs(down.x - (c.x - 50)) <= 1 && Math.abs(up.x - (c.x + 50)) <= 1, { expected: 'drag inside pad -> verified; observer saw trusted down/up within 1px', observed: { tier: tierOf(r), reason: reasonOf(r) }, observerTruth: { down, up }, verification: r.verification });
    });
    C('G2', async (id) => {
      await fresh();
      const r = (await tool('browser.drag_at_points', { fromX: 5000, fromY: 5000, toX: 10, toY: 10 })).json;
      record(surface, id, r.success === true && tierOf(r) === 'contradicted', { expected: 'NEG: drag from off-viewport -> contradicted', observed: { tier: tierOf(r), reason: reasonOf(r) }, verification: r.verification });
    });
  }

  // ── T: touch_tap (D15 decision gate) ─────────────────────────────────────────────────────
  if (surface !== 'bundle') {
    C('T1', async (id) => {
      const page = await fresh();
      const r = (await tool('browser.touch_tap', { target: '#tap-target' })).json;
      const ev = await page.evaluate(() => window.__fx7.events.filter((e) => e.target === 'tap-target'));
      const trusted = ev.filter((e) => e.trusted);
      record(surface, id, tierOf(r) === 'verified' && trusted.length > 0, { expected: 'verified with an observer-confirmed trusted event (D15 gate: if none reaches the element, touch_tap must stay unverifiable)', observed: { tier: tierOf(r), reason: reasonOf(r) }, observerTruth: { trustedEvents: trusted.map((e) => e.type) }, verification: r.verification });
    });
    C('T2', async (id) => {
      const page = await fresh();
      const r = (await tool('browser.touch_tap', { target: '#tap-covered' })).json;
      const ev = await page.evaluate(() => window.__fx7.events.filter((e) => e.target === 'tap-covered' && e.trusted));
      record(surface, id, r.success === true && tierOf(r) === 'contradicted' && reasonOf(r).includes('occluded') && ev.length === 0, { expected: 'NEG: contradicted "occluded"; observer saw no trusted event on #tap-covered', observed: { tier: tierOf(r), reason: reasonOf(r) }, observerTruth: { trustedOnCovered: ev.length }, verification: r.verification });
    });
  }

  // ── U: upload_file_via_trigger ───────────────────────────────────────────────────────────
  if (surface !== 'bundle') {
    const upDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fr2-07-up-'));
    tempDirs.push(upDir);
    const upFile = path.join(upDir, `fr207-${NONCE}.txt`);
    await fs.writeFile(upFile, 'fr2-07 upload payload\n');
    const upName = path.basename(upFile);
    const upSize = (await fs.stat(upFile)).size;
    C('U1', async (id) => {
      const page = await fresh();
      const r = (await tool('browser.upload_file_via_trigger', { target: '#browse', filePath: upFile })).json;
      const out = await page.$eval('#upload-out', (e) => e.textContent);
      record(surface, id, tierOf(r) === 'verified' && out === `${upName}:${upSize}`, { expected: 'verified; observer #upload-out === name:size', observed: { tier: tierOf(r), reason: reasonOf(r) }, observerTruth: { out }, verification: r.verification });
    });
    C('U2', async (id) => {
      const page = await fresh();
      const r = (await tool('browser.upload_file_via_trigger', { target: '#browse-reset', filePath: upFile })).json;
      const out = await page.$eval('#upload-out-b', (e) => e.textContent);
      const left = await page.$eval('#file-b', (e) => e.files.length);
      record(surface, id, tierOf(r) === 'verified' && out === `${upName}:${upSize}` && left === 0, { expected: 'verified via the change event even though the page cleared the input', observed: { tier: tierOf(r), reason: reasonOf(r) }, observerTruth: { out, filesLeft: left }, verification: r.verification });
    });
    C('U3', async (id) => {
      const page = await fresh();
      const r = (await tool('browser.upload_file_via_trigger', { target: '#browse-detached', filePath: upFile })).json;
      const got = await page.evaluate(() => window.__detachedGot);
      record(surface, id, r.success === true && r.verification.verified === false && tierOf(r) === 'unverifiable' && reasonOf(r).includes('detached') && got === upName, { expected: 'NEG: detached input -> unverifiable "detached" while the observer shows the page DID get the file (no claim either way)', observed: { tier: tierOf(r), reason: reasonOf(r) }, observerTruth: { detachedGot: got }, verification: r.verification });
    });
    C('U4', async (id) => {
      const page = await fresh();
      const r1 = (await tool('browser.upload_file_via_trigger', { target: '#browse', filePath: upFile })).json;
      const r2 = (await tool('browser.upload_file_via_trigger', { target: '#browse', filePath: upFile })).json;
      record(surface, id, tierOf(r2) !== 'contradicted' && ['verified', 'unverifiable'].includes(tierOf(r2)), { expected: 'same file re-selected: recorded, and NEVER contradicted', observed: { first: tierOf(r1), second: tierOf(r2), reason: reasonOf(r2) }, verification: r2.verification });
    });
    C('U5', async (id) => {
      await tool('browser.navigate', { url: pathToFileURL(path.join(here, 'fixtures', 'fr2-06-selectors.html')).href });
      const page = (await observer.pages()).at(-1);
      await page.waitForFunction(() => window.__fx6 && window.__fx6.ready, { timeout: 8000 });
      const r = (await tool('browser.upload_file_via_trigger', { target: 'pierce/#browse-btn', filePath: upFile })).json;
      record(surface, id, r.success === true && tierOf(r) === 'verified', { expected: 'FR2-06 compat: pierce/#browse-btn -> verified', observed: { tier: tierOf(r), reason: reasonOf(r), error: r.error }, verification: r.verification });
    });
  }

  // ── fix-1 F1/F4: expect.text must not count text that is NOT RENDERED; built-in-not-run reason ─────
  // (runs on the bundle surface too: the audit reproduced F1 on the sutradhar bundle)
  {
    /** Independent ground truth from the observer's own connection (never the tool's helper). */
    const shadowTruth = (page, hostSel) =>
      page.evaluate((sel) => {
        const p = document.querySelector(sel).shadowRoot.firstElementChild;
        return { innerText: p.innerText, textContent: p.textContent, checkVisibility: p.checkVisibility() };
      }, hostSel);
    /** Navigates to the dedicated F1 page and waits until every cross-origin text frame is live. */
    const freshHT = async () => {
      await tool('browser.navigate', { url: server.url('/hidden-text.html') });
      const pages = await observer.pages();
      const page = pages.find((p) => p.url().includes('/hidden-text.html')) ?? pages[pages.length - 1];
      await page.waitForFunction(() => window.__ht && window.__ht.ready, { timeout: 8000 });
      const t0 = performance.now();
      for (;;) {
        const tf = page.frames().filter((x) => x.url().includes('/textframe.html'));
        const live = tf.length === 2 ? await Promise.all(tf.map((x) => Promise.race([x.evaluate(() => document.body.innerText).then(() => true), delay(1000).then(() => false)]).catch(() => false))) : [];
        if (live.length === 2 && live.every(Boolean)) break;
        if (performance.now() - t0 > 8000) throw new Error('cross-origin text frames never became live');
        await delay(100);
      }
      return page;
    };
    const negText = (id, text, what, truthFn) =>
      C(id, async (cid) => {
        const page = await freshHT();
        const r = (await tool('browser.click', { target: '#noop', expect: { text } })).json;
        await delay(1200); // the engine rejects a duplicate click on the same target within 1000ms; keep the next case clear of it
        const t = await truthFn(page);
        record(surface, cid, r.success === true && r.verification?.verified === false && tierOf(r) === 'contradicted' && checkOf(r, 'expect.text')?.outcome === 'fail' && t.ok, {
          expected: `NEG: text only in ${what} (in the DOM, NOT rendered) -> contradicted; the observer confirms it is unrendered`,
          observed: { tier: tierOf(r), verified: r.verification?.verified, reason: reasonOf(r) }, observerTruth: t, verification: r.verification,
        });
      });
    const posText = (id, text, what, truthFn) =>
      C(id, async (cid) => {
        const page = await freshHT();
        const r = (await tool('browser.click', { target: '#noop', expect: { text } })).json;
        await delay(1200); // the engine rejects a duplicate click on the same target within 1000ms; keep the next case clear of it
        const t = await truthFn(page);
        record(surface, cid, r.success === true && r.verification?.verified === true && tierOf(r) === 'verified' && checkOf(r, 'expect.text')?.outcome === 'pass' && t.ok, {
          expected: `POS: text in ${what} (rendered) -> verified; the observer confirms it is rendered`,
          observed: { tier: tierOf(r), verified: r.verification?.verified, reason: reasonOf(r) }, observerTruth: t, verification: r.verification,
        });
      });
    negText('X8', 'FR2-07 SHADOW-HIDDEN', 'an open shadow root whose host is display:none', async (page) => {
      const t = await shadowTruth(page, '#hidden-shadow-host');
      // the trap: textContent has it and innerText falls back to it, but nothing is rendered
      return { ...t, ok: t.checkVisibility === false && /SHADOW-HIDDEN/.test(t.textContent) };
    });
    posText('X9', 'FR2-07 SHADOW-VISIBLE', 'a visible open shadow root', async (page) => {
      const t = await shadowTruth(page, '#visible-shadow-host');
      return { ...t, ok: t.checkVisibility === true && /SHADOW-VISIBLE/.test(t.innerText) };
    });
    negText('X10', 'FR2-07 IFRAME-HIDDEN-SAME', 'a display:none same-origin iframe', async (page) => {
      const own = await page.evaluate(() => {
        const fe = document.getElementById('hid-same');
        return { frameRects: fe.getClientRects().length, innerTextInsideHasIt: fe.contentDocument.body.innerText.includes('IFRAME-HIDDEN-SAME'), mainInnerHasIt: document.body.innerText.includes('IFRAME-HIDDEN-SAME') };
      });
      return { ...own, ok: own.frameRects === 0 && own.innerTextInsideHasIt === true && own.mainInnerHasIt === false };
    });
    negText('X11', 'FR2-07 IFRAME-HIDDEN-XO', 'a display:none CROSS-ORIGIN (out-of-process) iframe', async (page) => {
      const own = await page.evaluate(() => ({ frameRects: document.getElementById('hid-xo').getClientRects().length }));
      // never evaluate INSIDE a hidden out-of-process frame: it may never answer (the old X11 flake was this observer
      // read hanging, not the product). Its element having no box, judged from the parent side, is the ground truth.
      const fr = page.frames().find((f) => f.url().includes('IFRAME-HIDDEN-XO'));
      return { ...own, frameListed: !!fr, ok: own.frameRects === 0 };
    });
    posText('X12', 'FR2-07 IFRAME-VISIBLE-SAME', 'a visible same-origin iframe', async (page) => {
      const own = await page.evaluate(() => ({ frameRects: document.getElementById('vis-same').getClientRects().length, inner: document.getElementById('vis-same').contentDocument.body.innerText }));
      return { ...own, ok: own.frameRects > 0 && /IFRAME-VISIBLE-SAME/.test(own.inner) };
    });
    posText('X13', 'FR2-07 IFRAME-VISIBLE-XO', 'a visible cross-origin (out-of-process) iframe', async (page) => {
      const t0 = performance.now();
      let fr;
      while (!fr && performance.now() - t0 < 6000) {
        fr = page.frames().find((f) => f.url().includes('IFRAME-VISIBLE-XO'));
        if (!fr) await delay(100);
      }
      const inner = fr ? await fr.evaluate(() => document.body.innerText) : null;
      return { frameFound: !!fr, inner, ok: !!fr && /IFRAME-VISIBLE-XO/.test(inner ?? '') };
    });
  }

  // ── fix-1 F4: built-in not-run + a passing expect must still name the built-in outcome (bundle too)
  {
    // F4: the built-in press_key check could not run (nothing focused) and a trivially-true expect passes:
    // the reason must still say the built-in check did not run (spec rule 9), not the generic sentence.
    C('K15', async (id) => {
      const page = await fresh();
      await page.evaluate(() => document.activeElement && document.activeElement.blur());
      const focusedTag = await page.evaluate(() => document.activeElement && document.activeElement.tagName);
      const r = (await tool('browser.press_key', { key: 'q', expect: { urlChanged: false } })).json;
      const bi = r.verification?.evidence?.checks?.find((c) => c.check.startsWith('press_key.') && c.outcome === 'not-run');
      record(surface, id, r.success === true && r.verification?.verified === true && !!bi && !/^Action execution verified successfully/.test(reasonOf(r)) && /no element had focus/.test(reasonOf(r)) && /Expectations met: urlChanged/.test(reasonOf(r)) && focusedTag === 'BODY', {
        expected: 'built-in not-run + passing expect.urlChanged:false -> verified:true, and the reason still names the built-in outcome and the expectation',
        observed: { tier: tierOf(r), reason: reasonOf(r), notRunCheck: bi?.check }, observerTruth: { activeElementTag: focusedTag }, verification: r.verification,
      });
    });
  }

  // ── fix-2: the GENERATED expect.text matrix (hiding mechanism x placement), each verdict compared with an
  //    INDEPENDENT observer (fixtures/fr2-07-oracle.mjs) and the case label compared with the observer too ─────
  {
    const all = matrixCases();
    // the bundle runs the same code path; a deterministic third of the matrix is enough there
    const list = surface === 'bundle' ? all.filter((c, i) => i % 3 === 0) : all;
    let seq = 0;
    const tokFor = () => `QZ${String(++seq).padStart(3, '0')}K${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const pageFor = async (url) => {
      const t0 = performance.now();
      for (;;) {
        const p = (await observer.pages()).find((x) => x.url() === url);
        if (p) return p;
        if (performance.now() - t0 > 8000) throw new Error('observer never saw ' + url);
        await delay(50);
      }
    };
    const settle = async (p, framesExpected) => {
      await p.waitForFunction(() => window.__mx === 1 && document.readyState === 'complete', { timeout: 10000 });
      const t0 = performance.now();
      while (p.frames().length < 1 + framesExpected && performance.now() - t0 < 8000) await delay(50);
    };
    /** Observer truth, re-read until no frame is "unknown/hung" unless the case EXPECTS a hung frame. */
    const truthOf = async (p, tok, expectText, mode, allowHung) => {
      for (let attempt = 0; ; attempt++) {
        let t;
        if (mode === 'innerText') {
          const found = await p.evaluate((s) => document.body.innerText.includes(s), expectText);
          t = { found, frames: [], hung: 0 };
        } else t = await oracleTruth(p, tok);
        if (allowHung || t.hung === 0 || attempt >= 3) return t;
        await delay(400);
      }
    };
    const runOne = async (id, opts) => {
      try {
        await runOneInner(id, opts);
      } finally {
        server.releaseHeld(); // un-hang any frame parked in the held sync XHR before the next case
        await delay(150);
      }
    };
    const runOneInner = async (id, { url, tok, expectText, label, framesExpected, mode, allowHung, expectHung, relaxedFound, extra }) => {
      await tool('browser.navigate', { url });
      const p = await pageFor(url);
      await settle(p, framesExpected);
      const t1 = await truthOf(p, tok, expectText, mode, allowHung);
      const r = (await tool('browser.click', { target: `#go-${tok}`, expect: { text: expectText } })).json;
      const t2 = await truthOf(p, tok, expectText, mode, allowHung); // re-read AFTER the action: no stale ground truth
      const ec = checkOf(r, 'expect.text');
      const stable = t1.found === t2.found;
      const labelOk = label === undefined || label === t2.found;
      const inconclusive = !allowHung && t2.hung > 0;
      let productOk;
      if (expectHung) {
        // text absent everywhere but an unrelated frame never answers: fail closed, never verified, never "not found"
        productOk = r.success === true && r.verification?.verified === false && tierOf(r) === 'unverifiable' && ec?.outcome === 'not-run' && /did not answer/.test(ec?.detail ?? '');
      } else if (t2.found && relaxedFound) {
        // the frame holding the text may itself be one of the (natural) parse-time out-of-process frames that never answers
        // for THIS client: verified is right when it answered, fail-closed unavailable when it did not; never a false not-found
        productOk = r.success === true && ((r.verification?.verified === true && tierOf(r) === 'verified' && ec?.outcome === 'pass') || (r.verification?.verified === false && tierOf(r) === 'unverifiable' && ec?.outcome === 'not-run' && /did not answer/.test(ec?.detail ?? '')));
      } else if (t2.found) {
        productOk = r.success === true && r.verification?.verified === true && tierOf(r) === 'verified' && ec?.outcome === 'pass';
      } else {
        productOk = r.success === true && r.verification?.verified === false && tierOf(r) === 'contradicted' && ec?.outcome === 'fail';
      }
      record(surface, id, productOk && stable && labelOk && !inconclusive, {
        expected: `${expectHung ? 'UNAVAILABLE (a frame hung, text nowhere else)' : t2.found ? 'verified (rendered)' : 'contradicted (not rendered)'}; intended label ${label === undefined ? 'n/a' : label ? 'counted' : 'excluded'}; observer agrees`,
        observed: { verified: r.verification?.verified, tier: tierOf(r), expectOutcome: ec?.outcome, detail: ec?.detail, reason: reasonOf(r) },
        observerTruth: { before: t1, after: t2, stable, labelMatchesObserver: labelOk, inconclusive },
        ...extra,
      });
    };
    for (const c of list) {
      C(`M:${c.id}`, async (cid) => {
        const tok = tokFor();
        const expectText = c.expectText ? c.expectText(tok) : tok;
        const url = `${server.origin}/matrix?case=${encodeURIComponent(c.id)}&tok=${tok}`;
        await runOne(cid, { url, tok, expectText, label: c.counted, framesExpected: c.frames, mode: c.expectText || /split-over|whitespace/.test(c.id) ? 'innerText' : 'oracle', allowHung: false });
      });
    }
    // audit-2 regression: ONE unrelated out-of-process frame never answers (infinite loop); 8 cross-origin frames.
    const hungUrl = (tok, q) => `${server.origin}/matrix-hung?tok=${tok}&n=8&hung=3&${q}`;
    C('H1', (cid) => { const tok = tokFor(); return runOne(cid, { url: hungUrl(tok, 'tokIn=main'), tok, expectText: tok, label: true, framesExpected: 8, allowHung: true, extra: { note: 'text in the main frame, 1 of 8 cross-origin frames hung: must still be verified' } }); });
    C('H2', (cid) => { const tok = tokFor(); return runOne(cid, { url: hungUrl(tok, 'tokIn=5'), tok, expectText: tok, label: true, framesExpected: 8, allowHung: true, relaxedFound: true, extra: { note: 'text only in cross-origin frame 5, frame 3 hung (own process): verified, or unavailable if frame 5 itself never answered; never contradicted' } }); });
    C('H3', (cid) => { const tok = tokFor(); return runOne(cid, { url: hungUrl(tok, 'tokIn=none'), tok, expectText: tok, label: false, framesExpected: 8, allowHung: true, expectHung: true, extra: { note: 'text nowhere, frame 3 hung: fail closed (unavailable), never verified, never not-found' } }); });
  }

  // ── W / S / X / L: wait, screenshot, expect semantics, sweep ─────────────────────────────
  if (surface !== 'bundle') {
    const waitUrl = (hash = '#auto') => `${pathToFileURL(path.join(here, 'fixtures', 'fr2-01-wait-states.html')).href}?t=${Date.now()}-${Math.random().toString(36).slice(2)}${hash}`;
    C('W1', async (id) => {
      await tool('browser.navigate', { url: waitUrl() });
      const r = (await tool('browser.wait_for_selector', { target: '#toast', timeoutMs: 5000 })).json;
      record(surface, id, r.success && tierOf(r) === 'verified' && checkOf(r, 'wait_for_selector.state-matched')?.expected === 'visible', { expected: 'FR2-01 toast visible -> verified (was 0.45 before FR2-07)', observed: { tier: tierOf(r), conf: r.verification?.confidence }, verification: r.verification });
    });
    C('W2', async (id) => {
      await tool('browser.navigate', { url: waitUrl() });
      const r = (await tool('browser.wait_for_selector', { target: `#nope-typo-${NONCE}`, state: 'hidden', timeoutMs: 2000 })).json;
      record(surface, id, r.success === true && r.verification.verified === false && tierOf(r) === 'unverifiable' && reasonOf(r).includes('vacuously'), { expected: 'NEG: hidden with a typo selector -> success but unverifiable "vacuously"', observed: { tier: tierOf(r), reason: reasonOf(r) }, verification: r.verification });
    });
    C('W3', async (id) => {
      await tool('browser.navigate', { url: waitUrl() });
      const r = (await tool('browser.wait_for_selector', { target: '#banner, #stays', state: 'hidden', timeoutMs: 5000 })).json;
      record(surface, id, r.success === true && tierOf(r) === 'verified' && (checkOf(r, 'wait_for_selector.state-matched')?.detail ?? '').includes('later match'), { expected: '#banner, #stays hidden -> verified with a "later match" detail', observed: { tier: tierOf(r), detail: checkOf(r, 'wait_for_selector.state-matched')?.detail, reason: reasonOf(r) }, verification: r.verification });
    });
    C('S1', async (id) => {
      const page = await fresh();
      const res = await tool('browser.screenshot', {});
      const meta = JSON.parse(res.raw.content[1].text);
      // Independent truth: parse the returned PNG's own IHDR (bytes 16..23) here, not via the tool's helper.
      const png = Buffer.from(res.raw.content[0].data, 'base64');
      const isPng = png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      const w = png.readUInt32BE(16);
      const h = png.readUInt32BE(20);
      const viewport = await page.evaluate(() => ({ innerWidth: window.innerWidth, scrollHeight: document.documentElement.scrollHeight }));
      const chk = meta.verification.evidence.checks.find((c) => c.check === 'screenshot.png-well-formed');
      record(surface, id, res.raw.content[0].type === 'image' && isPng && meta.verification.evidence.tier === 'unverifiable' && chk?.outcome === 'pass' && chk?.observed === `${w}x${h}`, { expected: 'screenshot: image content[0]; unverifiable by design; png-well-formed observed WxH == the returned PNG IHDR dimensions', observed: { tier: meta.verification.evidence.tier, png: chk?.observed, reason: meta.verification.reason }, observerTruth: { ihdr: `${w}x${h}`, observerViewport: viewport }, verification: meta.verification });
    });
    C('X1', async (id) => {
      const page = await fresh();
      const r = (await tool('browser.click', { target: '#show-saved', expect: { text: 'FR2-07 SAVED' } })).json;
      const shown = await page.$eval('#toast', (e) => e.innerText).catch(() => null);
      record(surface, id, tierOf(r) === 'verified' && checkOf(r, 'expect.text')?.outcome === 'pass' && shown === 'FR2-07 SAVED', { expected: 'expect.text present -> verified', observed: { tier: tierOf(r) }, observerTruth: { toast: shown }, verification: r.verification });
    });
    C('X2', async (id) => {
      const page = await fresh();
      const r = (await tool('browser.click', { target: '#noop', expect: { text: 'FR2-07 SAVED' } })).json;
      const truth = await page.evaluate(() => ({
        hiddenHasIt: document.getElementById('hidden-template').textContent.includes('FR2-07 SAVED'),
        hiddenInnerText: document.getElementById('hidden-template').innerText,
        bodyInnerHasIt: document.body.innerText.includes('FR2-07 SAVED'),
        bodyTextContentHasIt: document.body.textContent.includes('FR2-07 SAVED'),
      }));
      record(surface, id, r.success === true && r.verification.verified === false && tierOf(r) === 'contradicted' && truth.hiddenHasIt && !truth.bodyInnerHasIt && truth.bodyTextContentHasIt, { expected: 'NEG: text only in a display:none element -> contradicted (the pre-FR2-07 build said verified:true: B-X2)', observed: { tier: tierOf(r), reason: reasonOf(r) }, observerTruth: truth, verification: r.verification });
    });
    C('X3', async (id) => {
      const page = await fresh();
      const r = (await tool('browser.click', { target: '#show-late', expect: { text: 'FR2-07 SAVED' } })).json;
      await delay(1200);
      const later = await page.$eval('#toast', (e) => e.innerText).catch(() => null);
      record(surface, id, tierOf(r) === 'contradicted' && later === 'FR2-07 SAVED', { expected: 'text appearing 800ms later -> contradicted (expect is checked ONCE; documented); observer sees the toast afterwards', observed: { tier: tierOf(r) }, observerTruth: { laterToast: later }, verification: r.verification });
    });
    C('X4', async (id) => {
      await fresh();
      const res = await tool('browser.click', { target: '#does-not-exist', expect: { text: 'x' } });
      const r = res.json;
      record(surface, id, r.success === false && tierOf(r) === 'action-failed' && checkOf(r, 'expect.text')?.outcome === 'not-run' && !res.isError, { expected: 'action failure: success:false, action-failed, expect.text not-run, result is NOT isError', observed: { success: r.success, tier: tierOf(r), isError: res.isError }, verification: r.verification });
    });
    C('X7', async (id) => {
      await fresh();
      const empty = await mcp.callTool('browser.click', { sessionId, target: '#noop', expect: { text: '' } }).then((x) => ({ isError: !!x.isError, text: textOf(x).slice(0, 160) })).catch((e) => ({ threw: e.message.slice(0, 160) }));
      const bogus = await mcp.callTool('browser.click', { sessionId, target: '#noop', expect: { bogus: 1 } }).then((x) => ({ isError: !!x.isError, text: textOf(x).slice(0, 160) })).catch((e) => ({ threw: e.message.slice(0, 160) }));
      const rejected = (x) => x.threw || x.isError;
      record(surface, id, rejected(empty) && rejected(bogus), { expected: 'expect {text:""} and {bogus:1} are rejected by schema validation', observed: { empty, bogus } });
    });
    C('L1', async (id) => {
      // The contract sweep: every one of the 24 expect tools plus set/get clipboard and screenshot, once.
      await grant();
      const upDir2 = await fs.mkdtemp(path.join(os.tmpdir(), 'fr2-07-sweep-'));
      tempDirs.push(upDir2);
      const f = path.join(upDir2, 'sweep.txt');
      await fs.writeFile(f, 'sweep');
      const page = await fresh();
      const B = await centerOf(page, '#real-btn');
      const sweep = [
        ['browser.navigate', { url: server.url('/page.html') }],
        ['browser.reload', {}],
        ['browser.go_back', {}],
        ['browser.go_forward', {}],
        ['browser.click', { target: '#noop' }],
        ['browser.click_at_point', { x: B.x, y: B.y }],
        ['browser.drag_at_points', { fromX: B.x, fromY: B.y, toX: B.x + 10, toY: B.y + 10 }],
        ['browser.type', { target: '#txt', value: 'sweep' }],
        ['browser.press_key', { key: 'Tab' }],
        ['browser.focus', { target: '#txt' }],
        ['browser.scroll', { direction: 'down', amount: 10 }],
        ['browser.hover', { target: '#real-btn' }],
        ['browser.select_option', { target: '#sel', value: 'b' }],
        ['browser.select_options', { target: '#msel', values: ['x'] }],
        ['browser.wait_for_selector', { target: '#txt', timeoutMs: 1000 }],
        ['browser.click_by_text', { text: 'noop' }],
        ['browser.click_by_role', { role: 'button', name: 'noop' }],
        ['browser.type_by_label', { label: 'blocked', value: 'q' }],
        ['browser.upload_file', { target: '#file-a', filePath: f }],
        ['browser.right_click', { target: '#ctx-target' }],
        ['browser.drag_and_drop', { sourceTarget: '#real-btn', destTarget: '#drag-pad' }],
        ['browser.touch_tap', { target: '#tap-target' }],
        ['browser.download_file', { target: '#dl', downloadDir: downloadRoot, __nav: dl.pageUrl('sweep', { name: 'sweep.bin' }) }],
        ['browser.upload_file_via_trigger', { target: '#browse', filePath: f, __nav: server.url('/page.html') }],
        ['browser.set_clipboard', { text: 'sweep-clip' }],
        ['browser.get_clipboard', {}],
        ['browser.screenshot', {}],
      ];
      const KEYS = ['verified', 'urlChanged', 'elementFound', 'confidence', 'reason', 'evidence'].sort().join();
      const TIERS = ['verified', 'contradicted', 'unverifiable', 'low-confidence', 'action-failed'];
      const rows = [];
      let sweepOk = true;
      for (const [name, a0] of sweep) {
        const a = { ...a0 };
        if (a.__nav) { await tool('browser.navigate', { url: a.__nav }); delete a.__nav; await delay(1100); }
        else if (name === 'browser.download_file' || name === 'browser.upload_file_via_trigger') { /* handled */ }
        const res = await tool(name, a);
        let v;
        if (name === 'browser.screenshot') v = JSON.parse(res.raw.content[1]?.text ?? '{}').verification;
        else v = res.json?.verification;
        const problems = [];
        if (!v) problems.push('no verification');
        else {
          if (Object.keys(v).sort().join() !== KEYS) problems.push(`keys ${Object.keys(v).sort().join()}`);
          if (!TIERS.includes(v.evidence?.tier)) problems.push(`tier ${v.evidence?.tier}`);
          if (!Array.isArray(v.evidence?.checks) || v.evidence.checks.some((c) => !c.check || !c.outcome)) problems.push('bad checks');
          if (!v.reason) problems.push('empty reason');
          if ((v.reason ?? '').includes('nothing about its actual effect on the page was verified')) problems.push('pre-FR2-07 generic text');
        }
        rows.push({ tool: name, tier: v?.evidence?.tier, success: res.json?.success, problems });
        if (problems.length) sweepOk = false;
      }
      record(surface, id, sweepOk, { expected: `all ${sweep.length} tools: verification has exactly the 6 keys, a valid tier, well-formed checks, a non-empty reason, no generic pre-FR2-07 text`, observed: rows });
    });
  }

  // ── G/O: overhead (medians of executionTimeMs) ───────────────────────────────────────────
  if (surface === 'mcp') {
    C('O1', async (id) => {
      const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
      const page = await fresh();
      const press = []; const focus = []; const point = []; const nav = [];
      await tool('browser.focus', { target: '#txt' });
      for (let i = 0; i < 20; i++) press.push((await tool('browser.press_key', { key: 'a' })).json.executionTimeMs ?? 0);
      for (let i = 0; i < 20; i++) focus.push((await tool('browser.focus', { target: '#txt' })).json.executionTimeMs ?? 0);
      const c = await centerOf(page, '#real-btn');
      for (let i = 0; i < 10; i++) point.push((await tool('browser.click_at_point', { x: c.x, y: c.y })).json.executionTimeMs ?? 0);
      for (let i = 0; i < 10; i++) { const t0 = performance.now(); await tool('browser.navigate', { url: server.url('/nav/a') }); nav.push(performance.now() - t0); }
      const now = { press_key: med(press), focus: med(focus), click_at_point: med(point), navigate: med(nav) };
      ctx.overhead = now;
      let baseline = null;
      try { baseline = JSON.parse(await fs.readFile(path.join(EVIDENCE_DIR, 'baseline-overhead.json'), 'utf-8')); } catch { /* no baseline yet */ }
      const delta = baseline ? Object.fromEntries(Object.keys(now).map((k) => [k, now[k] - (baseline[k] ?? 0)])) : null;
      const bounds = { press_key: 40, focus: 40, click_at_point: 40, navigate: 60 };
      const ok = !delta || Object.keys(bounds).every((k) => delta[k] <= bounds[k]);
      record(surface, id, ok, { expected: 'median delta vs baseline <= 40ms (press/focus/click_at_point) and <= 60ms (navigate); the bound is generous, not load-sensitive tuning', observed: { now, baseline, delta } });
    });
  }

  // run
  for (const c of cases) await c();

  // teardown
  await tool('browser.shutdown', {}).catch(() => {});
  mcp.child.stdin.end();
  await observer.close().catch(() => {});
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// CLI cases
// ─────────────────────────────────────────────────────────────────────────────────────────
async function runCliCases(ctx) {
  const surface = 'cli';
  const { server, dl } = ctx;
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fr2-07-cli-state-'));
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'fr2-07-cli-work-'));
  tempDirs.push(stateDir, work);
  const env = { ...process.env, SUTRADHAR_CLI_STATE_DIR: stateDir, __CWD: work };
  delete env.SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS;
  const cli = (a) => runCli(a, env);
  const nav = (p) => cli(['nav', typeof p === 'string' && p.startsWith('http') ? p : server.url(p)]);
  const mk = (id, fn) => async () => {
    if (!wanted(id)) return;
    try { await fn(id); } catch (e) { record(surface, id, false, { observed: `case threw: ${e.message}` }); }
  };
  let observer;
  const page = async () => {
    if (!observer) {
      const state = JSON.parse(await fs.readFile(path.join(stateDir, 'state.json'), 'utf-8'));
      observer = await puppeteer.connect({ browserWSEndpoint: state.wsEndpoint, defaultViewport: null });
    }
    const ps = await observer.pages();
    return ps.find((p) => p.url().startsWith(server.origin)) ?? ps.at(-1);
  };
  const fresh = async (extra = '') => {
    const r = await nav(server.url('/page.html', undefined, extra));
    const p = await page();
    await p.waitForFunction(() => window.__fx7 && window.__fx7.ready, { timeout: 8000 });
    return { p, r };
  };
  const cases = [];
  const C = (id, fn) => cases.push(mk(id, fn));

  C('K1', async (id) => {
    const { p } = await fresh();
    const r = await cli(['press', '#txt', 'a']);
    const v = await p.$eval('#txt', (e) => e.value);
    record(surface, id, r.code === 0 && /Pressed a/.test(r.stdout) && /Verification: verified/.test(r.stdout) && v === 'a', { expected: 'exit 0; "Pressed a" + "Verification: verified"; observer value "a"', observed: { code: r.code, stdout: r.stdout }, observerTruth: { value: v } });
  });
  C('K14', async (id) => {
    const { p } = await fresh();
    const r = await cli(['press', '#nofocus', 'a']);
    const active = await p.evaluate(() => document.activeElement && document.activeElement.tagName.toLowerCase());
    const txt = await p.$eval('#txt', (e) => e.value);
    record(surface, id, r.code === 1 && /Press aborted: focus did not land on #nofocus/.test(r.stdout) && txt === '', { expected: 'GAP-025: focus contradicted -> "Press aborted", exit 1, NO key sent (observer value unchanged)', observed: { code: r.code, stdout: r.stdout }, observerTruth: { active, txtValue: txt } });
    const r2 = await cli(['press', '#does-not-exist', 'a']);
    record(surface, 'K14b', r2.code === 1 && /Press aborted: could not focus #does-not-exist/.test(r2.stdout), { expected: 'GAP-025: focus fails -> "Press aborted: could not focus", exit 1', observed: { code: r2.code, stdout: r2.stdout } });
  });
  C('A1', async (id) => {
    const { p } = await fresh();
    const r = await cli(['clickpoint', '1', '1']); // any verb prints a Verification line; here a plain sanity check
    void r; void p;
    record(surface, id, /Verification:/.test(r.stdout), { expected: 'every action verb prints a Verification line', observed: { stdout: r.stdout } });
  });
  C('D4', async (id) => {
    await nav(dl.pageUrl('cli-d4', { name: 'fr207-cli.bin' }));
    const ok = await cli(['download', '#dl', './out']);
    const served = dl.served.filter((s) => s.caseId === 'cli-d4').at(-1);
    await delay(1100);
    await nav(dl.pageUrl('cli-d4b', { name: 'fr207-cli-b.bin' }));
    const bad = await cli(['download', '#dl', './out', '--expect-url', '/never']);
    const files = await fs.readdir(path.join(work, 'out')).catch(() => []);
    record(surface, id, ok.code === 0 && /Verification: verified/.test(ok.stdout) && bad.code === 4 && files.includes('fr207-cli-b.bin') && !!served, { expected: 'download: verified + exit 0; with --expect-url /never -> exit 4 and the file still exists', observed: { ok: { code: ok.code, stdout: ok.stdout }, bad: { code: bad.code, stderr: bad.stderr } }, observerTruth: { files } });
  });
  C('N12', async (id) => {
    const ok = await cli(['nav', server.url('/nav/redirect'), '--expect-url', '/nav/login']);
    const bad = await cli(['nav', server.url('/nav/redirect'), '--expect-url', '/nav/b']);
    const plain = await cli(['nav', server.url('/nav/a')]);
    record(surface, id, ok.code === 0 && bad.code === 4 && /Navigated to/.test(bad.stdout) && /NOT verified — contradicted/.test(bad.stdout) && /expectation failed/.test(bad.stderr) && plain.code === 0 && /Verification: verified/.test(plain.stdout), { expected: 'nav --expect-url: exit 0 / exit 4 with both "Navigated to" and "NOT verified — contradicted"', observed: { ok: ok.code, bad: { code: bad.code, stdout: bad.stdout, stderr: bad.stderr }, plain: plain.stdout } });
  });
  C('P1', async (id) => {
    const { p } = await fresh();
    const c = await p.$eval('#real-btn', (e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; });
    const before = (await p.evaluate(() => window.__fx7.clicks)).real ?? 0;
    const r = await cli(['clickpoint', String(c.x), String(c.y)]);
    const after = (await p.evaluate(() => window.__fx7.clicks)).real ?? 0;
    record(surface, id, r.code === 0 && /Verification: verified/.test(r.stdout) && /button#real-btn/.test(r.stdout) && after === before + 1, { expected: 'clickpoint verified naming button#real-btn; observer +1', observed: { code: r.code, stdout: r.stdout }, observerTruth: { before, after } });
  });
  C('G1', async (id) => {
    const { p } = await fresh();
    const c = await p.$eval('#drag-pad', (e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; });
    const r = await cli(['dragpoints', String(c.x - 40), String(c.y), String(c.x + 40), String(c.y)]);
    record(surface, id, r.code === 0 && /Verification: verified/.test(r.stdout), { expected: 'dragpoints verified', observed: { code: r.code, stdout: r.stdout } });
  });
  C('X5', async (id) => {
    await fresh();
    const ok = await cli(['click', '#show-saved', '--expect-text', 'FR2-07 SAVED']);
    await fresh();
    const bad = await cli(['click', '#noop', '--expect-text', 'NOPE']);
    const miss = await cli(['click', '#missing', '--expect-text', 'x']);
    record(surface, id, ok.code === 0 && bad.code === 4 && /expectation failed/.test(bad.stderr) && miss.code === 1, { expected: 'X1 exit 0; X2 exit 4 + stderr "expectation failed"; failed action exit 1', observed: { ok: ok.code, bad: { code: bad.code, stderr: bad.stderr }, miss: { code: miss.code, stdout: miss.stdout } } });
  });
  C('X5j', async (id) => {
    await fresh();
    const r = await cli(['click', '#noop', '--json', '--expect-text', 'NOPE']);
    let parsed; try { parsed = JSON.parse(r.stdout); } catch { parsed = null; }
    record(surface, id, r.code === 4 && parsed && parsed.success === true && parsed.verification?.evidence?.tier === 'contradicted' && !('failureScreenshot' in parsed), { expected: '--json prints one parseable result document (incl. verification), exit 4', observed: { code: r.code, parsedTier: parsed?.verification?.evidence?.tier } });
  });
  C('S1', async (id) => {
    await fresh();
    const r = await cli(['screenshot', path.join(work, 'shot.png')]);
    record(surface, id, r.code === 0 && /Saved screenshot/.test(r.stdout) && /Verification: NOT verified — unverifiable/.test(r.stdout), { expected: 'screenshot prints the (unverifiable) verification line', observed: { stdout: r.stdout } });
  });
  C('C5', async (id) => {
    const g = await cli(['getclipboard']);
    record(surface, id, g.code === 0 && !/Verification:/.test(g.stdout) && /Verification:/.test(g.stderr), { expected: 'getclipboard: stdout is only the text; the Verification line goes to stderr', observed: { stdout: g.stdout, stderr: g.stderr } });
  });
  C('E1', async (id) => {
    const a = await cli(['click', '#noop', '--expect-url-changed', '--expect-url-unchanged']);
    const b = await cli(['click', '#noop', '--expect-text']);
    record(surface, id, a.code === 1 && /mutually exclusive/.test(a.stderr) && b.code === 1 && /needs a value/.test(b.stderr), { expected: 'bad --expect-* flag combinations are rejected before any browser contact', observed: { a: a.stderr, b: b.stderr } });
  });

  {
    const all = new Map(matrixCases().map((c) => [c.id, c]));
    let n = 0;
    for (const id of SURFACE_MATRIX_IDS) {
      C('M:' + id, async (cid) => {
        const c = all.get(id);
        const tok = 'QZC' + String(++n).padStart(2, '0') + 'K' + Math.random().toString(36).slice(2, 6).toUpperCase();
        const url = server.origin + '/matrix?case=' + encodeURIComponent(id) + '&tok=' + tok;
        await nav(url);
        const p = await page();
        await p.waitForFunction(() => window.__mx === 1 && document.readyState === 'complete', { timeout: 10000 });
        const t0 = performance.now();
        while (p.frames().length < 1 + c.frames && performance.now() - t0 < 8000) await delay(50);
        const truth = await oracleTruth(p, tok);
        const r = await cli(['click', '#go-' + tok, '--expect-text', tok]);
        const after = await oracleTruth(p, tok);
        const ok = truth.found === c.counted && after.found === truth.found && (truth.found ? r.code === 0 : r.code === 4);
        record(surface, cid, ok, { expected: 'CLI exit ' + (c.counted ? '0 (rendered)' : '4 (not rendered)') + '; the observer agrees', observed: { code: r.code, stdout: r.stdout.split(String.fromCharCode(10)).filter((l) => /Verification/.test(l)), stderr: r.stderr.slice(0, 200) }, observerTruth: { truth, after } });
      });
    }
  }

  for (const c of cases) await c();
  await cli(['close']);
  await observer?.disconnect().catch(() => {});
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// SDK cases
// ─────────────────────────────────────────────────────────────────────────────────────────
async function runSdkCases(ctx) {
  const surface = 'sdk';
  const { server, dl } = ctx;
  const sdk = await import(pathToFileURL(path.join(repoRoot, 'packages', 'sutradhar', 'dist', 'index.js')).href);
  const downloadRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'fr2-07-sdk-dl-'));
  tempDirs.push(downloadRoot);
  const browser = await sdk.launch({ headless: true, allowedDownloadRoots: [downloadRoot] });
  const observer = await puppeteer.connect({ browserWSEndpoint: browser.getWsEndpoint(), defaultViewport: null });
  const page = (await browser.pages())[0];
  const obsPage = async () => (await observer.pages()).find((p) => p.url().startsWith(server.origin)) ?? (await observer.pages()).at(-1);
  const mk = (id, fn) => async () => {
    if (!wanted(id)) return;
    try { await fn(id); } catch (e) { record(surface, id, false, { observed: `case threw: ${e.message}` }); }
  };
  const cases = [];
  const C = (id, fn) => cases.push(mk(id, fn));
  const fresh = async () => {
    await page.goto(server.url('/page.html'));
    const p = await obsPage();
    await p.waitForFunction(() => window.__fx7 && window.__fx7.ready, { timeout: 8000 });
    return p;
  };

  C('K1', async (id) => {
    const p = await fresh();
    await page.click('#txt'); // real click focuses it
    const r = await page.press('a');
    const v = await p.$eval('#txt', (e) => e.value);
    record(surface, id, r.success && r.verification?.evidence?.tier === 'verified' && v === 'a', { expected: 'SDK press returns the result; verified; observer value "a"', observed: { tier: r.verification?.evidence?.tier }, observerTruth: { value: v }, verification: r.verification });
  });
  C('D1', async (id) => {
    await page.goto(dl.pageUrl('sdk-d1', { name: 'fr207-sdk.bin' }));
    const r = await page.download('#dl', { downloadDir: downloadRoot });
    const st = await fs.stat(r.path).catch(() => null);
    record(surface, id, r.verification?.evidence?.tier === 'verified' && st && st.size > 0, { expected: 'SDK download: verified; observer fs.stat > 0', observed: { tier: r.verification?.evidence?.tier }, observerTruth: { size: st?.size }, verification: r.verification });
  });
  C('N1', async (id) => {
    const back = await page.goto(server.url('/nav/a'));
    const last = page.lastResult;
    record(surface, id, back === page && last?.verification?.evidence?.tier === 'verified', { expected: 'goto returns the Page; lastResult.verification verified', observed: { tier: last?.verification?.evidence?.tier }, verification: last?.verification });
  });
  C('N13', async (id) => {
    const err = await page.goto(server.url('/nav/redirect'), { expect: { url: '/nav/b' } }).catch((e) => e);
    record(surface, id, err instanceof sdk.ExpectationFailedError && err.result.url.endsWith('/nav/login'), { expected: 'goto with a failing expect rejects ExpectationFailedError; result.url ends /nav/login', observed: { name: err?.name, url: err?.result?.url } });
  });
  C('X1', async (id) => {
    await fresh();
    const r = await page.click('#show-saved', { expect: { text: 'FR2-07 SAVED' } });
    record(surface, id, r.verification?.evidence?.tier === 'verified', { expected: 'expect.text present -> resolves verified', observed: { tier: r.verification?.evidence?.tier }, verification: r.verification });
  });
  C('X6', async (id) => {
    await fresh();
    const e1 = await page.click('#noop', { expect: { text: 'NOPE' } }).catch((e) => e);
    const e2 = await page.click('#missing').catch((e) => e);
    record(surface, id, e1 instanceof sdk.ExpectationFailedError && e1.failed.includes('text') && e2 instanceof sdk.ActionFailedError, { expected: 'expect failure -> ExpectationFailedError; failed action -> ActionFailedError (GAP-024)', observed: { e1: e1?.name, e2: e2?.name, e2msg: (e2?.message ?? '').slice(0, 120) } });
  });
  C('S1', async (id) => {
    await fresh();
    const b64 = await page.screenshot();
    const last = page.lastResult;
    record(surface, id, typeof b64 === 'string' && last?.verification?.evidence?.tier === 'unverifiable', { expected: 'screenshot returns base64; lastResult.verification.tier unverifiable', observed: { tier: last?.verification?.evidence?.tier }, verification: last?.verification });
  });

  // N11 (FR2-04's setDialogPolicy exists): a beforeunload armed on the page + policy 'dismiss' cancels the
  // navigation. Whatever the runtime then does (throw, or resolve), it must NEVER report verified:true.
  C('N11', async (id) => {
    const rt = new sdk.SutradharRuntime();
    const launched = await rt.launch({ launch: { headless: true } });
    try {
      rt.setDialogPolicy(launched.sessionId, { mode: 'dismiss' });
      const fixture = pathToFileURL(path.join(here, 'fixtures', 'fr2-04-dialogs.html')).href + `?n=n11-${Date.now()}`;
      await rt.navigate(launched.sessionId, fixture);
      const armed = await rt.click(launched.sessionId, '#arm-bu'); // a real click gives the page user activation
      let outcome;
      try {
        const nav = await rt.navigate(launched.sessionId, server.url('/nav/a', 'n11'));
        outcome = { resolved: true, verified: nav.verification?.verified, tier: nav.verification?.evidence?.tier, reason: nav.verification?.reason, url: nav.url };
      } catch (e) {
        outcome = { resolved: false, error: e.message.slice(0, 200) };
      }
      record(surface, id, armed.success === true && !(outcome.resolved && outcome.verified === true), {
        expected: 'beforeunload cancelled by policy dismiss: navigate throws or reports not-verified, NEVER verified:true', observed: outcome,
      });
    } finally {
      await rt.shutdown(launched.sessionId).catch(() => {});
    }
  });

  {
    const all = new Map(matrixCases().map((c) => [c.id, c]));
    let n = 0;
    const oneSdk = async (cid, url, tok, label, framesExpected, opts = {}) => {
      try {
        await oneSdkInner(cid, url, tok, label, framesExpected, opts);
      } finally {
        server.releaseHeld();
        await delay(150);
      }
    };
    const oneSdkInner = async (cid, url, tok, label, framesExpected, opts = {}) => {
      await page.goto(url);
      const p = await obsPage();
      await p.waitForFunction(() => window.__mx === 1 && document.readyState === 'complete', { timeout: 10000 });
      const t0 = performance.now();
      while (p.frames().length < 1 + framesExpected && performance.now() - t0 < 8000) await delay(50);
      const truth = await oracleTruth(p, tok);
      let res; let err;
      try { res = await page.click('#go-' + tok, { expect: { text: tok } }); } catch (e) { err = e; }
      const v = (res ?? err?.result)?.verification;
      const after = await oracleTruth(p, tok);
      let ok;
      if (opts.expectNeverVerified) ok = v?.verified === false && !(res && v.verified);
      else if (truth.found) ok = !err && v?.verified === true && v?.evidence?.tier === 'verified';
      else ok = err instanceof sdk.ExpectationFailedError && v?.verified === false;
      ok = ok && (opts.skipLabel || label === truth.found) && after.found === truth.found;
      record(surface, cid, ok, { expected: opts.expectNeverVerified ? 'never verified (fail closed)' : truth.found ? 'resolves verified (NO ExpectationFailedError)' : 'ExpectationFailedError, not verified', observed: { threw: err?.name, tier: v?.evidence?.tier, verified: v?.verified, detail: v?.evidence?.checks?.find((c) => c.check === 'expect.text')?.detail }, observerTruth: { truth, after } });
    };
    for (const id of SURFACE_MATRIX_IDS) {
      C('M:' + id, async (cid) => {
        const c = all.get(id);
        const tok = 'QZS' + String(++n).padStart(2, '0') + 'K' + Math.random().toString(36).slice(2, 6).toUpperCase();
        await oneSdk(cid, server.origin + '/matrix?case=' + encodeURIComponent(id) + '&tok=' + tok, tok, c.counted, c.frames);
      });
    }
    // audit-2 A2-2 on the SDK (Sutradhar attached as a second CDP client next to the observer): 1 of 8 cross-origin frames hangs
    C('H1', async (cid) => {
      const tok = 'QZSH1K' + Math.random().toString(36).slice(2, 6).toUpperCase();
      await oneSdk(cid, server.origin + '/matrix-hung?tok=' + tok + '&n=8&hung=3&tokIn=main', tok, true, 8);
    });
    C('H3', async (cid) => {
      const tok = 'QZSH3K' + Math.random().toString(36).slice(2, 6).toUpperCase();
      await oneSdk(cid, server.origin + '/matrix-hung?tok=' + tok + '&n=8&hung=3&tokIn=none', tok, false, 8, { expectNeverVerified: true, skipLabel: true });
    });
  }

  for (const c of cases) await c();
  await observer.disconnect().catch(() => {});
  await browser.close().catch(() => {});
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// Baseline (pre-change build): records the pre-change results for the same cases, asserts nothing
// ─────────────────────────────────────────────────────────────────────────────────────────
async function runBaseline(ctx) {
  const { server, dl, chromePath } = ctx;
  const serverPath = path.join(ROOT, 'packages', 'mcp-server', 'dist', 'cli.js');
  const downloadRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'fr2-07-bl-dl-'));
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'fr2-07-bl-obs-'));
  tempDirs.push(downloadRoot, profile);
  const observer = await puppeteer.launch({ executablePath: chromePath, headless: true, userDataDir: profile, args: ['--no-sandbox'], defaultViewport: { width: 1100, height: 900 } });
  const mcp = makeMcpClient(serverPath, { ...process.env, SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS: downloadRoot });
  await mcp.call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'fr2-07-baseline', version: '1' } });
  mcp.notify('notifications/initialized');
  const sessionId = jsonOf(await mcp.callTool('browser.attach', { endpoint: observer.wsEndpoint() })).sessionId;
  const tool = async (name, a = {}) => {
    const r = await mcp.callTool(name, { sessionId, ...a });
    let json; try { json = jsonOf(r); } catch { json = undefined; }
    return { json, isError: !!r.isError, text: textOf(r).slice(0, 300) };
  };
  const obs = async () => (await observer.pages()).find((p) => p.url().startsWith(server.origin)) ?? (await observer.pages()).at(-1);
  const fresh = async (extra = '') => {
    await tool('browser.navigate', { url: server.url('/page.html', undefined, extra) });
    const p = await obs();
    await p.waitForFunction(() => window.__fx7 && window.__fx7.ready, { timeout: 8000 });
    return p;
  };
  const row = (id, note, res, truth) => {
    baselineRows.push({ case: id, note, verification: res?.json?.verification ?? null, result: res?.json ?? res?.text, observerTruth: truth });
    console.log(`[baseline] ${id}: ${JSON.stringify(res?.json?.verification ?? res?.json ?? res?.text).slice(0, 220)}`);
  };
  await fresh();
  await tool('browser.focus', { target: '#blocked' }); // B-K2
  { const r = await tool('browser.press_key', { key: 'a' }); row('B-K2', 'press a into #blocked', r, { value: await (await obs()).$eval('#blocked', (e) => e.value) }); }
  await fresh(); { const r = await tool('browser.focus', { target: '#nofocus' }); row('B-F2', 'focus #nofocus', r, { active: await (await obs()).evaluate(() => document.activeElement.tagName) }); }
  { await tool('browser.navigate', { url: dl.pageUrl('bl-d2', { name: 'bl-d2.bin', empty: true }) }); const r = await tool('browser.download_file', { target: '#dl', downloadDir: downloadRoot }); const st = r.json?.output?.downloadedPath ? await fs.stat(r.json.output.downloadedPath).catch(() => null) : null; row('B-D2', 'download an empty file', r, { fsSize: st?.size }); }
  { await tool('browser.navigate', { url: server.url('/nav/a', 'bl4') }); const tab = (await tool('browser.new_tab')).json; const r = await tool('browser.go_back', { tabId: tab?.id }); row('B-N4', 'go_back at index 0', r, {}); await tool('browser.close_tab', { tabId: tab?.id }); }
  { const r = await tool('browser.navigate', { url: server.url('/nav/missing') }); row('B-N8', 'navigate to a 404', r, {}); }
  { await tool('browser.grant_permissions', { origin: server.origin, permissions: ['clipboard-read', 'clipboard-write'] }); await fresh('spoofClipboard=1'); const r = await tool('browser.set_clipboard', { text: 'bl-c2' }); row('B-C2', 'set_clipboard on the spoof page', r, {}); }
  { const p = await fresh(); const c = await p.$eval('#vanish', (e) => { const b = e.getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }; }); const r3 = await tool('browser.click_at_point', { x: c.x, y: c.y }); row('B-P3', 'click_at_point #vanish', r3, {}); const r4 = await tool('browser.click_at_point', { x: 5000, y: 5000 }); row('B-P4', 'click_at_point (5000,5000)', r4, {}); }
  { const f = path.join(profile, 'bl-up.txt'); await fs.writeFile(f, 'x'); await fresh(); const r = await tool('browser.upload_file_via_trigger', { target: '#browse-detached', filePath: f }); row('B-U3', 'upload via trigger to a detached input', r, {}); }
  { await tool('browser.navigate', { url: pathToFileURL(path.join(here, 'fixtures', 'fr2-01-wait-states.html')).href + `?t=${Date.now()}#auto` }); const r = await tool('browser.wait_for_selector', { target: '#toast', timeoutMs: 5000 }); row('B-W1', 'wait_for_selector visible success', r, {}); }
  // overhead baseline
  {
    const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
    const page = await fresh();
    const press = []; const focus = []; const point = []; const nav = [];
    await tool('browser.focus', { target: '#txt' });
    for (let i = 0; i < 20; i++) press.push((await tool('browser.press_key', { key: 'a' })).json.executionTimeMs ?? 0);
    for (let i = 0; i < 20; i++) focus.push((await tool('browser.focus', { target: '#txt' })).json.executionTimeMs ?? 0);
    const c = await page.$eval('#real-btn', (e) => { const b = e.getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }; });
    for (let i = 0; i < 10; i++) point.push((await tool('browser.click_at_point', { x: c.x, y: c.y })).json.executionTimeMs ?? 0);
    for (let i = 0; i < 10; i++) { const t0 = performance.now(); await tool('browser.navigate', { url: server.url('/nav/a') }); nav.push(performance.now() - t0); }
    const o = { press_key: med(press), focus: med(focus), click_at_point: med(point), navigate: med(nav) };
    await fs.writeFile(path.join(EVIDENCE_DIR, 'baseline-overhead.json'), JSON.stringify(o, null, 2));
    console.log(`[baseline] overhead medians ${JSON.stringify(o)}`);
  }
  // B-X2: the engine path with verificationSpec (no public expect exists pre-change) via the runtime
  {
    const rtMod = await import(pathToFileURL(path.join(ROOT, 'packages', 'capability-runtime', 'dist', 'index.js')).href);
    const runtime = new rtMod.SutradharRuntime();
    const { sessionId: sid } = await runtime.attach({ endpoint: observer.wsEndpoint() });
    await (await obs()).goto(server.url('/page.html', 'bl-x2'));
    await (await obs()).waitForFunction(() => window.__fx7 && window.__fx7.ready);
    // point the runtime at the observer's active page
    const res = await runtime.runAction(sid, { actionType: 'click', selector: '#noop', verificationSpec: { expectedElementText: 'FR2-07 SAVED' } });
    baselineRows.push({ case: 'B-X2', note: 'engine path, expectedElementText "FR2-07 SAVED" on #noop (text only in display:none)', verification: res.verification, result: { success: res.success } });
    console.log(`[baseline] B-X2: ${JSON.stringify(res.verification)}`);
    void sid; // not shut down here: shutting an attached session down would close the observer's tabs
  }
  await tool('browser.shutdown', {}).catch(() => {});
  mcp.child.stdin.end();
  await observer.close().catch(() => {});
}

// ─────────────────────────────────────────────────────────────────────────────────────────
/** Real count of Chrome/Chromium processes whose command line still names any of `needles` (Windows). */
function countChromeWithNeedles(needles) {
  if (process.platform !== 'win32' || needles.length === 0) return { count: 0, matches: [] };
  const script =
    "Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'chrome|msedge' } | " +
    'ForEach-Object { "$($_.ProcessId)`t$($_.CommandLine)" }';
  const r = spawnSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024 });
  const matches = (r.stdout || '').split(String.fromCharCode(10)).filter((l) => needles.some((n) => n && l.includes(n)));
  return { count: matches.length, matches: matches.map((m) => m.slice(0, 160)) };
}

async function listCliTempDirs() {
  return new Set((await fs.readdir(os.tmpdir()).catch(() => [])).filter((n) => n.startsWith('sutradhar-cli-')));
}

async function main() {
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  const cliDirsBefore = await listCliTempDirs();
  const chromePath = resolveChrome();
  const server = await startFr207Server();
  const dl = await startDownloadServer();
  const ctx = { server, dl, chromePath, leakStrings: [], overhead: null };
  const log = [];
  const startedAt = new Date().toISOString();
  console.log(`[fr2-07] evidence dir: ${EVIDENCE_DIR}; server ${server.origin} (ipv6 ${server.v6Listening}); mode ${BASELINE ? 'BASELINE' : 'verify'}`);
  try {
    if (BASELINE) {
      await runBaseline(ctx);
      await fs.writeFile(path.join(EVIDENCE_DIR, 'baseline.jsonl'), baselineRows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    } else {
      if (SURFACES.includes('mcp')) await runMcpCases('mcp', path.join(repoRoot, 'packages', 'mcp-server', 'dist', 'cli.js'), ctx);
      if (SURFACES.includes('cli')) await runCliCases(ctx);
      if (SURFACES.includes('sdk')) await runSdkCases(ctx);
      if (SURFACES.includes('bundle')) await runMcpCases('bundle', path.join(repoRoot, 'packages', 'sutradhar', 'dist', 'mcp-cli.js'), ctx);
      // D11: no evidence ever contains the clipboard text (checked over EVERY clipboard verification captured)
      for (const [cid, serialized, secret] of ctx.leakStrings) {
        record('mcp', `C5-${cid}-${secret.slice(0, 12)}`, !serialized.includes(secret), { expected: 'verification JSON never contains the clipboard text (D11)', observed: { leaked: serialized.includes(secret) } });
      }
    }
  } finally {
    await server.close().catch(() => {});
    await dl.close().catch(() => {});
    await delay(1500); // let the just-closed Chrome processes exit before the process scan
    var lingering = countChromeWithNeedles(tempDirs);
    for (const d of tempDirs) await rmWithRetry(d);
  }
  const cliDirsAfter = await listCliTempDirs();
  var newCliDirs = [...cliDirsAfter].filter((n) => !cliDirsBefore.has(n));
  if (!BASELINE) {
    for (const s of ['mcp', 'cli', 'sdk', 'bundle']) {
      await fs.writeFile(path.join(EVIDENCE_DIR, `live-${s}.jsonl`), results.filter((r) => r.surface === s).map((r) => JSON.stringify(r)).join('\n') + '\n');
    }
    const summary = {
      startedAt, finishedAt: new Date().toISOString(),
      total: results.length, passed: results.filter((r) => r.pass).length, failed: results.filter((r) => !r.pass).map((r) => `${r.surface}:${r.case}`),
      overhead: ctx.overhead,
      hygiene: { lingeringChromeWithScratchProfile: lingering?.count ?? null, lingeringMatches: lingering?.matches ?? [], newSutradharCliTempDirs: newCliDirs, childPidsStarted: spawned.filter(Boolean) },
      cases: results.map((r) => ({ surface: r.surface, case: r.case, expected: r.expected, observed: r.observed, observerTruth: r.observerTruth, verification: r.verification, pass: r.pass })),
    };
    await fs.writeFile(path.join(EVIDENCE_DIR, 'live-summary.json'), JSON.stringify(summary, null, 2));
    console.log(`\n[fr2-07] ${summary.passed}/${summary.total} passed${summary.failed.length ? `; FAILED: ${summary.failed.join(', ')}` : ''}`);
    if ((lingering?.count ?? 0) > 0 || newCliDirs.length > 0) {
      console.log(`[fr2-07] HYGIENE: ${lingering?.count} lingering chrome, new sutradhar-cli-* dirs: ${newCliDirs.join(',')}`);
    }
    process.exitCode = overallOk ? 0 : 1;
  }
}

main().catch((e) => {
  console.error('[fr2-07] fatal:', e);
  process.exitCode = 1;
}).finally(() => setTimeout(() => process.exit(process.exitCode ?? 0), 500).unref());
