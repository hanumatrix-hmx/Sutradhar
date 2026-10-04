// DIAGNOSTIC (not an AC harness): why the S1 fixture /hist/spa does not produce two same-document entries, and what the
// verbs do on (a) the S1 fixture as it is and (b) a variant whose inline script uses TWO history.pushState calls.
// Run under the isolation preamble (Git Bash). Env: CLI (absolute cli-bin.js; default HEAD build), SP, WT, OUT.
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';

const norm = (p) => path.resolve(p).split(path.sep).join('/').toLowerCase().replace(/[/]+$/, '');
const SP = process.env.SP, WT = process.env.WT;
if (!norm(os.tmpdir()).startsWith(norm(SP) + '/')) { console.error('ISOLATION GUARD (diag)'); process.exit(97); }
const ISO = os.tmpdir().split(path.sep).join('/');
if (!existsSync(`${ISO}/.r062`)) { console.error('ISO has no .r062 marker'); process.exit(2); }
const CLI = process.env.CLI ?? `${WT}/packages/sutradhar/dist/cli-bin.js`;
const OUT = process.env.OUT;
const LOGDIR = `${ISO}/diag-logs`; mkdirSync(LOGDIR, { recursive: true });

// The variant server is a child process (the CLI is driven with spawnSync, which blocks this process's event loop).
if (process.argv[2] === '--server') {
  const page = (title, script) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title}</h1><script>${script}</script></body></html>`;
  const srv = http.createServer((req, res) => {
    const p = new URL(req.url, 'http://x').pathname;
    res.setHeader('content-type', 'text/html; charset=utf-8'); res.setHeader('cache-control', 'no-store');
    // identical to the S1 fixture's /hist/spa
    if (p === '/spa-orig') return res.end(page('spa-orig', "history.pushState({}, '', '#2'); location.hash = 'x';"));
    // variant: both same-document entries made with pushState (location.hash during load is converted to a replace by Chrome)
    if (p === '/spa-2push') return res.end(page('spa-2push', "history.pushState({}, '', '#2'); history.pushState({}, '', '#x');"));
    if (p === '/plain') return res.end(page('plain', 'plain'));
    res.statusCode = 404; res.end('nf');
  });
  srv.listen(0, '127.0.0.1', () => process.stdout.write(JSON.stringify({ url: `http://127.0.0.1:${srv.address().port}` }) + '\n'));
  process.stdin.on('data', (d) => { if (String(d).includes('quit')) { srv.close(); process.exit(0); } });
} else {
  const child = spawn(process.execPath, [new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), '--server'], { env: process.env, stdio: ['pipe', 'pipe', 'inherit'] });
  const url = JSON.parse(await new Promise((r) => child.stdout.once('data', (d) => r(String(d).split('\n')[0])))).url;
  const baseEnv = { ...process.env, TEMP: os.tmpdir(), TMP: os.tmpdir(), TMPDIR: os.tmpdir(), SUTRADHAR_CLI_DEBUG_CLEANUP: '1', SUTRADHAR_CONFIG: 'none' };
  let n = 0;
  const run = (state, args) => {
    n++; const r = spawnSync(process.execPath, [CLI, ...args], { cwd: ISO, env: { ...baseEnv, SUTRADHAR_CLI_STATE_DIR: state }, encoding: 'utf8', timeout: 120000 });
    writeFileSync(`${LOGDIR}/${String(n).padStart(2, '0')}-${args[0]}.log`, r.stderr ?? '');
    return { code: r.status, out: (r.stdout ?? '').split(/\r?\n/).filter(Boolean), val: (r.stdout ?? '').replace(/\r?\n$/, '') };
  };
  const result = { cli: CLI, variants: {} };
  for (const [name, route] of [['S1-fixture (/hist/spa body, served as /spa-orig)', '/spa-orig'], ['two-pushState variant', '/spa-2push']]) {
    const state = `${ISO}/st-${route.slice(1)}`; if (existsSync(state)) throw new Error('state exists');
    const v = {};
    run(state, ['nav', `${url}/plain`]); // history: [NTP, blank-before(404 page)]
    v.entriesBefore = Number(run(state, ['eval', 'history.length']).val);
    run(state, ['nav', `${url}${route}`]);
    v.hash = run(state, ['eval', 'location.hash']).val;
    v.entriesAfter = Number(run(state, ['eval', 'history.length']).val);
    v.extraEntriesCreatedByThePage = v.entriesAfter - v.entriesBefore - 1;
    const b1 = run(state, ['back']); const h1 = run(state, ['eval', 'location.href']).val;
    const b2 = run(state, ['back']); const h2 = run(state, ['eval', 'location.href']).val;
    const f1 = run(state, ['forward']); const h3 = run(state, ['eval', 'location.href']).val;
    v.steps = { back1: { code: b1.code, line: b1.out[0], href: h1 }, back2: { code: b2.code, line: b2.out[0], href: h2 }, forward1: { code: f1.code, line: f1.out[0], href: h3 } };
    run(state, ['close']);
    result.variants[name] = v;
    console.error(`[diag] ${name}: ${JSON.stringify(v)}`);
  }
  child.stdin.write('quit\n');
  if (OUT) writeFileSync(OUT, JSON.stringify(result, null, 2));
}
