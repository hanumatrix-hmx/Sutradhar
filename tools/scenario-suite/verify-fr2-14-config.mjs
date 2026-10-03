// Live-verify for FR2-14 (.sutradhar.json project config). Real Chrome, real temp directories with
// real .sutradhar.json files, driven through the BUILT artifacts only:
//   cli    packages/cli/dist/cli.js                  (one process per command)
//   mcp    packages/mcp-server/dist/cli.js           (stdio JSON-RPC)
//   sdk    packages/sutradhar/dist/index.js          (through fr2-14-sdk-probe.mjs children)
//   bundle packages/sutradhar/dist/cli-bin.js, mcp-cli.js
// Independent observers (never the product's own parser): the fixture server's request log and the
// values the PAGE itself reports (its innerWidth, confirm() result, uploaded file), the served
// sha256 + a realpath check on disk for downloads, a puppeteer-core connection to the session's
// Chrome for the page URL, and OS process listings for "Chrome is really gone".
//
// Run (after a forced build):  node tools/scenario-suite/verify-fr2-14-config.mjs [--surface=cli,mcp,sdk,bundle] [--only=L1,L2]
// Outputs: <evidence>/live-cases.jsonl (every command), live-summary.json. Exit 1 on any failure.
import fs from 'node:fs/promises';
import { existsSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { startConfigServer } from './fixtures/fr2-14-config-server.mjs';
import { buildTree } from './fixtures/fr2-14-config-tree.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..');
const EVIDENCE_DIR =
  process.env.SUTRADHAR_FR2_14_EVIDENCE_DIR ?? path.join(repoRoot, '.ai', 'loop', 'field-report-2', 'evidence', 'FR2-14', 'run-1');
const argv = process.argv.slice(2);
const SURFACES = (argv.find((a) => a.startsWith('--surface=')) ?? '--surface=cli,mcp,sdk,bundle').slice(10).split(',');
const ONLY = (argv.find((a) => a.startsWith('--only=')) ?? '').slice(7).split(',').filter(Boolean);
const wanted = (id) => ONLY.length === 0 || ONLY.includes(id);
const require_ = createRequire(path.join(repoRoot, 'packages', 'browser', 'package.json'));
const puppeteer = require_('puppeteer-core');

const CLI = path.join(repoRoot, 'packages', 'cli', 'dist', 'cli.js');
const MCP = path.join(repoRoot, 'packages', 'mcp-server', 'dist', 'cli.js');
const BUNDLE_CLI = path.join(repoRoot, 'packages', 'sutradhar', 'dist', 'cli-bin.js');
const BUNDLE_MCP = path.join(repoRoot, 'packages', 'sutradhar', 'dist', 'mcp-cli.js');
const SDK_INDEX = path.join(repoRoot, 'packages', 'sutradhar', 'dist', 'index.js');
const PROBE = path.join(here, 'fixtures', 'fr2-14-sdk-probe.mjs');

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => performance.now(); // monotonic: never mixed with Date.now()

// ───────────────────────────── recording ─────────────────────────────
const results = [];
await fs.mkdir(EVIDENCE_DIR, { recursive: true });
const casesFile = path.join(EVIDENCE_DIR, 'live-cases.jsonl');
await fs.writeFile(casesFile, '');
function record(surface, id, pass, observed) {
  const entry = { surface, id, pass: !!pass, observed: String(observed ?? '').slice(0, 400) };
  results.push(entry);
  console.log(`[${entry.pass ? 'PASS' : 'FAIL'}] ${surface}/${id}${entry.observed ? ' - ' + entry.observed.slice(0, 200) : ''}`);
}
async function logCase(c) {
  await fs.appendFile(casesFile, JSON.stringify(c) + '\n');
}

