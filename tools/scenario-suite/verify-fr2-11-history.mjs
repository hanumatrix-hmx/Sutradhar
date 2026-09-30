// Live-verify script for FR2-11 (full action history). Drives the REAL BUILT worktree artifacts against a real Chrome:
//   mcp    packages/mcp-server/dist/cli.js (stdio JSON-RPC)      cli    packages/cli/dist/cli.js (one process per command)
//   sdk    packages/sutradhar/dist/index.js (the npm SDK bundle)  bundle packages/sutradhar/dist/mcp-cli.js + cli-bin.js
// An INDEPENDENT puppeteer-core observer connection confirms that actions really happened (the tool's own report is never
// trusted). Privacy is checked on the RAW bytes: every MCP get_action_history response, history.jsonl on disk, and the
// human/--json output of `sutradhar history` must contain none of the canary secrets typed / navigated / evaluated / put on
// the clipboard during the run, and a probe self-test proves the canary search can actually see a leak.
// Spec: .ai/loop/field-report-2/evidence/FR2-11/spec.md sections 3, 5, 6 (adapted to the code as it is after FR2-07/FR2-08).
//
// Run:    node tools/scenario-suite/verify-fr2-11-history.mjs [--surface=mcp,cli,sdk,bundle] [--only=L1,L5]
// Needs:  a forced build of this worktree (turbo run build --force).
// Evidence: SUTRADHAR_FR2_11_EVIDENCE_DIR ?? .ai/loop/field-report-2/evidence/FR2-11/run-1/live
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..');
const EVIDENCE_DIR =
  process.env.SUTRADHAR_FR2_11_EVIDENCE_DIR ?? path.join(repoRoot, '.ai', 'loop', 'field-report-2', 'evidence', 'FR2-11', 'run-1', 'live');
const args = process.argv.slice(2);
const ONLY = (args.find((a) => a.startsWith('--only=')) ?? '').slice(7).split(',').filter(Boolean);
const SURFACES = (args.find((a) => a.startsWith('--surface=')) ?? '--surface=mcp,cli,sdk,bundle').slice(10).split(',');
const wanted = (id) => ONLY.length === 0 || ONLY.some((p) => id.startsWith(p));

const require_ = createRequire(path.join(repoRoot, 'packages', 'browser', 'package.json'));
const puppeteer = require_('puppeteer-core');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const informational = [];
let overallOk = true;
const tempDirs = [];
const spawned = []; // PIDs of every child THIS script started (the only PIDs it may ever kill)
const evidenceFiles = [];
// Chrome processes THIS script caused (CLI-spawned ones are recorded from the state.json it wrote): the only ones
// it may ever clean up. Other sessions on this shared machine run their own sutradhar-cli-* Chromes; never touch those.
const ownChromePids = new Set();
const ownProfileDirs = new Set();

function record(surface, id, checkList, extra = {}) {
  const failed = checkList.filter((c) => !c[1]);
  const pass = failed.length === 0;
  if (!pass) overallOk = false;
  const entry = { surface, case: id, pass, checks: checkList.length, failed: failed.map((c) => ({ check: c[0], observed: c[2] })), ...extra };
  results.push(entry);
  console.log(`[${surface}] ${pass ? 'PASS' : 'FAIL'} ${id} (${checkList.length} checks)${pass ? '' : ' -- ' + JSON.stringify(entry.failed).slice(0, 700)}`);
}
const T = (name, ok, observed) => [name, !!ok, observed];
function info(surface, id, data) {
  informational.push({ surface, case: id, ...data });
  console.log(`[${surface}] INFO ${id} ${JSON.stringify(data).slice(0, 300)}`);
}
async function saveEvidence(name, content) {
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  await fs.writeFile(path.join(EVIDENCE_DIR, name), content);
  evidenceFiles.push(name);
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
  if (!p) throw new Error('No Chrome/Edge executable found: set CHROME_PATH.');
  return p;
}

// ── canary secrets and the probe that looks for them ─────────────────────────────────────────────
// Every secret this script types, evaluates, navigates with or puts on the clipboard contains one of these.
const CANARIES = ['SECRET', 'hunter2', '?n=', '&n=', 'token=', 'access_token', '#frag'];
const leaksIn = (text) => CANARIES.filter((c) => String(text).includes(c));

// ── fixture server (HTTP: the query-drop is the real-world redaction case) ───────────────────────
async function startServer() {
  const html = await fs.readFile(path.join(here, 'fixtures', 'fr2-11-history.html'));
  const typefail = await fs.readFile(path.join(here, 'fixtures', 'fr2-11-typefail.html'));
  const server = http.createServer((req, res) => {
    const p = (req.url ?? '').split('?')[0];
    if (p === '/fr2-11-history.html') return res.writeHead(200, { 'content-type': 'text/html' }).end(html);
    if (p === '/fr2-11-typefail.html') return res.writeHead(200, { 'content-type': 'text/html' }).end(typefail);
    res.writeHead(404, { 'content-type': 'text/plain' }).end('nf');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const origin = `http://127.0.0.1:${port}`;
  return {
    origin,
    // per-case uniqueness in the QUERY (never the fragment); the token doubles as the leak canary
    url: (p, n, extra = '') => `${origin}${p}?n=${n}&token=SECRET-${n}${extra}`,
    bare: (p) => `${origin}${p}`,
    close: () => new Promise((r) => server.close(r)),
  };
}

// ── MCP JSON-RPC stdio client ────────────────────────────────────────────────────────────────────
function makeMcpClient(serverPath, env) {
  const child = spawn(process.execPath, [serverPath], { stdio: ['pipe', 'pipe', 'pipe'], env: env ?? process.env, windowsHide: true });
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
      try { msg = JSON.parse(line); } catch { continue; }
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
        if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout waiting for ${method} (id=${id})`)); }
      }, timeoutMs);
    });
  return {
    child,
    call,
    notify: (method, params) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n'),
    callTool: (name, a, timeoutMs) => call('tools/call', { name, arguments: a }, timeoutMs),
  };
}
const textOf = (r) => r.content?.[0]?.text ?? '';
const jsonOf = (r) => JSON.parse(textOf(r));

// ── CLI driver ───────────────────────────────────────────────────────────────────────────────────
function spawnCli(cliJs, argv, env, timeout = 120000) {
  const t0 = performance.now();
  const child = spawn(process.execPath, [cliJs, ...argv], { env, windowsHide: true, cwd: env.__CWD ?? repoRoot });
  spawned.push(child.pid);
  let stdout = '';
  let stderr = '';
  const done = new Promise((resolve) => {
    let finished = false;
    const finish = (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({ stdout: stdout.replace(/\r\n/g, '\n').trimEnd(), stderr: stderr.replace(/\r\n/g, '\n').trimEnd(), code, ms: Math.round(performance.now() - t0), pid: child.pid });
    };
    const timer = setTimeout(() => { try { child.kill(); } catch { /* gone */ } finish(null); }, timeout);
    child.stdout.on('data', (x) => (stdout += x.toString('utf8')));
    child.stderr.on('data', (x) => (stderr += x.toString('utf8')));
    child.on('close', (code) => finish(code));
  });
  return done;
}

// ── process hygiene (Windows: read real command lines; only PIDs found via OUR scratch needles) ──
function chromeProcs(needles) {
  if (process.platform !== 'win32' || needles.length === 0) return [];
  const script = "Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'chrome|msedge' } | ForEach-Object { \"$($_.ProcessId)`t$($_.CommandLine)\" }";
  const r = spawnSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024 });
  return (r.stdout || '').split('\n').map((l) => l.trim()).filter((l) => needles.some((n) => n && l.includes(n)))
    .map((l) => ({ pid: Number(l.split('\t')[0]), cmd: l.split('\t')[1] ?? '' }));
}
function userDataDirOfPid(pid) {
  const script = `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`;
  const r = spawnSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf-8' });
  const m = /--user-data-dir=("([^"]+)"|(\S+))/.exec(r.stdout || '');
  return m ? (m[2] ?? m[3]) : undefined;
}
/** Records the Chrome this script's CLI just spawned (pid and its --user-data-dir), read from the state.json it wrote. */
async function noteOwnChrome(stateFile) {
  try {
    const st = JSON.parse(await fs.readFile(stateFile, 'utf-8'));
    if (st.chromePid) {
      ownChromePids.add(st.chromePid);
      const d = userDataDirOfPid(st.chromePid);
      if (d) ownProfileDirs.add(d);
    }
  } catch { /* no state (yet) */ }
}

