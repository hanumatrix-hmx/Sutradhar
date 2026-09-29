// FR2-12 audit-3 (independent auditor): CLI probes -- GAP-268 stdout document counting over a wide
// alert-timing sweep, concurrency, GAP-261's original shapes, snap --json's disclosed latent race,
// and A3-1 via the CLI surface.
// Usage: node probe-cli.mjs <group> ; groups: sweep | fine | shapes | concurrent | snap | own404
// Every CLI call has a hard timeout and is killed by its OWN PID; every session is closed; the temp
// root (under os.tmpdir(), name fr212-audit3-cli-*) is removed at the end. Writes ONLY
// audit-3/probe-cli-<group>.json.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
if (!here.replace(/\\/g, '/').endsWith('/evidence/FR2-12/audit-5/rerun-a3')) throw new Error('wrong dir');
const repoRoot = path.resolve(here, '..', '..', '..', '..', '..', '..', '..');
const CLI = path.join(repoRoot, 'packages', 'cli', 'dist', 'cli.js');
const GROUP = process.argv[2] ?? 'sweep';
const OUT = path.join(here, `probe-cli-${GROUP}.json`);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const TMP_ROOT = path.join(os.tmpdir(), `fr212-audit3-cli-${GROUP}-${Date.now()}`);
await fs.mkdir(TMP_ROOT, { recursive: true });

const H = (t, body, script = '') => `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${t}</title></head><body>${body}${script ? `<script>${script}</script>` : ''}</body></html>`;
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const send = (code, body, headers = { 'Content-Type': 'text/html' }) => { res.writeHead(code, headers); res.end(body); };
  const p = u.pathname;
  if (p === '/favicon.ico') return send(200, '', { 'Content-Type': 'image/x-icon' });
  if (p === '/clean') return send(200, H('clean', '<h1>clean</h1>'));
  if (p === '/alertload') return send(200, H('al', '<h1>a</h1>', `alert('a3-alert-load')`));
  if (p === '/alertat') return send(200, H('at', '<h1>a</h1><p style="height:3000px">tall</p>', `setTimeout(function(){alert('a3-at-${u.searchParams.get('ms')}')}, ${Number(u.searchParams.get('ms'))})`));
  if (p === '/alertconfirm') return send(200, H('ac', '<h1>a</h1>', `setTimeout(function(){alert('a3-a');confirm('a3-c')}, ${Number(u.searchParams.get('ms'))})`));
  if (p === '/bigalert') {
    let b = ''; for (let i = 0; i < 4000; i++) b += `<button id="b${i}">btn ${i}</button><a href="#l${i}">link ${i}</a>`;
    return send(200, H('big', b, `setTimeout(function(){alert('a3-snap-${u.searchParams.get('d')}')}, ${Number(u.searchParams.get('d'))})`));
  }
  if (p === '/own-404-empty') { res.writeHead(404, { 'Content-Length': '0' }); return res.end(); }
  if (p === '/own-500-empty') { res.writeHead(500, { 'Content-Length': '0' }); return res.end(); }
  if (p === '/own-404-hash') return send(404, H('nf', '<h1>404</h1>', `location.hash='top'`));
  if (p === '/own-404') return send(404, H('nf', '<h1>404</h1>'));
  send(404, 'nf', { 'Content-Type': 'text/plain' });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

