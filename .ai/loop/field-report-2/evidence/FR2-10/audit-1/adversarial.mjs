// FR2-10 audit-1: auditor's own race stress + adversarial probes against the REAL built MCP server.
// Writes only to .ai/loop/field-report-2/evidence/FR2-10/audit-1/.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';

const repoRoot = 'E:/HMX_Projects/Internal_Projects/PinchTab/.claude/worktrees/project-understanding-696041';
const OUT = path.join(repoRoot, '.ai/loop/field-report-2/evidence/FR2-10/audit-1');
const require_ = createRequire(path.join(repoRoot, 'packages', 'browser', 'package.json'));
const puppeteer = require_('puppeteer-core');
const SERVER = path.join(repoRoot, 'packages', 'mcp-server', 'dist', 'cli.js');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
let allOk = true;
function rec(name, pass, detail) {
  results.push({ name, pass, detail });
  if (!pass) allOk = false;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`);
}

function client() {
  const child = spawn(process.execPath, [SERVER], { stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '';
  let id = 1;
  const pending = new Map();
  child.stdout.on('data', (c) => {
    buf += c.toString('utf8');
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let m;
      try { m = JSON.parse(line); } catch { continue; }
      if (m.id !== undefined && pending.has(m.id)) {
        const p = pending.get(m.id);
        pending.delete(m.id);
        m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
      }
    }
  });
  child.stderr.on('data', () => {});
  const call = (method, params) => new Promise((resolve, reject) => {
    const myId = id++;
    pending.set(myId, { resolve, reject });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: myId, method, params }) + '\n');
  });
  const tool = (name, args) => call('tools/call', { name, arguments: args });
  return {
    child, call, tool,
    async init() {
      await call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'fr2-10-audit', version: '1' } });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    },
    async end() {
      await tool('browser.shutdown_all', {}).catch(() => {});
      child.stdin.end();
      await new Promise((r) => { const t = setTimeout(r, 4000); child.once('exit', () => { clearTimeout(t); r(); }); });
    },
  };
}
const text = (r) => r?.content?.[0]?.text ?? '';
const last = (r) => r?.content?.at(-1)?.text ?? '';
const noteFor = (id) => `sessionId omitted: used "${id}", the only live browser session.`;
async function marker(c, sid, key) {
  const r = await c.tool('browser.eval', { sessionId: sid, code: `window.${key} ?? null` });
  if (r.isError) return `ERR:${text(r).slice(0, 80)}`;
  return JSON.parse(text(r)).result;
}

const fixture = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(`<title>audit ${req.url}</title><p>x</p>`);
});
await new Promise((r) => fixture.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${fixture.address().port}`;
const mod = await import('file:///' + path.join(repoRoot, 'packages/browser/dist/index.js').replace(/\\/g, '/'));
const chromePath = process.env.CHROME_PATH ?? new mod.BrowserLauncher().findExecutablePath();
const tmpDirs = [];
async function observer() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fr2-10-audit-obs-'));
  tmpDirs.push(dir);
  return puppeteer.launch({ executablePath: chromePath, headless: true, userDataDir: dir, args: ['--no-sandbox'] });
}