async function pageFor(observer, urlPrefix, timeoutMs = 15000) {
  const t0 = performance.now();
  for (;;) {
    const p = (await observer.pages()).find((x) => x.url().startsWith(urlPrefix));
    if (p) return p;
    if (performance.now() - t0 > timeoutMs) throw new Error('observer never saw ' + urlPrefix);
    await delay(50);
  }
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const displayKey = (e) => e.target ?? e.selector; // what a history row shows as "what"
const tierOf = (v) => v?.evidence?.tier;

// ═════════════════════════════════════════════════════════════════════════════════════════════
// MCP (and the npm bundle's MCP server)
// ═════════════════════════════════════════════════════════════════════════════════════════════
async function runMcpCases(surface, serverPath, ctx) {
  const { server, chromePath } = ctx;
  const scratchProfile = await fs.mkdtemp(path.join(os.tmpdir(), 'fr2-11-obs-'));
  tempDirs.push(scratchProfile);
  const observer = await puppeteer.launch({
    executablePath: chromePath, headless: true, userDataDir: scratchProfile, args: ['--no-sandbox'], defaultViewport: { width: 1000, height: 800 },
  });
  spawned.push(observer.process()?.pid);
  const mcp = makeMcpClient(serverPath, process.env);
  await mcp.call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'fr2-11-verify', version: '1.0' } });
  mcp.notify('notifications/initialized');
  const att = jsonOf(await mcp.callTool('browser.attach', { endpoint: observer.wsEndpoint() }));
  const sessionId = att.sessionId;
  const raw = []; // every get_action_history response text, for the privacy sweep
  const tool = async (name, a = {}, timeoutMs) => {
    const r = await mcp.callTool(name, { sessionId, ...a }, timeoutMs);
    let json;
    try { json = jsonOf(r); } catch { /* not json */ }
    const out = { raw: r, json, isError: !!r.isError, text: textOf(r) };
    if (name === 'browser.get_action_history') raw.push(out.text);
    return out;
  };
  const history = async (a = {}) => tool('browser.get_action_history', a);
  const tabs = async () => (await tool('browser.list_tabs')).json.tabs;

  // The script's own ledger of every action it sent that the product must record, in order, per tab.
  const log = []; // {tab, actionType, key}
  const cases = [];
  const C = (id, fn) => cases.push(async () => {
    if (!wanted(id)) return;
    try { await fn(id); } catch (e) { record(surface, id, [T('case did not throw', false, e.message)]); }
  });
  let T1;
  let T2;

  C('L1', async (id) => {
    T1 = (await tabs())[0].id;
    const url1 = server.url('/fr2-11-history.html', 'L1', '#access_token=FRAG-SECRET-L1');
    const nav = await tool('browser.navigate', { url: url1 });
    log.push({ tab: 'T1', actionType: 'navigate', key: server.bare('/fr2-11-history.html') });
    const page = await pageFor(observer, server.bare('/fr2-11-history.html'));
    const ev = await tool('browser.eval', { code: 'document.title' });
    log.push({ tab: 'T1', actionType: 'eval', key: 'document.title' });
    const click = await tool('browser.click', { target: '#bump', settle: true, expect: { text: '1' } });
    log.push({ tab: 'T1', actionType: 'click', key: '#bump' });
    const evThrow = await tool('browser.eval', { code: "throw new Error('boom-L1')" });
    log.push({ tab: 'T1', actionType: 'eval', key: "throw new Error('boom-L1')" });
    const count = await page.$eval('#count', (e) => e.textContent); // observer: the click really incremented
    const h = await history();
    const j = h.json;
    const e = j?.entries ?? [];
    const navEntryVerif = e[0]?.verification;
    record(surface, id, [
      T('observer: #count really is 1', count === '1', count),
      T('navigate result carried a verification', !!nav.json?.verification, nav.text.slice(0, 200)),
      T('eval returned the page title', ev.text.includes('FR2-11 history'), ev.text.slice(0, 100)),
      T('the throwing eval is isError', evThrow.isError === true, evThrow.text.slice(0, 150)),
      T('entries are [navigate, eval, click, eval] in call order', JSON.stringify(e.map((x) => x.actionType)) === JSON.stringify(['navigate', 'eval', 'click', 'eval']), e.map((x) => x.actionType)),
      T('navigate target is the redacted URL', e[0]?.target === server.bare('/fr2-11-history.html'), e[0]?.target),
      T('navigate url is the redacted page URL', e[0]?.url === server.bare('/fr2-11-history.html'), e[0]?.url),
      T('RAW history response has no canary (query, fragment, token)', leaksIn(h.text).length === 0, leaksIn(h.text)),
      T('eval target is the code preview', e[1]?.target === 'document.title', e[1]?.target),
      T('successful eval has NO verification key (FR2-07 D13a)', e[1] && !('verification' in e[1]), e[1] && Object.keys(e[1])),
      T('throwing eval recorded as failure with the message', e[3]?.success === false && String(e[3]?.error).includes('boom-L1'), e[3]),
      T('click has a verification with evidence (FR2-07 shape)', !!e[2]?.verification?.evidence?.checks, e[2]?.verification),
      T('click history verification tier == the result tier (same contract, not a projection)', tierOf(e[2]?.verification) === tierOf(click.json?.verification), [tierOf(e[2]?.verification), tierOf(click.json?.verification)]),
      T('click history carries the expect.text check the result carried (FR2-07/FR2-08 evidence)', e[2]?.verification?.evidence?.checks?.some((c) => c.check === 'expect.text') === (click.json?.verification?.evidence?.checks?.some((c) => c.check === 'expect.text') ?? false), e[2]?.verification?.evidence?.checks?.map((c) => c.check)),
      T('navigate verification tier verified', tierOf(navEntryVerif) === 'verified', tierOf(navEntryVerif)),
      T('evicted 0, capacity 200, scope tab, no note', j.evicted === 0 && j.capacity === 200 && j.scope === 'tab' && !('note' in j), { evicted: j.evicted, capacity: j.capacity, scope: j.scope }),
      T('tab-scope entries carry NO seq/tabId keys (back-compat)', e.every((x) => !('seq' in x) && !('tabId' in x)), e[0] && Object.keys(e[0])),
      T('engine entries keep the original 6 keys with sensible values (N11)', e[2] && ['actionType', 'selector', 'success', 'executionTimeMs', 'timestamp'].every((k) => k in e[2]) && e[2].selector === '#bump' && e[2].success === true, e[2] && Object.keys(e[2])),
    ]);
    await saveEvidence(`${surface}-L1-history.json`, JSON.stringify(j, null, 2));
  });

  C('L1b', async (id) => {
    // wait_for (FR2-08) and privacy of typed / clipboard / failed-type values, on the same tab (T1)
    const wf = await tool('browser.wait_for', { js: 'true', timeoutMs: 3000 });
    log.push({ tab: 'T1', actionType: 'wait_for', key: 'js(true)' });
    const ty = await tool('browser.type', { target: '#name', value: 'hunter2-L1' });
    log.push({ tab: 'T1', actionType: 'type', key: '#name' });
    const page = await pageFor(observer, server.bare('/fr2-11-history.html'));
    const typed = await page.$eval('#name', (e) => e.value);
    const clip = await tool('browser.set_clipboard', { text: 'CLIP-SECRET-L1' });
    log.push({ tab: 'T1', actionType: 'set_clipboard', key: '<14 chars>' });
    const h = await history();
    const e = h.json.entries;
    const last3 = e.slice(-3);
    // the type-fail page: the engine's own error QUOTES the typed value (that is the pre-existing leak surface)
    await tool('browser.navigate', { url: server.url('/fr2-11-typefail.html', 'L1b') });
    log.push({ tab: 'T1', actionType: 'navigate', key: server.bare('/fr2-11-typefail.html') });
    const tf = await tool('browser.type', { target: '#f', value: 'typefail-SECRET-L1b', maxRetries: 0 }, 60000);
    log.push({ tab: 'T1', actionType: 'type', key: '#f' });
    const h2 = await history();
    const e2 = h2.json.entries;
    const tfEntry = e2.at(-1);
    // go back to the plain fixture for the later cases
    await tool('browser.navigate', { url: server.url('/fr2-11-history.html', 'L1c') });
    log.push({ tab: 'T1', actionType: 'navigate', key: server.bare('/fr2-11-history.html') });
    record(surface, id, [
      T('wait_for recorded with its FR2-08 evidence check', last3[0]?.actionType === 'wait_for' && last3[0]?.verification?.evidence?.checks?.some((c) => c.check === 'wait_for.js'), last3[0]),
      T('observer: the typed value really landed in the field', typed === 'hunter2-L1', typed),
      T('type entry has the selector and NO typed value', last3[1]?.actionType === 'type' && last3[1]?.selector === '#name', last3[1]),
      T('set_clipboard entry is a length only', last3[2]?.actionType === 'set_clipboard' && last3[2]?.target === '<14 chars>', last3[2]),
      T('clipboard result did not fail the call', clip.isError === false || clip.isError === true, clip.text.slice(0, 80)),
      T('RAW history response has no canary (typed text, clipboard text)', leaksIn(h.text).length === 0, leaksIn(h.text)),
      T('NEGATIVE CONTROL: the typed value IS in the tool own error (the leak surface exists), so the history check is meaningful', String(tf.text).includes('typefail-SECRET-L1b'), tf.text.slice(0, 300)),
      T('the failing type is recorded as a failure', tfEntry?.actionType === 'type' && tfEntry?.success === false, tfEntry),
      T('RAW history after the failing type has no canary (the error and the verification reason quoted it)', leaksIn(h2.text).length === 0, leaksIn(h2.text)),
      T('the failing type entry error is the scrubbed message', String(tfEntry?.error).startsWith('type did not land the expected value'), tfEntry?.error),
      T('ty result itself succeeded (typing worked)', ty.json?.success === true, ty.text.slice(0, 100)),
      T('wait_for result succeeded', wf.json?.success === true, wf.text.slice(0, 100)),
    ]);
  });

  C('L2', async (id) => {
    const t2 = await tool('browser.new_tab', { url: server.url('/fr2-11-history.html', 'L2b') });
    T2 = t2.json?.tabId ?? t2.json?.id ?? (await tabs()).find((t) => t.id !== T1)?.id;
    const c2 = await tool('browser.click', { target: '#bump', tabId: T2 });
    log.push({ tab: 'T2', actionType: 'click', key: '#bump' });
    await tool('browser.focus_tab', { tabId: T1 });
    const e1 = await tool('browser.eval', { code: '1+1' });
    log.push({ tab: 'T1', actionType: 'eval', key: '1+1' });
    await tool('browser.close_tab', { tabId: T2 });
    const gone = (await tabs()).every((t) => t.id !== T2);
    const s = await history({ scope: 'session' });
    const se = s.json.entries;
    const seqs = se.map((x) => x.seq);
    const exp = log.map((x) => `${x.tab === 'T1' ? T1 : T2}|${x.actionType}`);
    const got = se.map((x) => `${x.tabId}|${x.actionType}`);
    const def = await history({});
    const gt2 = await history({ tabId: T2 });
    const t1Count = log.filter((x) => x.tab === 'T1').length;
    record(surface, id, [
      T('observer/tab list: T2 really closed', gone, gone),
      T('session view: seq strictly increasing by 1 from 1', seqs.every((v, i) => v === i + 1), seqs.slice(0, 40)),
      T('session view order == the script own call order (both tabs)', JSON.stringify(got) === JSON.stringify(exp), { got: got.slice(-6), exp: exp.slice(-6) }),
      T('closed tab T2 entries survive in the session view with tabId T2', se.some((x) => x.tabId === T2 && x.actionType === 'click'), se.filter((x) => x.tabId === T2)),
      T('no canary in the session view', leaksIn(s.text).length === 0, leaksIn(s.text)),
      T('session report has scope session, no report-level tabId', s.json.scope === 'session' && !('tabId' in s.json), Object.keys(s.json)),
      T('default (scope tab) is the ACTIVE tab only: exactly T1 entries, no seq key', def.json.entries.length === t1Count && def.json.entries.every((x) => !('seq' in x)) && def.json.tabId === T1, { n: def.json.entries.length, t1Count }),
      T('get_action_history {tabId: closed tab} is still isError (unchanged behaviour)', gt2.isError === true, gt2.text.slice(0, 120)),
      T('the click on T2 succeeded on the page (observer-side not needed: result success)', c2.json?.success === true, c2.text.slice(0, 100)),
      T('eval 1+1 result', e1.text.includes('2'), e1.text.slice(0, 60)),
    ]);
    await saveEvidence(`${surface}-L2-session.json`, JSON.stringify(s.json, null, 2));
  });

  C('L3', async (id) => {
    const t0 = performance.now();
    for (let i = 0; i < 205; i++) {
      await tool('browser.eval', { code: `${i}+1` });
      log.push({ tab: 'T1', actionType: 'eval', key: `${i}+1` });
    }
    const ms = Math.round(performance.now() - t0);
    const nT1 = log.filter((x) => x.tab === 'T1').length;
    const nSes = log.length;
    const tabH = await history();
    const sesH = await history({ scope: 'session' });
    const t1Log = log.filter((x) => x.tab === 'T1');
    const firstExpected = t1Log[nT1 - 200];
    record(surface, id, [
      T('tab view keeps exactly 200', tabH.json.entries.length === 200, tabH.json.entries.length),
      T('tab evicted == (actions sent to T1) - 200, exactly', tabH.json.evicted === nT1 - 200, { evicted: tabH.json.evicted, nT1 }),
      T('tab first retained entry is the (nT1-199)th action sent', tabH.json.entries[0]?.actionType === firstExpected.actionType && displayKey(tabH.json.entries[0]) === firstExpected.key, { got: displayKey(tabH.json.entries[0]), exp: firstExpected.key }),
      T('tab note matches "N older entries were evicted"', /^\d+ older entries were evicted — only the most recent 200 are kept\.$/.test(tabH.json.note ?? ''), tabH.json.note),
      T('session view keeps 200, evicted == total-200, first seq == total-199', sesH.json.entries.length === 200 && sesH.json.evicted === nSes - 200 && sesH.json.entries[0].seq === nSes - 199, { len: sesH.json.entries.length, evicted: sesH.json.evicted, nSes, first: sesH.json.entries[0]?.seq }),
      T('the last entry is the last action sent', displayKey(tabH.json.entries.at(-1)) === '204+1', displayKey(tabH.json.entries.at(-1))),
      T('205 evals finished within a generous 120s bound (no rate-limit stall)', ms < 120000, ms),
    ], { elapsedMs: ms });
    info(surface, 'L3-timing', { evals: 205, elapsedMs: ms, perCallMs: Math.round(ms / 205) });
  });

  C('L4', async (id) => {
    const a = await history({ scope: 'session', tabId: T1 });
    const b = await history({ scope: 'all' });
    const c = await mcp.callTool('browser.get_action_history', { sessionId: 'nope' });
    record(surface, id, [
      T('scope session + tabId is isError "cannot be combined"', a.isError === true && a.text.includes('cannot be combined'), a.text.slice(0, 160)),
      T('scope "all" is rejected by the schema (isError)', b.isError === true, b.text.slice(0, 160)),
      T('unknown sessionId is isError', c.isError === true, textOf(c).slice(0, 160)),
    ]);
  });

  C('L9-overhead', async (id) => {
    // informational: mean per-call cost of 200 evals (recording included). The baseline number comes from the master build run separately.
    const t0 = performance.now();
    for (let i = 0; i < 200; i++) await tool('browser.eval', { code: `${i}` });
    const ms = performance.now() - t0;
    info(surface, id, { evals: 200, totalMs: Math.round(ms), meanPerCallMs: Math.round((ms / 200) * 100) / 100 });
    record(surface, id, [T('200 evals completed', true, ms)]);
  });

  try {
    for (const c of cases) await c();
    // Privacy sweep over EVERY raw get_action_history response of this session, plus the probe self-test.
    const sweep = raw.map((t) => leaksIn(t)).flat();
    record(surface, 'PRIV-sweep', [
      T(`no canary in any of ${raw.length} raw history responses`, sweep.length === 0, sweep),
      T('PROBE SELF-TEST: the canary search sees a leak when one exists', leaksIn('x https://a/?n=1&token=SECRET-1 y').length >= 3, leaksIn('x https://a/?n=1&token=SECRET-1 y')),
    ]);
    await saveEvidence(`${surface}-raw-history-responses.txt`, raw.join('\n----\n'));
  } finally {
    await mcp.callTool('browser.shutdown_all', {}).catch(() => {});
    mcp.child.stdin.end();
    await observer.close().catch(() => {});
  }
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// CLI (and the npm bundle's CLI)
// ═════════════════════════════════════════════════════════════════════════════════════════════
async function runCliCases(surface, cliJs, ctx) {
  const { server } = ctx;
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fr2-11-cli-state-'));
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'fr2-11-cli-work-'));
  tempDirs.push(stateDir, work);
  const env = { ...process.env, SUTRADHAR_CLI_STATE_DIR: stateDir, __CWD: work };
  const HIST = path.join(stateDir, 'history.jsonl');
  const STATE = path.join(stateDir, 'state.json');
  const cli = (a, t, e = env) => spawnCli(cliJs, a, e, t);
  const readLines = async () => (await fs.readFile(HIST, 'utf-8').catch(() => '')).split('\n').filter((l) => l.trim());
  const validCount = async () => (await readLines()).filter((l) => { try { const o = JSON.parse(l); return o && typeof o === 'object' && Number.isInteger(o.v); } catch { return false; } }).length;
  let tornFragments = 0; // N7 leaves one unparsable fragment in the file on purpose
  const cases = [];
  const C = (id, fn) => cases.push(async () => {
    if (!wanted(id)) return;
    try { await fn(id); } catch (e) { record(surface, id, [T('case did not throw', false, e.message)]); }
  });
  const jsonLines = (out) => out.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  let expectedLines = 0;
  let ourChromeNeedle;
  let observer;
  const observerPage = async () => {
    if (!observer) {
      const st = JSON.parse(await fs.readFile(STATE, 'utf-8'));
      observer = await puppeteer.connect({ browserWSEndpoint: st.wsEndpoint, defaultViewport: null });
    }
    const ps = await observer.pages();
    return ps.find((p) => p.url().startsWith(server.origin)) ?? ps.at(-1);
  };

  C('L5', async (id) => {
    const url = server.url('/fr2-11-history.html', 'L5');
    const r = [];
    r.push(await cli(['nav', url]));
    await noteOwnChrome(STATE);
    r.push(await cli(['eval', 'document.title']));
    r.push(await cli(['click', '#bump']));
    r.push(await cli(['type', '#name', 'hunter2-L5']));
    r.push(await cli(['snap']));
    r.push(await cli(['eval', "throw new Error('x-L5')"]));
    r.push(await cli(['press', '#name', 'Enter']));
    expectedLines = 7;
    const page = await observerPage();
    const count = await page.$eval('#count', (e) => e.textContent);
    const nameVal = await page.$eval('#name', (e) => e.value);
    const st = JSON.parse(await fs.readFile(STATE, 'utf-8'));
    const stateDirEntries = (await fs.readdir(stateDir)).sort();
    const bytes = await fs.readFile(HIST);
    const j = await cli(['history', '--json']);
    const lines = jsonLines(j.stdout);
    const human = await cli(['history']);
    const hl = human.stdout.split('\n');
    const nav = lines[0]; const typeL = lines[3]; const snapL = lines[4]; const failEv = lines[5]; const press = lines[6]; const click = lines[2];
    ourChromeNeedle = userDataDirOfPid(st.chromePid) ?? 'NO-NEEDLE-FOUND';
    const chromeBefore = chromeProcs([ourChromeNeedle]).length;
    const stateShaBefore = sha256(await fs.readFile(STATE));
    const hist = await cli(['history']);
    const chromeAfter = chromeProcs([ourChromeNeedle]).length;
    const stateShaAfter = sha256(await fs.readFile(STATE));
    const failedRows = hl.filter((l) => l.includes(' FAILED ') && l.includes('x-L5'));
    record(surface, id, [
      T('all 7 commands ran as expected (exit codes 0,0,0,0,0,1,0)', JSON.stringify(r.map((x) => x.code)) === JSON.stringify([0, 0, 0, 0, 0, 1, 0]), r.map((x) => [x.code, x.stderr.slice(0, 80)])),
      T('observer: #count really is 1 and #name really holds the typed text', count === '1' && nameVal === 'hunter2-L5', { count, nameVal }),
      T('history.jsonl exists NEXT TO state.json', stateDirEntries.includes('history.jsonl') && stateDirEntries.includes('state.json'), stateDirEntries),
      T('RAW history.jsonl bytes contain no canary (SECRET-L5, hunter2-L5, ?n=, token=)', leaksIn(bytes.toString('utf-8')).length === 0, leaksIn(bytes.toString('utf-8'))),
      T('NEGATIVE CONTROL: the CLI own stdout for nav DID print the tokened URL (the leak surface exists)', r[0].stdout.includes('SECRET-L5'), r[0].stdout.slice(0, 200)),
      T('history --json: exactly 7 lines, each v 1 / type command', lines.length === 7 && lines.every((l) => l.v === 1 && l.type === 'command'), lines.length),
      T('verbs in order', JSON.stringify(lines.map((l) => l.verb)) === JSON.stringify(['nav', 'eval', 'click', 'type', 'snap', 'eval', 'press']), lines.map((l) => l.verb)),
      T('every sessionId equals state.json sessionId', lines.every((l) => l.sessionId === st.sessionId), lines.map((l) => l.sessionId)),
      T('nav line: actions[0] is navigate with the redacted target and args', nav.actions[0]?.actionType === 'navigate' && nav.actions[0]?.target === server.bare('/fr2-11-history.html') && nav.args[0] === server.bare('/fr2-11-history.html'), { a: nav.actions[0]?.target, args: nav.args }),
      T('type line: args[1] is a length tag, and the click line has a verification with evidence', /^<\d+ chars>$/.test(typeL.args[1]) && typeL.args[1] === '<10 chars>' && !!click.actions[0]?.verification?.evidence, { args: typeL.args, click: click.actions[0]?.verification }),
      T('snap line has actions []', snapL.actions.length === 0, snapL.actions),
      T('failing eval: exitCode 1 and actions[0].success false', failEv.exitCode === 1 && failEv.actions[0]?.success === false, { exit: failEv.exitCode, a: failEv.actions[0] }),
      T('press line: actions are [focus, press_key] and press_key target is Enter', JSON.stringify(press.actions.map((a) => a.actionType)) === JSON.stringify(['focus', 'press_key']) && press.actions[1]?.target === 'Enter', press.actions.map((a) => [a.actionType, a.target])),
      T('the navigation verification says verified (FR2-07 contract)', tierOf(nav.actions[0]?.verification) === 'verified', tierOf(nav.actions[0]?.verification)),
      T('human: line 1 is "History: 7 command(s) in ...history.jsonl"', /^History: 7 command\(s\) in .*history\.jsonl$/.test(hl[0]), hl[0]),
      T('human: exactly one "(current)" session row', hl.filter((l) => /^--- session .* \(current\) ---$/.test(l)).length === 1, hl.filter((l) => l.startsWith('---'))),
      T('human: 7 command rows', hl.filter((l) => /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\dZ  exit /.test(l)).length === 7, hl.length),
      T('human: one FAILED action row that contains x-L5', failedRows.length === 1, failedRows),
      T('human output has no canary either', leaksIn(human.stdout).length === 0, leaksIn(human.stdout)),
      T('history did not start Chrome (our Chrome process count unchanged and >= 1) and did not touch state.json', chromeBefore >= 1 && chromeBefore === chromeAfter && stateShaBefore === stateShaAfter && hist.code === 0, { chromeBefore, chromeAfter }),
    ]);
    info(surface, 'L5-history-duration', { historyProcessMs: hist.ms });
    await saveEvidence(`${surface}-L5-history.jsonl`, bytes);
    await saveEvidence(`${surface}-L5-history-human.txt`, human.stdout);
  });

  C('N7', async (id) => {
    await fs.appendFile(HIST, '{"v":1,"ty'); // a torn last line (a writer killed mid-write), no newline
    tornFragments = 1;
    const j = await cli(['history', '--json']);
    const h = await cli(['history']);
    const text = await cli(['text']); // appends a NEW line: must not be glued onto the fragment
    expectedLines = 8;
    const j2 = await cli(['history', '--json']);
    record(surface, id, [
      T('history --json still gives exactly 7 lines, exit 0', j.code === 0 && jsonLines(j.stdout).length === 7, j.stdout.split('\n').length),
      T('stderr notes exactly one skipped line', /Note: skipped 1 unreadable line\(s\) in /.test(j.stderr), j.stderr),
      T('human header still counts 7 commands', /^History: 7 command\(s\)/.test(h.stdout), h.stdout.split('\n')[0]),
      T('the next command succeeded', text.code === 0, text.code),
      T('the line appended after the torn fragment is intact: 8 valid lines, still 1 skipped', jsonLines(j2.stdout).length === 8 && /skipped 1/.test(j2.stderr) && jsonLines(j2.stdout).at(-1).verb === 'text', { n: jsonLines(j2.stdout).length, err: j2.stderr }),
    ]);
  });

  C('L5x', async (id) => {
    // privacy on the remaining secret-bearing verbs: clipboard, a failing type (the error quotes the value), select-like value
    const cl = await cli(['setclipboard', 'CLIP-SECRET-L5']);
    const nav = await cli(['nav', server.url('/fr2-11-typefail.html', 'L5x')]);
    const tf = await cli(['type', '#f', 'typefail-SECRET-L5']);
    expectedLines += 3;
    const bytes = (await fs.readFile(HIST)).toString('utf-8');
    const j = await cli(['history', '--json']);
    const human = await cli(['history']);
    const lines = jsonLines(j.stdout);
    const clipL = lines.find((l) => l.verb === 'setclipboard');
    const tfL = lines.filter((l) => l.verb === 'type').at(-1);
    record(surface, id, [
      T('NEGATIVE CONTROL: the failing type printed the typed value on the CLI own stdout (leak surface exists)', tf.stdout.includes('typefail-SECRET-L5'), tf.stdout.slice(0, 200)),
      T('the failing type exited 1', tf.code === 1, tf.code),
      T('setclipboard line args is a length tag', JSON.stringify(clipL?.args) === JSON.stringify(['<14 chars>']), clipL?.args),
      T('setclipboard action target is a length tag', clipL?.actions?.some((a) => a.actionType === 'set_clipboard' && a.target === '<14 chars>'), clipL?.actions?.map((a) => [a.actionType, a.target])),
      T('the failing type is recorded (exit 1, action failed)', tfL?.exitCode === 1 && tfL?.actions?.some((a) => a.actionType === 'type' && a.success === false), tfL),
      T('RAW history.jsonl has no canary after clipboard + failed-type (CLIP-SECRET-L5, typefail-SECRET-L5)', leaksIn(bytes).length === 0, leaksIn(bytes)),
      T('history --json and human output have no canary', leaksIn(j.stdout).length === 0 && leaksIn(human.stdout).length === 0, [leaksIn(j.stdout), leaksIn(human.stdout)]),
      T('nav to the typefail page ran', nav.code === 0, nav.code),
    ]);
    await saveEvidence(`${surface}-L5x-history.jsonl`, bytes);
  });

  C('L7', async (id) => {
    await cli(['nav', server.url('/fr2-11-history.html', 'L7')]);
    await noteOwnChrome(STATE);
    expectedLines += 1;
    const before = (await readLines()).length;
    const runs = await Promise.all(Array.from({ length: 5 }, () => cli(['eval', '1'])));
    expectedLines += 5;
    const lines = await readLines();
    const parsed = lines.map((l) => { try { return JSON.parse(l); } catch { return undefined; } });
    record(surface, id, [
      T('all 5 parallel CLI processes exited 0', runs.every((r) => r.code === 0), runs.map((r) => [r.code, r.stderr.slice(0, 100)])),
      T('exactly 5 new lines were appended', lines.length - before === 5, { before, after: lines.length }),
      T('every file line individually JSON.parse-able (no interleaving); the only unparsable one is the N7 fragment', parsed.filter((p) => p === undefined).length === tornFragments, parsed.map((p) => p === undefined)),
      T('the 5 new lines are eval lines with an eval action each', parsed.slice(-5).every((p) => p?.verb === 'eval' && p?.actions?.[0]?.actionType === 'eval'), parsed.slice(-5).map((p) => p?.verb)),
    ]);
  });

  C('L7b', async (id) => {
    // A heavier, deterministic cross-process stress on the append itself (built history-file module), in its own dir:
    // 8 processes x 50 lines of ~8 KiB, and 6 processes x 5 lines of ~58 KiB (near the 64 KiB single-write guard).
    if (surface !== 'cli') return; // the bundle has no separate history-file module
    const mod = pathToFileURL(path.join(path.dirname(cliJs), 'history-file.js')).href;
    const runStress = async (dirName, procs, per, payloadBytes) => {
      const d = await fs.mkdtemp(path.join(os.tmpdir(), `fr2-11-${dirName}-`));
      tempDirs.push(d);
      const file = path.join(d, 'history.jsonl');
      const code = `
        import { buildHistoryLine, appendHistoryLine } from ${JSON.stringify(mod)};
        const [file, proc, per, size] = process.argv.slice(1);
        let ok = 0;
        for (let i = 0; i < Number(per); i++) {
          const line = buildHistoryLine({ ts: new Date().toISOString(), sessionId: 's', cwd: '/w', verb: 'stress', args: ['p' + proc + '-' + i],
            exitCode: 0, durationMs: 1, actions: [{ actionType: 'x', success: true, executionTimeMs: 1, timestamp: 't', tabId: 't', seq: i, target: 'y'.repeat(Number(size)) }] });
          const r = await appendHistoryLine(file, line, { rotateBytes: 1e12 });
          if (r.ok) ok++;
        }
        console.log(ok);`;
      const runs = await Promise.all(Array.from({ length: procs }, (_, p) => {
        const child = spawn(process.execPath, ['--input-type=module', '-e', code, file, String(p), String(per), String(payloadBytes)], { windowsHide: true });
        spawned.push(child.pid);
        return new Promise((resolve) => { let out = ''; child.stdout.on('data', (x) => (out += x)); child.on('close', (c) => resolve({ code: c, out: out.trim() })); });
      }));
      const text = await fs.readFile(file, 'utf-8');
      const rows = text.split('\n').filter(Boolean);
      const parsed = rows.map((r) => { try { return JSON.parse(r); } catch { return undefined; } });
      const ids = new Set(parsed.filter(Boolean).map((p) => p.args[0]));
      const wantIds = procs * per;
      return { runs, rows: rows.length, unparsable: parsed.filter((p) => p === undefined).length, uniqueIds: ids.size, wantIds, endsWithNewline: text.endsWith('\n'), maxLineBytes: Math.max(...rows.map((r) => Buffer.byteLength(r))), bytes: Buffer.byteLength(text) };
    };
    const a = await runStress('stressA', 8, 50, 8000);
    const b = await runStress('stressB', 6, 5, 58000);
    record(surface, id, [
      T('stress A: every child process wrote all its lines', a.runs.every((r) => r.code === 0 && r.out === '50'), a.runs),
      T('stress A: 400 lines, 0 unparsable (no interleaving), 400 unique ids (no lost entries), file ends with newline', a.rows === a.wantIds && a.unparsable === 0 && a.uniqueIds === a.wantIds && a.endsWithNewline, a),
      T('stress B (lines near 58 KiB): 30 lines, all parseable, all unique', b.rows === b.wantIds && b.unparsable === 0 && b.uniqueIds === b.wantIds && b.endsWithNewline && b.maxLineBytes < 64 * 1024, b),
    ]);
  });

  C('L6', async (id) => {
    const st = JSON.parse(await fs.readFile(STATE, 'utf-8'));
    const beforeLines = (await readLines()).length;
    const beforeValid = await validCount();
    const close = await cli(['close']);
    expectedLines += 1;
    const stateGone = !(await fs.stat(STATE).then(() => true, () => false));
    const dirExists = await fs.stat(stateDir).then(() => true, () => false);
    const histExists = await fs.stat(HIST).then(() => true, () => false);
    const lines = await readLines();
    const last = JSON.parse(lines.at(-1));
    const h = await cli(['history']);
    const hj = await cli(['history', '--json']);
    const navNew = await cli(['nav', server.url('/fr2-11-history.html', 'L6')]);
    await noteOwnChrome(STATE);
    expectedLines += 1;
    const st2 = JSON.parse(await fs.readFile(STATE, 'utf-8'));
    const h2 = await cli(['history']);
    const rows2 = h2.stdout.split('\n');
    record(surface, id, [
      T('close exited 0', close.code === 0, close.stdout),
      T('state.json is gone after close', stateGone, stateGone),
      T('history.jsonl STILL exists after close, and so does the directory', histExists && dirExists, { histExists, dirExists }),
      T('the last line is the close line with actions []', last.verb === 'close' && last.actions.length === 0 && last.sessionId === st.sessionId && lines.length === beforeLines + 1, last),
      T('history after close: exit 0, the previous lines are all still there, no (current) marker', h.code === 0 && jsonLines(hj.stdout).length === beforeValid + 1 && !h.stdout.includes('(current)'), { code: h.code, n: jsonLines(hj.stdout).length, beforeValid }),
      T('a new nav after close is a NEW session id', navNew.code === 0 && st2.sessionId !== st.sessionId, [st.sessionId, st2.sessionId]),
      T('history then shows the new session marked (current) and the old one not', rows2.filter((l) => l.includes('(current)')).length === 1 && rows2.filter((l) => l.startsWith('--- session ')).length >= 2 && rows2.some((l) => l.includes(st2.sessionId) && l.includes('(current)')), rows2.filter((l) => l.startsWith('---'))),
    ]);
    if (observer) { await observer.disconnect().catch(() => {}); observer = undefined; }
  });

  C('L8', async (id) => {
    await cli(['close']);
    expectedLines += 1;
    // seed synthetic valid v1 lines totalling >= 5 MiB (shape the fixture, not the code), remember its sha256
    const seedLine = JSON.stringify({ v: 1, type: 'command', ts: '2026-01-01T00:00:00.000Z', sessionId: 'seed', cwd: '/w', verb: 'seed', args: ['x'.repeat(1000)], exitCode: 0, durationMs: 1, actions: [], actionsEvicted: 0 });
    const perLine = Buffer.byteLength(seedLine) + 1;
    const seed = Array.from({ length: Math.ceil((5 * 1024 * 1024) / perLine) + 2 }, () => seedLine).join('\n') + '\n';
    await fs.writeFile(HIST, seed);
    const seedSha = sha256(Buffer.from(seed));
    const navR = await cli(['nav', server.url('/fr2-11-history.html', 'L8')]);
    await noteOwnChrome(STATE);
    const rotatedPath = path.join(stateDir, 'history.1.jsonl');
    const rotatedSha = sha256(await fs.readFile(rotatedPath).catch(() => Buffer.alloc(0)));
    const now = await readLines();
    const human = await cli(['history']);
    const last = human.stdout.split('\n').at(-1);
    record(surface, id, [
      T('nav after seeding exited 0', navR.code === 0, navR.stderr.slice(0, 200)),
      T('history.1.jsonl is BYTE-IDENTICAL to the seeded file (sha256)', rotatedSha === seedSha, { rotatedSha, seedSha }),
      T('history.jsonl now has exactly 1 line (the nav)', now.length === 1 && JSON.parse(now[0]).verb === 'nav', now.length),
      T('human history ends with the rotated-file footer', /^Older commands were rotated to .*history\.1\.jsonl \(not shown\)\.$/.test(last), last),
    ]);
    await fs.rm(rotatedPath, { force: true });
  });

  C('N9', async (id) => {
    const d = await fs.mkdtemp(path.join(os.tmpdir(), 'fr2-11-n9-'));
    tempDirs.push(d);
    const sd = path.join(d, 'never-created');
    const e = { ...env, SUTRADHAR_CLI_STATE_DIR: sd };
    const before = chromeProcs(['sutradhar-cli-']).length;
    const h = await cli(['history'], undefined, e);
    const hj = await cli(['history', '--json'], undefined, e);
    const after = chromeProcs(['sutradhar-cli-']).length;
    record(surface, id, [
      T('prints "No CLI history yet ..." and exits 0', h.code === 0 && /^No CLI history yet for this directory \(.*history\.jsonl does not exist\)\.$/.test(h.stdout), h.stdout),
      T('--json prints nothing, exit 0', hj.code === 0 && hj.stdout === '', hj.stdout),
      T('no state dir / state.json was created', !(await fs.stat(sd).then(() => true, () => false)), sd),
    ]);
    info(surface, 'N9-chrome-count', { sutradharCliChromeProcsBefore: before, after, note: 'informational: other sessions on this machine may start/stop their own' });
  });

  C('N10', async (id) => {
    const h = await cli(['history', '--bogus']);
    record(surface, id, [T('history --bogus is the existing unrecognized-flag error, exit 1', h.code === 1 && /Unrecognized flag "--bogus"/.test(h.stderr), h.stderr.slice(0, 200))]);
  });

  C('N8', async (id) => {
    // history.jsonl unwritable (a DIRECTORY with that name): the command must behave exactly like a control run
    const mk = async (tag, blocked) => {
      const d = await fs.mkdtemp(path.join(os.tmpdir(), `fr2-11-n8-${tag}-`));
      tempDirs.push(d);
      if (blocked) await fs.mkdir(path.join(d, 'history.jsonl'));
      return d;
    };
    const ctl = await mk('ctl', false);
    const blk = await mk('blk', true);
    const url = server.url('/fr2-11-history.html', 'N8');
    const run = async (d) => {
      const e = { ...env, SUTRADHAR_CLI_STATE_DIR: d };
      const r = await spawnCli(cliJs, ['nav', url], e, 120000);
      await noteOwnChrome(path.join(d, 'state.json'));
      const rr = await spawnCli(cliJs, ['close'], e, 60000);
      return { r, rr };
    };
    const a = await run(ctl);
    const b = await run(blk);
    const warnings = b.r.stderr.split('\n').filter((l) => l.includes('Warning: could not append'));
    record(surface, id, [
      T('control run exited 0', a.r.code === 0, a.r.code),
      T('blocked run: identical stdout and exit code to the control', b.r.stdout === a.r.stdout && b.r.code === a.r.code, { ctl: a.r.stdout.slice(0, 150), blk: b.r.stdout.slice(0, 150) }),
      T('blocked run: exactly one "Warning: could not append" line on stderr', warnings.length === 1, warnings),
      T('control run wrote its history line', (await fs.readFile(path.join(ctl, 'history.jsonl'), 'utf-8')).split('\n').filter(Boolean).length >= 1, 'ok'),
      T('the directory named history.jsonl is untouched', (await fs.stat(path.join(blk, 'history.jsonl'))).isDirectory(), 'dir'),
    ]);
  });

  C('N15', async (id) => {
    const d = await fs.mkdtemp(path.join(os.tmpdir(), 'fr2-11-n15-'));
    tempDirs.push(d);
    const e = { ...env, SUTRADHAR_CLI_STATE_DIR: d };
    // a pre-session failure (printErrorAndExit before any session exists): an unknown --profile
    const r = await spawnCli(cliJs, ['nav', server.url('/fr2-11-history.html', 'N15'), '--profile', 'fr2-11-no-such-profile'], e, 60000);
    const entries = await fs.readdir(d);
    record(surface, id, [
      T('a spawn failure exits 1 (before any session exists)', r.code === 1, { code: r.code, err: r.stderr.slice(0, 200) }),
      T('no history line and no state were written (nothing to attribute)', !entries.includes('history.jsonl') && !entries.includes('state.json'), entries),
    ]);
  });

  try {
    for (const c of cases) await c();
    if (wanted('PRIV-sweep')) {
      const bytes = await fs.readFile(HIST, 'utf-8').catch(() => '');
      record(surface, 'PRIV-sweep', [
        T('final history.jsonl has no canary', leaksIn(bytes).length === 0, leaksIn(bytes)),
        T('PROBE SELF-TEST: the canary search sees a leak in a synthetic history line', leaksIn('{"args":["https://a/?n=1"],"error":"hunter2"}').length >= 2, leaksIn('{"args":["https://a/?n=1"],"error":"hunter2"}')),
      ]);
    }
  } finally {
    if (observer) await observer.disconnect().catch(() => {});
    await cli(['close']).catch(() => {});
  }
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
// SDK (the npm bundle's index.js: page.goto / page.evaluate route through runtime.navigate / runtime.eval)
// ═════════════════════════════════════════════════════════════════════════════════════════════
async function runSdkCases(ctx) {
  const surface = 'sdk';
  const { server } = ctx;
  const sdk = await import(pathToFileURL(path.join(repoRoot, 'packages', 'sutradhar', 'dist', 'index.js')).href);
  const browser = await sdk.launch({ headless: true });
  const observer = await puppeteer.connect({ browserWSEndpoint: browser.getWsEndpoint(), defaultViewport: null });
  try {
    const page = (await browser.pages())[0];
    // The SDK has no public history API (spec gap G-A): read through the runtime it wraps, the same object every SDK call goes through.
    const rt = browser.runtime;
    const url = server.url('/fr2-11-history.html', 'SDK', '#access_token=FRAG-SECRET-SDK');
    await page.goto(url);
    const title = await page.evaluate('document.title');
    await page.click('#bump');
    await page.type('#name', 'hunter2-SDK');
    let evalErr;
    try { await page.evaluate("throw new Error('boom-SDK')"); } catch (e) { evalErr = e; }
    const obs = await pageFor(observer, server.bare('/fr2-11-history.html'));
    const count = await obs.$eval('#count', (e) => e.textContent);
    const nameVal = await obs.$eval('#name', (e) => e.value);
    const rep = rt.getActionHistoryReport(browser.sessionId, { scope: 'session' });
    const tabRep = rt.getActionHistoryReport(browser.sessionId);
    const e = rep.entries;
    const text = JSON.stringify(rep);
    let combined, bad;
    try { rt.getActionHistoryReport(browser.sessionId, { scope: 'session', tabId: page.tabId }); } catch (x) { combined = x; }
    try { rt.getActionHistoryReport(browser.sessionId, { scope: 'all' }); } catch (x) { bad = x; }
    record(surface, 'SDK-L1', [
      T('observer: #count is 1 and #name holds the typed text', count === '1' && nameVal === 'hunter2-SDK', { count, nameVal }),
      T('page.evaluate returned the title; the throwing evaluate rejected', title === 'FR2-11 history' && evalErr instanceof Error && String(evalErr.message).includes('boom-SDK'), { title, err: evalErr?.message }),
      T('SDK goto/evaluate/click/type/evaluate are recorded in order (navigate, eval, click, type, eval)', JSON.stringify(e.map((x) => x.actionType)) === JSON.stringify(['navigate', 'eval', 'click', 'type', 'eval']), e.map((x) => x.actionType)),
      T('navigate target and url are the redacted URL', e[0]?.target === server.bare('/fr2-11-history.html') && e[0]?.url === server.bare('/fr2-11-history.html'), [e[0]?.target, e[0]?.url]),
      T('navigate and click carry FR2-07 verification evidence', tierOf(e[0]?.verification) === 'verified' && !!e[2]?.verification?.evidence, [tierOf(e[0]?.verification), e[2]?.verification]),
      T('failing eval recorded as failure with the message; successful eval has no verification', e[4]?.success === false && String(e[4]?.error).includes('boom-SDK') && !('verification' in e[1]), [e[4], Object.keys(e[1])]),
      T('RAW report JSON has no canary (typed text, query, fragment)', leaksIn(text).length === 0, leaksIn(text)),
      T('tab report: scope tab, tabId set, evicted 0, capacity 200', tabRep.scope === 'tab' && tabRep.tabId === page.tabId && tabRep.evicted === 0 && tabRep.capacity === 200, [tabRep.scope, tabRep.tabId, tabRep.evicted]),
      T('scope session + tabId is a TypeError "cannot be combined"; an unknown scope is a TypeError', combined instanceof TypeError && /cannot be combined/.test(combined.message) && bad instanceof TypeError && /scope must be/.test(bad.message), [combined?.message, bad?.message]),
      T('session entries carry tabId and a strictly increasing seq', e.every((x, i) => x.tabId === page.tabId && x.seq === i + 1), e.map((x) => x.seq)),
    ]);
    await saveEvidence('sdk-L1-report.json', JSON.stringify(rep, null, 2));
  } finally {
    await observer.disconnect().catch(() => {});
    await browser.close().catch(() => {});
  }
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
async function main() {
  await fs.mkdir(EVIDENCE_DIR, { recursive: true });
  const chromePath = resolveChrome();
  const server = await startServer();
  const ctx = { server, chromePath };
  const startedAt = new Date().toISOString();
  console.log(`[fr2-11] evidence dir: ${EVIDENCE_DIR}; fixture server ${server.origin}`);
  try {
    if (SURFACES.includes('mcp')) await runMcpCases('mcp', path.join(repoRoot, 'packages', 'mcp-server', 'dist', 'cli.js'), ctx);
    if (SURFACES.includes('cli')) await runCliCases('cli', path.join(repoRoot, 'packages', 'cli', 'dist', 'cli.js'), ctx);
    if (SURFACES.includes('sdk')) await runSdkCases(ctx);
    if (SURFACES.includes('bundle')) {
      await runMcpCases('bundle', path.join(repoRoot, 'packages', 'sutradhar', 'dist', 'mcp-cli.js'), ctx);
      await runCliCases('bundle', path.join(repoRoot, 'packages', 'sutradhar', 'dist', 'cli-bin.js'), ctx);
    }
  } finally {
    await server.close().catch(() => {});
    await delay(1500);
  }
  // hygiene: only Chrome whose command line names a scratch dir or a --user-data-dir THIS script's own CLI runs used
  const needles = [...tempDirs, ...ownProfileDirs];
  const lingering = chromeProcs(needles);
  for (const p of lingering) spawnSync('taskkill', ['/PID', String(p.pid), '/T', '/F']); // matched via this run's own dirs only
  for (const d of tempDirs) await rmWithRetry(d);
  for (const d of ownProfileDirs) await rmWithRetry(d);
  const newCliDirs = [...ownProfileDirs];
  const perSurface = {};
  for (const s of ['mcp', 'cli', 'sdk', 'bundle']) {
    const rs = results.filter((r) => r.surface === s);
    perSurface[s] = { cases: rs.length, casesPassed: rs.filter((r) => r.pass).length, checks: rs.reduce((a, r) => a + r.checks, 0), checksFailed: rs.reduce((a, r) => a + r.failed.length, 0) };
    await fs.writeFile(path.join(EVIDENCE_DIR, `live-${s}.jsonl`), rs.map((r) => JSON.stringify(r)).join('\n') + '\n');
  }
  const summary = {
    startedAt, finishedAt: new Date().toISOString(),
    cases: results.length, casesPassed: results.filter((r) => r.pass).length,
    checks: results.reduce((a, r) => a + r.checks, 0), checksFailed: results.reduce((a, r) => a + r.failed.length, 0),
    perSurface, failed: results.filter((r) => !r.pass).map((r) => `${r.surface}:${r.case}`), informational,
    hygiene: { lingeringChromeKilledByPid: lingering.map((p) => p.pid), ownCliChromePids: [...ownChromePids], ownCliChromeProfileDirs: newCliDirs, childPidsStarted: spawned.filter(Boolean) },
    evidenceFiles,
    results,
  };
  await fs.writeFile(path.join(EVIDENCE_DIR, 'live-summary.json'), JSON.stringify(summary, null, 2));
  console.log(`\n[fr2-11] ${summary.casesPassed}/${summary.cases} cases (${summary.checks - summary.checksFailed}/${summary.checks} checks) ${JSON.stringify(perSurface)}${summary.failed.length ? `; FAILED: ${summary.failed.join(', ')}` : ''}`);
  if (lingering.length > 0) console.log(`[fr2-11] HYGIENE: ${lingering.length} lingering chrome process(es) with this run's scratch dirs were killed by PID: ${lingering.map((p) => p.pid).join(',')}`);
  process.exitCode = overallOk ? 0 : 1;
}

main().catch((e) => {
  console.error('[fr2-11] fatal:', e);
  process.exitCode = 1;
}).finally(() => setTimeout(() => process.exit(process.exitCode ?? 0), 500).unref());
