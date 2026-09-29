// FR2-12 audit-2 (auditor-written): GAP-261 dialog shapes and GAP-262 through the real CLI.
// Every CLI call has a hard timeout; every session is closed; temp root removed at the end.
// Usage: node probe-cli.mjs [dialogs|leak|false-clean|all] [outSuffix]
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..', '..', '..', '..');
const CLI = path.join(repoRoot, 'packages', 'cli', 'dist', 'cli.js');
const ONLY = process.argv[2] ?? 'all';
const OUT = path.join(here, `probe-cli-${ONLY}${process.argv[3] ? '-' + process.argv[3] : ''}.json`);
const r = createRequire(path.join(repoRoot, 'packages', 'mcp-server', 'package.json'));
const r2 = createRequire(path.join(path.dirname(r.resolve('@modelcontextprotocol/sdk/package.json')), 'package.json'));
let Ajv = r2('ajv'); Ajv = Ajv.default ?? Ajv;
let addFormats = r2('ajv-formats'); addFormats = addFormats.default ?? addFormats;
const ajv = new Ajv({ allErrors: true, strict: false }); addFormats(ajv);
const validate = ajv.compile(JSON.parse(await fs.readFile(path.join(repoRoot, 'packages', 'capability-runtime', 'schemas', 'audit-report.schema.json'), 'utf8')));
const delay = (ms) => new Promise((res) => setTimeout(res, ms));
const TMP_ROOT = path.join(os.tmpdir(), `fr212-audit2-cli-${Date.now()}`);
await fs.mkdir(TMP_ROOT, { recursive: true });

const H = (t, body, script = '') => `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${t}</title></head><body>${body}${script ? `<script>${script}</script>` : ''}</body></html>`;
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const send = (code, body, type = 'text/html') => { res.writeHead(code, { 'Content-Type': type }); res.end(body); };
  const p = u.pathname;
  if (p === '/favicon.ico') return send(200, '', 'image/x-icon');
  if (p === '/clean') return send(200, H('clean', '<h1>clean</h1>'));
  if (p === '/alertload') return send(200, H('alertload', '<h1>a</h1>', `alert('audit2-alert-load')`));
  if (p === '/alertat') return send(200, H('alertat', '<h1>a</h1>', `setTimeout(function(){alert('audit2-alert-at-${u.searchParams.get('ms')}')}, ${Number(u.searchParams.get('ms'))})`));
  if (p === '/confirmload') return send(200, H('confirm', '<h1>c</h1>', `confirm('audit2-confirm')`));
  if (p === '/noisy-interval') return send(200, H('noisy', 'noisy', `var i=0;setInterval(function(){i++;console.error('noisy-'+i);fetch('/missing-noisy-'+i).catch(function(){})},25);`));
  if (p === '/clean-delayed') { await delay(Number(u.searchParams.get('delayMs') ?? 150)); return send(200, H('cd', '<h1>clean</h1>')); }
  if (p === '/clean-own') { await delay(150); return send(200, H('co', '<h1>own</h1>', `console.error('own-error-of-page')`)); }
  if (p === '/main-500') return send(500, H('500', '<h1>server error</h1>'));
  if (p === '/spa') return send(200, H('spa', '<h1>spa</h1><img src="/missing-spa-asset.png" alt="x">', `console.error('spa-own-error');fetch('/missing-spa-api').catch(function(){});setTimeout(function(){history.replaceState({},'',location.pathname+'?hydrated=1')},200)`));
  send(404, 'nf', 'text/plain');
});
await new Promise((res) => server.listen(0, '127.0.0.1', res));
const origin = `http://127.0.0.1:${server.address().port}`;

