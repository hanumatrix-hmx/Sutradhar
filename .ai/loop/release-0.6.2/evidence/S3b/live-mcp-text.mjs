// S3b live check: the MCP server (mcp-cli.js over stdio) against the fixture server. Run under the isolation preamble.
// Env: MCP (abs mcp-cli.js; default HEAD build), SP, WT, OUT (result json). RUNS/NO_MUTANTS: not used (nothing repeats, no mutants here).
// Mode is detected from tools/list (`browser.get_page_text` present = HEAD behaviour, absent = NEG061 old behaviour).
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

const norm = (p) => path.resolve(p).split(path.sep).join('/').toLowerCase().replace(/[/]+$/, '');
const SP = process.env.SP, WT = process.env.WT;
if (!SP || !WT) process.exit(2);
if (!norm(os.tmpdir()).startsWith(norm(SP) + '/')) { console.error('ISOLATION GUARD (harness)'); process.exit(97); }
const ISO = os.tmpdir();
if (ISO.length + 1 + 35 > 200) { console.error('ISO too long'); process.exit(2); }
const MCP = process.env.MCP ?? `${WT}/packages/sutradhar/dist/mcp-cli.js`;
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
console.error(`[harness] MCP=${MCP} sha256=${sha(MCP)} tmpdir=${norm(ISO)}`);
const { start } = await import(pathToFileURL(`${WT}/.ai/loop/release-0.6.2/evidence/fixtures/fixture-server.mjs`).href);
const f = await start();

const t0 = performance.now();
const child = spawn(process.execPath, [MCP], { cwd: ISO, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, SUTRADHAR_CONFIG: 'none', TEMP: ISO, TMP: ISO, TMPDIR: ISO } });
let exited = false; child.on('exit', () => { exited = true; });
let buf = ''; const pending = new Map(); let nextId = 1; let stderr = '';
child.stdout.on('data', (d) => { buf += d.toString(); let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(line); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } } catch { /* log line */ } } });
child.stderr.on('data', (d) => { stderr += d.toString(); });
const call = (method, params) => new Promise((resolve, reject) => {
  const id = nextId++; const to = setTimeout(() => { pending.delete(id); reject(new Error('timeout ' + method)); }, Math.max(1000, 240000 - (performance.now() - t0)));
  pending.set(id, (m) => { clearTimeout(to); resolve(m); });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
});
const tool = async (name, args) => { const m = await call('tools/call', { name, arguments: args }); return { isError: m.result?.isError === true || !!m.error, text: m.result?.content?.[0]?.text ?? JSON.stringify(m.error ?? m), raw: m }; };