// ───────────────────────────── processes ─────────────────────────────
const spawned = new Set();
function track(cp) {
  spawned.add(cp);
  cp.on('exit', () => spawned.delete(cp));
  return cp;
}
async function killTracked() {
  for (const cp of [...spawned]) {
    if (!cp.pid || cp.exitCode !== null) continue;
    const exited = new Promise((r) => cp.once('exit', r));
    try { process.kill(cp.pid); } catch { continue; }
    const timedOut = await Promise.race([exited.then(() => false), delay(3000).then(() => true)]);
    if (timedOut && process.platform === 'win32') {
      try { execFileSync('taskkill', ['/PID', String(cp.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ }
    }
  }
}
function listProcs(needle) {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('powershell', ['-NoProfile', '-Command', 'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId)`t$($_.CommandLine)" }'], { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
      return out.split('\n').filter((l) => l.toLowerCase().includes(needle.toLowerCase()));
    }
    return execFileSync('ps', ['-eo', 'pid,args'], { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 }).split('\n').filter((l) => l.includes(needle));
  } catch { return []; }
}
async function rmRetry(dir) {
  for (let i = 0; i < 15; i++) {
    try { await fs.rm(dir, { recursive: true, force: true }); return true; } catch { await delay(400); }
  }
  return false;
}

// ───────────────────────────── environment ─────────────────────────────
let R; // temp root (realpath)
let T; // named tree paths
let server;
let baseEnv;
const ENV_STRIP = ['SUTRADHAR_CONFIG', 'SUTRADHAR_ALLOWED_DOMAINS', 'SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS', 'SUTRADHAR_ALLOWED_UPLOAD_ROOTS', 'SUTRADHAR_IDLE_TIMEOUT_MS', 'SUTRADHAR_CLI_STATE_DIR'];

/** One CLI command. `key` names the session (its own state dir under R/state), so the observer can find its Chrome. */
const stateDirs = new Map();
async function cli(key, cwd, args, envDelta = {}, bin = CLI, surface = 'cli') {
  const stateDir = path.join(R, 'state', key);
  stateDirs.set(key, { cwd, env: envDelta, bin });
  const env = { ...baseEnv, SUTRADHAR_CLI_STATE_DIR: stateDir, ...envDelta };
  for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];
  const t0 = now();
  const res = await new Promise((resolve) => {
    const cp = track(spawn(process.execPath, [bin, ...args], { env, cwd }));
    let stdout = '', stderr = '';
    cp.stdout.on('data', (d) => (stdout += d.toString('utf8')));
    cp.stderr.on('data', (d) => (stderr += d.toString('utf8')));
    cp.on('close', (code) => resolve({ code, stdout, stderr }));
  });
  res.ms = Math.round(now() - t0);
  await logCase({ surface, key, argv: args.map((a) => a.replace(R, '<R>')), cwd: cwd.replace(R, '<R>'), envDelta: Object.keys(envDelta).map((k) => `${k}=${String(envDelta[k]).replace(R, '<R>')}`), code: res.code, ms: res.ms, stdout: res.stdout.slice(0, 700).replace(R, '<R>'), stderr: res.stderr.slice(0, 700).replace(R, '<R>') });
  return res;
}
async function closeKey(key) {
  const k = stateDirs.get(key);
  if (!k) return;
  await cli(key, k.cwd, ['close'], k.env, k.bin);
}
/** Independent observer: attach puppeteer-core to the session's Chrome (ws endpoint from the CLI's state file). */
async function observe(key, fn) {
  const state = JSON.parse(await fs.readFile(path.join(R, 'state', key, 'state.json'), 'utf-8'));
  const browser = await puppeteer.connect({ browserWSEndpoint: state.wsEndpoint, defaultViewport: null });
  try {
    const pages = await browser.pages();
    return await fn(pages.find((p) => p.url().startsWith('http')) ?? pages.at(-1), pages);
  } finally {
    await browser.disconnect();
  }
}
const readState = async (key) => JSON.parse(await fs.readFile(path.join(R, 'state', key, 'state.json'), 'utf-8'));
const stateExists = (key) => existsSync(path.join(R, 'state', key, 'state.json'));
async function waitHit(pred, ms = 8000) {
  const t0 = now();
  while (now() - t0 < ms) {
    const h = server.hits.find(pred);
    if (h) return h;
    await delay(100);
  }
  return undefined;
}
const hit = (n, field) => server.hits.find((h) => h.n === n && h.path === '/hit' && field in h.q);
const pageHit = (n) => server.hits.find((h) => h.n === n && h.path === '/page');
const U = (host, n) => server.url(host, n);
const NOTE_DL = (cfgPath) => `Note: using downloadDir/allowedDownloadRoots from project config ${cfgPath}`;
function lastServed(n) {
  for (let i = server.served.length - 1; i >= 0; i--) if (server.served[i].n === n) return server.served[i];
  return undefined;
}
/** Independent download check: sha256 + size vs the server's own record, and the file really lives inside `dir` (realpath). */
async function dlCheck(file, n, dir) {
  const s = lastServed(n);
  if (!s) return 'server never served this case';
  try {
    const buf = await fs.readFile(file);
    if (buf.length !== s.size) return `size ${buf.length} != served ${s.size}`;
    if (crypto.createHash('sha256').update(buf).digest('hex') !== s.sha256) return 'sha256 mismatch';
    const a = realpathSync.native(file), b = realpathSync.native(dir);
    const [x, y] = process.platform === 'win32' ? [a.toLowerCase(), b.toLowerCase()] : [a, b];
    if (!(x === y || x.startsWith(y + path.sep))) return `${a} not inside ${b}`;
    return '';
  } catch (e) {
    return `check error: ${e.message}`;
  }
}
const downloadedPath = (r) => r.stdout.match(/^Downloaded ".+" to (.+)$/m)?.[1]?.trim();

// ───────────────────────────── MCP client ─────────────────────────────
function mcpClient(bin, cwd, envDelta = {}) {
  const env = { ...baseEnv, ...envDelta };
  for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];
  const child = track(spawn(process.execPath, [bin], { stdio: ['pipe', 'pipe', 'pipe'], env, cwd }));
  let buf = '', nextId = 1;
  const pending = new Map();
  const stderr = [];
  let exited = false, exitCode = null;
  child.on('exit', (c) => { exited = true; exitCode = c; for (const { reject } of pending.values()) reject(new Error('mcp process exited')); pending.clear(); });
  child.stdout.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg.id !== undefined && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      }
    }
  });
  child.stderr.on('data', (d) => stderr.push(d.toString('utf8')));
  const call = (method, params, ms = 60000) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout ${method}`)); } }, ms);
  });
  const api = {
    child, stderr, get exited() { return exited; }, get exitCode() { return exitCode; },
    stderrText: () => stderr.join(''),
    async init() {
      await call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'fr2-14-verify', version: '0' } });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n');
    },
    async tool(name, args) {
      const r = await call('tools/call', { name, arguments: args });
      const text = r.content?.[0]?.text ?? '';
      let json; try { json = JSON.parse(text); } catch { json = undefined; }
      return { isError: !!r.isError, text, json };
    },
    async waitExit(ms) {
      const t0 = now();
      while (!exited && now() - t0 < ms) await delay(100);
      return exited;
    },
    async stop() {
      try { child.stdin.end(); } catch { /* closed */ }
      await Promise.race([new Promise((r) => child.once('exit', r)), delay(8000)]);
      if (!exited) { try { child.kill(); } catch { /* gone */ } }
    },
  };
  return api;
}
const sleepUntil = async (pred, ms, every = 250) => {
  const t0 = now();
  while (now() - t0 < ms) { if (await pred()) return true; await delay(every); }
  return false;
};

// ───────────────────────────── CLI suite ─────────────────────────────
async function cliSuite(bin, surface, full) {
  const run = (id, fn) => (wanted(id) ? fn(id).catch((e) => record(surface, id, false, `threw: ${e.stack ?? e.message}`)) : undefined);
  const k = (s) => `${surface}-${s}`;
  const cfg = T.projCfg;

  // L0 preflight: dual-stack fixture works, default layer = no restriction, doctor on a git root with no config.
  await run('L0', async (id) => {
    const a = await cli(k('l0'), T.proj0, ['nav', U('localhost', `${surface}-L0a`)], {}, bin, surface);
    const b = await cli(k('l0'), T.proj0, ['nav', U('127.0.0.1', `${surface}-L0b`)], {}, bin, surface);
    const d = await cli(k('l0'), T.proj0, ['doctor'], {}, bin, surface);
    const want = `Config:          none (searched 1 directories upward from ${T.proj0}; stopped at git root ${T.proj0})`;
    const baseH = await waitHit((x) => x.n === `${surface}-L0a` && 'w' in x.q);
    const baseW = baseH?.q.w;
    baseline.width = baseW;
    record(surface, id, a.code === 0 && b.code === 0 && d.code === 0 && d.stdout.includes(want) && !!pageHit(`${surface}-L0a`) && !!pageHit(`${surface}-L0b`),
      `nav=${a.code}/${b.code} doctor=${d.code} baselineWidth=${baseW} ${d.stdout.split('\n').find((l) => l.startsWith('Config'))}`);
    await closeKey(k('l0'));
  });

  // L1 (Done-when): a live CLI run from a CHILD directory picks up the config from a PARENT directory.
  await run('L1', async (id) => {
    const d = await cli(k('l1'), T.cwdC, ['doctor'], {}, bin, surface);
    const lines = d.stdout.split('\n');
    const ok = d.code === 0
      && lines.includes(`Config:          ${cfg} (discovered)`)
      && lines.some((l) => l.startsWith('Config warning:') && l.includes('unknown key "allowedDomian"') && l.includes('did you mean "allowedDomains"'))
      && lines.includes('Config sources:  allowedDomains=config, downloadRoots=config, uploadRoots=config, dialog=config, viewport=config');
    record(surface, id, ok, `exit=${d.code} ms=${d.ms} ${lines.filter((l) => l.startsWith('Config')).join(' | ')}`);
  });

  // L2/L3: the config's allowedDomains is ENFORCED end to end (server never sees the blocked request).
  await run('L2', async (id) => {
    const r = await cli(k('l23'), T.cwdC, ['nav', U('127.0.0.1', `${surface}-L2`)], {}, bin, surface);
    const url = await observe(k('l23'), (p) => p.url());
    const ok = r.code === 1 && r.stderr.includes('allowedDomains is configured') && r.stderr.includes('(localhost)')
      && r.stderr.includes(`Warning: ${cfg}: unknown key "allowedDomian"`) && !url.startsWith('http') && !pageHit(`${surface}-L2`);
    record(surface, id, ok, `exit=${r.code} observerUrl=${url} serverSawIt=${!!pageHit(`${surface}-L2`)} ${r.stderr.split('\n')[0].slice(0, 120)}`);
  });
  await run('L3', async (id) => {
    const r = await cli(k('l23'), T.cwdC, ['nav', U('localhost', `${surface}-L3`)], {}, bin, surface);
    record(surface, id, r.code === 0 && !!pageHit(`${surface}-L3`), `exit=${r.code}`);
  });
  // L6: config viewport, observed by the PAGE's own report and a puppeteer observer.
  await run('L6', async (id) => {
    const r = await cli(k('l23'), T.cwdC, ['eval', "innerWidth+'x'+innerHeight"], {}, bin, surface);
    // The viewport override is per CDP client, so a SECOND client (puppeteer) cannot see it: the independent
    // observer is the PAGE ITSELF reporting its innerWidth/innerHeight to the fixture server at load.
    const h = await waitHit((x) => x.n === `${surface}-L3` && 'w' in x.q);
    record(surface, id, r.stdout.includes('700x500') && h?.q.w === '700' && h?.q.h === '500',
      `cliEval=${r.stdout.trim().slice(0, 30)} pageReported=${h?.q.w}x${h?.q.h} (browser default ${baseline.width})`);
  });
  // L9: downloadDir is relative to the CONFIG FILE, not the cwd; trust notice printed.
  await run('L9', async (id) => {
    const key = k('l9');
    await cli(key, T.cwdC, ['nav', U('localhost', `${surface}-L9`)], {}, bin, surface);
    const r = await cli(key, T.cwdC, ['download', '#dl'], {}, bin, surface);
    const p = downloadedPath(r);
    const bad = p ? await dlCheck(p, `${surface}-L9`, path.join(T.proj, 'dl')) : 'no path';
    const ok = r.code === 0 && !bad && !existsSync(path.join(T.cwdC, 'dl')) && r.stderr.includes(NOTE_DL(cfg));
    record(surface, id, ok, `exit=${r.code} path=${p} check=${bad || 'ok'} cwdDlExists=${existsSync(path.join(T.cwdC, 'dl'))} note=${r.stderr.includes(NOTE_DL(cfg))}`);
    await closeKey(key);
  });
  if (!full) { await closeKey(k('l23')); return; }

  // L4: env > config.
  await run('L4', async (id) => {
    const env = { SUTRADHAR_ALLOWED_DOMAINS: '127.0.0.1' };
    const a = await cli(k('l4'), T.cwdC, ['nav', U('127.0.0.1', 'L4a')], env, bin, surface);
    const b = await cli(k('l4'), T.cwdC, ['nav', U('localhost', 'L4b')], env, bin, surface);
    record(surface, id, a.code === 0 && b.code === 1 && b.stderr.includes('(127.0.0.1)') && !pageHit('L4b'), `a=${a.code} b=${b.code}`);
    await closeKey(k('l4'));
  });
  // L5: flag > env > config, all three present at once (pairwise AND triple).
  await run('L5', async (id) => {
    const env = { SUTRADHAR_ALLOWED_DOMAINS: '127.0.0.1' };
    const a = await cli(k('l5'), T.cwdC, ['nav', U('localhost', 'L5a'), '--allowlist-domains', 'localhost'], env, bin, surface);
    const b = await cli(k('l5'), T.cwdC, ['nav', U('127.0.0.1', 'L5b'), '--allowlist-domains', 'localhost'], env, bin, surface);
    record(surface, id, a.code === 0 && b.code === 1 && b.stderr.includes('(localhost)') && !pageHit('L5b'), `a=${a.code} b=${b.code}`);
    await closeKey(k('l5'));
  });
  // L5m: GENERATED live matrix: every subset of {flag, env, config} for allowedDomains. Each layer carries a
  // distinct, unreachable domain; the runtime's own error lists the allowlist it enforces, naming the winner.
  await run('L5m', async (id) => {
    const key = k('l5m');
    const bad = [];
    for (let mask = 0; mask < 8; mask++) {
      const dir = path.join(R, 'm5', String(mask));
      await fs.mkdir(path.join(dir, '.git'), { recursive: true });
      if (mask & 4) await fs.writeFile(path.join(dir, '.sutradhar.json'), JSON.stringify({ allowedDomains: ['config.example'] }));
      const env = mask & 2 ? { SUTRADHAR_ALLOWED_DOMAINS: 'env.example' } : {};
      const args = ['nav', U('localhost', `L5m${mask}`), ...(mask & 1 ? ['--allowlist-domains', 'flag.example'] : [])];
      const r = await cli(`${key}${mask}`, dir, args, env, bin, surface);
      const winner = mask & 1 ? 'flag.example' : mask & 2 ? 'env.example' : mask & 4 ? 'config.example' : undefined;
      const ok = winner ? r.code === 1 && r.stderr.includes(`(${winner})`) && !pageHit(`L5m${mask}`) : r.code === 0 && !!pageHit(`L5m${mask}`);
      if (!ok) bad.push(`mask${mask}(want ${winner ?? 'open'}): exit=${r.code} ${r.stderr.slice(0, 100)}`);
      await closeKey(`${key}${mask}`);
    }
    record(surface, id, bad.length === 0, bad.join(' ; ') || '8/8 subsets');
  });
  // L7: flag > config for viewport, and the flag sticks (config edits still apply when no flag).
  await run('L7', async (id) => {
    const key = k('l7');
    await cli(key, T.cwdC, ['nav', U('localhost', 'L7'), '--viewport', '390x844'], {}, bin, surface);
    const a = await cli(key, T.cwdC, ['eval', "innerWidth+'x'+innerHeight"], {}, bin, surface);
    await cli(key, T.cwdC, ['nav', U('localhost', 'L7b')], {}, bin, surface); // NO flag: the sticky flag still beats the config
    const h1 = await waitHit((x) => x.n === 'L7' && 'w' in x.q);
    const h2 = await waitHit((x) => x.n === 'L7b' && 'w' in x.q);
    record(surface, id, a.stdout.includes('390x844') && h1?.q.w === '390' && h1?.q.h === '844' && h2?.q.w === '390' && h2?.q.h === '844',
      `eval=${a.stdout.trim()} pageReported(flag)=${h1?.q.w}x${h1?.q.h} pageReported(sticky,no flag)=${h2?.q.w}x${h2?.q.h}`);
    await closeKey(key);
  });
  // L7m: GENERATED live matrix for viewport: every subset of {flag now, sticky flag (state), config}.
  await run('L7m', async (id) => {
    const bad = [];
    for (let mask = 0; mask < 8; mask++) {
      const key = k(`l7m${mask}`);
      const dir = path.join(R, 'm7', String(mask));
      await fs.mkdir(path.join(dir, '.git'), { recursive: true });
      if (mask & 4) await fs.writeFile(path.join(dir, '.sutradhar.json'), JSON.stringify({ viewport: { width: 700, height: 500 } }));
      if (mask & 2) await cli(key, dir, ['nav', U('localhost', `L7m${mask}s`), '--viewport', '300x400'], {}, bin, surface); // earlier flag -> sticky
      const a = await cli(key, dir, ['nav', U('localhost', `L7m${mask}`), ...(mask & 1 ? ['--viewport', '200x250'] : [])], {}, bin, surface);
      const rep = await waitHit((x) => x.n === `L7m${mask}` && 'w' in x.q);
      const got = `${rep?.q.w}x${rep?.q.h}`;
      const want = mask & 1 ? '200x250' : mask & 2 ? '300x400' : mask & 4 ? '700x500' : undefined;
      const ok = want ? got === want : !['200x250', '300x400', '700x500'].includes(got);
      if (!ok || a.code !== 0) bad.push(`mask${mask}: got ${got} want ${want ?? 'chrome default'} exit=${a.code}`);
      await closeKey(key);
    }
    record(surface, id, bad.length === 0, bad.join(' ; ') || '8/8 subsets');
  });
  // L8: the config is re-read on every command (a config edit applies with no flag; nothing is cached in state).
  await run('L8', async (id) => {
    const key = k('l8');
    const dir = path.join(R, 'm8');
    await fs.mkdir(path.join(dir, '.git'), { recursive: true });
    const file = path.join(dir, '.sutradhar.json');
    await fs.writeFile(file, JSON.stringify({ viewport: { width: 800, height: 600 } }));
    await cli(key, dir, ['nav', U('localhost', 'L8')], {}, bin, surface);
    const a = await cli(key, dir, ['eval', "innerWidth+'x'+innerHeight"], {}, bin, surface);
    await fs.writeFile(file, JSON.stringify({ viewport: { width: 820, height: 620 } }));
    const b = await cli(key, dir, ['eval', "innerWidth+'x'+innerHeight"], {}, bin, surface);
    await cli(key, dir, ['nav', U('localhost', 'L8b')], {}, bin, surface);
    const h = await waitHit((x) => x.n === 'L8b' && 'w' in x.q);
    const st = await readState(key);
    record(surface, id, a.stdout.includes('800x600') && b.stdout.includes('820x620') && h?.q.w === '820' && h?.q.h === '620' && st.viewport === undefined,
      `a=${a.stdout.trim()} b=${b.stdout.trim()} pageReported=${h?.q.w}x${h?.q.h} stateViewport=${JSON.stringify(st.viewport)}`);
    await closeKey(key);
  });
  // L10: env > config for download roots; L11: the per-command grant is relative to the cwd.
  await run('L10', async (id) => {
    const key = k('l10');
    const envdl = path.join(R, 'envdl');
    await cli(key, T.cwdC, ['nav', U('localhost', 'L10')], {}, bin, surface);
    const r = await cli(key, T.cwdC, ['download', '#dl'], { SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS: envdl }, bin, surface);
    const p = downloadedPath(r);
    const bad = p ? await dlCheck(p, 'L10', envdl) : 'no path';
    record(surface, id, r.code === 0 && !bad && !r.stderr.includes('Note: using downloadDir'), `exit=${r.code} check=${bad || 'ok'} noNote=${!r.stderr.includes('Note: using downloadDir')}`);
    await delay(1100);
    await cli(key, T.cwdC, ['nav', U('localhost', 'L11')], {}, bin, surface);
    const g = await cli(key, T.cwdC, ['download', '#dl', './here'], {}, bin, surface);
    const gp = downloadedPath(g);
    const gbad = gp ? await dlCheck(gp, 'L11', path.join(T.cwdC, 'here')) : 'no path';
    record(surface, 'L11', g.code === 0 && !gbad, `exit=${g.code} check=${gbad || 'ok'}`);
    await closeKey(key);
  });
  // L12: upload roots from config, env over config; the page reports the file it really received.
  await run('L12', async (id) => {
    const key = k('l12');
    await cli(key, T.cwdC, ['nav', U('localhost', 'L12')], {}, bin, surface);
    const a = await cli(key, T.cwdC, ['upload', '#f', T.elsewhereX], {}, bin, surface);
    const b = await cli(key, T.cwdC, ['upload', '#f', T.upOk], {}, bin, surface);
    const up = await waitHit((h) => h.n === 'L12' && h.q.up?.startsWith('ok.txt:'));
    const c = await cli(key, T.cwdC, ['upload', '#f', T.elsewhereX], { SUTRADHAR_ALLOWED_UPLOAD_ROOTS: path.dirname(T.elsewhereX) }, bin, surface);
    const up2 = await waitHit((h) => h.n === 'L12' && h.q.up?.startsWith('x.txt:'));
    record(surface, id, a.code === 1 && /outside the allowed upload directories/.test(a.stdout + a.stderr) && b.code === 0 && up?.q.up === 'ok.txt:10' && c.code === 0 && !!up2,
      `a=${a.code} b=${b.code} pageGot=${up?.q.up} envOverride=${c.code}/${up2?.q.up}`);
    await closeKey(key);
  });
  // L13/L14/L15: dialog.
  await run('L13', async (id) => {
    const key = k('l13');
    await cli(key, T.cwdC, ['nav', U('localhost', 'L13')], {}, bin, surface);
    const r = await cli(key, T.cwdC, ['click', '#confirm'], {}, bin, surface);
    const h = await waitHit((x) => x.n === 'L13' && 'confirm' in x.q);
    record(surface, id, /dialogHandled: .*"action":"dismiss".*"by":"policy"/.test(r.stdout) && h?.q.confirm === 'false', `exit=${r.code} pageSawConfirm=${h?.q.confirm} ${r.stdout.split('\n').find((l) => l.startsWith('dialog'))?.slice(0, 120)}`);
    await closeKey(key);
  });
  await run('L14', async (id) => {
    const key = k('l14');
    await cli(key, T.cwdC, ['nav', U('localhost', 'L14')], {}, bin, surface);
    const a = await cli(key, T.cwdC, ['click', '#confirm', '--dialog', 'accept'], {}, bin, surface);
    const h1 = await waitHit((x) => x.n === 'L14' && x.q.confirm === 'true');
    const nBefore = server.hits.filter((x) => x.n === 'L14' && 'confirm' in x.q).length;
    await delay(1200);
    const b = await cli(key, T.cwdC, ['click', '#confirm'], {}, bin, surface);
    await waitHit((x) => x.n === 'L14' && 'confirm' in x.q && server.hits.filter((y) => y.n === 'L14' && 'confirm' in y.q).length > nBefore);
    const hits = server.hits.filter((x) => x.n === 'L14' && 'confirm' in x.q).map((x) => x.q.confirm);
    await cli(key, T.cwdC, ['snap', '--dialog', 'report'], {}, bin, surface);
    const stA = (await readState(key)).dialogPolicy?.action;
    await delay(1200);
    const c = await cli(key, T.cwdC, ['click', '#confirm'], {}, bin, surface);
    const pending = c.stdout.includes('dialogPending:');
    await cli(key, T.cwdC, ['dialog', 'dismiss'], {}, bin, surface);
    const final = await waitHit((x) => x.n === 'L14' && x.q.confirm === 'false');
    record(surface, id, !!h1 && /dialogHandled: .*"action":"accept"/.test(a.stdout) && hits.slice(0, 2).join() === 'true,true' && stA === 'report' && pending && !!final,
      `flagAccept->${hits[0]} stickyAccept->${hits[1]} stateAfterReport=${stA} pendingAfterReport=${pending} dismissed=${!!final} (config dismiss never applied)`);
    await closeKey(key);
  });
  await run('L15', async (id) => {
    const key = k('l15');
    const dir = path.join(R, 'auto');
    const n = await cli(key, dir, ['nav', U('localhost', 'L15')], {}, bin, surface);
    const c = await cli(key, dir, ['click', '#confirm'], {}, bin, surface);
    await cli(key, dir, ['dialog', 'dismiss'], {}, bin, surface);
    record(surface, id, n.stderr.includes('dialog.mode "auto" is not supported by the CLI') && c.stdout.includes('dialogPending:'), `warn=${n.stderr.includes('is not supported by the CLI')} pending=${c.stdout.includes('dialogPending:')}`);
    await closeKey(key);
  });
  // L16: a .git FILE (worktree form) is a boundary: the config above it is NOT applied (localhost would be blocked if it were).
  await run('L16', async (id) => {
    const d = await cli(k('l16'), T.outerRepoSub, ['doctor'], {}, bin, surface);
    const r = await cli(k('l16'), T.outerRepoSub, ['nav', U('localhost', 'L16')], {}, bin, surface);
    const want = `none (searched 2 directories upward from ${T.outerRepoSub}; stopped at git root ${path.dirname(T.outerRepoSub)})`;
    record(surface, id, d.stdout.includes(want) && r.code === 0 && !!pageHit('L16'), `doctor=${d.stdout.split('\n').find((l) => l.startsWith('Config:'))} nav=${r.code}`);
    await closeKey(k('l16'));
  });
  // L17/L18: the home directory is an inclusive boundary; nothing above it is ever read.
  await run('L17', async (id) => {
    const home = path.join(R, 'fakehome');
    const d = await cli(k('l17'), path.join(home, 'p', 'q'), ['doctor'], { USERPROFILE: home, HOME: home }, bin, surface);
    record(surface, id, d.stdout.includes(`Config:          ${path.join(home, '.sutradhar.json')} (discovered)`), d.stdout.split('\n').find((l) => l.startsWith('Config:')));
  });
  await run('L18', async (id) => {
    const home = path.join(R, 'nohome');
    const d = await cli(k('l18'), path.join(home, 'p', 'q'), ['doctor'], { USERPROFILE: home, HOME: home }, bin, surface);
    const line = d.stdout.split('\n').find((l) => l.startsWith('Config:')) ?? '';
    record(surface, id, line.includes('none (') && line.includes(`stopped at home ${home}`) && !d.stdout.includes(path.join(R, '.sutradhar.json')), line);
  });
  // L19/L20: SUTRADHAR_CONFIG=none disables; an explicit path loads that file instead.
  await run('L19', async (id) => {
    const env = { SUTRADHAR_CONFIG: 'none' };
    const d = await cli(k('l19'), T.cwdC, ['doctor'], env, bin, surface);
    const r = await cli(k('l19'), T.cwdC, ['nav', U('127.0.0.1', 'L19')], env, bin, surface);
    record(surface, id, d.stdout.includes('Config:          disabled (SUTRADHAR_CONFIG=none)') && r.code === 0 && !!pageHit('L19'), `nav=${r.code}`);
    await closeKey(k('l19'));
  });
  await run('L20', async (id) => {
    const env = { SUTRADHAR_CONFIG: T.outerCfg };
    const r = await cli(k('l20'), T.proj0, ['nav', U('localhost', 'L20')], env, bin, surface);
    const d = await cli(k('l20'), T.proj0, ['doctor'], env, bin, surface);
    record(surface, id, r.code === 1 && r.stderr.includes('(127.0.0.1)') && !pageHit('L20') && d.stdout.includes(`Config:          ${T.outerCfg} (SUTRADHAR_CONFIG)`), `nav=${r.code}`);
    await closeKey(k('l20'));
  });
  // L21: the NEAREST file wins (a closer config replaces, never merges with, a farther one).
  await run('L21', async (id) => {
    const dir = path.join(R, 'near', 'x', 'y');
    const a = await cli(k('l21'), dir, ['nav', U('127.0.0.1', 'L21a')], {}, bin, surface);
    const b = await cli(k('l21'), dir, ['nav', U('localhost', 'L21b')], {}, bin, surface);
    const d = await cli(k('l21'), dir, ['doctor'], {}, bin, surface);
    record(surface, id, a.code === 0 && b.code === 1 && b.stderr.includes('(127.0.0.1)') && !pageHit('L21b') && d.stdout.includes(`Config:          ${path.join(R, 'near', 'x', '.sutradhar.json')} (discovered)`),
      `nearest(127.0.0.1) a=${a.code} farther(localhost) b=${b.code}`);
    await closeKey(k('l21'));
  });
  await closeKey(k('l23'));
}
const baseline = { width: undefined };

// ───────────────────────────── negative / hostile cases (CLI) ─────────────────────────────
async function negativeSuite(surface) {
  const run = (id, fn) => (wanted(id) ? fn(id).catch((e) => record(surface, id, false, `threw: ${e.stack ?? e.message}`)) : undefined);
  const k = (s) => `${surface}-${s}`;
  const chromeProcs = () => listProcs(path.join(R, 'temp')).length;
  const cliDirs = async () => (await fs.readdir(path.join(R, 'temp')).catch(() => [])).filter((n) => n.startsWith('sutradhar-cli-'));
  const noChrome = async (key, before, beforeDirs) => !stateExists(key) && chromeProcs() === before && (await cliDirs()).length === beforeDirs;

  // N1/N2: an invalid file stops the command BEFORE any Chrome contact: no state file, no new profile dir, no new process.
  for (const [id, dirName, needles] of [
    ['N1', 'bad-empty', ['allowedDomains must list at least one domain; remove the key for no restriction']],
    ['N2', 'bad-json', ['is not valid JSON']],
    ['N11', 'bad-idle', ['idleTimeoutMs must be 0', 'between 1000 and 2147483647']],
    ['H6', 'bad-type', ['allowedDomains must be an array of strings']],
    ['H7', 'bad-domain', ['is not a bare domain', 'write "localhost"']],
    ['H8', 'bad-dup', ['duplicate key "allowedDomains"']],
    ['H9', 'bad-dir', ['is not a regular file']],
    ['H11', 'bad-big', ['larger than 64 KiB']],
    ['H12', 'bad-comment', ['comments are not allowed']],
  ]) {
    await run(id, async () => {
      const dir = path.join(R, dirName);
      const key = k(`neg-${dirName}`);
      const before = chromeProcs(), beforeDirs = (await cliDirs()).length;
      const r = await cli(key, dir, ['nav', U('localhost', `${id}-${surface}`)], {}, surface === 'bundle' ? BUNDLE_CLI : CLI, surface);
      const file = path.join(dir, '.sutradhar.json');
      const ok = r.code === 1 && r.stderr.includes('Error: ') && r.stderr.includes(file) && needles.every((n) => r.stderr.includes(n))
        && !pageHit(`${id}-${surface}`) && (await noChrome(key, before, beforeDirs));
      record(surface, id, ok, `exit=${r.code} noChrome=${await noChrome(key, before, beforeDirs)} ${r.stderr.split('\n')[0].slice(0, 160)}`);
    });
  }
  // N3: a broken file never blocks diagnostics or cleanup.
  await run('N3', async (id) => {
    const dir = path.join(R, 'bad-json');
    const d = await cli(k('n3'), dir, ['doctor'], {}, surface === 'bundle' ? BUNDLE_CLI : CLI, surface);
    const c = await cli(k('n3'), dir, ['close'], {}, surface === 'bundle' ? BUNDLE_CLI : CLI, surface);
    const p = await cli(k('n3'), dir, ['profile', 'list'], {}, surface === 'bundle' ? BUNDLE_CLI : CLI, surface);
    record(surface, id, d.code === 0 && d.stdout.includes('Config:          INVALID:') && d.stdout.includes('is not valid JSON') && c.code === 0 && p.code === 0, `doctor=${d.code} close=${c.code} profile=${p.code}`);
  });
  // N4/N6/H1/H3/H4: hostile download roots in a discovered config are refused; nothing is created outside.
  for (const [id, dirName, cwdSub, forbidden, needles] of [
    ['N4', 'escape', '', 'outside', ["outside this config's directory", 'SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS', 'SUTRADHAR_CONFIG=']],
    ['N6', 'hooks', '', path.join('hooks', '.git', 'hooks'), ['inside a .git directory']],
    ['H1', 'hp', 'child', 'outside-hp', ["outside this config's directory"]],
    ['H3', 'hp3', 'child', 'outside-hp3', ["outside this config's directory", 'allowedDownloadRoots[0]']],
    ['H4', 'hp4', 'child', path.join('hp4', '.git', 'x'), ['allowedDownloadRoots[1]', 'inside a .git directory']],
  ]) {
    await run(id, async () => {
      const dir = path.join(R, dirName, cwdSub);
      const key = k(`neg-${dirName}`);
      const before = chromeProcs();
      const r = await cli(key, dir, ['nav', U('localhost', `${id}-${surface}`)], {}, surface === 'bundle' ? BUNDLE_CLI : CLI, surface);
      const created = existsSync(path.join(R, forbidden));
      const ok = r.code === 1 && needles.every((n) => r.stderr.includes(n)) && !created && !pageHit(`${id}-${surface}`) && !stateExists(key) && chromeProcs() === before;
      record(surface, id, ok, `exit=${r.code} forbiddenPathCreated=${created} noSession=${!stateExists(key)} ${r.stderr.split('\n')[0].slice(0, 140)}`);
    });
  }
  // H4b (fix-1 F1, INVERTED from run-1, which asserted the bug): the hostile hp3 file is refused only when it is the layer that
  // would supply the download roots; with SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS set, the env var wins and the command works.
  await run('H4b', async () => {
    const dir = path.join(R, 'hp3', 'child');
    const bin = surface === 'bundle' ? BUNDLE_CLI : CLI;
    const envdl = path.join(R, 'envdl-h4b');
    const key = k('neg-hp3b');
    const env = { SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS: envdl };
    const a = await cli(key, dir, ['nav', U('localhost', `H4b-${surface}`), '--allowlist-domains', 'localhost'], env, bin, surface);
    const d = await cli(key, dir, ['download', '#dl', '--allowlist-domains', 'localhost'], env, bin, surface);
    const p = downloadedPath(d);
    const bad = p ? await dlCheck(p, `H4b-${surface}`, envdl) : 'no path';
    record(surface, 'H4b', a.code === 0 && !!pageHit(`H4b-${surface}`) && d.code === 0 && !bad && !existsSync(path.join(R, 'outside-hp3')) && !d.stderr.includes('Note: using downloadDir'),
      `nav=${a.code} download=${d.code} check=${bad || 'ok'} outsideCreated=${existsSync(path.join(R, 'outside-hp3'))}`);
    await closeKey(key);
  });
  // N5: the SAME hostile file, loaded EXPLICITLY, is trusted (like an env var) and works.
  await run('N5', async (id) => {
    const key = k('n5');
    const env = { SUTRADHAR_CONFIG: path.join(R, 'escape', '.sutradhar.json') };
    await cli(key, path.join(R, 'escape'), ['nav', U('localhost', `N5-${surface}`)], env, surface === 'bundle' ? BUNDLE_CLI : CLI, surface);
    const r = await cli(key, path.join(R, 'escape'), ['download', '#dl'], env, surface === 'bundle' ? BUNDLE_CLI : CLI, surface);
    const p = downloadedPath(r);
    const bad = p ? await dlCheck(p, `N5-${surface}`, path.join(R, 'outside')) : 'no path';
    record(surface, id, r.code === 0 && !bad, `exit=${r.code} check=${bad || 'ok'}`);
    await closeKey(key);
    await fs.rm(path.join(R, 'outside'), { recursive: true, force: true }); // so N4 (same escape, discovered) can prove it is NOT created
  });
  // H2: a hostile parent config that stays INSIDE its own tree works (downloads under the parent's tree, announced); its
  // dialog accept is honored but announced; a flag overrides it.
  await run('H2', async (id) => {
    const key = k('h2');
    const dir = path.join(R, 'hp2', 'child');
    const bin = surface === 'bundle' ? BUNDLE_CLI : CLI;
    const cfg2 = path.join(R, 'hp2', '.sutradhar.json');
    await cli(key, dir, ['nav', U('localhost', `H2-${surface}`)], {}, bin, surface);
    const dl = await cli(key, dir, ['download', '#dl'], {}, bin, surface);
    const p = downloadedPath(dl);
    const bad = p ? await dlCheck(p, `H2-${surface}`, path.join(R, 'hp2', 'dl')) : 'no path';
    const noteBoth = dl.stderr.includes(`Note: using downloadDir/allowedDownloadRoots, dialog.mode "accept" from project config ${cfg2}`);
    const click1 = await cli(key, dir, ['click', '#confirm'], {}, bin, surface); // config accept honored (+ announced)
    const h1 = await waitHit((x) => x.n === `H2-${surface}` && x.q.confirm === 'true');
    await delay(1200);
    const click2 = await cli(key, dir, ['click', '#confirm', '--dialog', 'dismiss'], {}, bin, surface); // flag beats the hostile accept
    const h2 = await waitHit((x) => x.n === `H2-${surface}` && x.q.confirm === 'false');
    record(surface, id, dl.code === 0 && !bad && !existsSync(path.join(dir, 'dl')) && noteBoth && click1.stderr.includes(`dialog.mode "accept" from project config ${cfg2}`) && !!h1 && !!h2,
      `download=${bad || 'ok'} noteBoth=${noteBoth} configAccept=${h1?.q.confirm} flagDismiss=${h2?.q.confirm}`);
    await closeKey(key);
  });
  // H5: --dialog report beats a hostile config accept (and sticks).
  await run('H5', async (id) => {
    const key = k('h5');
    const dir = path.join(R, 'hp2', 'child');
    const bin = surface === 'bundle' ? BUNDLE_CLI : CLI;
    await cli(key, dir, ['nav', U('localhost', `H5-${surface}`), '--dialog', 'report'], {}, bin, surface);
    const c = await cli(key, dir, ['click', '#confirm'], {}, bin, surface);
    const pending = c.stdout.includes('dialogPending:');
    await cli(key, dir, ['dialog', 'dismiss'], {}, bin, surface);
    record(surface, id, pending && !server.hits.some((x) => x.n === `H5-${surface}` && x.q.confirm === 'true'), `pending=${pending}`);
    await closeKey(key);
  });
  // N7/N8: SUTRADHAR_CONFIG problems.
  await run('N7', async (id) => {
    const r = await cli(k('n7'), T.proj0, ['doctor'], { SUTRADHAR_CONFIG: 'rel.json' }, surface === 'bundle' ? BUNDLE_CLI : CLI, surface);
    const n = await cli(k('n7'), T.proj0, ['nav', U('localhost', 'N7')], { SUTRADHAR_CONFIG: 'rel.json' }, surface === 'bundle' ? BUNDLE_CLI : CLI, surface);
    record(surface, id, n.code === 1 && n.stderr.includes('SUTRADHAR_CONFIG') && n.stderr.includes('absolute') && !pageHit('N7') && r.code === 0 && r.stdout.includes('INVALID'), `nav=${n.code} doctor=${r.code}`);
  });
  await run('N8', async (id) => {
    const n = await cli(k('n8'), T.proj0, ['nav', U('localhost', 'N8')], { SUTRADHAR_CONFIG: path.join(R, 'missing.json') }, surface === 'bundle' ? BUNDLE_CLI : CLI, surface);
    record(surface, id, n.code === 1 && n.stderr.includes('does not exist') && !pageHit('N8'), `nav=${n.code}`);
  });
  // N12: a __proto__ key is a warning only; nothing is blocked or polluted.
  await run('N12', async (id) => {
    const dir = path.join(R, 'proto');
    const r = await cli(k('n12'), dir, ['nav', U('localhost', `N12-${surface}`)], {}, surface === 'bundle' ? BUNDLE_CLI : CLI, surface);
    record(surface, id, r.code === 0 && r.stderr.includes('unknown key "__proto__"') && !!pageHit(`N12-${surface}`), `exit=${r.code} ${r.stderr.split('\n')[0].slice(0, 100)}`);
    await closeKey(k('n12'));
  });
  // H10: BOM is accepted.
  await run('H10', async (id) => {
    const dir = path.join(R, 'bom');
    const d = await cli(k('h10'), dir, ['doctor'], {}, surface === 'bundle' ? BUNDLE_CLI : CLI, surface);
    record(surface, id, d.code === 0 && d.stdout.includes(`Config:          ${path.join(dir, '.sutradhar.json')} (discovered)`), d.stdout.split('\n').find((l) => l.startsWith('Config:')));
  });
  // H13: a symlink LOOP / dangling symlink is an error, not a silent default (skipped if links cannot be created).
  await run('H13', async (id) => {
    const dir = path.join(R, 'loopdir');
    await fs.mkdir(path.join(dir, '.git'), { recursive: true });
    try {
      await fs.symlink(path.join(dir, 'b.json'), path.join(dir, '.sutradhar.json'), 'file');
      await fs.symlink(path.join(dir, '.sutradhar.json'), path.join(dir, 'b.json'), 'file');
    } catch (e) {
      record(surface, id, true, `SKIPPED (cannot create symlinks here: ${e.code})`);
      return;
    }
    const r = await cli(k('h13'), dir, ['nav', U('localhost', `H13-${surface}`)], {}, surface === 'bundle' ? BUNDLE_CLI : CLI, surface);
    record(surface, id, r.code === 1 && /cannot be read|broken symbolic link|not a regular file/.test(r.stderr) && !pageHit(`H13-${surface}`), `exit=${r.code} ${r.stderr.split('\n')[0].slice(0, 140)}`);
  });
  // H14: secret-looking values from the file never appear in any output.
  await run('H14', async (id) => {
    const bin = surface === 'bundle' ? BUNDLE_CLI : CLI;
    const a = await cli(k('h14'), path.join(R, 'secret'), ['doctor'], {}, bin, surface);
    const b = await cli(k('h14'), path.join(R, 'secret-bad'), ['doctor'], {}, bin, surface);
    const c = await cli(k('h14'), path.join(R, 'secret-bad'), ['nav', U('localhost', `H14-${surface}`)], {}, bin, surface);
    const all = [a, b, c].map((r) => r.stdout + r.stderr).join('\n');
    record(surface, id, !/SECRET/.test(all) && a.stdout.includes('(discovered)') && b.stdout.includes('INVALID') && c.code === 1, `leaks=${/SECRET/.test(all)} warn=${a.stdout.split('\n').find((l) => l.startsWith('Config warning'))}`);
  });
  // N15: the config is re-read per CLI command, so a STRICTER file applies to the very next command.
  await run('N15', async (id) => {
    const key = k('n15');
    const dir = path.join(R, 'n15');
    const bin = surface === 'bundle' ? BUNDLE_CLI : CLI;
    const file = path.join(dir, '.sutradhar.json');
    const a = await cli(key, dir, ['nav', U('127.0.0.1', `N15a-${surface}`)], {}, bin, surface);
    await fs.writeFile(file, JSON.stringify({ allowedDomains: ['localhost'] }));
    const b = await cli(key, dir, ['nav', U('127.0.0.1', `N15b-${surface}`)], {}, bin, surface);
    await fs.rm(file);
    const c = await cli(key, dir, ['nav', U('127.0.0.1', `N15c-${surface}`)], {}, bin, surface);
    record(surface, id, a.code === 0 && b.code === 1 && !pageHit(`N15b-${surface}`) && c.code === 0, `before=${a.code} stricter=${b.code} removed=${c.code}`);
    await closeKey(key);
  });
  // Empty --allowlist-domains must fail, never mean "unrestricted".
  await run('H15', async (id) => {
    const bin = surface === 'bundle' ? BUNDLE_CLI : CLI;
    const r = await cli(k('h15'), T.proj0, ['nav', U('localhost', `H15-${surface}`), '--allowlist-domains', ','], {}, bin, surface);
    record(surface, id, r.code === 1 && r.stderr.includes('--allowlist-domains needs at least one domain') && !pageHit(`H15-${surface}`), `exit=${r.code}`);
  });
}

// ───────────────────────────── MCP suite ─────────────────────────────
async function mcpSuite(bin, surface, full) {
  const run = (id, fn) => (wanted(id) ? fn(id).catch((e) => record(surface, id, false, `threw: ${e.stack ?? e.message}`)) : undefined);
  const cfg = T.projCfg;
  const tempNeedle = path.join(R, 'temp');

  // L22: discovery from a child cwd; every key effective through the real server.
  await run('M-L22', async (id) => {
    const c = mcpClient(bin, T.cwdC);
    try {
      await c.init();
      const banner = `[sutradhar-mcp] config: loaded ${cfg} (found by searching upward from ${T.cwdC})`;
      const stderr0 = c.stderrText();
      const procsBefore = listProcs(tempNeedle).length;
      const launch = await c.tool('browser.launch', {});
      const sid = launch.json?.sessionId;
      const nav = await c.tool('browser.navigate', { sessionId: sid, url: U('localhost', `${surface}-M1`) });
      const w = await waitHit((h) => h.n === `${surface}-M1` && 'w' in h.q);
      const blocked = await c.tool('browser.navigate', { sessionId: sid, url: U('127.0.0.1', `${surface}-M2`) });
      const dl = await c.tool('browser.download_file', { sessionId: sid, target: '#dl' });
      const dlPath = dl.json?.output?.downloadedPath;
      const dlBad = dlPath ? await dlCheck(dlPath, `${surface}-M1`, path.join(T.proj, 'dl')) : 'no path';
      await delay(1100);
      const click = await c.tool('browser.click', { sessionId: sid, target: '#confirm' });
      const conf = await waitHit((h) => h.n === `${surface}-M1` && 'confirm' in h.q);
      const procsLive = listProcs(tempNeedle).length;
      // idle reaper (4000 from the config): no calls; poll list_tabs until the session is gone (hard 15 s).
      const t0 = now();
      let gone = false;
      while (now() - t0 < 15000) {
        const r = await c.tool('browser.list_tabs', { sessionId: sid }).catch(() => ({ isError: true, text: 'rpc error' }));
        if (r.isError && /No browser session|not found|unknown session/i.test(r.text)) { gone = true; break; }
        await delay(500);
      }
      const reapMs = Math.round(now() - t0);
      const procsAfter = await (async () => { await delay(1500); return listProcs(tempNeedle).length; })();
      const ok = stderr0.includes(banner) && stderr0.includes('[sutradhar-mcp] warning: ') && stderr0.includes('unknown key "allowedDomian"')
        && w?.q.w === '700' && /allowedDomains/.test(blocked.text) && !pageHit(`${surface}-M2`)
        && !dlBad && !existsSync(path.join(T.cwdC, 'dl'))
        && conf?.q.confirm === 'false'
        && procsLive > procsBefore && gone && procsAfter <= procsBefore;
      record(surface, id, ok, `banner=${stderr0.includes(banner)} pageWidth=${w?.q.w} blocked=${blocked.isError} download=${dlBad || 'ok'} dialogDismissed=${conf?.q.confirm} chromeProcs=${procsBefore}->${procsLive}->${procsAfter} reapedAfterMs=${reapMs} gone=${gone}`);
    } finally { await c.stop(); }
  });
  if (!full) return;

  // L23: env > config; the call argument > config; IDLE=0 from env keeps the session alive past the config's 4 s.
  await run('M-L23', async (id) => {
    const c = mcpClient(bin, T.cwdC, { SUTRADHAR_ALLOWED_DOMAINS: '127.0.0.1', SUTRADHAR_IDLE_TIMEOUT_MS: '0' });
    try {
      await c.init();
      const launch = await c.tool('browser.launch', { viewport: { width: 390, height: 844 } });
      const sid = launch.json?.sessionId;
      const ok1 = await c.tool('browser.navigate', { sessionId: sid, url: U('127.0.0.1', `${surface}-M3`) });
      const w = await waitHit((h) => h.n === `${surface}-M3` && 'w' in h.q);
      const blocked = await c.tool('browser.navigate', { sessionId: sid, url: U('localhost', `${surface}-M4`) });
      let alive = true;
      const t0 = now();
      while (now() - t0 < 10000) {
        const r = await c.tool('browser.list_tabs', { sessionId: sid });
        if (r.isError) { alive = false; break; }
        await delay(1000);
      }
      await c.tool('browser.shutdown_all', {});
      record(surface, id, !ok1.isError && w?.q.w === '390' && blocked.isError && blocked.text.includes('(127.0.0.1)') && !pageHit(`${surface}-M4`) && alive,
        `argViewportBeatsConfig=${w?.q.w} envDomainsBeatConfig=${blocked.text.includes('(127.0.0.1)')} aliveAfter10s=${alive}`);
    } finally { await c.stop(); }
  });
  // L24: none found banner; a config written AFTER startup is not picked up by a running server (documented).
  await run('M-L24', async (id) => {
    const dir = path.join(R, 'proj0');
    const c = mcpClient(bin, dir);
    const file = path.join(dir, '.sutradhar.json');
    try {
      await c.init();
      const want = `[sutradhar-mcp] config: none found (searched upward from ${dir}, stopped at git root ${dir}); set SUTRADHAR_CONFIG to an absolute path to load one explicitly`;
      const launch = await c.tool('browser.launch', {});
      await fs.writeFile(file, JSON.stringify({ allowedDomains: ['localhost'] }));
      const nav = await c.tool('browser.navigate', { sessionId: launch.json?.sessionId, url: U('127.0.0.1', `${surface}-M5`) });
      await c.tool('browser.shutdown_all', {});
      record(surface, id, c.stderrText().includes(want) && !nav.isError && !!pageHit(`${surface}-M5`), `bannerOk=${c.stderrText().includes(want)} navAfterFileWritten=${nav.isError ? 'blocked' : 'allowed (startup values kept)'}`);
    } finally { await c.stop(); await fs.rm(file, { force: true }); }
  });
  // M-none / M-explicit banners.
  await run('M-banners', async (id) => {
    const a = mcpClient(bin, T.cwdC, { SUTRADHAR_CONFIG: 'none' });
    const b = mcpClient(bin, T.proj0, { SUTRADHAR_CONFIG: T.outerCfg });
    try {
      await a.init(); await b.init();
      const okA = a.stderrText().includes('[sutradhar-mcp] config: disabled (SUTRADHAR_CONFIG=none)');
      const okB = b.stderrText().includes(`[sutradhar-mcp] config: loaded ${T.outerCfg} (SUTRADHAR_CONFIG)`);
      record(surface, id, okA && okB, `disabled=${okA} explicit=${okB}`);
    } finally { await a.stop(); await b.stop(); }
  });
  // N7/N9/N10 on MCP: fatal before the server starts, exit 1 within 10 s.
  for (const [id, cwd, env, needles] of [
    ['M-N7', T.proj0, { SUTRADHAR_CONFIG: 'rel.json' }, ['SUTRADHAR_CONFIG', 'absolute']],
    ['M-N9', path.join(R, 'bad-empty'), {}, ['[sutradhar-mcp] fatal:', path.join(R, 'bad-empty', '.sutradhar.json'), 'allowedDomains must list at least one domain']],
    ['M-N10', T.proj0, { SUTRADHAR_IDLE_TIMEOUT_MS: 'abc' }, ['[sutradhar-mcp] fatal:', 'SUTRADHAR_IDLE_TIMEOUT_MS must be 0']],
    ['M-N4', path.join(R, 'escape'), {}, ['[sutradhar-mcp] fatal:', "outside this config's directory"]],
  ]) {
    await run(id, async () => {
      const c = mcpClient(bin, cwd, env);
      try {
        const t0 = now();
        const exited = await c.waitExit(10000);
        record(surface, id, exited && c.exitCode === 1 && needles.every((n) => c.stderrText().includes(n)), `exited=${exited} code=${c.exitCode} in ${Math.round(now() - t0)}ms ${c.stderrText().split('\n')[0].slice(0, 120)}`);
      } finally { await c.stop(); }
    });
  }
}

// ───────────────────────────── SDK suite ─────────────────────────────
async function sdkSuite() {
  const surface = 'sdk';
  const run = (id, fn) => (wanted(id) ? fn(id).catch((e) => record(surface, id, false, `threw: ${e.stack ?? e.message}`)) : undefined);
  const probe = async (mode, cwd, arg) => {
    const env = { ...baseEnv, FR214_SDK_INDEX: SDK_INDEX, FR214_PORT: String(server.port) };
    const t0 = now();
    const out = await new Promise((resolve) => {
      const cp = track(spawn(process.execPath, [PROBE, mode, ...(arg ? [arg] : [])], { env, cwd }));
      let stdout = '', stderr = '';
      cp.stdout.on('data', (d) => (stdout += d.toString('utf8')));
      cp.stderr.on('data', (d) => (stderr += d.toString('utf8')));
      cp.on('close', () => resolve({ stdout, stderr }));
    });
    let json; try { json = JSON.parse(out.stdout.trim().split('\n').at(-1)); } catch { json = { error: `unparseable: ${out.stdout.slice(0, 200)} ${out.stderr.slice(0, 200)}` }; }
    await logCase({ surface, argv: [mode, arg].filter(Boolean).map((a) => a.replace(R, '<R>')), cwd: cwd.replace(R, '<R>'), ms: Math.round(now() - t0), stdout: out.stdout.slice(0, 600).replace(R, '<R>'), stderr: out.stderr.slice(0, 400).replace(R, '<R>') });
    return { json, stderr: out.stderr };
  };
  await run('S-plain', async (id) => {
    const { json: j } = await probe('plain', T.cwdC);
    record(surface, id, j.error === null && j.innerWidth !== 700 && j.navResults['127.0.0.1'] === 'ok' && j.navResults.localhost === 'ok', `width=${j.innerWidth} nav=${JSON.stringify(j.navResults)} (config in cwd parent ignored: opt-in)`);
  });
  await run('S-discover', async (id) => {
    const { json: j, stderr } = await probe('discover', T.cwdC);
    const dlBad = j.downloadPath ? await dlCheck(j.downloadPath, 'sdk-discover-localhost', path.join(T.proj, 'dl')) : 'no path';
    record(surface, id, j.error === null && j.innerWidth === 700 && /allowedDomains/.test(j.navResults['127.0.0.1']) && j.navResults.localhost === 'ok' && !dlBad && stderr.includes('[sutradhar] ') && stderr.includes('allowedDomian'),
      `width=${j.innerWidth} nav=${JSON.stringify(j.navResults).slice(0, 160)} download=${dlBad || 'ok'}`);
  });
  await run('S-override', async (id) => {
    const { json: j } = await probe('discover-override', T.cwdC);
    record(surface, id, j.error === null && j.innerWidth === 390 && j.navResults['127.0.0.1'] === 'ok' && /allowedDomains/.test(j.navResults.localhost), `width=${j.innerWidth} nav=${JSON.stringify(j.navResults).slice(0, 160)}`);
  });
  await run('S-explicit', async (id) => {
    const { json: j } = await probe('explicit', T.proj0, T.outerCfg);
    record(surface, id, j.error === null && j.navResults['127.0.0.1'] === 'ok' && /allowedDomains/.test(j.navResults.localhost), `nav=${JSON.stringify(j.navResults).slice(0, 160)}`);
  });
  await run('S-both', async (id) => {
    const { json: j } = await probe('both', T.cwdC);
    record(surface, id, /either configFile or discoverConfig/.test(j.error ?? ''), `error=${j.error}`);
  });
  await run('S-hostile', async (id) => {
    const { json: j } = await probe('discover', path.join(R, 'hp', 'child'));
    record(surface, id, /outside this config's directory/.test(j.error ?? '') && !existsSync(path.join(R, 'outside-hp')), `error=${String(j.error).slice(0, 140)}`);
  });
  await run('S-bad', async (id) => {
    const { json: j } = await probe('discover', path.join(R, 'bad-empty'));
    record(surface, id, /allowedDomains must list at least one domain/.test(j.error ?? ''), `error=${String(j.error).slice(0, 140)}`);
  });
}

// ───────────────────────────── fix-1 suites (audit-1 findings F1/F3/F4/F8) ─────────────────────────────
async function fixSuite(surface) {
  const run = (id, fn) => (wanted(id) ? fn(id).catch((e) => record(surface, id, false, `threw: ${e.stack ?? e.message}`)) : undefined);
  const k = (s) => `${surface}-${s}`;
  const bin = surface === 'bundle' ? BUNDLE_CLI : CLI;
  const chromeProcs = () => listProcs(path.join(R, 'temp')).length;
  const cliDirs = async () => (await fs.readdir(path.join(R, 'temp')).catch(() => [])).filter((n) => n.startsWith('sutradhar-cli-'));
  // An earlier case's Chrome may still be shutting down (close is asynchronous): measure "no new Chrome" from a STABLE count (event-based, 10 s cap).
  const settled = async () => {
    let prev = -1;
    const t0 = now();
    for (;;) {
      const c = chromeProcs();
      if (c === prev || now() - t0 > 10000) return c;
      prev = c;
      await delay(700);
    }
  };

  // F1: for each discovered-file shape the refusal rule blocks, a higher layer (env roots, or the explicit `download <ref> <dir>`
  // grant) wins: the command works, the download lands in the HIGHER layer's directory (sha256 + realpath), and nothing is created
  // where the hostile file pointed. The same file with NO higher layer is still refused (negative control, recorded separately).
  const shapes = [
    ['f1-out', path.join(R, 'hp', 'child'), path.join(R, 'outside-hp'), 'downloadDir ../outside-hp'],
    ['f1-abs', path.join(R, 'hp3', 'child'), path.join(R, 'outside-hp3'), 'allowedDownloadRoots absolute outside'],
    ['f1-git', path.join(R, 'hooks'), path.join(R, 'hooks', '.git', 'hooks'), 'downloadDir .git/hooks'],
    ['f1-git2', path.join(R, 'hp4', 'child'), path.join(R, 'hp4', '.git', 'x'), 'allowedDownloadRoots [./dl, .git/x]'],
  ];
  for (const [id, cwd, forbidden, label] of shapes) {
    await run(`F1-env-${id}`, async (rid) => {
      const key = k(rid);
      const envdl = path.join(R, `envdl-${id}`);
      const env = { SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS: envdl };
      const n = `${rid}-${surface}`;
      const a = await cli(key, cwd, ['nav', U('localhost', n)], env, bin, surface);
      const d = await cli(key, cwd, ['download', '#dl'], env, bin, surface);
      const p = downloadedPath(d);
      const bad = p ? await dlCheck(p, n, envdl) : 'no path';
      const created = existsSync(forbidden);
      record(surface, rid, a.code === 0 && d.code === 0 && !bad && !created && !!pageHit(n), `${label}: nav=${a.code} download=${d.code} check=${bad || 'ok'} hostileTargetCreated=${created}`);
      await closeKey(key);
    });
    await run(`F1-none-${id}`, async (rid) => {
      const key = k(rid);
      const before = await settled();
      const r = await cli(key, cwd, ['nav', U('localhost', `${rid}-${surface}`)], {}, bin, surface);
      record(surface, rid, r.code === 1 && /outside this config's directory|inside a \.git directory/.test(r.stderr) && r.stderr.includes('SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS') && !stateExists(key) && chromeProcs() === before && !existsSync(forbidden), `${label}: exit=${r.code} noSession=${!stateExists(key)}`);
    });
  }
  // The explicit per-command grant `download <ref> <dir>` is a flag-level layer: with a session already open, a hostile file in the cwd
  // must not block it, and the file lands in the granted directory.
  await run('F1-arg', async (id) => {
    const key = k(id);
    const n = `${id}-${surface}`;
    const argdl = path.join(R, 'argdl-f1');
    const a = await cli(key, T.proj0, ['nav', U('localhost', n)], {}, bin, surface);
    const d = await cli(key, path.join(R, 'hp', 'child'), ['download', '#dl', argdl], {}, bin, surface);
    const p = downloadedPath(d);
    const bad = p ? await dlCheck(p, n, argdl) : 'no path';
    record(surface, id, a.code === 0 && d.code === 0 && !bad && !existsSync(path.join(R, 'outside-hp')), `nav=${a.code} download=${d.code} check=${bad || 'ok'} (hostile file in cwd, explicit dir wins)`);
    await closeKey(key);
  });

  // F8: a huge viewport from the FILE or the FLAG is rejected before any Chrome starts: no state, no profile dir, no process.
  for (const [id, cwd, args, needle] of [
    ['F8-file', path.join(R, 'vphuge'), [], 'positive integer (at most 10000000)'],
    ['F8-flag', T.proj0, ['--viewport', '1000000000x1000000000'], '--viewport'],
  ]) {
    await run(id, async (rid) => {
      const key = k(rid);
      const before = await settled(), beforeDirs = (await cliDirs()).length;
      const r = await cli(key, cwd, ['nav', U('localhost', `${rid}-${surface}`), ...args], {}, bin, surface);
      const noChrome = !stateExists(key) && chromeProcs() === before && (await cliDirs()).length === beforeDirs;
      record(surface, rid, r.code === 1 && r.stderr.includes(needle) && noChrome && !pageHit(`${rid}-${surface}`), `exit=${r.code} noChrome=${noChrome} ${r.stderr.split('\n')[0].slice(0, 120)}`);
    });
  }
  // F4: a 20 KB unknown key prints a short, single-line warning on every command (not 20 KB).
  await run('F4-longkey', async (id) => {
    const key = k(id);
    const n = `${id}-${surface}`;
    const r = await cli(key, path.join(R, 'longkey'), ['nav', U('localhost', n)], {}, bin, surface);
    const warn = r.stderr.split('\n').find((l) => l.startsWith('Warning:')) ?? '';
    record(surface, id, r.code === 0 && warn.length > 0 && warn.length < 400 && warn.includes('...'), `exit=${r.code} warningLength=${warn.length}`);
    await closeKey(key);
  });
  // F3: a cwd that is a junction INSIDE home pointing elsewhere does not read a config above home.
  await run('F3-home-junction', async (id) => {
    const home = path.join(R, 'f3top', 'home');
    const link = path.join(home, `link-${surface}`);
    try {
      await fs.mkdir(path.join(R, `f3elsewhere-${surface}`), { recursive: true });
      await fs.symlink(path.join(R, `f3elsewhere-${surface}`), link, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (e) {
      record(surface, id, true, `SKIPPED (cannot create a link here: ${e.code})`);
      return;
    }
    const d = await cli(k(id), link, ['doctor'], { USERPROFILE: home, HOME: home }, bin, surface);
    const line = d.stdout.split('\n').find((l) => l.startsWith('Config:')) ?? '';
    const aboveFile = path.join(R, 'f3top', '.sutradhar.json');
    record(surface, id, d.code === 0 && line.includes('none (searched') && line.includes('stopped at home') && !d.stdout.includes(aboveFile), line.slice(0, 200));
  });
}

async function mcpFixSuite(bin, surface) {
  const run = (id, fn) => (wanted(id) ? fn(id).catch((e) => record(surface, id, false, `threw: ${e.stack ?? e.message}`)) : undefined);
  // F1 on MCP: the same hostile discovered files, with SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS set: the server STARTS, and a real download
  // lands in the env root; without the env var the server still dies at startup naming it.
  for (const [id, cwd, forbidden] of [
    ['mf1-out', path.join(R, 'hp', 'child'), path.join(R, 'outside-hp')],
    ['mf1-git', path.join(R, 'hooks'), path.join(R, 'hooks', '.git', 'hooks')],
  ]) {
    await run(`M-F1-env-${id}`, async (rid) => {
      const envdl = path.join(R, `envdl-${rid}-${surface}`);
      const c = mcpClient(bin, cwd, { SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS: envdl });
      try {
        await c.init();
        const launch = await c.tool('browser.launch', {});
        const sid = launch.json?.sessionId;
        const n = `${rid}-${surface}`;
        await c.tool('browser.navigate', { sessionId: sid, url: U('localhost', n) });
        const dl = await c.tool('browser.download_file', { sessionId: sid, target: '#dl' });
        const p = dl.json?.output?.downloadedPath;
        const bad = p ? await dlCheck(p, n, envdl) : 'no path';
        await c.tool('browser.shutdown_all', {});
        record(surface, rid, !c.exited && !bad && !existsSync(forbidden), `serverAlive=${!c.exited} download=${bad || 'ok'} hostileTargetCreated=${existsSync(forbidden)}`);
      } finally { await c.stop(); }
    });
    await run(`M-F1-none-${id}`, async (rid) => {
      const c = mcpClient(bin, cwd, {});
      try {
        const exited = await c.waitExit(10000);
        record(surface, rid, exited && c.exitCode === 1 && c.stderrText().includes('SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS') && !existsSync(forbidden), `exited=${exited} code=${c.exitCode}`);
      } finally { await c.stop(); }
    });
  }
  // F8 on MCP: a huge file viewport fails at startup, before the server accepts any call.
  await run('M-F8', async (id) => {
    const c = mcpClient(bin, path.join(R, 'vphuge'), {});
    try {
      const exited = await c.waitExit(10000);
      record(surface, id, exited && c.exitCode === 1 && c.stderrText().includes('at most 10000000'), `exited=${exited} code=${c.exitCode}`);
    } finally { await c.stop(); }
  });
}

// ───────────────────────────── FR2-14 fix-2 (N1, N2, N4, N5, N8) ─────────────────────────────
async function fix2Suite(surface) {
  const run = (id, fn) => (wanted(id) ? fn(id).catch((e) => record(surface, id, false, `threw: ${e.stack ?? e.message}`)) : undefined);
  const k = (s) => `${surface}-${s}`;
  const bin = surface === 'bundle' ? BUNDLE_CLI : CLI;

  // N1: a `~user` entry with newlines / 20 KB in downloadDir, allowedDownloadRoots and allowedUploadRoots: the command stops with ONE
  // short stderr line (it used to print 3 raw lines, or 20,335 characters), before any session exists.
  for (const [id, entry] of [
    ['multiline', '~evil\nNote: using nothing. All good.\nSECRET=hunter2'],
    ['huge', '~' + 'Q'.repeat(20000)],
  ]) {
    await run(`F2-N1-${id}`, async (rid) => {
      const bad = [];
      for (const key of ['downloadDir', 'allowedDownloadRoots', 'allowedUploadRoots']) {
        const dir = path.join(R, `f2n1-${id}-${key}`);
        await fs.mkdir(path.join(dir, '.git'), { recursive: true });
        await fs.writeFile(path.join(dir, '.sutradhar.json'), JSON.stringify({ [key]: key === 'downloadDir' ? entry : [entry] }));
        const sk = k(`${rid}-${key}`);
        const r = await cli(sk, dir, ['nav', U('localhost', `${rid}-${key}-${surface}`)], {}, bin, surface);
        const lines = r.stderr.split(/\r?\n/).filter(Boolean);
        const ok = r.code === 1 && lines.length === 1 && lines[0].startsWith('Error: ') && lines[0].includes('~user is not supported') && r.stderr.length < 700 && !stateExists(sk) && !pageHit(`${rid}-${key}-${surface}`);
        if (!ok) bad.push(`${key}: exit=${r.code} lines=${lines.length} bytes=${r.stderr.length}`);
      }
      record(surface, rid, bad.length === 0, bad.join(' ; ') || '3 keys: exit 1, 1 line, <700 bytes, no session');
    });
  }

  // N2: a junction ABOVE home pointing INTO home must not make the search read the file above home. Observed through `doctor`
  // (which loads the file) with HOME/USERPROFILE pointed at the fixture home; the negative control (home elsewhere) DOES read it.
  await run('F2-N2', async (rid) => {
    const S = path.join(R, `f2n2-${surface}`);
    const top = path.join(S, 'top');
    const home = path.join(top, 'home');
    await fs.mkdir(path.join(home, 'p'), { recursive: true });
    await fs.mkdir(path.join(S, 'other-home'), { recursive: true });
    await fs.writeFile(path.join(top, '.sutradhar.json'), JSON.stringify({ allowedDomains: ['above-home.test'] }));
    await fs.symlink(path.join(home, 'p'), path.join(top, 'jn'), 'junction');
    const aboveCfg = path.join(top, '.sutradhar.json');
    const d = await cli(k(rid), path.join(top, 'jn'), ['doctor'], { USERPROFILE: home, HOME: home }, bin, surface);
    const line = d.stdout.split('\n').find((l) => l.startsWith('Config:')) ?? '';
    const d2 = await cli(k(`${rid}-ctl`), path.join(top, 'jn'), ['doctor'], { USERPROFILE: path.join(S, 'other-home'), HOME: path.join(S, 'other-home') }, bin, surface);
    const line2 = d2.stdout.split('\n').find((l) => l.startsWith('Config:')) ?? '';
    record(surface, rid, d.code === 0 && line.includes('none (') && line.includes('stopped at home') && !d.stdout.includes(aboveCfg) && line2.includes(aboveCfg),
      `home-in-effect: ${line.slice(0, 90)} | control(home elsewhere): ${line2.slice(0, 40)}...${line2.slice(-40)}`);
  });

  // N8: an env var overriding a REFUSED discovered download root is announced (once); a file that was not refused is not.
  await run('F2-N8', async (rid) => {
    const key = k(rid);
    const envdl = path.join(R, `envdl-${rid}`);
    const a = await cli(key, path.join(R, 'hp', 'child'), ['nav', U('localhost', `${rid}-a-${surface}`), '--allowlist-domains', 'localhost'], { SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS: envdl }, bin, surface);
    const notes = a.stderr.split(/\r?\n/).filter((l) => l.includes('were refused'));
    await closeKey(key);
    const keyB = k(`${rid}-ok`);
    const b = await cli(keyB, path.join(R, 'hp2', 'child'), ['nav', U('localhost', `${rid}-b-${surface}`), '--allowlist-domains', 'localhost'], { SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS: envdl }, bin, surface);
    await closeKey(keyB);
    record(surface, rid, a.code === 0 && notes.length === 1 && notes[0].startsWith('Warning: ') && notes[0].includes('SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS') && b.code === 0 && !b.stderr.includes('were refused'),
      `refused+env: exit=${a.code} notes=${notes.length} | not-refused+env: exit=${b.code} notes=${b.stderr.includes('were refused') ? 1 : 0}`);
  });

  // N5: the advertised maximum viewport passes validation but Chrome cannot create it: exit 1, and the Chrome it spawned is stopped.
  await run('F2-N5', async (rid) => {
    const key = k(rid);
    const before = listProcs(path.join(R, 'temp')).length;
    const r = await cli(key, path.join(R, 'hp2', 'child'), ['nav', U('localhost', `${rid}-${surface}`), '--viewport', '10000000x10000000'], {}, bin, surface);
    await delay(2500);
    const after = listProcs(path.join(R, 'temp')).length;
    await closeKey(key);
    record(surface, rid, r.code === 1 && /No browser session/.test(r.stderr) && after <= before, `exit=${r.code} chromeBefore=${before} chromeAfter=${after} ${(r.stderr.split('\n').find((l) => l.startsWith('Fatal')) ?? r.stderr.split('\n')[0]).slice(0, 100)}`);
  });
}

async function mcpFix2Suite(bin, surface) {
  const run = (id, fn) => (wanted(id) ? fn(id).catch((e) => record(surface, id, false, `threw: ${e.stack ?? e.message}`)) : undefined);
  const chromeProcs = () => listProcs(path.join(R, 'temp')).length;
  // N4: an out-of-range MCP browser.launch viewport is rejected by the tool schema BEFORE any Chrome is started (it used to reach
  // Chrome, fail there, and leave Chrome running until shutdown_all).
  await run('M-F2-N4', async (rid) => {
    const c = mcpClient(bin, path.join(R, 'hp2', 'child'), {});
    try {
      await c.init();
      const before = chromeProcs();
      const r = await c.tool('browser.launch', { viewport: { width: 1000000000, height: 1000000000 } });
      await delay(1500);
      const during = chromeProcs();
      const ok1 = await c.tool('browser.launch', { viewport: { width: 800, height: 600 } }); // the same call within bounds still works
      await c.tool('browser.shutdown_all', {});
      record(surface, rid, r.isError && /10000000|too_big|less than or equal/i.test(r.text) && during === before && !ok1.isError && !!ok1.json?.sessionId,
        `isError=${r.isError} chromeBefore=${before} chromeAfterBadCall=${during} inBoundsLaunch=${ok1.isError ? 'ERR' : 'ok'} text=${r.text.slice(0, 90)}`);
    } finally { await c.stop(); }
  });
  // N8 on MCP: env overriding a refused discovered root: the server starts and says so on stderr.
  await run('M-F2-N8', async (rid) => {
    const envdl = path.join(R, `envdl-${rid}-${surface}`);
    const c = mcpClient(bin, path.join(R, 'hp', 'child'), { SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS: envdl });
    try {
      await c.init();
      const warn = c.stderrText().split(/\r?\n/).filter((l) => l.includes('were refused'));
      record(surface, rid, !c.exited && warn.length === 1 && warn[0].startsWith('[sutradhar-mcp] warning:') && warn[0].includes('SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS'), `alive=${!c.exited} notes=${warn.length}`);
    } finally { await c.stop(); }
  });
}

async function sdkFixSuite() {
  const surface = 'sdk';
  const run = (id, fn) => (wanted(id) ? fn(id).catch((e) => record(surface, id, false, `threw: ${e.stack ?? e.message}`)) : undefined);
  const probe = async (mode, cwd, arg) => {
    const env = { ...baseEnv, FR214_SDK_INDEX: SDK_INDEX, FR214_PORT: String(server.port) };
    const out = await new Promise((resolve) => {
      const cp = track(spawn(process.execPath, [PROBE, mode, ...(arg ? [arg] : [])], { env, cwd }));
      let stdout = '', stderr = '';
      cp.stdout.on('data', (d) => (stdout += d.toString('utf8')));
      cp.stderr.on('data', (d) => (stderr += d.toString('utf8')));
      cp.on('close', () => resolve({ stdout, stderr }));
    });
    let json; try { json = JSON.parse(out.stdout.trim().split('\n').at(-1)); } catch { json = { error: `unparseable: ${out.stdout.slice(0, 200)} ${out.stderr.slice(0, 200)}` }; }
    await logCase({ surface, argv: [mode, arg].filter(Boolean).map((a) => a.replace(R, '<R>')), cwd: cwd.replace(R, '<R>'), stdout: out.stdout.slice(0, 600).replace(R, '<R>'), stderr: out.stderr.slice(0, 400).replace(R, '<R>') });
    return { json, stderr: out.stderr };
  };
  // F1 on the SDK: the allowedDownloadRoots OPTION beats a refused discovered file, and the download lands there.
  for (const [id, cwd, forbidden] of [
    ['sf1-out', path.join(R, 'hp', 'child'), path.join(R, 'outside-hp')],
    ['sf1-git', path.join(R, 'hooks'), path.join(R, 'hooks', '.git', 'hooks')],
  ]) {
    await run(`S-F1-opt-${id}`, async (rid) => {
      const root = path.join(R, `optdl-${rid}`);
      const { json: j } = await probe('discover-roots', cwd, root);
      const bad = j.downloadPath ? await dlCheck(j.downloadPath, 'sdk-discover-roots-localhost', root) : 'no path';
      record(surface, rid, j.error === null && !bad && !existsSync(forbidden), `error=${j.error} download=${bad || 'ok'} hostileTargetCreated=${existsSync(forbidden)}`);
    });
    await run(`S-F1-none-${id}`, async (rid) => {
      const { json: j } = await probe('discover', cwd);
      record(surface, rid, /outside this config's directory|inside a \.git directory/.test(j.error ?? '') && !existsSync(forbidden), `error=${String(j.error).slice(0, 120)}`);
    });
  }
  // F2 on the SDK: null options are "not set": the discovered config still applies (width 700, 127.0.0.1 blocked).
  await run('S-F2-null', async (id) => {
    const { json: j } = await probe('discover-null', T.cwdC);
    record(surface, id, j.error === null && j.innerWidth === 700 && /allowedDomains/.test(j.navResults['127.0.0.1']) && j.navResults.localhost === 'ok', `width=${j.innerWidth} nav=${JSON.stringify(j.navResults).slice(0, 160)}`);
  });
  await run('S-F8', async (id) => {
    const { json: j } = await probe('discover', path.join(R, 'vphuge'));
    record(surface, id, /at most 10000000/.test(j.error ?? ''), `error=${String(j.error).slice(0, 140)}`);
  });
  // F9: a discovered dialog accept is announced by the SDK.
  await run('S-F9-announce', async (id) => {
    const { stderr } = await probe('discover', path.join(R, 'hp2', 'child'));
    record(surface, id, stderr.includes('[sutradhar] ') && stderr.includes('dialog.mode "accept"') && stderr.includes(path.join(R, 'hp2', '.sutradhar.json')), stderr.split('\n').find((l) => l.includes('accept'))?.slice(0, 160));
  });
}

// ───────────────────────────── main ─────────────────────────────
async function main() {
  const st = await fs.statfs(os.tmpdir());
  const freeGB = (st.bavail * st.bsize) / 2 ** 30;
  console.log(`free disk on ${os.tmpdir()}: ${freeGB.toFixed(1)} GB`);
  if (freeGB < 5) throw new Error(`refusing to run: only ${freeGB.toFixed(1)} GB free (< 5 GB)`);
  const tmpBefore = (await fs.readdir(os.tmpdir())).filter((n) => n.startsWith('sutradhar-cli-'));
  await fs.writeFile(path.join(EVIDENCE_DIR, 'tmp-sutradhar-cli-before.txt'), tmpBefore.join('\n'));
  const procBase = listProcs('sutradhar');
  R = realpathSync(await fs.mkdtemp(path.join(os.tmpdir(), 'fr2-14-')));
  T = await buildTree(R);
  server = await startConfigServer();
  baseEnv = { ...process.env, TEMP: path.join(R, 'temp'), TMP: path.join(R, 'temp'), TMPDIR: path.join(R, 'temp') };
  for (const k of ENV_STRIP) delete baseEnv[k];
  console.log(`root=${R} port=${server.port} surfaces=${SURFACES.join(',')}`);
  try {
    if (SURFACES.includes('cli')) { await cliSuite(CLI, 'cli', true); await negativeSuite('cli'); await fixSuite('cli'); await fix2Suite('cli'); }
    if (SURFACES.includes('mcp')) { await mcpSuite(MCP, 'mcp', true); await mcpFixSuite(MCP, 'mcp'); await mcpFix2Suite(MCP, 'mcp'); }
    if (SURFACES.includes('sdk')) { await sdkSuite(); await sdkFixSuite(); }
    if (SURFACES.includes('bundle')) {
      await cliSuite(BUNDLE_CLI, 'bundle', false);
      await negativeSuite('bundle');
      await fixSuite('bundle');
      await fix2Suite('bundle');
      await mcpSuite(BUNDLE_MCP, 'bundle-mcp', false);
      await mcpFixSuite(BUNDLE_MCP, 'bundle-mcp');
      await mcpFix2Suite(BUNDLE_MCP, 'bundle-mcp');
    }
    // Cleanup: close every CLI session this run opened (PID-scoped via each state file; never by image name).
    for (const key of stateDirs.keys()) if (stateExists(key)) await closeKey(key);
  } catch (e) {
    record('harness', 'FATAL', false, e.stack ?? String(e));
  } finally {
    await killTracked();
    await server.close();
    const left = listProcs(R).filter((l) => !l.includes('Get-CimInstance'));
    const dirsInTemp = (await fs.readdir(path.join(R, 'temp')).catch(() => [])).filter((n) => n.startsWith('sutradhar-cli-'));
    await fs.writeFile(path.join(EVIDENCE_DIR, 'tmp-profile-dirs-in-run-temp.txt'), `${dirsInTemp.length} sutradhar-cli-* dirs were left in <R>/temp (GAP-315); removed with <R>\n${dirsInTemp.join('\n')}`);
    const removed = await rmRetry(R);
    const tmpAfter = (await fs.readdir(os.tmpdir())).filter((n) => n.startsWith('sutradhar-cli-'));
    await fs.writeFile(path.join(EVIDENCE_DIR, 'tmp-sutradhar-cli-after.txt'), tmpAfter.join('\n'));
    record('harness', 'no-leaked-processes', left.length === 0, `processes still referencing the run root: ${left.length}`);
    record('harness', 'root-removed', removed && !existsSync(R), `removed=${removed}`);
    record('harness', 'no-new-global-cli-dirs', tmpAfter.every((n) => tmpBefore.includes(n)), `before=${tmpBefore.length} after=${tmpAfter.length}`);
    const bySurface = {};
    for (const r of results) { const s = (bySurface[r.surface] ??= { pass: 0, fail: 0 }); r.pass ? s.pass++ : s.fail++; }
    const summary = { total: results.length, passed: results.filter((r) => r.pass).length, bySurface, failed: results.filter((r) => !r.pass), processBaselineCount: procBase.length };
    await fs.writeFile(path.join(EVIDENCE_DIR, 'live-summary.json'), JSON.stringify(summary, null, 2));
    console.log(`\n${summary.passed}/${summary.total} passed`, JSON.stringify(bySurface));
    process.exitCode = summary.failed.length === 0 ? 0 : 1;
  }
}
await main();