function cliChromes(){ try { return execFileSync('powershell', ['-NoProfile', '-Command', "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'chrome.exe' -and $_.CommandLine -match 'sutradhar-cli-' -and $_.CommandLine -notmatch '--type=' } | ForEach-Object { \"$($_.ProcessId)`t$($_.CommandLine)\" }"], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split(/\r?\n/).map((l) => l.trim()).filter(Boolean); } catch { return []; } }
const preCliChromes = new Set(cliChromes().map((l) => l.split(/\s/)[0]));
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
function oneDoc(stdout) { try { return { single: true, doc: JSON.parse(stdout) }; } catch (e) { return { single: false, err: e.message }; } }
const out = { origin, startedAt: new Date().toISOString(), cases: {} };
const save = () => fs.writeFile(OUT, JSON.stringify(out, null, 2));
const stateDirs = [];
let seq = 0;
async function fresh(name) { const d = path.join(TMP_ROOT, `state-${name}-${seq++}`); await fs.mkdir(d, { recursive: true }); stateDirs.push(d); return d; }
function describe(r) {
  const p = oneDoc(r.stdout);
  const isReport = p.single && p.doc && p.doc.schemaVersion === 1;
  return {
    code: r.code, ms: r.ms, timedOut: r.timedOut, stdoutIsSingleJson: p.single, parseErr: p.err,
    stdoutKind: !p.single ? 'NOT-JSON' : isReport ? 'report' : p.doc && 'dialogPending' in p.doc ? 'dialog-blocked-doc' : 'other-json',
    schemaValid: isReport ? validate(p.doc) : null, schemaErrors: isReport && !validate(p.doc) ? validate.errors?.slice(0, 3) : undefined,
    blockedDoc: p.single && !isReport ? p.doc : undefined,
    rawDialogLinesOnStdout: r.stdout.split('\n').filter((l) => /^dialog(Handled|Pending)/.test(l.trim())).length,
    stderrDialogLines: r.stderr.split('\n').filter((l) => /dialog/i.test(l)).slice(0, 4),
    report: isReport ? { url: p.doc.url, consoleErrors: p.doc.consoleErrors.map((c) => c.text), brokenRequests: p.doc.brokenRequests.map((b) => `${b.status} ${b.url.replace(origin, '')}`) } : undefined,
    stdoutHead: p.single ? undefined : r.stdout,
    stderrFull: p.single ? undefined : r.stderr,
  };
}
async function audit(s, url, extra = []) { return runCli(['audit', url, path.join(TMP_ROOT, `o${seq++}`), '--json', ...extra], s); }
const want = (k) => ONLY === 'all' || ONLY === k;

try {
  if (want('dialogs')) {
    // S1: default policy, dialog LEFT OVER from an earlier command, then audit --json
    for (let t = 0; t < 2; t++) {
      const s = await fresh('s1');
      const nav = await runCli(['nav', `${origin}/alertload?t=${t}`], s);
      const a = await audit(s, `${origin}/clean?t=${t}`);
      (out.cases.S1_defaultPolicyLeftover ??= []).push({ navCode: nav.code, navStdout: nav.stdout.slice(0, 200), audit: describe(a) });
      await runCli(['dialog', 'dismiss'], s); await runCli(['close'], s); await save();
    }
    // S1b: default policy, current-page audit (no url) while the leftover dialog is open
    {
      const s = await fresh('s1b');
      await runCli(['nav', `${origin}/alertload?b=1`], s);
      const a = await runCli(['audit', '', path.join(TMP_ROOT, `o${seq++}`), '--json'], s);
      out.cases.S1b_leftoverCurrentPage = describe(a);
      await runCli(['dialog', 'dismiss'], s); await runCli(['close'], s); await save();
    }
    // S2: accept policy, alert fires mid-audit (during settle); explicit flag and persisted-from-nav
    for (const [name, pre, extra] of [['S2_acceptFlag', null, ['--dialog', 'accept']], ['S2_persistedAccept', ['nav', `${origin}/clean`, '--dialog', 'accept'], []], ['S2_dismissFlag', null, ['--dialog', 'dismiss']]]) {
      for (const ms of [0, 600]) {
        const s = await fresh(name);
        if (pre) await runCli(pre, s);
        const a = await audit(s, `${origin}/alertat?ms=${ms}&k=${name}`, extra);
        (out.cases[name] ??= []).push({ alertAtMs: ms, audit: describe(a) });
        await runCli(['close'], s); await save();
      }
    }
    // S3: default policy, never-handled alert opening mid-audit at various offsets (incl. the
    // settle/evaluate boundary around 1500ms) and on load; also confirm() on load
    for (const ms of [0, 600, 1400, 1500, 1550, 1650, 1800]) {
      const s = await fresh('s3');
      const a = await audit(s, `${origin}/alertat?ms=${ms}&s3=1`);
      (out.cases.S3_neverHandledMidAudit ??= []).push({ alertAtMs: ms, audit: describe(a) });
      await runCli(['dialog', 'dismiss'], s); await runCli(['close'], s); await save();
    }
    {
      const s = await fresh('s3c');
      out.cases.S3_confirmOnLoad = describe(await audit(s, `${origin}/confirmload`));
      await runCli(['dialog', 'dismiss'], s); await runCli(['close'], s); await save();
    }
    // Non-dialog fatal error keeps its contract (empty stdout, exit 1): unreachable URL
    {
      const s = await fresh('fatal');
      const a = await audit(s, `http://127.0.0.1:1/unreachable`);
      out.cases.nonDialogFatal = { code: a.code, stdoutEmpty: a.stdout.trim() === '', stderr: a.stderr.slice(0, 200) };
      await runCli(['close'], s); await save();
    }
    // control: no dialog at all
    { const s = await fresh('ctl'); out.cases.control = describe(await audit(s, `${origin}/clean?ctl=1`)); await runCli(['close'], s); await save(); }
  }
  if (ONLY === 'mut') {
    const m = {};
    { const s = await fresh('m1'); await runCli(['nav', `${origin}/alertload?m=1`], s); m.S1_leftover = describe(await audit(s, `${origin}/clean?m=1`)); await runCli(['dialog', 'dismiss'], s); await runCli(['close'], s); }
    { const s = await fresh('m2'); m.S2_accept600 = describe(await audit(s, `${origin}/alertat?ms=600&m=2`, ['--dialog', 'accept'])); await runCli(['close'], s); }
    { const s = await fresh('m3'); m.S3_at0 = describe(await audit(s, `${origin}/alertat?ms=0&m=3`)); await runCli(['dialog', 'dismiss'], s); await runCli(['close'], s); }
    { const s = await fresh('m4'); m.S3_at600 = describe(await audit(s, `${origin}/alertat?ms=600&m=4`)); await runCli(['dialog', 'dismiss'], s); await runCli(['close'], s); }
    out.cases.mut = Object.fromEntries(Object.entries(m).map(([k, d]) => [k, { code: d.code, single: d.stdoutIsSingleJson, kind: d.stdoutKind }]));
    await save();
  }
  if (want('boundary1500')) {
    for (let rep = 0; rep < 3; rep++) for (const ms of [1450, 1500, 1525, 1550, 1575, 1600]) {
      const s = await fresh('b15');
      const a = await audit(s, `${origin}/alertat?ms=${ms}&rep=${rep}`);
      (out.cases.S3_boundary ??= []).push({ alertAtMs: ms, audit: describe(a) });
      await runCli(['dialog', 'dismiss'], s); await runCli(['close'], s); await save();
    }
  }
  if (want('leak')) {
    const s = await fresh('leak');
    const trials = [];
    for (let t = 0; t < 15; t++) {
      await runCli(['nav', `${origin}/noisy-interval?t=${t}`], s);
      const a = describe(await audit(s, `${origin}/clean-delayed?delayMs=150&t=${t}`, ['--fail-on-diff']));
      const leaks = a.report ? a.report.consoleErrors.filter((x) => x.startsWith('noisy')).length + a.report.brokenRequests.filter((x) => x.includes('noisy')).length : null;
      trials.push({ t, code: a.code, leaks, schemaValid: a.schemaValid, single: a.stdoutIsSingleJson });
      out.cases.leak = trials; await save();
    }
    for (let t = 0; t < 3; t++) {
      await runCli(['nav', `${origin}/noisy-interval?o=${t}`], s);
      const a = describe(await audit(s, `${origin}/clean-own?o=${t}`));
      (out.cases.leakOwnKept ??= []).push({ ownKept: a.report?.consoleErrors.includes('own-error-of-page'), leaks: a.report?.consoleErrors.filter((x) => x.startsWith('noisy')).length });
      await save();
    }
    await runCli(['close'], s); await save();
  }
  if (want('false-clean')) {
    // the new regressions through the CLI's CI gate: exit 0 == "clean" under --fail-on-diff
    const s = await fresh('fc');
    for (let t = 0; t < 3; t++) {
      (out.cases.spaReplaceStateFailOnDiff ??= []).push(describe(await audit(s, `${origin}/spa?t=${t}`, ['--fail-on-diff'])));
      (out.cases.main500 ??= []).push(describe(await audit(s, `${origin}/main-500?t=${t}`, ['--fail-on-diff'])));
      await save();
    }
    await runCli(['close'], s); await save();
  }
} finally {
  out.finishedAt = new Date().toISOString();
  for (const cp of children) { try { execFileSync('taskkill', ['/PID', String(cp.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {} }
  // any Chrome whose command line mentions our temp root (user-data-dir lives under the state dir or TMP) -- PID-scoped
  try {
    const list = execFileSync('powershell', ['-NoProfile', '-Command', "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'chrome.exe' } | ForEach-Object { \"$($_.ProcessId)`t$($_.CommandLine)\" }"], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const mine = list.split('\n').filter((l) => stateDirs.some((d) => l.includes(d)) || l.includes(TMP_ROOT));
    out.leftoverChromeByTempDir = mine.length;
  } catch (e) { out.listingError = String(e); }
  try { const post = cliChromes().filter((l) => !preCliChromes.has(l.split(/\s/)[0])); out.newCliChromeRootsLeft = post.map((l) => l.slice(0, 200)); } catch (e) { out.cliChromeListErr = String(e); }
  await save();
  server.close();
  await fs.rm(TMP_ROOT, { recursive: true, force: true }).catch((e) => { out.rmError = String(e); });
  await save();
}
console.log('done', ONLY);
process.exit(0);