const c1 = client();
await c1.init();
try {
  // ── S-A: launch race, many omitted evals spread across the whole launch window ──
  const A = JSON.parse(text(await c1.tool('browser.launch', { headless: true, initialUrl: `${base}/A` }))).sessionId;
  const launchRuns = [];
  for (let round = 0; round < 4; round++) {
    const offsets = [0, 0, 1, 3, 5, 10, 20, 40, 80, 120, 200, 300, 500, 800, 1200, 1800];
    const evals = [];
    const t0 = Date.now();
    let launchDoneAt;
    const launchP = c1.tool('browser.launch', { headless: true, initialUrl: `${base}/E${round}` }).then((r) => { launchDoneAt = Date.now() - t0; return r; });
    for (const [k, off] of offsets.entries()) {
      const key = `__aud_l${round}_${k}`;
      evals.push(delay(off).then(async () => {
        const sentAt = Date.now() - t0;
        const r = await c1.tool('browser.eval', { code: `window.${key} = 1; location.pathname` });
        return { key, off, sentAt, doneAt: Date.now() - t0, isError: !!r.isError, note: r.isError ? null : last(r), err: r.isError ? text(r).slice(0, 90) : null };
      }));
    }
    const [launchR, evs] = await Promise.all([launchP, Promise.all(evals)]);
    const E = JSON.parse(text(launchR)).sessionId;
    for (const e of evs) {
      e.onA = await marker(c1, A, e.key);
      e.onE = await marker(c1, E, e.key);
    }
    // After launch settles we have 2 sessions, so evals sent after launchDoneAt should be ambiguous.
    const violations = evs.filter((e) =>
      e.onE !== null || // never on the new session
      (e.isError && e.onA !== null) || // an error must have had no effect
      (!e.isError && !(e.note === noteFor(A) && e.onA === 1)), // a success must be on A with A's note
    );
    launchRuns.push({ round, A, E, launchDoneAt, branches: evs.map((e) => `${e.sentAt}ms:${e.isError ? (e.err.includes('in progress') ? 'inflight' : e.err.includes('are live') ? 'ambiguous' : 'OTHER') : 'onA'}`), violations });
    await c1.tool('browser.shutdown', { sessionId: E });
  }
  rec('S-A launch race (4 rounds x 16 omitted evals spread 0..1800ms)', launchRuns.every((r) => r.violations.length === 0), launchRuns);

  // ── S-B: shutdown race of a second session, evals spread across the shutdown window ──
  const shutRuns = [];
  for (let round = 0; round < 4; round++) {
    const E = JSON.parse(text(await c1.tool('browser.launch', { headless: true, initialUrl: `${base}/S${round}` }))).sessionId;
    const t0 = Date.now();
    let shutDoneAt;
    const shutP = c1.tool('browser.shutdown', { sessionId: E }).then((r) => { shutDoneAt = Date.now() - t0; return r; });
    const evs = await Promise.all([0, 0, 1, 2, 5, 10, 20, 40, 80, 150, 300, 600].map((off, k) => delay(off).then(async () => {
      const key = `__aud_s${round}_${k}`;
      const sentAt = Date.now() - t0;
      const r = await c1.tool('browser.eval', { code: `window.${key} = 1` });
      return { key, sentAt, isError: !!r.isError, note: r.isError ? null : last(r), err: r.isError ? text(r).slice(0, 90) : null };
    })));
    await shutP;
    for (const e of evs) e.onA = await marker(c1, A, e.key);
    const violations = evs.filter((e) => (e.note && e.note !== noteFor(A)) || (!e.isError && e.onA !== 1) || (e.isError && e.onA !== null) || (!e.isError && !e.note));
    shutRuns.push({ round, E, shutDoneAt, branches: evs.map((e) => `${e.sentAt}ms:${e.isError ? (e.err.includes('in progress') ? 'inflight' : e.err.includes('are live') ? 'ambiguous' : 'OTHER:' + e.err) : 'onA'}`), violations });
  }
  rec('S-B shutdown race of E with A live (4 rounds x 12 evals)', shutRuns.every((r) => r.violations.length === 0), shutRuns);

  // ── S-C: shutdown race of the ONLY session A: an omitted eval must never succeed "on" a
  //    session after it's gone, and none may report a success without a note. ──
  {
    const t0 = Date.now();
    const shutP = c1.tool('browser.shutdown', { sessionId: A });
    const evs = await Promise.all([0, 0, 1, 5, 20, 100, 400].map((off) => delay(off).then(async () => {
      const sentAt = Date.now() - t0;
      const r = await c1.tool('browser.eval', { code: '1' });
      return { sentAt, isError: !!r.isError, note: r.isError ? null : last(r), txt: text(r).slice(0, 100) };
    })));
    const s = await shutP;
    const bad = evs.filter((e) => !e.isError && e.note !== noteFor(A));
    rec('S-C shutdown race of the only session', !s.isError && bad.length === 0, evs);
  }

  // ── S-D: attach race — A2 live, attach to an external Chrome concurrently with omitted evals ──
  {
    const A2 = JSON.parse(text(await c1.tool('browser.launch', { headless: true, initialUrl: `${base}/A2` }))).sessionId;
    const obs = await observer();
    const t0 = Date.now();
    const attachP = c1.tool('browser.attach', { endpoint: obs.wsEndpoint() });
    const evs = await Promise.all([0, 0, 1, 5, 20, 60, 150, 400].map((off, k) => delay(off).then(async () => {
      const key = `__aud_att_${k}`;
      const sentAt = Date.now() - t0;
      const r = await c1.tool('browser.eval', { code: `window.${key} = 1` });
      return { key, sentAt, isError: !!r.isError, note: r.isError ? null : last(r), err: r.isError ? text(r).slice(0, 90) : null };
    })));
    const D = JSON.parse(text(await attachP)).sessionId;
    for (const e of evs) { e.onA2 = await marker(c1, A2, e.key); e.onD = await marker(c1, D, e.key); }
    const violations = evs.filter((e) => e.onD !== null || (!e.isError && (e.note !== noteFor(A2) || e.onA2 !== 1)) || (e.isError && e.onA2 !== null));
    rec('S-D attach race never lands on the attaching session', violations.length === 0, { A2, D, evs });

    // ── S-E: crash of D (external Chrome killed) while A2 + D live → omitted resolves to A2 after. ──
    obs.process()?.kill('SIGKILL');
    const t1 = Date.now();
    let resolved = null;
    const seen = [];
    while (Date.now() - t1 < 8000) {
      const r = await c1.tool('browser.eval', { code: '1' });
      seen.push(r.isError ? 'err:' + text(r).slice(0, 60) : last(r));
      if (!r.isError) { resolved = last(r); break; }
      await delay(100);
    }
    rec('S-E external Chrome killed: omitted id falls back to the one remaining session, never D', resolved === noteFor(A2), { A2, D, elapsedMs: Date.now() - t1, resolved, firstSeen: seen.slice(0, 3) });
    await c1.tool('browser.shutdown', { sessionId: A2 });
  }

  // ── Adversarial (b): error message with 5 live sessions ──
  {
    const ids = [];
    for (let i = 0; i < 5; i++) {
      ids.push(JSON.parse(text(await c1.tool('browser.launch', { headless: true, initialUrl: `${base}/five/${i}?token=SECRET${i}#frag` }))).sessionId);
    }
    const r = await c1.tool('browser.click', { target: '#x' });
    const t = text(r);
    await fs.writeFile(path.join(OUT, 'adv-b-five-sessions-message.txt'), t);
    const lines = t.split('\n').filter((l) => l.startsWith('  - '));
    const ok = r.isError && t.startsWith('click failed: No sessionId given, and 5 browser sessions are live') && lines.length === 5 &&
      ids.every((id) => t.includes(`  - ${id} (launched `)) && !t.includes('SECRET') && !t.includes('#frag') && !t.includes('Hint:');
    rec('ADV-b 5 live sessions: message lists all 5 ids, one per line, no query/fragment leak', ok, { text: t });
  }
} finally {
  await c1.end();
}

