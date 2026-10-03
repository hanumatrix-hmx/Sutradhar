// AUDIT-1 live MCP precedence: every subset of {env, config} x every key, on one MCP build (argv[2] =
// pkg | bundle). Observers: server Host log, page beacons, filesystem + sha256, chrome.exe process list.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startObserver } from './observer-server.mjs';
import { chromePids } from './procs.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const WT = path.resolve(HERE, '../../../../../../..');
const req = createRequire(path.join(WT, 'packages/mcp-server/package.json'));
const { Client } = await import(pathToFileURL(req.resolve('@modelcontextprotocol/sdk/client/index.js')).href);
const { StdioClientTransport } = await import(pathToFileURL(req.resolve('@modelcontextprotocol/sdk/client/stdio.js')).href);
const BUILD = process.argv[2];
const BIN = { pkg: path.join(WT, 'packages/mcp-server/dist/cli.js'), bundle: path.join(WT, 'packages/sutradhar/dist/mcp-cli.js') }[BUILD];
const S = path.resolve(process.argv[3], 'mcp-' + BUILD);
const OUT = path.join(HERE, '..', 'live-mcp-' + BUILD + '.jsonl'); fs.writeFileSync(OUT, '');
const T0 = performance.now();
const obs = await startObserver(); const P = obs.port;
const proj = path.join(S, 'proj'); const cwd = path.join(proj, 'a', 'b');
for (const d of [path.join(proj, '.git'), cwd, path.join(proj, 'cup'), path.join(S, 'envup'), path.join(S, 'other'), path.join(S, 'envdl')]) fs.mkdirSync(d, { recursive: true });
fs.writeFileSync(path.join(proj, 'cup', 'c.txt'), 'cfg-up'); fs.writeFileSync(path.join(S, 'envup', 'e.txt'), 'env-upload'); fs.writeFileSync(path.join(S, 'other', 'o.txt'), 'other-upload-file');
const CFGFILE = path.join(proj, '.sutradhar.json');
const url = (h, c) => 'http://' + h + ':' + P + '/p?c=' + encodeURIComponent(c);
async function waitFor(fn, ms) { const end = performance.now() + ms; for (;;) { const v = await fn(); if (v !== undefined) return v; if (performance.now() > end) return undefined; await new Promise((r) => setTimeout(r, 200)); } }
let pass = 0, fail = 0; const fails = [];
function rec(o) { fs.appendFileSync(OUT, JSON.stringify(o) + '\n'); if (o.pass) pass++; else { fail++; fails.push(o.id); } }
const txt = (r) => (r.content || []).map((c) => c.text || '').join('\n');
const parse = (r) => { try { return JSON.parse(txt(r)); } catch { return undefined; } };
for (const sub of [[], ['env'], ['config'], ['env', 'config']]) {
  const has = (l) => sub.includes(l); const id = BUILD + '[' + (sub.join('+') || 'none') + ']';
  const temp = path.join(S, 'temp-' + (sub.join('_') || 'none')); fs.mkdirSync(temp, { recursive: true });
  if (has('config')) fs.writeFileSync(CFGFILE, JSON.stringify({ allowedDomains: ['127.0.0.4'], downloadDir: './cdl', allowedUploadRoots: ['./cup'], dialog: { mode: 'accept', promptText: 'CFG' }, viewport: { width: 405, height: 305 }, idleTimeoutMs: 15000 }));
  else fs.rmSync(CFGFILE, { force: true });
  const env = { ...process.env, TEMP: temp, TMP: temp };
  for (const k of Object.keys(env)) if (/^SUTRADHAR_/i.test(k) || /^(OPENROUTER|OLLAMA)/i.test(k)) delete env[k];
  if (has('env')) Object.assign(env, { SUTRADHAR_ALLOWED_DOMAINS: '127.0.0.3', SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS: path.join(S, 'envdl'), SUTRADHAR_ALLOWED_UPLOAD_ROOTS: path.join(S, 'envup'), SUTRADHAR_IDLE_TIMEOUT_MS: '0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [BIN], cwd, env, stderr: 'pipe' });
  let stderr = ''; transport.stderr?.on('data', (d) => { stderr += d; });
  const client = new Client({ name: 'audit1', version: '1' });
  await client.connect(transport);
  const call = (name, args) => client.callTool({ name, arguments: args }, undefined, { timeout: 60000 }).catch((e) => ({ isError: true, content: [{ type: 'text', text: 'THROW ' + e.message }] }));
  await new Promise((r) => setTimeout(r, 300));
  const banner = stderr.split('\n').filter((l) => l.startsWith('[sutradhar-mcp]'));
  const wantBanner = has('config') ? 'config: loaded ' + CFGFILE + ' (found by searching upward from ' + cwd + ')' : 'config: none found';
  rec({ id: id + '.banner', banner, pass: banner.some((l) => l.includes(wantBanner)) && (has('config') === banner.some((l) => l.includes('sets dialog.mode "accept"'))) });
  const L1 = parse(await call('browser.launch', {})); const sid = L1?.sessionId;
  const winner = has('env') ? '127.0.0.3' : has('config') ? '127.0.0.4' : null;
  const nav = {};
  for (const h of ['127.0.0.3', '127.0.0.4', '127.0.0.5']) {
    const c = id + '-h' + h; const r = await call('browser.navigate', { sessionId: sid, url: url(h, c) });
    const reached = (await waitFor(() => (obs.pageHits(c).length ? true : undefined), 3000)) === true;
    nav[h] = { isError: !!r.isError, reached };
  }
  rec({ id: id + '.allowedDomains', expectWinner: winner ?? 'unrestricted', nav, pass: Object.entries(nav).every(([h, v]) => (winner === null || h === winner) ? (v.reached && !v.isError) : (!v.reached && v.isError)) });
  const cm = id + '-main';
  await call('browser.navigate', { sessionId: sid, url: url(winner ?? '127.0.0.5', cm) });
  const vp = await waitFor(() => obs.beacons(cm, 'vp')[0], 8000);
  rec({ id: id + '.viewport(config>default)', want: has('config') ? '405x305' : 'DEFAULT', got: vp, pass: has('config') ? vp === '405x305' : (vp !== undefined && vp !== '405x305') });
  const L2 = parse(await call('browser.launch', { viewport: { width: 404, height: 304 } })); const sid2 = L2?.sessionId; const cm2 = id + '-call';
  await call('browser.navigate', { sessionId: sid2, url: url(winner ?? '127.0.0.5', cm2) });
  const vp2 = await waitFor(() => obs.beacons(cm2, 'vp')[0], 8000);
  rec({ id: id + '.viewport(call>config)', got: vp2, pass: vp2 === '404x304' });
  await call('browser.shutdown', { sessionId: sid2 });
  const clickP = call('browser.click', { sessionId: sid, target: '#pr' });
  const pr = await waitFor(() => obs.beacons(cm, 'prompt')[0], 5000);
  let pend;
  if (!has('config')) { pend = txt(await call('browser.get_pending_dialog', { sessionId: sid })); await call('browser.handle_dialog', { sessionId: sid, action: 'dismiss' }); }
  await clickP;
  rec({ id: id + '.dialog', want: has('config') ? 'CFG' : 'pending-auto', got: pr ?? null, pend: pend ? pend.slice(0, 200) : null, pass: has('config') ? pr === 'CFG' : (pr === undefined && /prompt/i.test(pend || "")) });
  const rd = await call('browser.download_file', { sessionId: sid, target: '#dl' });
  const name = 'a1-' + cm.replace(/[^A-Za-z0-9_.-]/g, '_') + '.bin';
  const dirs = { env: path.join(S, 'envdl'), config: path.join(proj, 'cdl'), default: path.join(temp, 'sutradhar-downloads'), cwdRel: path.join(cwd, 'cdl') };
  const found = Object.entries(dirs).filter(([, d]) => fs.existsSync(path.join(d, name))).map(([k]) => k);
  const shaOk = found.length === 1 && obs.served.filter((s) => s.c === cm).map((s) => s.sha256).includes(crypto.createHash('sha256').update(fs.readFileSync(path.join(dirs[found[0]], name))).digest('hex'));
  const wantDl = has('env') ? 'env' : has('config') ? 'config' : 'default';
  rec({ id: id + '.download', want: wantDl, found, shaOk, err: rd.isError ? txt(rd).slice(0, 200) : undefined, pass: found.length === 1 && found[0] === wantDl && shaOk });
  const ups = {};
  for (const [k, f] of [['e', path.join(S, 'envup', 'e.txt')], ['c', path.join(proj, 'cup', 'c.txt')], ['o', path.join(S, 'other', 'o.txt')]]) {
    await new Promise((r0) => setTimeout(r0, 1300)); const before = obs.beacons(cm, 'up').length; const r = await call('browser.upload_file', { sessionId: sid, target: '#f', filePath: f });
    const got = await waitFor(() => (obs.beacons(cm, 'up').length > before ? obs.beacons(cm, 'up').at(-1) : undefined), 4000);
    const pj = parse(r); ups[k] = { success: pj ? pj.success === true : false, isError: !!r.isError, got: got ?? null };
  }
  const allowedSet = has('env') ? ['e'] : has('config') ? ['c'] : ['e', 'c', 'o'];
  rec({ id: id + '.upload', allowedSet, ups, pass: Object.entries(ups).every(([k, v]) => allowedSet.includes(k) ? (v.success && v.got && v.got.startsWith(k + '.txt:')) : (!v.success && v.got === null)) });
  const pidsBefore = await chromePids(temp);
  const wantReaped = has('config') && !has('env');
  const gone = await waitFor(async () => { const p = await chromePids(temp); return p && p.length === 0 ? true : undefined; }, wantReaped ? 50000 : 35000);
  rec({ id: id + '.idle', wantReaped, chromeBefore: pidsBefore ? pidsBefore.length : null, reaped: gone === true, pass: (gone === true) === wantReaped && (pidsBefore ? pidsBefore.length : 0) > 0 });
  await call('browser.shutdown_all', {});
  await client.close();
  await waitFor(async () => { const p = await chromePids(temp); return p && p.length === 0 ? true : undefined; }, 15000);
  const left = await chromePids(temp);
  if (left && left.length) fs.appendFileSync(OUT, JSON.stringify({ id: id + '.leftover', left }) + '\n');
}
fs.rmSync(CFGFILE, { force: true });
await obs.close();
const summary = { build: BUILD, pass, fail, fails, seconds: Math.round((performance.now() - T0) / 1000) };
fs.appendFileSync(OUT, JSON.stringify({ summary }) + '\n'); console.log(JSON.stringify(summary));
process.exit(0);
