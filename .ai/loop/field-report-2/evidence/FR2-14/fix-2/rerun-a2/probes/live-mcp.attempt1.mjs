// AUDIT-2 live MCP: {env, config} subsets x keys, plus F1 (refused discovered download root vs env / explicit file)
// and F8 (file viewport bound) at server startup. argv: <pkg|bundle> <scratch>.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { observer, chromePids, until } from './obs.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const WT = path.resolve(HERE, '../../../../../../..');
const req = createRequire(path.join(WT, 'packages/mcp-server/package.json'));
const { Client } = await import(pathToFileURL(req.resolve('@modelcontextprotocol/sdk/client/index.js')).href);
const { StdioClientTransport } = await import(pathToFileURL(req.resolve('@modelcontextprotocol/sdk/client/stdio.js')).href);
const BUILD = process.argv[2];
const BIN = { pkg: path.join(WT, 'packages/mcp-server/dist/cli.js'), bundle: path.join(WT, 'packages/sutradhar/dist/mcp-cli.js') }[BUILD];
const S = path.resolve(process.argv[3], 'mcp-' + BUILD); fs.rmSync(S, { recursive: true, force: true });
const OUT = path.join(HERE, '..', `live-mcp-${BUILD}.jsonl`); fs.writeFileSync(OUT, '');
const T0 = performance.now();
const O = await observer();
const mk = (...p) => { const d = path.join(S, ...p); fs.mkdirSync(d, { recursive: true }); return d; };
const proj = mk('proj'); mk('proj', '.git'); const cwd = mk('proj', 'x', 'y');
const envdl = mk('envdl'); const envup = mk('envup'); const other = mk('other'); const cup = mk('proj', 'cup');
fs.writeFileSync(path.join(envup, 'E.txt'), 'e'); fs.writeFileSync(path.join(cup, 'C.txt'), 'c'); fs.writeFileSync(path.join(other, 'X.txt'), 'x');
const CFG = path.join(proj, '.sutradhar.json');
let pass = 0, fail = 0; const fails = [];
const rec = (o) => { fs.appendFileSync(OUT, JSON.stringify(o) + '\n'); o.pass ? pass++ : (fail++, fails.push(o.id)); };
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const dlName = (tag) => 'a2-' + tag.replace(/[^A-Za-z0-9_-]/g, '_') + '.bin';
const where = (tag, dirs) => Object.entries(dirs).filter(([, d]) => fs.existsSync(path.join(d, dlName(tag)))).map(([k]) => k);
const shaOk = (tag, dir) => O.served.some((s) => s.tag === tag && s.sha === sha(path.join(dir, dlName(tag))));
const txt = (r) => (r.content || []).map((c) => c.text || '').join('\n');
const pj = (r) => { try { return JSON.parse(txt(r)); } catch { return undefined; } };
function envFor(temp, extra) { const e = { ...process.env, TEMP: temp, TMP: temp }; for (const k of Object.keys(e)) if (/^SUTRADHAR_|^OPENROUTER|^OLLAMA/i.test(k)) delete e[k]; return { ...e, ...extra }; }
// start the server; returns {client, call, stderr()} or {exitCode, stderr} if it died at startup
async function start(dir, temp, extra) {
  const transport = new StdioClientTransport({ command: process.execPath, args: [BIN], cwd: dir, env: envFor(temp, extra), stderr: 'pipe' });
  let se = ''; transport.stderr?.on('data', (d) => (se += d));
  const client = new Client({ name: 'audit2', version: '1' });
  try { await Promise.race([client.connect(transport), new Promise((_, r) => setTimeout(() => r(new Error('connect timeout')), 30000))]); }
  catch (e) { await new Promise((r) => setTimeout(r, 500)); try { await client.close(); } catch {} return { died: true, err: e.message, stderr: () => se }; }
  const call = (name, args) => client.callTool({ name, arguments: args }, undefined, { timeout: 60000 }).catch((e) => ({ isError: true, content: [{ type: 'text', text: 'THROW ' + e.message }] }));
  return { client, call, stderr: () => se };
}
const H = { env: '127.0.0.42', config: '127.0.0.43', loser: '127.0.0.44' };
async function matrix() {
  for (const sub of [['config'], ['env', 'config'], [], ['env']]) {
    const has = (l) => sub.includes(l); const id = `${BUILD}[${sub.join('+') || 'none'}]`; const tg = (s) => `m-${BUILD}-${sub.join('_') || 'none'}-${s}`;
    const temp = mk('temp-' + (sub.join('_') || 'none'));
    const VC = { width: 411 + sub.length, height: 311 + sub.length };
    if (has('config')) fs.writeFileSync(CFG, JSON.stringify({ allowedDomains: [H.config], downloadDir: './cdl', allowedUploadRoots: ['./cup'], dialog: { mode: 'accept', promptText: 'CF-' + BUILD }, viewport: VC, idleTimeoutMs: 3000 }));
    else fs.rmSync(CFG, { force: true });
    const env = has('env') ? { SUTRADHAR_ALLOWED_DOMAINS: H.env, SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS: envdl, SUTRADHAR_ALLOWED_UPLOAD_ROOTS: envup, SUTRADHAR_IDLE_TIMEOUT_MS: '0' } : {};
    const s = await start(cwd, temp, env);
    if (s.died) { rec({ id: id + '.start', err: s.err, se: s.stderr().slice(0, 400), pass: false }); continue; }
    await new Promise((r) => setTimeout(r, 300));
    const banner = s.stderr().split(String.fromCharCode(10)).filter((l) => l.startsWith('[sutradhar-mcp]'));
    rec({ id: id + '.banner', banner, pass: has('config') ? banner.some((l) => l.includes('config: loaded ' + CFG)) && banner.some((l) => l.includes('sets dialog.mode "accept"')) : banner.some((l) => l.includes('config: none found')) });
    const sid = pj(await s.call('browser.launch', {}))?.sessionId;
    const win = has('env') ? 'env' : has('config') ? 'config' : null; const host = win ? H[win] : H.loser;
    const r1 = await s.call('browser.navigate', { sessionId: sid, url: O.url(host, tg('main')) });
    const ok1 = !!(await until(() => O.reached(tg('main')).length > 0, 4000));
    const lose = win ? H.loser : H.config;
    const r2 = await s.call('browser.navigate', { sessionId: sid, url: O.url(lose, tg('lose')) });
    const ok2 = !!(await until(() => O.reached(tg('lose')).length > 0, 2500));
    rec({ id: id + '.domains', want: win ?? 'unrestricted', main: [!!r1.isError, ok1], lose: [!!r2.isError, ok2], pass: !r1.isError && ok1 && (win ? !ok2 : ok2) });
    if (!win) await s.call('browser.navigate', { sessionId: sid, url: O.url(host, tg('main2')) });
    const pageTag = win ? tg('main') : tg('main2');
    const v = await until(() => O.sig(pageTag, 'vp')[0], 8000);
    rec({ id: id + '.viewport', want: has('config') ? `${VC.width}x${VC.height}` : 'default', got: v, pass: has('config') ? v === `${VC.width}x${VC.height}` : v !== undefined && v !== `${VC.width}x${VC.height}` });
    const cp = s.call('browser.click', { sessionId: sid, target: '#pq' });
    const pq = await until(() => O.sig(pageTag, 'pq')[0], 5000);
    let pend = null;
    if (!has('config')) { pend = txt(await s.call('browser.get_pending_dialog', { sessionId: sid })).slice(0, 160); await s.call('browser.handle_dialog', { sessionId: sid, action: 'dismiss' }); }
    await cp;
    rec({ id: id + '.dialog', got: pq ?? null, pend, pass: has('config') ? pq === 'CF-' + BUILD : pq === undefined && /prompt/i.test(pend || '') });
    const rd = await s.call('browser.download_file', { sessionId: sid, target: '#dl' });
    const dirs = { env: envdl, config: path.join(proj, 'cdl'), default: path.join(temp, 'sutradhar-downloads'), cwdRel: path.join(cwd, 'cdl') };
    const found = where(pageTag, dirs); const want = has('env') ? 'env' : has('config') ? 'config' : 'default';
    rec({ id: id + '.download', want, found, err: rd.isError ? txt(rd).slice(0, 160) : null, pass: found.length === 1 && found[0] === want && shaOk(pageTag, dirs[want]) });
    const ups = {};
    for (const [k, f] of [['E', path.join(envup, 'E.txt')], ['C', path.join(cup, 'C.txt')], ['X', path.join(other, 'X.txt')]]) {
      await new Promise((r) => setTimeout(r, 1300)); const before = O.sig(pageTag, 'up').length;
      const r = pj(await s.call('browser.upload_file', { sessionId: sid, target: '#up', filePath: f }));
      const got = await until(() => (O.sig(pageTag, 'up').length > before ? O.sig(pageTag, 'up').at(-1) : undefined), 4000);
      ups[k] = [r?.success === true, got ?? null];
    }
    const allow = has('env') ? ['E'] : has('config') ? ['C'] : ['E', 'C', 'X'];
    rec({ id: id + '.upload', allow, ups, pass: Object.entries(ups).every(([k, [ok, g]]) => (allow.includes(k) ? ok && g === k + '.txt' : !ok && g === null)) });
    // idle: config 3000 ms reaps (no calls); env "0" outranks it; default 30 min does not reap in the window
    const before = (await chromePids(temp))?.length ?? 0;
    const reaped = !!(await until(async () => { const p = await chromePids(temp); return p && p.length === 0; }, has('config') && !has('env') ? 30000 : 12000, 1000));
    rec({ id: id + '.idle', before, reaped, pass: before > 0 && reaped === (has('config') && !has('env')) });
    await s.call('browser.shutdown_all', {}); try { await s.client.close(); } catch {}
    await until(async () => { const p = await chromePids(temp); return p && p.length === 0; }, 15000, 1000);
  }
  fs.rmSync(CFG, { force: true });
}
async function f1f8() {
  const hp = mk('hp'); mk('hp', '.git'); const hcwd = mk('hp', 'w'); const outside = path.join(S, 'outside-hp');
  const HF = path.join(hp, '.sutradhar.json'); fs.writeFileSync(HF, JSON.stringify({ downloadDir: '../outside-hp' }));
  const temp = mk('temp-f1'); const host = '127.0.0.51';
  const need = ["outside this config's directory", 'SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS', 'allowedDownloadRoots', 'SUTRADHAR_CONFIG=<file>'];
  for (const [lab, extra] of [['none', {}], ['envEmpty', { SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS: '' }], ['envBlank', { SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS: ' ; ' }], ['envZero', { SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS: '0' }], ['uploadOnly', { SUTRADHAR_ALLOWED_UPLOAD_ROOTS: envup }]]) {
    const s = await start(hcwd, temp, extra); const pids = (await chromePids(temp))?.length;
    if (!s.died) { try { await s.client.close(); } catch {} }
    rec({ id: `${BUILD}.F1.${lab}.fatal`, died: !!s.died, se: s.stderr().slice(0, 300), missing: lab === 'none' ? need.filter((n) => !s.stderr().includes(n)) : [], pids, pass: !!s.died && /fatal/.test(s.stderr()) && pids === 0 && (lab !== 'none' || need.every((n) => s.stderr().includes(n))) });
  }
  // env override works
  {
    const s = await start(hcwd, temp, { SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS: envdl });
    if (s.died) rec({ id: `${BUILD}.F1.envOverride`, se: s.stderr().slice(0, 300), pass: false });
    else {
      const sid = pj(await s.call('browser.launch', {}))?.sessionId; const t = `f1-${BUILD}-env`;
      await s.call('browser.navigate', { sessionId: sid, url: O.url(host, t) }); const rd = await s.call('browser.download_file', { sessionId: sid, target: '#dl' });
      const found = where(t, { env: envdl, outside, def: path.join(temp, 'sutradhar-downloads') });
      rec({ id: `${BUILD}.F1.envOverride`, found, err: rd.isError ? txt(rd).slice(0, 200) : null, pass: found.join() === 'env' && shaOk(t, envdl) && !fs.existsSync(outside) });
      await s.call('browser.shutdown_all', {}); try { await s.client.close(); } catch {}
    }
  }
  // explicit SUTRADHAR_CONFIG=<file> trusted
  {
    const s = await start(hcwd, temp, { SUTRADHAR_CONFIG: HF });
    if (s.died) rec({ id: `${BUILD}.F1.explicit`, se: s.stderr().slice(0, 300), pass: false });
    else {
      const sid = pj(await s.call('browser.launch', {}))?.sessionId; const t = `f1-${BUILD}-ex`;
      await s.call('browser.navigate', { sessionId: sid, url: O.url(host, t) }); const rd = await s.call('browser.download_file', { sessionId: sid, target: '#dl' });
      const found = where(t, { outside, env: envdl, def: path.join(temp, 'sutradhar-downloads') });
      rec({ id: `${BUILD}.F1.explicit`, found, err: rd.isError ? txt(rd).slice(0, 200) : null, pass: found.join() === 'outside' && shaOk(t, outside) });
      await s.call('browser.shutdown_all', {}); try { await s.client.close(); } catch {}
    }
  }
  // F8: file viewport over the bound is fatal at startup; at the bound it starts
  const vd = mk('vp'); mk('vp', '.git');
  for (const [lab, w, wantDie] of [['1e9', 1000000000, true], ['max+1', 10000001, true], ['max', 10000000, false]]) {
    fs.writeFileSync(path.join(vd, '.sutradhar.json'), JSON.stringify({ viewport: { width: w, height: 300 } }));
    const s = await start(vd, temp, {});
    if (!s.died) { try { await s.client.close(); } catch {} }
    rec({ id: `${BUILD}.F8.file-${lab}`, died: !!s.died, se: s.stderr().slice(0, 200), pass: !!s.died === wantDie && (!wantDie || /viewport\.width must be a positive integer/.test(s.stderr())) });
  }
  await until(async () => { const p = await chromePids(temp); return p && p.length === 0; }, 15000, 1000);
  // F8 / GAP-350 claim check: an out-of-range browser.launch ARGUMENT (not via resolveViewport). Leak check by PID.
  {
    const t8 = mk('temp-f8call'); const cd = mk('f8call'); mk('f8call', '.git');
    const s = await start(cd, t8, {});
    if (s.died) rec({ id: BUILD + '.F8.callHuge', se: s.stderr().slice(0, 200), pass: false });
    else {
      const r = await s.call('browser.launch', { viewport: { width: 1000000000, height: 1000000000 } });
      const during = (await chromePids(t8))?.length;
      await s.call('browser.shutdown_all', {}); await new Promise((x) => setTimeout(x, 2000));
      const afterShutdown = (await chromePids(t8))?.length;
      try { await s.client.close(); } catch {}
      await new Promise((x) => setTimeout(x, 3000));
      const afterExit = await chromePids(t8);
      rec({ id: BUILD + '.F8.callHuge', isError: !!r.isError, text: txt(r).slice(0, 200), during, afterShutdown, afterExit, pass: (afterExit ?? [1]).length === 0, note: 'observed: GAP-350 says the call argument is treated as absent' });
    }
  }
}
try { await matrix(); await f1f8(); } catch (e) { rec({ id: 'HARNESS-ERROR', err: String(e.stack).slice(0, 500), pass: false }); }
const left = await chromePids(S);
fs.appendFileSync(OUT, JSON.stringify({ summary: { pass, fail, fails, leftChromePids: left, ms: Math.round(performance.now() - T0) } }) + '\n');
console.log(JSON.stringify({ build: BUILD, pass, fail, fails, leftChromePids: left }));
await O.close(); process.exit(0);