const children = new Set();
function runCli(args, stateDir, timeoutMs = 90000) {
  return new Promise((resolve) => {
    const cp = spawn(process.execPath, [CLI, ...args], { env: { ...process.env, SUTRADHAR_CLI_STATE_DIR: stateDir }, cwd: TMP_ROOT });
    children.add(cp);
    let stdout = '', stderr = '', timedOut = false;
    const t0 = Date.now();
    const timer = setTimeout(() => { timedOut = true; try { execFileSync('taskkill', ['/PID', String(cp.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {} }, timeoutMs);
    cp.stdout.on('data', (d) => (stdout += d));
    cp.stderr.on('data', (d) => (stderr += d));
    cp.on('close', (code) => { clearTimeout(timer); children.delete(cp); resolve({ code, stdout, stderr, ms: Date.now() - t0, timedOut }); });
  });
}
/** Counts top-level JSON values on stdout; flags any non-JSON residue. */
function countDocs(s) {
  let i = 0, docs = [], junk = '';
  const n = s.length;
  while (i < n) {
    while (i < n && /\s/.test(s[i])) i++;
    if (i >= n) break;
    if (s[i] !== '{' && s[i] !== '[') { const j = s.indexOf('\n', i); junk += s.slice(i, j < 0 ? n : j) + '\n'; i = j < 0 ? n : j + 1; continue; }
    let depth = 0, inStr = false, esc = false, start = i;
    for (; i < n; i++) {
      const c = s[i];
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true; else if (c === '{' || c === '[') depth++; else if (c === '}' || c === ']') { depth--; if (depth === 0) { i++; break; } }
    }
    const txt = s.slice(start, i);
    try { docs.push(JSON.parse(txt)); } catch { junk += txt; }
  }
  return { count: docs.length, docs, junk: junk.trim() };
}
const kind = (d) => (d && d.schemaVersion === 1 ? 'report' : d && 'dialogPending' in d ? 'blocked' : d && 'nodes' in d ? 'snap' : 'other');
function describe(r) {
  const c = countDocs(r.stdout);
  return { code: r.code, ms: r.ms, timedOut: r.timedOut, docCount: c.count, kinds: c.docs.map(kind), junk: c.junk.slice(0, 300) || undefined,
    fatal: /Fatal:/.test(r.stderr) || undefined, stderrHead: c.count !== 1 ? r.stderr.slice(0, 600) : undefined };
}
const out = { group: GROUP, origin, startedAt: new Date().toISOString(), rows: [], summary: {} };
const save = () => fs.writeFile(OUT, JSON.stringify(out, null, 2));
let seq = 0;
async function fresh() { const d = path.join(TMP_ROOT, `s${seq++}`); await fs.mkdir(d, { recursive: true }); return d; }
async function cleanupSession(s) { await runCli(['dialog', 'dismiss'], s, 30000); await runCli(['dialog', 'dismiss'], s, 30000); await runCli(['close'], s, 30000); }
const watchdog = setTimeout(async () => { out.watchdog = 'fired'; await save(); for (const c of children) try { execFileSync('taskkill', ['/PID', String(c.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {} process.exit(2); }, 45 * 60 * 1000);

async function auditAlert(ms, route = 'alertat', extra = []) {
  const s = await fresh();
  const r = await runCli(['audit', `${origin}/${route}?ms=${ms}&k=${seq}`, path.join(TMP_ROOT, `o${seq}`), '--json', ...extra], s);
  const d = describe(r);
  await cleanupSession(s);
  return d;
}
function summarize() {
  const bad = out.rows.filter((r) => r.docCount !== 1 || r.junk);
  const zero = out.rows.filter((r) => r.docCount === 0);
  out.summary = { total: out.rows.length, exactlyOneDoc: out.rows.filter((r) => r.docCount === 1 && !r.junk).length, zeroDocs: zero.length, multiDocs: out.rows.filter((r) => r.docCount > 1).length,
    badRows: bad.map((r) => ({ tag: r.tag, docCount: r.docCount, kinds: r.kinds, code: r.code, junk: r.junk, fatal: r.fatal })) };
}

try {
  if (GROUP === 'sweep') {
    for (let ms = 0; ms <= 3000; ms += 100) for (let t = 0; t < 3; t++) { out.rows.push({ tag: `alert@${ms}#${t}`, ...(await auditAlert(ms)) }); summarize(); await save(); }
  }
  if (GROUP === 'fine') {
    for (let ms = 1400; ms <= 1800; ms += 20) for (let t = 0; t < 2; t++) { out.rows.push({ tag: `alert@${ms}#${t}`, ...(await auditAlert(ms)) }); summarize(); await save(); }
    for (const ms of [1500, 1540, 1560, 1580, 1600]) for (let t = 0; t < 2; t++) { out.rows.push({ tag: `alertconfirm@${ms}#${t}`, ...(await auditAlert(ms, 'alertconfirm')) }); summarize(); await save(); }
  }
  if (GROUP === 'shapes') {
    // GAP-261's original 3 shapes: default-policy leftover, accept flag / persisted accept / dismiss flag, never-handled mid-audit
    for (let t = 0; t < 3; t++) {
      const s = await fresh();
      await runCli(['nav', `${origin}/alertload?t=${t}`], s);
      const r = await runCli(['audit', `${origin}/clean?t=${t}`, path.join(TMP_ROOT, `o${seq++}`), '--json'], s);
      out.rows.push({ tag: `S1_defaultLeftover#${t}`, ...describe(r) });
      await cleanupSession(s); await save();
    }
    for (const [name, pre, extra] of [['S2_acceptFlag', null, ['--dialog', 'accept']], ['S2_persistedAccept', ['nav', `${origin}/clean`, '--dialog', 'accept'], []], ['S2_dismissFlag', null, ['--dialog', 'dismiss']]]) {
      for (const ms of [0, 600, 1550]) {
        const s = await fresh();
        if (pre) await runCli(pre, s);
        const r = await runCli(['audit', `${origin}/alertat?ms=${ms}&k=${name}`, path.join(TMP_ROOT, `o${seq++}`), '--json', ...extra], s);
        const d = describe(r);
        out.rows.push({ tag: `${name}@${ms}`, ...d, reportIsReport: d.kinds[0] === 'report' });
        await cleanupSession(s); await save();
      }
    }
    summarize();
  }
  if (GROUP === 'concurrent') {
    // two SEPARATE CLI processes with separate state dirs (separate Chromes), alert during capture in both
    for (let pair = 0; pair < 5; pair++) {
      const [a, b] = await Promise.all([auditAlert(1550), auditAlert(1560)]);
      out.rows.push({ tag: `sepState-pair${pair}-A`, ...a }, { tag: `sepState-pair${pair}-B`, ...b });
      summarize(); await save();
    }
    // two concurrent processes sharing ONE state dir (same Chrome session) -- informational
    for (let pair = 0; pair < 3; pair++) {
      const s = await fresh();
      await runCli(['nav', `${origin}/clean?warm=${pair}`], s);
      const [a, b] = await Promise.all([
        runCli(['audit', `${origin}/alertat?ms=1550&p=${pair}a`, path.join(TMP_ROOT, `o${seq++}`), '--json'], s),
        runCli(['audit', `${origin}/clean?p=${pair}b`, path.join(TMP_ROOT, `o${seq++}`), '--json'], s),
      ]);
      out.rows.push({ tag: `sharedState-pair${pair}-A`, ...describe(a) }, { tag: `sharedState-pair${pair}-B`, ...describe(b) });
      await cleanupSession(s); summarize(); await save();
    }
  }
  if (GROUP === 'snap') {
    // disclosed latent bug: snap --json's success write is not routed through the guard
    for (const d of [200, 400, 600, 800, 1000, 1300, 1600, 2000]) {
      for (let t = 0; t < 3; t++) {
        const s = await fresh();
        const nav = await runCli(['nav', `${origin}/bigalert?d=${d}&t=${t}`], s);
        const r = await runCli(['snap', '--json'], s);
        out.rows.push({ tag: `snap-alert@${d}#${t}`, navCode: nav.code, ...describe(r) });
        await cleanupSession(s); summarize(); await save();
      }
    }
  }
  if (GROUP === 'own404') {
    for (const route of ['own-404', 'own-404-empty', 'own-500-empty', 'own-404-hash']) {
      for (let t = 0; t < 3; t++) {
        const s = await fresh();
        for (const extra of [[], ['--fail-on-diff']]) {
          const r = await runCli(['audit', `${origin}/${route}?t=${t}`, path.join(TMP_ROOT, `o${seq++}`), '--json', ...extra], s);
          const c = countDocs(r.stdout);
          const rep = c.docs[0];
          out.rows.push({ tag: `${route}#${t}${extra.length ? ' --fail-on-diff' : ''}`, code: r.code, docCount: c.count, url: rep?.url, requestedUrl: rep?.requestedUrl,
            brokenRequests: rep?.brokenRequests, consoleErrors: rep?.consoleErrors?.map((x) => x.text), ownStatusReported: !!rep?.brokenRequests?.some((b) => b.url.includes(`/${route}`)) });
        }
        await runCli(['close'], s, 30000); await save();
      }
    }
    out.summary = Object.fromEntries(['own-404', 'own-404-empty', 'own-500-empty', 'own-404-hash'].map((rt) => [rt, `${out.rows.filter((r) => r.tag.startsWith(rt + '#') && r.ownStatusReported).length}/${out.rows.filter((r) => r.tag.startsWith(rt + '#')).length}`]));
  }
} finally {
  clearTimeout(watchdog);
  await save();
  server.close();
  for (let i = 0; i < 5; i++) { try { await fs.rm(TMP_ROOT, { recursive: true, force: true }); break; } catch { await delay(1000); } }
  out.tmpRemoved = !(await fs.stat(TMP_ROOT).then(() => true, () => false));
  await save();
  console.log(JSON.stringify(out.summary, null, 1));
  process.exit(0);
}