// ── Adversarial (a): two separate MCP clients (connections): client X has 2 sessions, client Y has 1. ──
{
  const X = client(); const Y = client();
  await X.init(); await Y.init();
  try {
    const x1 = JSON.parse(text(await X.tool('browser.launch', { headless: true, initialUrl: `${base}/x1` }))).sessionId;
    const x2 = JSON.parse(text(await X.tool('browser.launch', { headless: true, initialUrl: `${base}/x2` }))).sessionId;
    const y1 = JSON.parse(text(await Y.tool('browser.launch', { headless: true, initialUrl: `${base}/y1` }))).sessionId;
    const rx = await X.tool('browser.eval', { code: 'window.__aud_x = 1' });
    const ry = await Y.tool('browser.eval', { code: 'window.__aud_y = 1; location.pathname' });
    const yPath = ry.isError ? null : JSON.parse(text(ry)).result;
    // Can X name Y's session explicitly? (it must not exist in X's process)
    const crossExplicit = await X.tool('browser.eval', { sessionId: y1, code: '1' });
    const xOnX1 = await marker(X, x1, '__aud_x');
    const xOnX2 = await marker(X, x2, '__aud_x');
    const ok = rx.isError && text(rx).includes('2 browser sessions are live') && text(rx).includes(x1) && text(rx).includes(x2) && !text(rx).includes(y1)
      && !ry.isError && last(ry) === noteFor(y1) && yPath === '/y1' && xOnX1 === null && xOnX2 === null
      && (x1 === y1 ? true : crossExplicit.isError);
    rec('ADV-a per-client isolation (separate MCP connections = separate server processes)', ok, {
      x1, x2, y1, idCollision: x1 === y1 || x2 === y1, xText: text(rx), yNote: last(ry), yPath, crossExplicit: text(crossExplicit).slice(0, 120),
    });
  } finally { await X.end(); await Y.end(); }
}

await new Promise((r) => fixture.close(r));
for (const d of tmpDirs) await fs.rm(d, { recursive: true, force: true }).catch(() => {});
await fs.writeFile(path.join(OUT, 'adversarial-results.json'), JSON.stringify({ allOk, results }, null, 2));
console.log('ALL OK:', allOk);
process.exitCode = allOk ? 0 : 1;