const out = { mcp: MCP, mcpSha256: sha(MCP), checks: {} };
const check = (k, ok, detail) => { out.checks[k] = { ok: !!ok, detail }; console.error(`${ok ? 'PASS' : 'FAIL'} ${k}${detail !== undefined ? ' ' + JSON.stringify(detail).slice(0, 300) : ''}`); };
const MARK = (a, b, total, hint) => `[page text truncated: showing characters ${a}-${b} of ${total}. ${hint}]`;
const textBlock = (t) => { const i = t.indexOf('Page text:\n'); return i < 0 ? null : t.slice(i + 'Page text:\n'.length); };
let sessionId;
try {
  const init = await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 's3b-live', version: '1' } });
  out.version = init.result?.serverInfo?.version;
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const tl = await call('tools/list', {}); const names = (tl.result?.tools ?? []).map((t) => t.name);
  out.toolCount = names.length;
  const head = names.includes('browser.get_page_text');
  out.mode = head ? 'head' : 'neg';
  const launch = JSON.parse((await tool('browser.launch', { headless: true })).text); sessionId = launch.sessionId;
  check('launch', typeof sessionId === 'string');
  await tool('browser.navigate', { sessionId, url: `${f.url}/long?n=10000` });
  const FULL = JSON.parse((await tool('browser.eval', { sessionId, code: 'document.body.innerText' })).text).result;
  const L = FULL.length; out.L = L;
  check('FULL via browser.eval, L >= 10000', L >= 10000, L);
  const snap1 = await tool('browser.snapshot', { sessionId });
  const b1 = textBlock(snap1.text);
  if (head) {
    check('S3b-1 tools/list includes browser.get_page_text', true, out.toolCount);
    check('S3b-2 snapshot Page text block = FULL[0:2000] + marker naming get_page_text offset=2000',
      b1 === `${FULL.slice(0, 2000)}\n${MARK(0, 2000, L, 'Continue with browser.get_page_text offset=2000, or raise textMaxChars (max 40000)')}`, { len: b1?.length, tail: b1?.slice(-150) });
    const snap2 = await tool('browser.snapshot', { sessionId, textMaxChars: 5000 });
    const b2 = textBlock(snap2.text);
    check('S3b-2 textMaxChars 5000 = FULL[0:5000] + marker', b2 === `${FULL.slice(0, 5000)}\n${MARK(0, 5000, L, 'Continue with browser.get_page_text offset=5000, or raise textMaxChars (max 40000)')}`, { len: b2?.length });
    // paging
    let acc = ''; const wins = []; let off = 0; let lastMarker = null; let ok = true;
    for (let i = 0; i < 40 && off < L; i++) {
      const r = await tool('browser.get_page_text', { sessionId, offset: off, maxChars: 4000 });
      if (r.isError) { ok = false; break; }
      const m = /^([\s\S]*)\n(\[page text[^\n]*\])$/.exec(r.text);
      const text = m ? m[1] : r.text; wins.push(text); acc += text; off += text.length; lastMarker = m ? m[2] : null;
      if (lastMarker && lastMarker.includes('(end)')) break;
    }
    check('S3b-3 get_page_text paged to marker B: concatenation == FULL, windows differ', ok && acc === FULL && wins.length >= 3 && new Set(wins).size === wins.length, { windows: wins.length, acc: acc.length });
    check('S3b-3 last marker is (end)', lastMarker === `[page text: showing characters ${off - wins[wins.length - 1].length}-${L} of ${L} (end)]`, lastMarker);
    const big = await tool('browser.get_page_text', { sessionId, maxChars: 40001 });
    out.maxChars40001 = { isError: big.isError, text: big.text.slice(0, 200) };
    check('S3b maxChars 40001 -> schema error (isError / JSON-RPC error, no text window)', big.isError && !/page text truncated/.test(big.text), out.maxChars40001);
    const big2 = await tool('browser.snapshot', { sessionId, textMaxChars: 40001 });
    check('S3b snapshot textMaxChars 40001 -> schema error', big2.isError, big2.text.slice(0, 120));
    const d = await tool('browser.get_page_text', { sessionId, maxChars: 40000 });
    check('S3b maxChars 40000 accepted: whole page, no marker', !d.isError && d.text === FULL, { len: d.text.length });
  } else {
    check('S3b-5 NEG061 tools/list lacks browser.get_page_text', !names.includes('browser.get_page_text'), out.toolCount);
    check('S3b-5 NEG061 snapshot Page text block is exactly 2000 chars (= FULL[0:2000]) with no marker', b1 === FULL.slice(0, 2000) && !/page text/i.test(b1.replace(FULL.slice(0, 2000), '')), { len: b1?.length });
  }
  await tool('browser.navigate', { sessionId, url: `${f.url}/short` });
  const sn = await tool('browser.snapshot', { sessionId });
  const bs = textBlock(sn.text);
  out.shortBlock = bs; out.shortBlockSha256 = createHash('sha256').update(bs ?? '').digest('hex'); out.shortLength = bs?.length;
  check('S3b-4 /short snapshot text length > 200, no marker', (bs?.length ?? 0) > 200 && !/\[page text/.test(bs), bs?.length);
  const sd = await tool('browser.shutdown_all', {});
  check('shutdown_all', !sd.isError);
} catch (e) { check('noException', false, String(e?.stack ?? e)); }
try { child.stdin.end(); } catch { /* ignore */ }
const tw = performance.now(); while (!exited && performance.now() - tw < 15000) await new Promise((r) => setTimeout(r, 100));
if (!exited) { out.killedChild = true; spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); await new Promise((r) => setTimeout(r, 2000)); }
check('server child exited', exited);
const q = spawnSync('powershell', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'chrome|msedge' -and $_.CommandLine -like ('*' + $env:ISO_BASE + '*') } | ForEach-Object { $_.ProcessId }`], { encoding: 'utf8', env: { ...process.env, ISO_BASE: path.basename(ISO) } });
const left = (q.stdout ?? '').split(/\r?\n/).filter(Boolean);
check('no Chrome with the ISO basename left', left.length === 0, left);
await f.close();
out.stderrTail = stderr.split(/\r?\n/).filter(Boolean).slice(-4);
out.allPass = Object.values(out.checks).every((c) => c.ok);
if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify(out, null, 2));
console.error(out.allPass ? 'LIVE-MCP-TEXT OK' : 'LIVE-MCP-TEXT FAILED');
process.exitCode = out.allPass ? 0 : 1;
