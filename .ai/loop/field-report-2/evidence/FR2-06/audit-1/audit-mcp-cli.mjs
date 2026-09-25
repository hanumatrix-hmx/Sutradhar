// FR2-06 audit-1 — MCP (stdio child) and CLI surfaces, each child process traced by
// trace-preload.mjs (CDP sends, outbound HTTP, child-process spawns logged from INSIDE the process).
// Run: node .ai/loop/field-report-2/evidence/FR2-06/audit-1/audit-mcp-cli.mjs
import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { spawn, execFile } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..', '..', '..', '..');
const FIXTURE_URL = pathToFileURL(path.join(here, 'fixture-audit.html')).href;
const PRELOAD = pathToFileURL(path.join(here, 'trace-preload.mjs')).href;
const req = createRequire(path.join(repoRoot, 'packages', 'browser', 'package.json'));
const puppeteer = req('puppeteer-core');
const browserMod = await import(pathToFileURL(path.join(repoRoot, 'packages', 'browser', 'dist', 'index.js')));
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const traceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fr2-06-audit1-trace-'));
const cleanup = [traceDir];

const cases = [];
let ok = true;
function rec(c) {
  cases.push(c);
  if (!c.pass) ok = false;
  console.log(`${c.pass ? 'PASS' : 'FAIL'} ${c.case}${c.pass ? '' : ' :: ' + JSON.stringify(c).slice(0, 500)}`);
}
function readTrace(file) {
  if (!fss.existsSync(file)) return [];
  return fss.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

// ── MCP ──────────────────────────────────────────────────────────────────────────────────────
async function runMcp() {
  const chromePath = new browserMod.BrowserLauncher().findExecutablePath();
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'fr2-06-audit1-mcp-'));
  cleanup.push(profile);
  const observer = await puppeteer.launch({ executablePath: chromePath, headless: true, userDataDir: profile, args: ['--no-sandbox'] });
  const traceFile = path.join(traceDir, 'mcp.jsonl');
  const child = spawn(process.execPath, ['--import', PRELOAD, path.join(repoRoot, 'packages', 'mcp-server', 'dist', 'cli.js')], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, AUDIT_TRACE_FILE: traceFile, AUDIT_REPO_ROOT: repoRoot },
  });
  let buf = '';
  let id = 1;
  const pending = new Map();
  child.stdout.on('data', (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      try {
        const m = JSON.parse(line);
        if (m.id !== undefined && pending.has(m.id)) {
          pending.get(m.id)(m);
          pending.delete(m.id);
        }
      } catch {}
    }
  });
  child.stderr.on('data', () => {});
  const call = (method, params) =>
    new Promise((resolve, reject) => {
      const myId = id++;
      pending.set(myId, (m) => (m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)));
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: myId, method, params }) + '\n');
      setTimeout(() => pending.has(myId) && (pending.delete(myId), reject(new Error('timeout ' + method))), 60000);
    });
  const tool = (name, args) => call('tools/call', { name, arguments: args });
  const text = (r) => r.content?.[0]?.text ?? '';
  try {
    await call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'fr2-06-audit1', version: '1' } });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    const { sessionId } = JSON.parse(text(await tool('browser.attach', { endpoint: observer.wsEndpoint() })));
    await tool('browser.navigate', { sessionId, url: `${FIXTURE_URL}?t=${Date.now()}` });
    const page = (await observer.pages()).find((p) => p.url().startsWith(FIXTURE_URL));
    await page.waitForFunction(() => window.__a && window.__a.ready);
    await delay(300);

    const mcpCases = [
      ['browser.click', { target: 'text=Submit' }],
      ['browser.right_click', { target: 'button >> text=OK' }],
      ['browser.type', { target: 'div:has-text("x")', value: 'x' }],
      ['browser.hover', { target: "getByRole('button')" }],
      ['browser.focus', { target: 'internal:role=button' }],
      ['browser.select_option', { target: 'role=combobox', value: 'v' }],
      ['browser.select_options', { target: 'css=select', values: ['v'] }],
      ['browser.wait_for_selector', { target: 'xpath=//div' }],
      ['browser.upload_file', { target: '#12', filePath: path.join(here, 'fixture-audit.html') }],
      ['browser.drag_and_drop', { sourceTarget: '#plain-btn', destTarget: '//div' }],
      ['browser.drag_and_drop', { sourceTarget: 'aria=Go', destTarget: '#plain-btn' }],
      ['browser.touch_tap', { target: 'button:visible' }],
      ['browser.download_file', { target: '"Download"' }],
      ['browser.scroll', { target: 'data-testid=list' }],
      ['browser.upload_file_via_trigger', { target: 'text=Browse', filePath: path.join(here, 'fixture-audit.html') }],
      ['browser.eval', { code: '1', frameSelector: 'role=frame' }],
      ['browser.extract_data', { fields: { a: { selector: 'text=Buy' }, b: { selector: 'li >> nth=0' } } }],
    ];
    for (const [name, args] of mcpCases) {
      const before = readTrace(traceFile).length;
      const t0 = Date.now();
      const r = await tool(name, { sessionId, ...args });
      const ms = Date.now() - t0;
      await delay(30);
      const after = readTrace(traceFile).slice(before).filter((e) => e.kind !== 'process-start');
      const t = text(r);
      rec({
        case: `M-zero-cdp ${name} ${JSON.stringify(args).slice(0, 80)}`,
        ms,
        isError: r.isError,
        cdpOrNet: after.map((e) => e.method ?? e.kind),
        text: t.slice(0, 200),
        pass: r.isError === true && after.length === 0 && /Playwright-style/.test(t) && /click_by_text/.test(t) && !t.includes('\nHint:') && ms < 200,
      });
    }
    // fill_form per-field
    {
      const before = readTrace(traceFile).length;
      const r = await tool('browser.fill_form', { sessionId, fields: { 'text=Name': 'x', '#plain-btn': 'y' } });
      const after = readTrace(traceFile).slice(before);
      const parsed = JSON.parse(text(r));
      rec({
        case: 'M-fill_form per-field: Playwright field fails with hint, other field still dispatched',
        pw: parsed['text=Name'],
        other: parsed['#plain-btn']?.success,
        cdpForOtherField: after.length,
        pass: parsed['text=Name']?.success === false && /Playwright-style/.test(parsed['text=Name']?.error ?? '') && after.length > 0,
      });
    }
    // Valid control through the same traced child — proves the tracer really sees this process's CDP.
    {
      const before = readTrace(traceFile).length;
      const r = JSON.parse(text(await tool('browser.click', { sessionId, target: '#plain-btn' })));
      const after = readTrace(traceFile).slice(before).filter((e) => e.kind === 'cdp-send');
      const last = await page.evaluate(() => window.__a.clicks.slice(-1)[0]);
      rec({ case: 'M-control-valid-click-is-traced', success: r.success, cdpSends: after.length, last, pass: r.success && after.length > 0 && last === 'plain-btn' });
    }
    // Invalid CSS: exactly the probe
    {
      const before = readTrace(traceFile).length;
      const t0 = Date.now();
      const r = JSON.parse(text(await tool('browser.click', { sessionId, target: 'button[' })));
      const ms = Date.now() - t0;
      const after = readTrace(traceFile).slice(before).filter((e) => e.kind === 'cdp-send');
      rec({
        case: 'M-invalid-css-single-probe',
        ms,
        retriesUsed: r.retriesUsed,
        sends: after.map((e) => `${e.method}(${(e.fn ?? '').slice(0, 30)})`),
        err: r.error?.slice(0, 160),
        pass: r.success === false && r.retriesUsed === 0 && after.length === 1 && /selectorSyntaxProbeInPage/.test(after[0].fn ?? '') && ms < 1000,
      });
    }
    await tool('browser.shutdown', { sessionId }).catch(() => {});
  } finally {
    child.stdin.end();
    child.kill();
    await observer.close().catch(() => {});
  }
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────
async function runCli() {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fr2-06-audit1-cli-state-'));
  cleanup.push(stateDir);
  const cliPath = path.join(repoRoot, 'packages', 'cli', 'dist', 'cli.js');
  let n = 0;
  const cli = (args) =>
    new Promise((resolve) => {
      const traceFile = path.join(traceDir, `cli-${++n}.jsonl`);
      const t0 = Date.now();
      execFile(
        process.execPath,
        ['--import', PRELOAD, cliPath, ...args],
        { env: { ...process.env, SUTRADHAR_CLI_STATE_DIR: stateDir, AUDIT_TRACE_FILE: traceFile, AUDIT_REPO_ROOT: repoRoot }, timeout: 60000 },
        (err, stdout, stderr) =>
          resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr, ms: Date.now() - t0, trace: readTrace(traceFile) }),
      );
    });
  const stateFile = path.join(stateDir, 'state.json');
  const snap = () => {
    if (!fss.existsSync(stateFile)) return { exists: false, dirEntries: fss.readdirSync(stateDir) };
    const buf = fss.readFileSync(stateFile);
    return { exists: true, sha: crypto.createHash('sha256').update(buf).digest('hex'), mtimeMs: fss.statSync(stateFile).mtimeMs, dirEntries: fss.readdirSync(stateDir) };
  };
  const alive = (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  const suspicious = (trace) => trace.filter((e) => e.kind !== 'process-start');

  // C0: no session yet — a Playwright selector must not spawn Chrome / connect / write state.
  {
    const before = snap();
    const r = await cli(['click', 'text=Submit']);
    const after = snap();
    rec({
      case: 'C0-cli-no-session-playwright-click: exit 1, zero spawn/connect/cdp, state dir untouched',
      code: r.code,
      ms: r.ms,
      trace: suspicious(r.trace),
      before,
      after,
      stderr: r.stderr.slice(0, 160),
      pass: r.code === 1 && suspicious(r.trace).length === 0 && JSON.stringify(before) === JSON.stringify(after) && /Playwright-style/.test(r.stderr) && /clickrole/.test(r.stderr),
    });
    // Tracer sanity: the process-start line proves the preload ran in that child.
    rec({ case: 'C0b-tracer-loaded-in-cli-child', starts: r.trace.filter((e) => e.kind === 'process-start').length, pass: r.trace.some((e) => e.kind === 'process-start') });
  }
  // C1: real session
  const nav = await cli(['nav', `${FIXTURE_URL}?t=${Date.now()}`]);
  const navTraceSpawns = nav.trace.filter((e) => e.kind === 'child-process').length;
  const navCdp = nav.trace.filter((e) => e.kind === 'cdp-send').length;
  rec({ case: 'C1-cli-nav-creates-session (tracer control: sees spawns + CDP)', code: nav.code, navTraceSpawns, navCdp, pass: nav.code === 0 && navCdp > 0 });
  const state0 = snap();
  const stateJson = JSON.parse(fss.readFileSync(stateFile, 'utf8'));
  const chromePid = stateJson.chromePid;
  const tmpUpload = path.join(here, 'fixture-audit.html');
  const cmds = [
    ['click', 'text=Submit'],
    ['type', 'role=textbox', 'hi'],
    ['press', 'button >> text=OK', 'Enter'],
    ['select', 'div:has-text("x")', 'v'],
    ['wait', "getByRole('button')"],
    ['eval', '1', '--frame', 'iframe#f::role=frame'],
    ['eval', '1', '--frame', 'internal:role=frame'],
    ['hover', 'internal:has-text="x"'],
    ['scroll', 'down', '100', 'xpath=//div'],
    ['upload', '#12', tmpUpload],
    ['drag', 'aria=Go', '#plain-btn'],
    ['drag', '#plain-btn', '//div'],
    ['download', 'css=a'],
  ];
  for (const args of cmds) {
    const r = await cli(args);
    const s = snap();
    rec({
      case: `C2-cli-existing-session ${args.join(' ')}: exit 1, zero connect/cdp, state unchanged, chrome alive`,
      code: r.code,
      ms: r.ms,
      trace: suspicious(r.trace),
      stateUnchanged: s.sha === state0.sha && s.mtimeMs === state0.mtimeMs,
      chromeAlive: alive(chromePid),
      stderr: r.stderr.slice(0, 140),
      pass:
        r.code === 1 &&
        suspicious(r.trace).length === 0 &&
        s.sha === state0.sha &&
        s.mtimeMs === state0.mtimeMs &&
        alive(chromePid) &&
        /Playwright-style/.test(r.stderr),
    });
  }
  // C3: same session still works
  {
    const r = await cli(['click', '#plain-btn']);
    const e = await cli(['eval', 'window.__a.clicks.slice(-1)[0]']);
    const s = snap();
    rec({ case: 'C3-cli-same-session-still-works-after-rejections', clickCode: r.code, evalOut: e.stdout.trim(), sameChromePid: JSON.parse(fss.readFileSync(stateFile, 'utf8')).chromePid === chromePid, sameSha: s.sha === state0.sha, pass: r.code === 0 && /plain-btn/.test(e.stdout) });
  }
  // C4: invalid CSS through the CLI (needs the session) — exits 1 with parser text, no backoff
  {
    const r = await cli(['click', 'div[']);
    rec({ case: 'C4-cli-invalid-css', code: r.code, ms: r.ms, out: (r.stdout + r.stderr).slice(0, 200), pass: r.code === 1 && /Invalid selector "div\["/.test(r.stdout + r.stderr) });
  }
  const close = await cli(['close']);
  await delay(1500);
  rec({ case: 'C5-cli-close', code: close.code, chromeAliveAfterClose: alive(chromePid), pass: close.code === 0 && !alive(chromePid) });
  return { stateDir, chromePid, userDataDir: stateJson.userDataDir };
}

let cliInfo;
try {
  await runMcp();
  cliInfo = await runCli();
} catch (e) {
  console.error('HARNESS ERROR', e);
  ok = false;
  cases.push({ case: 'harness-error', error: String(e?.stack ?? e), pass: false });
}
for (const d of cleanup) {
  for (let i = 0; i < 6; i++) {
    try {
      await fs.rm(d, { recursive: true, force: true });
      break;
    } catch {
      await delay(500);
    }
  }
}
await fs.writeFile(path.join(here, 'audit-mcp-cli-cases.json'), JSON.stringify({ ok, cleanup, cliInfo, cases }, null, 2));
console.log('overall', ok, JSON.stringify({ cleanup, cliInfo }));
process.exit(0);
