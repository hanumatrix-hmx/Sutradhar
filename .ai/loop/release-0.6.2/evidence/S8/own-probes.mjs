// S8 auditor's own live probes (not a builder harness). Env: SP, WT, CLI (abs cli-bin.js; default HEAD dist), MCP, OUT,
// LOGDIR, PROBES (comma list of P1..P7; default all). Run under the isolation preamble; ISO = os.tmpdir().
import os from 'node:os'; import path from 'node:path'; import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
const norm = (p) => path.resolve(p).split(path.sep).join('/').toLowerCase().replace(/[/]+$/, '');
const SP = process.env.SP, WT = process.env.WT;
if (!SP || !WT || !norm(os.tmpdir()).startsWith(norm(SP) + '/')) { console.error('ISOLATION GUARD (probe)'); process.exit(97); }
const ISO = os.tmpdir().split(path.sep).join('/');
if (!existsSync(`${ISO}/.r062`)) { console.error('no .r062'); process.exit(2); }
const CLI = process.env.CLI ?? `${WT}/packages/sutradhar/dist/cli-bin.js`;
const MCP = process.env.MCP ?? path.join(path.dirname(CLI), 'mcp-cli.js');
const PROBES = new Set((process.env.PROBES ?? 'P1,P2,P3,P4,P5,P6,P7').split(','));
const LOGDIR = process.env.LOGDIR ?? `${ISO}/logs`; mkdirSync(LOGDIR, { recursive: true });
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
console.error(`[probe] CLI=${CLI} sha256=${sha(CLI)} PROBES=${[...PROBES]}`);
const fxChild = spawn(process.execPath, [`${WT}/.ai/loop/release-0.6.2/evidence/S8/probe-server.mjs`], { stdio: ['pipe', 'pipe', 'inherit'] });
const fx = await new Promise((r) => { let b = ''; fxChild.stdout.on('data', (d) => { b += d; const i = b.indexOf('\n'); if (i >= 0) r(JSON.parse(b.slice(0, i))); }); });
console.error(`[probe] fixture ${JSON.stringify(fx)}`);
const baseEnv = { ...process.env, TEMP: os.tmpdir(), TMP: os.tmpdir(), TMPDIR: os.tmpdir(), SUTRADHAR_CLI_DEBUG_CLEANUP: '1', SUTRADHAR_CONFIG: 'none' };
let n = 0; const logs = [];
const cli = (args, stateDir = `${ISO}/state`, timeout = 120000) => {
  n++; const r = spawnSync(process.execPath, [CLI, ...args], { cwd: ISO, env: { ...baseEnv, SUTRADHAR_CLI_STATE_DIR: stateDir }, encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024 });
  const log = `${LOGDIR}/${String(n).padStart(3, '0')}-${args[0]}.stderr.log`; writeFileSync(log, r.stderr ?? ''); logs.push(log);
  return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '', timedOut: r.error?.code === 'ETIMEDOUT' };
};
const out = { cli: CLI, cliSha256: sha(CLI), probes: {} }; let failures = 0;
const check = (k, ok, d) => { if (!ok) failures++; console.error(`${ok ? 'PASS' : 'FAIL'} ${k} ${JSON.stringify(d ?? '').slice(0, 400)}`); (out.checks ??= {})[k] = { ok: !!ok, d }; };
const RAW_DETACHED = /Attempted to use detached Frame/;
const errLines = (s) => s.split('\n').filter((l) => l && !l.startsWith('[iso-guard]') && !l.startsWith('[cleanup]') && !l.startsWith('{"timestamp"'));
const first = (r) => (r.out.split('\n')[0] || errLines(r.err)[0] || '').slice(0, 160);
try {
  if (PROBES.has('P1')) { // F5a: cross-origin/cross-site iframes navigating during the resolveElement loop
    const nv = cli(['nav', `${fx.a}/xo?k=4&ms=40`]); check('P1 nav', nv.code === 0, nv.code);
    const res = [];
    for (let i = 0; i < 8; i++) { const r = cli(['click', '#absent']); res.push({ code: r.code, raw: RAW_DETACHED.test(r.out + r.err), msg: first(r) }); }
    const inner = []; for (let i = 0; i < 5; i++) { const r = cli(['click', '#inner-btn']); inner.push({ code: r.code, raw: RAW_DETACHED.test(r.out + r.err), msg: first(r) }); }
    const navs = cli(['eval', 'window.__navs']).out.trim();
    out.probes.P1 = { absent: res, inner, navs };
    check('P1 churn happened (__navs > 50)', Number(navs) > 50, navs);
    check('P1 #absent under cross-origin iframe navigation: every run exit 1 "No visible element", never raw detached text', res.every((x) => x.code === 1 && !x.raw && /No visible element/.test(x.msg)), res);
    check('P1 #inner-btn (in a navigating child frame): never raw detached text', inner.every((x) => !x.raw), inner);
    cli(['close']);
  }
  if (PROBES.has('P2')) { // F5b: main frame navigates itself (same origin) during clicks
    const nv = cli(['nav', `${fx.a}/selfnav?ms=250`]); check('P2 nav', nv.code === 0, nv.code);
    const res = [];
    for (let i = 0; i < 10; i++) {
      const sel = i % 3 === 2 ? '#absent' : '#go'; const r = cli(['click', sel]); const all = r.out + r.err;
      res.push({ sel, code: r.code, raw: RAW_DETACHED.test(all), rawCtx: /Execution context was destroyed/.test(first(r)) && !/navigated away/.test(first(r)), msg: first(r) });
    }
    out.probes.P2 = res;
    check('P2 same-origin main-frame navigation during clicks: never raw "detached Frame" text', res.every((x) => !x.raw), res);
    check('P2 a context-destroyed failure surfaces as the navigated-away diagnosis, not as a bare raw context error', res.every((x) => !x.rawCtx), res.filter((x) => x.rawCtx));
    cli(['close']);
  }
  if (PROBES.has('P3')) { // T11: page text grows between paged reads; each marker must describe its own window
    const nv = cli(['nav', `${fx.a}/grow?start=600&add=400&ms=30`]); check('P3 nav', nv.code === 0, nv.code);
    const wins = []; let off = 0;
    const reA = /^\[page text truncated: showing characters (\d+)-(\d+) of (\d+)\. Continue with: sutradhar text --offset (\d+)\]$/;
    const reB = /^\[page text: showing characters (\d+)-(\d+) of (\d+) \(end\)\]$/;
    for (let i = 0; i < 40; i++) {
      const plain = i % 2 === 0;
      const r = cli(plain ? ['text', '--offset', String(off)] : ['text', '--json', '--offset', String(off)]);
      if (r.code !== 0) { wins.push({ i, code: r.code, selfConsistent: false }); break; }
      let w;
      if (plain) {
        const m = /^([\s\S]*)\n(\[page text[^\n]*\])\n$/.exec(r.out);
        const text = m ? m[1] : r.out.replace(/\n$/, ''); const marker = m ? m[2] : null;
        const A = marker && reA.exec(marker); const B = marker && reB.exec(marker); const mm = A || B;
        w = { i, mode: 'plain', text, marker, shape: A ? 'A' : B ? 'B' : marker ? 'other' : 'none', offset: mm ? +mm[1] : undefined, end: mm ? +mm[2] : undefined, total: mm ? +mm[3] : undefined, hint: A ? +A[4] : undefined };
        w.selfConsistent = !!mm && w.end - w.offset === text.length && (w.shape === 'A' ? w.end < w.total && w.hint === w.end : w.end === w.total) && w.offset === off;
      } else {
        const j = JSON.parse(r.out);
        w = { i, mode: 'json', text: j.text, offset: j.offset, end: j.offset + j.returnedChars, total: j.totalChars, truncated: j.truncated, shape: 'json' };
        w.selfConsistent = j.returnedChars === j.text.length && j.offset === off && j.truncated === (j.offset > 0 || j.offset + j.returnedChars < j.totalChars);
      }
      wins.push(w); off = w.end;
      if (w.end >= w.total) {
        const done = cli(['eval', 'window.__done']).out.trim();
        if (done === 'true') { const fj = JSON.parse(cli(['text', '--json', '--offset', String(off)]).out); if (fj.returnedChars === 0) break; }
      }
    }
    for (let k = 0; k < 30 && cli(['eval', 'window.__done']).out.trim() !== 'true'; k++) await new Promise((r) => setTimeout(r, 500));
    const FINAL = cli(['eval', 'document.body.innerText']).out.replace(/\n$/, '');
    const perWin = wins.map((w) => ({ i: w.i, mode: w.mode, shape: w.shape, offset: w.offset, end: w.end, total: w.total, hint: w.hint, selfConsistent: w.selfConsistent,
      textIsSnapshotWindow: w.text !== undefined && FINAL.slice(w.offset, w.end) === w.text,
      totalIsLineBoundary: w.total === FINAL.length || FINAL[w.total] === '\n' }));
    out.probes.P3 = { finalLength: FINAL.length, windows: perWin, totals: [...new Set(perWin.map((w) => w.total))].length };
    check('P3 the text really changed between paged reads (>= 2 distinct totals)', out.probes.P3.totals >= 2, out.probes.P3.totals);
    check('P3 >= 2 plain windows with marker A at offset > 0 (hint checked away from offset 0)', perWin.filter((w) => w.shape === 'A' && w.offset > 0).length >= 1, perWin.map((w) => [w.shape, w.offset]));
    check('P3 every window: marker/JSON numbers describe the returned text (end-offset == length, A iff end < total, hint == end)', perWin.every((w) => w.selfConsistent), perWin.filter((w) => !w.selfConsistent));
    check('P3 every window is exactly FINAL[offset:end] of a real snapshot whose total is a line boundary (prefix-growing page)', perWin.every((w) => w.textIsSnapshotWindow && w.totalIsLineBoundary), perWin.filter((w) => !(w.textIsSnapshotWindow && w.totalIsLineBoundary)));
    check('P3 concatenation of windows == FINAL', wins.map((w) => w.text ?? '').join('') === FINAL, { acc: wins.map((w) => w.text ?? '').join('').length, final: FINAL.length });
    cli(['close']);
  }
  if (PROBES.has('P4')) { // I-NAV own: #hash entries created AFTER load (the fixed S1 fixture covers only pushState)
    const nv = cli(['nav', `${fx.a}/plain`]); check('P4 nav', nv.code === 0, nv.code);
    cli(['eval', "location.hash = 'a'"]); cli(['eval', "location.hash = 'b'"]);
    const h0 = cli(['eval', 'location.hash']).out.trim();
    const b1 = cli(['back']); const h1 = cli(['eval', 'location.hash']).out.trim();
    const b2 = cli(['back']); const h2 = cli(['eval', 'location.href']).out.trim();
    const f1 = cli(['forward']); const h3 = cli(['eval', 'location.hash']).out.trim();
    out.probes.P4 = { h0, b1: [b1.code, first(b1)], h1, b2: [b2.code, first(b2)], h2, f1: [f1.code, first(f1)], h3 };
    check('P4 setup: two post-load hash entries (#b current)', h0 === '#b', h0);
    check('P4 back over a #hash entry: exit 0 "Navigated back to ...#a", location.hash == #a', b1.code === 0 && /^Navigated back to .*#a$/.test(first(b1)) && h1 === '#a', out.probes.P4);
    check('P4 second back: exit 0, URL without hash', b2.code === 0 && /^Navigated back to /.test(first(b2)) && h2 === `${fx.a}/plain`, out.probes.P4);
    check('P4 forward: exit 0, #a', f1.code === 0 && /^Navigated forward to .*#a$/.test(first(f1)) && h3 === '#a', out.probes.P4);
    cli(['close']);
  }
  if (PROBES.has('P5')) { // I-049 own: #N/[#N] on hover/select/type with independent read-backs
    cli(['nav', `${fx.a}/ids`]);
    const snap = cli(['snap']).out;
    const id = (re) => (re.exec(snap) || [])[1];
    const hv = id(/\[#(\d+)\][^\n]*Hover me/), sel = id(/\[#(\d+)\][^\n]*(?:select|combobox)/i), inp = id(/\[#(\d+)\][^\n]*Inp/);
    const h = cli(['hover', `#${hv}`]); const hov = cli(['eval', 'window.__hover || 0']).out.trim();
    const s = cli(['select', `[#${sel}]`, 'b']); const sv = cli(['eval', "document.getElementById('sel').value"]).out.trim();
    const t = cli(['type', ` #${inp} `, 'zz']); const tv = cli(['eval', "document.getElementById('inp').value"]).out.trim();
    out.probes.P5 = { ids: { hv, sel, inp }, hover: [h.code, hov, first(h)], select: [s.code, sv, first(s)], type: [t.code, tv, first(t)], snap: snap.split('\n').slice(0, 6) };
    check('P5 ids found in snap', !!(hv && sel && inp), out.probes.P5);
    check('P5 hover "#N" exit 0 and the page saw a mouseover', h.code === 0 && Number(hov) >= 1, out.probes.P5.hover);
    check('P5 select "[#N]" b -> value b', s.code === 0 && sv === 'b', out.probes.P5.select);
    check('P5 type " #N " (padded) -> value zz', t.code === 0 && tv === 'zz', out.probes.P5.type);
    cli(['close']);
  }
  if (PROBES.has('P6')) { // I-051 own: more verbs/flags with no session, each with its own fresh state dir
    const cases = [['tabs', '--json'], ['back', '--json'], ['reload'], ['forward', '--expect-url-changed'], ['eval', '1', '--json'], ['newtab', ''], ['audit', ''], ['download', '#x'], ['text', '--offset', '10']];
    const rows = []; let k = 0;
    for (const c of cases) {
      const st = `${ISO}/p6st${k++}`; if (existsSync(st)) throw new Error('state dir exists ' + st);
      const r = cli(c, st); const lines = errLines(r.err);
      const want = `Error: no active browser session \u2014 "${c[0]}" needs an open page and does not start one. Start a session with: sutradhar nav <url>`;
      rows.push({ args: c.join(' '), code: r.code, stdout: r.out, lines, exact: lines.length === 1 && lines[0] === want, state: existsSync(`${st}/state.json`) });
    }
    const isoCli = readdirSync(ISO).filter((x) => x.startsWith('sutradhar-cli-'));
    out.probes.P6 = { rows, isoCliDirs: isoCli };
    check('P6 no-session: exit 1, exactly the hint line on stderr, stdout empty, no state.json', rows.every((x) => x.code === 1 && x.exact && x.stdout === '' && !x.state), rows.filter((x) => !(x.code === 1 && x.exact && x.stdout === '' && !x.state)));
    check('P6 no sutradhar-cli-* profile created under ISO', isoCli.length === 0, isoCli);
  }
  if (PROBES.has('P7')) { // MCP get_page_text: FR2-10 omitted sessionId, marker C, and a read while a dialog is open
    const child = spawn(process.execPath, [MCP], { cwd: ISO, stdio: ['pipe', 'pipe', 'pipe'], env: { ...baseEnv } });
    let buf = ''; const pend = new Map(); let id = 1; let se = '';
    child.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(l); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } } catch { /* log */ } } });
    child.stderr.on('data', (d) => { se += d; });
    const call = (method, params, ms = 90000) => new Promise((res) => { const k = id++; const t = setTimeout(() => { pend.delete(k); res({ timeout: true }); }, ms); pend.set(k, (m) => { clearTimeout(t); res(m); }); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: k, method, params }) + '\n'); });
    const tool = async (name, args, ms) => { const m = await call('tools/call', { name, arguments: args }, ms); return m.timeout ? { timeout: true } : { isError: m.result?.isError === true || !!m.error, text: m.result?.content?.map((c) => c.text).join('\n') ?? JSON.stringify(m.error) }; };
    await call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 's8-probe', version: '1' } });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    const L = await tool('browser.launch', { headless: true });
    const nav = await tool('browser.navigate', { url: `${fx.a}/grow?start=300&add=0` });
    const g1 = await tool('browser.get_page_text', { maxChars: 1000 });
    const gC = await tool('browser.get_page_text', { offset: 999999 });
    await tool('browser.eval', { expression: "setTimeout(() => alert('blocked'), 0); 1" });
    await new Promise((r) => setTimeout(r, 700));
    const t0 = performance.now(); const gD = await tool('browser.get_page_text', {}, 120000); const dt = Math.round(performance.now() - t0);
    out.probes.P7 = { launch: (L.text ?? '').slice(0, 120), navErr: nav.isError, g1: { isError: g1.isError, tail: (g1.text ?? '').slice(-260) }, gC: gC.text?.slice(0, 200), dialogRead: { timeout: !!gD.timeout, isError: gD.isError, text: (gD.text ?? '').slice(0, 300), ms: dt } };
    check('P7 get_page_text with sessionId omitted (FR2-10) returns a window + marker A naming offset=1000', !g1.isError && /\[page text truncated: showing characters 0-1000 of \d+\. Continue with browser\.get_page_text offset=1000\]/.test(g1.text ?? ''), out.probes.P7.g1);
    check('P7 offset past the end -> marker C', /\[page text: offset 999999 is past the end; the page text has \d+ characters\]/.test(gC.text ?? ''), gC.text?.slice(0, 200));
    check('P7 read while an alert is open: an error with a reason or a real window, never an empty success, no hang', !gD.timeout && (gD.isError || (gD.text ?? '').trim().length > 0), out.probes.P7.dialogRead);
    await tool('browser.shutdown_all', {}, 30000);
    child.stdin.end(); await new Promise((r) => { const t = setTimeout(() => { child.kill(); r(); }, 15000); child.on('exit', () => { clearTimeout(t); r(); }); });
  }
} catch (e) { failures++; out.fatal = String(e?.stack ?? e); console.error('FATAL', out.fatal); }
finally { cli(['close']); fxChild.stdin.write('quit\n'); }
const pc = spawnSync(process.execPath, [`${SP}/iso/check-cleanup-paths.mjs`, ISO, ...logs], { encoding: 'utf8' });
check('path-log check exit 0', pc.status === 0, (pc.stdout ?? '').trim().split('\n').slice(-1));
out.failures = failures;
if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify(out, null, 2));
console.error(failures === 0 ? 'OWN-PROBES OK' : `OWN-PROBES FAILED (${failures})`);
process.exitCode = failures === 0 ? 0 : 1;
