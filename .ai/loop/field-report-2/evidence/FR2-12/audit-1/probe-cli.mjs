// FR2-12 audit-1: independent CLI probes (auditor-written).
// Focus: is `audit --json` stdout really "exactly one JSON document" (D2.1) when a dialog is involved
// (the disclosed D2.4 deviation), plus the B1-residual leak through the CLI, and misc edge cases.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..', '..', '..', '..');
const CLI = path.join(repoRoot, 'packages', 'cli', 'dist', 'cli.js');
const OUT = path.join(here, 'probe-cli.json');
const reqMcp = createRequire(path.join(repoRoot, 'packages', 'mcp-server', 'package.json'));
const { AjvJsonSchemaValidator } = reqMcp('@modelcontextprotocol/sdk/validation/ajv');
const schema = JSON.parse(await fs.readFile(path.join(repoRoot, 'packages', 'capability-runtime', 'schemas', 'audit-report.schema.json'), 'utf8'));
const validate = new AjvJsonSchemaValidator().getValidator(schema);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const TMP_ROOT = path.join(os.tmpdir(), `fr212-audit1-cli-${Date.now()}`);
await fs.mkdir(TMP_ROOT, { recursive: true });

const page = (title, body) => `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const send = (code, body, type = 'text/html') => { res.writeHead(code, { 'Content-Type': type }); res.end(body); };
  if (u.pathname === '/favicon.ico') return send(204, '');
  if (u.pathname === '/clean') return send(200, page('clean', '<h1>clean</h1>'));
  if (u.pathname === '/alertload') return send(200, page('alertload', `<h1>alert on load</h1><script>alert('fr212-audit1-alert')</script>`));
  if (u.pathname === '/alertlate') return send(200, page('alertlate', `<h1>alert later</h1><script>setTimeout(()=>alert('fr212-late'),600)</script>`));
  if (u.pathname === '/poller') return send(200, page('poller', `<p>poller</p><script>setInterval(()=>{console.error('poll-err');fetch('/missing-poll?t='+Date.now()).catch(()=>{})},25)</script>`));
  if (u.pathname === '/slowclean') { await delay(Number(u.searchParams.get('ms') ?? 800)); return send(200, page('slowclean', '<h1>slow clean</h1>')); }
  return send(404, 'nf', 'text/plain');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

const children = new Set();
function runCli(args, stateDir, timeoutMs = 120000) {
  return new Promise((resolve) => {
    const cp = spawn(process.execPath, [CLI, ...args], { env: { ...process.env, SUTRADHAR_CLI_STATE_DIR: stateDir }, cwd: TMP_ROOT });
    children.add(cp);
    let stdout = '', stderr = '';
    const t0 = Date.now();
    const timer = setTimeout(() => { try { process.kill(cp.pid); } catch {} }, timeoutMs);
    cp.stdout.on('data', (d) => (stdout += d));
    cp.stderr.on('data', (d) => (stderr += d));
    cp.on('close', (code) => { clearTimeout(timer); children.delete(cp); resolve({ code, stdout, stderr, ms: Date.now() - t0 }); });
  });
}
function parseOneDoc(stdout) {
  try { const j = JSON.parse(stdout); return { single: true, doc: j }; } catch (e) { return { single: false, err: e.message }; }
}
const out = { origin, cases: {} };
const save = () => fs.writeFile(OUT, JSON.stringify(out, null, 2));
const stateDirs = [];
async function fresh(name) { const d = path.join(TMP_ROOT, 'state-' + name); await fs.mkdir(d, { recursive: true }); stateDirs.push(d); return d; }
const brief = (r) => ({ code: r.code, ms: r.ms, stdoutHead: r.stdout.slice(0, 300), stdoutTail: r.stdout.slice(-400), stderr: r.stderr.slice(0, 600) });

try {
  // D-a: explicit --dialog accept on a page that alerts on load
  {
    const s = await fresh('da');
    const r = await runCli(['audit', `${origin}/alertload`, path.join(TMP_ROOT, 'da'), '--json', '--dialog', 'accept'], s);
    const p = parseOneDoc(r.stdout);
    out.cases.dialogAcceptOnLoad = { ...brief(r), stdoutIsSingleJson: p.single, parseErr: p.err, dialogLines: r.stdout.split('\n').filter((l) => l.startsWith('dialog')) };
    await runCli(['close'], s);
    await save();
  }
  // D-b: policy persisted by an EARLIER command (nav --dialog accept), then a plain audit --json
  {
    const s = await fresh('db');
    await runCli(['nav', `${origin}/clean`, '--dialog', 'accept'], s);
    const r = await runCli(['audit', `${origin}/alertload`, path.join(TMP_ROOT, 'db'), '--json'], s);
    const p = parseOneDoc(r.stdout);
    out.cases.persistedAcceptPolicy = { ...brief(r), stdoutIsSingleJson: p.single, parseErr: p.err, dialogLines: r.stdout.split('\n').filter((l) => l.startsWith('dialog')) };
    await runCli(['close'], s);
    await save();
  }
  // D-c: default policy (report) — alert on load
  {
    const s = await fresh('dc');
    const r = await runCli(['audit', `${origin}/alertload`, path.join(TMP_ROOT, 'dc'), '--json'], s);
    const p = parseOneDoc(r.stdout);
    out.cases.defaultPolicyAlertOnLoad = { ...brief(r), stdoutIsSingleJson: p.single, stdoutEmpty: r.stdout.trim() === '', parseErr: p.err };
    await runCli(['dialog', 'dismiss'], s);
    await runCli(['close'], s);
    await save();
  }
  // D-d: late alert (fires during the 1500ms dwell) with accept policy
  {
    const s = await fresh('dd');
    const r = await runCli(['audit', `${origin}/alertlate`, path.join(TMP_ROOT, 'dd'), '--json', '--dialog', 'accept'], s);
    const p = parseOneDoc(r.stdout);
    out.cases.dialogAcceptLate = { ...brief(r), stdoutIsSingleJson: p.single, parseErr: p.err, dialogLines: r.stdout.split('\n').filter((l) => l.startsWith('dialog')) };
    await runCli(['close'], s);
    await save();
  }
  // B1-residual through the CLI: nav to a polling-error page, then audit a slow-TTFB clean URL
  {
    const s = await fresh('b1');
    out.cases.cliB1residual = [];
    for (let i = 0; i < 3; i++) {
      await runCli(['nav', `${origin}/poller`], s);
      await delay(400);
      const r = await runCli(['audit', `${origin}/slowclean?ms=800&i=${i}`, path.join(TMP_ROOT, 'b1'), '--json'], s);
      const p = parseOneDoc(r.stdout);
      out.cases.cliB1residual.push(p.single
        ? { i, code: r.code, consoleErrors: p.doc.consoleErrors.length, broken: p.doc.brokenRequests.length, cover: p.doc.observation.coversWholeDocument, valid: validate(p.doc).valid, sample: p.doc.consoleErrors.slice(0, 2).map((e) => e.text) }
        : { i, ...brief(r) });
      await save();
    }
    // --fail-on-diff consequence: clean page audited right after the poller page
    await runCli(['nav', `${origin}/poller`], s);
    await delay(400);
    const g = await runCli(['audit', `${origin}/slowclean?ms=300&g=1`, path.join(TMP_ROOT, 'b1g'), '--json', '--fail-on-diff'], s);
    const pg = parseOneDoc(g.stdout);
    out.cases.cliFailOnDiffFalseGate = { code: g.code, consoleErrors: pg.doc?.consoleErrors.length, broken: pg.doc?.brokenRequests.length, cover: pg.doc?.observation.coversWholeDocument, ttfbMs: 300 };
    // same page audited fresh (no poller before) for contrast
    await runCli(['nav', `${origin}/clean`], s);
    await delay(300);
    const h = await runCli(['audit', `${origin}/slowclean?ms=300&g=2`, path.join(TMP_ROOT, 'b1h'), '--json', '--fail-on-diff'], s);
    const ph = parseOneDoc(h.stdout);
    out.cases.cliFailOnDiffControl = { code: h.code, consoleErrors: ph.doc?.consoleErrors.length, broken: ph.doc?.brokenRequests.length };
    await runCli(['close'], s);
    await save();
  }
  // Misc: current page with "" + --json; relative outDir; outDir a file + --json (stdout empty?)
  {
    const s = await fresh('misc');
    await runCli(['nav', `${origin}/clean`], s);
    const r = await runCli(['audit', '', 'rel-out/x', '--json'], s);
    const p = parseOneDoc(r.stdout);
    out.cases.currentPageRelativeOutDir = p.single
      ? { code: r.code, valid: validate(p.doc).valid, path: p.doc.screenshot.path, isAbs: path.isAbsolute(p.doc.screenshot.path), under: p.doc.screenshot.path.startsWith(TMP_ROOT), exists: !!(await fs.stat(p.doc.screenshot.path).catch(() => null)), mode: p.doc.observation.mode, cover: p.doc.observation.coversWholeDocument, stderr: r.stderr.slice(0, 300) }
      : brief(r);
    const fileAsDir = path.join(TMP_ROOT, 'iamafile');
    await fs.writeFile(fileAsDir, 'x');
    const f = await runCli(['audit', `${origin}/clean`, fileAsDir, '--json'], s);
    out.cases.outDirIsFileJson = { code: f.code, stdoutEmpty: f.stdout.trim() === '', stderr: f.stderr.slice(0, 300) };
    await runCli(['close'], s);
    await save();
  }
} catch (e) {
  out.fatal = String(e?.stack ?? e);
} finally {
  await save();
  for (const cp of children) { try { process.kill(cp.pid); } catch {} }
  server.close();
}
console.log('done');
