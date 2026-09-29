// FR2-05 audit-2: independent live probes through the REAL sutradhar-mcp server + REAL Chrome,
// using the repo's own fixture server (tools/scenario-suite/fixtures/fr2-05-download-server.mjs).
// MCP is the untrusted-LLM surface (unlike the CLI, it never auto-grants the requested dir).
//
// Groups (argv, default all): g294 cs fold upload legit conc multiproc
// Writes live-mcp-audit2-<groups>.json. All temp state under one mkdtemp R; PID-tracked processes only.
import fs from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..', '..', '..', '..', '..', '..');
const MCP_PATH = path.join(repoRoot, 'packages', 'mcp-server', 'dist', 'cli.js');
const { startDownloadServer } = await import(
  pathToFileURL(path.join(repoRoot, 'tools', 'scenario-suite', 'fixtures', 'fr2-05-download-server.mjs')).href
);
const USER_DOWNLOADS = path.join(os.homedir(), 'Downloads');
const GROUPS = process.argv.slice(2).length ? process.argv.slice(2) : ['g294', 'cs', 'fold', 'upload', 'legit', 'conc', 'multiproc'];
const TAG = `a2${Date.now().toString(36)}`;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function record(e) {
  results.push(e);
  console.log(`[${e.pass ? 'PASS' : 'FAIL'}] ${e.id}${e.detail ? ' -- ' + e.detail : ''}`);
}

// ---------- processes ----------
const children = new Set();
function track(cp) { children.add(cp); cp.on('exit', () => children.delete(cp)); return cp; }
async function killTracked() {
  for (const cp of [...children]) {
    if (!cp.pid || cp.exitCode !== null) continue;
    const exited = new Promise((r) => cp.once('exit', r));
    try { process.kill(cp.pid); } catch { continue; }
    if (await Promise.race([exited.then(() => false), delay(3000).then(() => true)])) {
      try { execFileSync('taskkill', ['/PID', String(cp.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {}
      await Promise.race([exited, delay(2000)]);
    }
  }
}
function cmd(line) {
  try {
    return { ok: true, out: execFileSync('cmd.exe', ['/d', '/s', '/c', `"${line}"`], { encoding: 'utf8', windowsVerbatimArguments: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim() };
  } catch (e) { return { ok: false, out: String(e.stderr ?? e.message).trim().slice(0, 200) }; }
}
const junction = (link, target) => cmd(`mklink /J "${link}" "${target}"`);

// ---------- MCP client ----------
function mcp(env) {
  const child = track(spawn(process.execPath, [MCP_PATH], { stdio: ['pipe', 'pipe', 'pipe'], env }));
  let buf = ''; let id = 1; const pending = new Map(); const stderr = [];
  child.stdout.on('data', (c) => {
    buf += c.toString('utf8'); let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue; let m; try { m = JSON.parse(line); } catch { continue; }
      if (m.id !== undefined && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
    }
  });
  child.stderr.on('data', (d) => stderr.push(d.toString('utf8')));
  const call = (method, params, t = 240000) => new Promise((resolve, reject) => {
    const n = id++; pending.set(n, { resolve, reject });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n');
    setTimeout(() => { if (pending.has(n)) { pending.delete(n); reject(new Error(`timeout ${method}`)); } }, t);
  });
  const tool = async (name, args, t) => {
    const r = await call('tools/call', { name, arguments: args }, t);
    const text = r.content?.[0]?.text ?? '';
    try { return JSON.parse(text); } catch { return { success: false, error: text, isError: r.isError }; }
  };
  const init = async () => {
    await call('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'fr2-05-audit2', version: '0' } });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n');
  };
  const close = async () => {
    try { await tool('browser.shutdown_all', {}, 30000); } catch {}
    child.stdin.end();
    await Promise.race([new Promise((r) => child.once('exit', r)), delay(10000)]);
  };
  return { child, tool, init, close, stderr };
}

// ---------- helpers ----------
const sha = async (f) => crypto.createHash('sha256').update(await fs.readFile(f)).digest('hex');
function findName(name, dirs) {
  const hits = [];
  const walk = (d, depth) => {
    let ents; try { ents = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.name === name) hits.push(p);
      if (e.isDirectory() && !e.isSymbolicLink() && depth < 8) walk(p, depth + 1);
    }
  };
  for (const d of dirs) walk(d, 0);
  return hits;
}
function userDownloadsHits() {
  try { return readdirSync(USER_DOWNLOADS).filter((n) => n.startsWith(TAG)); } catch { return []; }
}

const R = await fs.mkdtemp(path.join(os.tmpdir(), 'fr205-audit2-mcp-'));
const server = await startDownloadServer();
const mk = async (...p) => { const d = path.join(R, ...p); await fs.mkdir(d, { recursive: true }); return d; };

const allowA = await mk('allowA');
const allowB = await mk('allowB');
const outside = await mk('outside');
const upRoot = await mk('up');
const upOutside = await mk('upOutside');
// case-sensitive parent (per-directory NTFS flag, settable without elevation here)
const csParent = await mk('cs');
const csFlag = cmd(`fsutil file setCaseSensitiveInfo "${csParent}" enable`);
const csRoot = path.join(csParent, 'dlroot'); await fs.mkdir(csRoot);
const csUpRoot = path.join(csParent, 'uproot'); await fs.mkdir(csUpRoot);
// fold roots
const KELVIN = 'K';
const kRoot = await mk('workroot');
const iRoot = await mk('winroot');
const sRoot = await mk('deskroot');

const env = {
  ...process.env,
  SUTRADHAR_CLI_STATE_DIR: path.join(R, 'state'),
  SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS: [allowA, allowB, csRoot, kRoot, iRoot, sRoot].join(';'),
  SUTRADHAR_ALLOWED_UPLOAD_ROOTS: [upRoot, csUpRoot].join(';'),
};
const searchDirs = [R];
let n = 0;
const uniq = (s) => `${TAG}-${s}-${++n}.bin`;

async function dl(c, sid, dir, label, tabId) {
  const name = uniq(label);
  await c.tool('browser.navigate', { sessionId: sid, url: server.pageUrl(label, { name }), ...(tabId ? { tabId } : {}) });
  await delay(1200);
  const t0 = Date.now();
  const r = await c.tool('browser.download_file', { sessionId: sid, target: '#dl', ...(dir !== undefined ? { downloadDir: dir } : {}), ...(tabId ? { tabId } : {}) });
  const ms = Date.now() - t0;
  await delay(700);
  return { name, r, ms, hits: findName(name, searchDirs), userDl: userDownloadsHits().filter((x) => x === name) };
}
const inside = (p, root) => p.toLowerCase().startsWith(root.toLowerCase() + path.sep);

try {
  const c = mcp(env);
  await c.init();
  const sid = (await c.tool('browser.launch', {})).sessionId;

  // ---------------- GAP-294 via MCP ----------------
  if (GROUPS.includes('g294')) {
    junction(path.join(allowA, 'jn'), outside);
    await fs.mkdir(path.join(allowA, 'subdir'), { recursive: true });
    const variants = {
      dot: [path.join(allowA, 'jn.', 'sub'), 15],
      space: [path.join(allowA, 'jn ', 'sub'), 5],
      anywhere: [path.join(allowA, 'subdir.', 'jn.', 'sub'), 5],
      dotspace: [path.join(allowA, 'jn. .', 'sub'), 3],
      threedots: [path.join(allowA, 'jn...', 'sub'), 3],
      leafdot: [path.join(allowA, 'jn.'), 3],
      fwdslash: [path.join(allowA, 'jn.', 'sub').replace(/\\/g, '/'), 3],
      extended: ['\\\\?\\' + path.join(allowA, 'jn.', 'sub'), 3],
      plainJunction: [path.join(allowA, 'jn', 'sub'), 3],
    };
    for (const [v, [dir, trials]] of Object.entries(variants)) {
      let esc = 0, rej = 0; const other = [];
      for (let i = 0; i < trials; i++) {
        const o = await dl(c, sid, dir, `g294${v}`);
        const outHits = o.hits.filter((h) => inside(h, outside));
        if (outHits.length || o.userDl.length || o.r.success) esc++; else if (/outside the allowed download|trailing dot or space/.test(String(o.r.error))) rej++; else other.push(String(o.r.error).slice(0,80));
      }
      record({ id: `GAP294-mcp-${v}`, pass: esc === 0 && rej === trials, detail: `containmentRejected=${rej}/${trials} other=${JSON.stringify(other)} escapes=${esc} outsideEntries=${JSON.stringify(readdirSync(outside))}` });
    }
  }

  // ---------------- case-sensitive parent (ASCII-fold assumption) ----------------
  if (GROUPS.includes('cs')) {
    record({ id: 'CS-setup', pass: csFlag.ok, detail: csFlag.out });
    if (csFlag.ok) {
      for (let i = 0; i < 3; i++) {
        const target = path.join(csParent, 'DLROOT', `sub${i}`);
        const o = await dl(c, sid, target, 'csNew');
        const landedOutside = o.hits.filter((h) => h.includes(path.join(csParent, 'DLROOT')));
        let shaOk = null;
        if (landedOutside.length) {
          const s = server.served.filter((x) => x.name === o.name).pop();
          shaOk = s ? (await sha(landedOutside[0])) === s.sha256 : null;
        }
        record({
          id: `CS-download-new-case-variant-sibling-t${i}`,
          pass: landedOutside.length === 0,
          detail: `success=${o.r.success} landed=${JSON.stringify(o.hits)} shaMatchesServed=${shaOk} csParentEntries=${JSON.stringify(readdirSync(csParent))} err=${String(o.r.error ?? '').slice(0, 120)}`,
        });
      }
      // pre-existing, genuinely different sibling folder that differs only in ASCII case
      const sib = path.join(csParent, 'Dlroot'); await fs.mkdir(sib, { recursive: true });
      await fs.writeFile(path.join(sib, 'unrelated-project-file.txt'), 'not in the allowed root');
      const o2 = await dl(c, sid, sib, 'csExisting');
      record({ id: 'CS-download-into-existing-case-variant-sibling', pass: !o2.hits.some((h) => inside(h, sib)), detail: `success=${o2.r.success} landed=${JSON.stringify(o2.hits)} err=${String(o2.r.error ?? '').slice(0, 140)}` });
      // upload: read a file from outside the upload root through the case variant
      const upSib = path.join(csParent, 'UPROOT'); await fs.mkdir(upSib, { recursive: true });
      const secret = path.join(upSib, 'secret-cs.txt'); await fs.writeFile(secret, 'SECRET-OUTSIDE-UPLOAD-ROOT');
      await c.tool('browser.navigate', { sessionId: sid, url: server.pageUrl('csUp', { name: uniq('csUp') }) });
      await delay(1200);
      const ur = await c.tool('browser.upload_file', { sessionId: sid, target: '#f', filePath: secret });
      await delay(500);
      const shown = await c.tool('browser.eval', { sessionId: sid, code: "document.getElementById('out').textContent" });
      record({ id: 'CS-upload-from-case-variant-sibling', pass: ur.success !== true, detail: `uploadSuccess=${ur.success} pageSaw=${JSON.stringify(shown.output ?? shown.result ?? shown).slice(0, 120)} err=${String(ur.error ?? '').slice(0, 120)}` });
      // control: same shape in a NORMAL (case-insensitive) parent must be allowed and land in the root
      const ctl = await dl(c, sid, path.join(allowA.toUpperCase(), 'ctl'), 'csControl');
      record({ id: 'CS-control-normal-dir-case-variant-allowed-inside', pass: ctl.r.success === true && ctl.hits.every((h) => inside(h, allowA)), detail: JSON.stringify(ctl.hits) });
    }
  }

  // ---------------- Unicode fold look-alikes (GAP-295 generalised), end-to-end ----------------
  if (GROUPS.includes('fold')) {
    const cases = [
      ['kelvin', path.join(R, `wor${KELVIN}root`), 10],
      ['dotless-i', path.join(R, 'wınroot'), 3],
      ['long-s', path.join(R, 'deſkroot'), 3],
      ['turkish-dotted-I', path.join(R, 'WİNROOT'), 3],
    ];
    for (const [label, look, trials] of cases) {
      let bad = 0;
      for (let i = 0; i < trials; i++) {
        const o = await dl(c, sid, path.join(look, 'sub'), `fold${label}`);
        if (o.r.success || existsSync(look) || !/outside the allowed download/.test(String(o.r.error))) bad++;
      }
      record({ id: `FOLD-${label}`, pass: bad === 0, detail: `rejected=${trials - bad}/${trials} lookalikeDirCreated=${existsSync(look)}` });
    }
  }

  // ---------------- uploads ----------------
  if (GROUPS.includes('upload')) {
    const secret = path.join(upOutside, 'secret-up.txt'); await fs.writeFile(secret, 'SECRET');
    junction(path.join(upRoot, 'jn'), upOutside);
    const legit = path.join(upRoot, 'legit file.v1.txt'); await fs.writeFile(legit, 'ok');
    await fs.mkdir(path.join(upRoot, 'my.dir'), { recursive: true });
    const legit2 = path.join(upRoot, 'my.dir', 'b.txt'); await fs.writeFile(legit2, 'ok2');
    const upCases = [
      ['jn-trailing-dot', path.join(upRoot, 'jn.', 'secret-up.txt'), false],
      ['jn-trailing-space', path.join(upRoot, 'jn ', 'secret-up.txt'), false],
      ['jn-plain', path.join(upRoot, 'jn', 'secret-up.txt'), false],
      ['traversal', path.join(upRoot, '..', 'upOutside', 'secret-up.txt'), false],
      ['direct-outside', secret, false],
      ['legit', legit, true],
      ['legit-dotted-dir', legit2, true],
      ['legit-forward-slashes', legit2.replace(/\\/g, '/'), true],
      ['legit-with-dotdot', path.join(upRoot, 'my.dir', '..', 'legit file.v1.txt'), true],
    ];
    for (const [label, fp, expectOk] of upCases) {
      await c.tool('browser.navigate', { sessionId: sid, url: server.pageUrl('up', { name: 'x' }) });
      await delay(1200);
      const r = await c.tool('browser.upload_file', { sessionId: sid, target: '#f', filePath: fp });
      const r2 = await (async () => {
        await c.tool('browser.navigate', { sessionId: sid, url: server.pageUrl('up2', { name: 'x' }) });
        await delay(1200);
        return c.tool('browser.upload_file_via_trigger', { sessionId: sid, target: '#pick', filePath: fp });
      })();
      const ok1 = expectOk ? r.success === true : r.success !== true;
      const ok2 = expectOk ? r2.success !== false && !r2.isError : r2.success === false || r2.isError === true;
      record({ id: `UPLOAD-${label}`, pass: ok1 && ok2, detail: `upload_file=${r.success} via_trigger=${JSON.stringify(r2).slice(0, 100)} err=${String(r.error ?? '').slice(0, 100)}` });
    }
  }

  // ---------------- ordinary, legitimate downloads ----------------
  if (GROUPS.includes('legit')) {
    const legit = [
      ['default-root (no downloadDir)', undefined, allowA],
      ['root itself', allowA, allowA],
      ['second root', allowB, allowB],
      ['nested new dirs', path.join(allowA, 'a', 'b', 'c'), allowA],
      ['dotted dir names', path.join(allowA, 'v1.2', 'my.files'), allowA],
      ['dir with spaces', path.join(allowB, 'my downloads', 'x y'), allowB],
      ['forward slashes', path.join(allowB, 'fs', 'q').replace(/\\/g, '/'), allowB],
      ['dotdot inside root', path.join(allowA, 'a', '..', 'dd'), allowA],
      ['uppercase root spelling', path.join(allowA.toUpperCase(), 'UP'), allowA],
    ];
    for (const [label, dir, root] of legit) {
      const o = await dl(c, sid, dir, 'legit');
      const s = server.served.filter((x) => x.name === o.name).pop();
      const f = o.hits[0];
      const ok = o.r.success === true && o.hits.length === 1 && inside(f, root) && s && (await sha(f)) === s.sha256;
      record({ id: `LEGIT-${label}`, pass: !!ok, detail: `success=${o.r.success} at=${f} ms=${o.ms} err=${String(o.r.error ?? '').slice(0, 100)}` });
    }
  }

  // ---------------- control: SEQUENTIAL download_file on new_tab tabs (no concurrency) ----------------
  if (GROUPS.includes('newtabseq')) {
    for (let t = 0; t < 4; t++) {
      const tabId = (await c.tool('browser.new_tab', { sessionId: sid })).id;
      const dir = path.join(allowA, `seq-t${t}`);
      const o = await dl(c, sid, dir, `seq${t}`, tabId);
      const ok = o.r.success === true && o.hits.length === 1 && inside(o.hits[0], dir) && o.userDl.length === 0;
      record({ id: `NEWTAB-sequential-t${t}`, pass: ok, detail: `success=${o.r.success} ms=${o.ms} retries=${o.r.retriesUsed} hits=${JSON.stringify(o.hits)} userDl=${JSON.stringify(o.userDl)} err=${String(o.r.error ?? '').slice(0, 120)}` });
      await c.tool('browser.close_tab', { sessionId: sid, tabId }).catch(() => {});
    }
  }

  // ---------------- does the 'deny' reset survive? plain browser.click after a completed download_file ----------------
  if (GROUPS.includes('afterdeny')) {
    for (let t = 0; t < 3; t++) {
      const o = await dl(c, sid, path.join(allowA, `ad-t${t}`), `ad${t}`);
      const name2 = uniq(`adclick${t}`);
      await c.tool('browser.navigate', { sessionId: sid, url: server.pageUrl(`adclick${t}`, { name: name2 }) });
      await delay(1200);
      const cr = await c.tool('browser.click', { sessionId: sid, target: '#dl' });
      await delay(4000);
      const served2 = server.served.filter((x) => x.name === name2).length;
      const hits2 = findName(name2, searchDirs);
      const user2 = userDownloadsHits().filter((x) => x === name2);
      record({ id: `AFTERDENY-plain-click-t${t}`, pass: user2.length === 0, detail: `download_file ok=${o.r.success}; then plain click ok=${cr.success} served=${served2} inRoots=${JSON.stringify(hits2)} inUserDownloads=${JSON.stringify(user2)}` });
    }
  }

  // ---------------- same-process concurrency ----------------
  if (GROUPS.includes('conc')) {
    const runConc = async (k, trials, label) => {
      const tabs = [];
      for (let i = 0; i < k; i++) tabs.push((await c.tool('browser.new_tab', { sessionId: sid })).id);
      let escapes = 0, cross = 0, ok = 0, fail = 0; const lat = [];
      for (let t = 0; t < trials; t++) {
        const specs = tabs.map((tabId, i) => ({ tabId, name: uniq(`${label}t${t}i${i}`), dir: path.join(i % 2 ? allowB : allowA, `${label}-t${t}-i${i}`) }));
        for (const s of specs) await c.tool('browser.navigate', { sessionId: sid, tabId: s.tabId, url: server.pageUrl(label, { name: s.name }) });
        await delay(1200);
        const t0 = Date.now();
        const rs = await Promise.all(specs.map((s) => c.tool('browser.download_file', { sessionId: sid, tabId: s.tabId, target: '#dl', downloadDir: s.dir }).then((r) => ({ r, ms: Date.now() - t0 }))));
        await delay(1500);
        specs.forEach((s, i) => {
          lat.push(rs[i].ms);
          const hits = findName(s.name, searchDirs);
          if (userDownloadsHits().includes(s.name)) escapes++;
          if (hits.some((h) => !inside(h, s.dir))) cross++;
          if (rs[i].r.success) ok++; else fail++;
        });
      }
      for (const tabId of tabs) await c.tool('browser.close_tab', { sessionId: sid, tabId }).catch(() => {});
      record({ id: `CONC-${label}-${k}tabs-x${trials}`, pass: escapes === 0 && cross === 0, detail: `ok=${ok} fail=${fail} escapesToUserDownloads=${escapes} crossDir=${cross} latencyMs(max)=${Math.max(...lat)}` });
    };
    await runConc(2, 10, 'c2');
    await runConc(3, 5, 'c3');
    await runConc(4, 3, 'c4');

    // A download_file that never gets a download (clicks a non-download element) runs the full
    // inner 30s wait + outer 15s race + GAP-020 retries while holding the per-browser lock;
    // a second, unrelated tab's download_file is started concurrently. Measure the cost.
    for (let t = 0; t < 2; t++) {
      const tA = (await c.tool('browser.new_tab', { sessionId: sid })).id;
      const tB = (await c.tool('browser.new_tab', { sessionId: sid })).id;
      const nameB = uniq(`blockB${t}`);
      await c.tool('browser.navigate', { sessionId: sid, tabId: tA, url: server.pageUrl('blockA', { name: uniq('blockA') }) });
      await c.tool('browser.navigate', { sessionId: sid, tabId: tB, url: server.pageUrl(`blockB${t}`, { name: nameB }) });
      const t0 = Date.now();
      const pA = c.tool('browser.download_file', { sessionId: sid, tabId: tA, target: '#out', downloadDir: path.join(allowA, 'blockA') }).then((r) => ({ r, ms: Date.now() - t0 }));
      await delay(300);
      const pB = c.tool('browser.download_file', { sessionId: sid, tabId: tB, target: '#dl', downloadDir: path.join(allowB, `blockB${t}`) }).then((r) => ({ r, ms: Date.now() - t0 }));
      const [a, b] = await Promise.all([pA, pB]);
      const servedBAtReturn = server.served.filter((x) => x.name === nameB).length;
      await delay(100000); // let any abandoned (timed-out but still queued) dispatch drain
      const servedBLater = server.served.filter((x) => x.name === nameB).length;
      const filesB = findName(nameB, searchDirs).length + userDownloadsHits().filter((x) => x === nameB).length;
      record({
        id: `CONC-lock-held-by-nondownload-t${t}`,
        pass: userDownloadsHits().filter((x) => x === nameB).length === 0,
        detail: `A: success=${a.r.success} ms=${a.ms} retries=${a.r.retriesUsed} | B: success=${b.r.success} ms=${b.ms} retries=${b.r.retriesUsed} err=${String(b.r.error ?? '').slice(0, 90)} | B served at return=${servedBAtReturn}, after drain=${servedBLater}, B files on disk=${filesB}`,
      });
      await c.tool('browser.close_tab', { sessionId: sid, tabId: tA }).catch(() => {});
      await c.tool('browser.close_tab', { sessionId: sid, tabId: tB }).catch(() => {});
    }
  }
  await c.close();

  // ---------------- two MCP server processes attached to ONE Chrome ----------------
  if (GROUPS.includes('multiproc')) {
    const chromeDir = path.join(os.homedir(), '.cache', 'puppeteer', 'chrome');
    const ver = readdirSync(chromeDir).find((d) => d.startsWith('win64'));
    const exe = path.join(chromeDir, ver, 'chrome-win64', 'chrome.exe');
    const udd = await mk('chrome-udd');
    const chrome = track(spawn(exe, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${udd}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' }));
    let port;
    for (let i = 0; i < 60 && !port; i++) {
      await delay(250);
      try { port = (await fs.readFile(path.join(udd, 'DevToolsActivePort'), 'utf8')).split('\n')[0].trim(); } catch {}
    }
    const endpoint = `http://127.0.0.1:${port}`;
    const cA = mcp({ ...env, SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS: allowA, SUTRADHAR_CLI_STATE_DIR: path.join(R, 'stA') });
    const cB = mcp({ ...env, SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS: allowB, SUTRADHAR_CLI_STATE_DIR: path.join(R, 'stB') });
    await cA.init(); await cB.init();
    const aA = await cA.tool('browser.attach', { endpoint });
    const aB = await cB.tool('browser.attach', { endpoint });
    const tabA = (await cA.tool('browser.new_tab', { sessionId: aA.sessionId })).id;
    const tabB = (await cB.tool('browser.new_tab', { sessionId: aB.sessionId })).id;
    let escUser = 0, crossA = 0, crossB = 0, okA = 0, okB = 0; const trials = 10; const rows = [];
    for (let t = 0; t < trials; t++) {
      const nA = uniq(`mpA${t}`), nB = uniq(`mpB${t}`);
      const dA = path.join(allowA, `mp${t}`), dB = path.join(allowB, `mp${t}`);
      await cA.tool('browser.navigate', { sessionId: aA.sessionId, tabId: tabA, url: server.pageUrl('mpA', { name: nA }) });
      await cB.tool('browser.navigate', { sessionId: aB.sessionId, tabId: tabB, url: server.pageUrl('mpB', { name: nB }) });
      await delay(1200);
      const [rA, rB] = await Promise.all([
        cA.tool('browser.download_file', { sessionId: aA.sessionId, tabId: tabA, target: '#dl', downloadDir: dA }),
        cB.tool('browser.download_file', { sessionId: aB.sessionId, tabId: tabB, target: '#dl', downloadDir: dB }),
      ]);
      await delay(2500);
      const hA = findName(nA, searchDirs), hB = findName(nB, searchDirs);
      const uA = userDownloadsHits().includes(nA), uB = userDownloadsHits().includes(nB);
      if (uA || uB) escUser++;
      if (hA.some((h) => !inside(h, allowA))) crossA++;
      if (hB.some((h) => !inside(h, allowB))) crossB++;
      if (rA.success) okA++; if (rB.success) okB++;
      rows.push({ t, A: { success: rA.success, err: String(rA.error ?? '').slice(0, 80), hits: hA, userDl: uA }, B: { success: rB.success, err: String(rB.error ?? '').slice(0, 80), hits: hB, userDl: uB } });
    }
    record({
      id: 'MULTIPROC-two-mcp-servers-one-chrome-x10',
      pass: escUser === 0 && crossA === 0 && crossB === 0,
      detail: `okA=${okA} okB=${okB} trialsWithFileInUserDownloads=${escUser} A-files-outside-A-roots=${crossA} B-files-outside-B-roots=${crossB}`,
      rows,
    });
    for (const cc of [cA, cB]) { cc.child.stdin.end(); await Promise.race([new Promise((r) => cc.child.once('exit', r)), delay(8000)]); }
    await killTracked(); // includes the Chrome we spawned (PID-scoped, /T)
  }
} catch (e) {
  record({ id: 'FATAL', pass: false, detail: e.stack ?? String(e) });
} finally {
  await killTracked();
  await server.close();
  // any of OUR tagged files that reached the user's real Downloads folder: record then remove
  const stray = userDownloadsHits();
  for (const s of stray) await fs.rm(path.join(USER_DOWNLOADS, s), { force: true }).catch(() => {});
  record({ id: 'cleanup-user-downloads', pass: true, detail: `tagged strays found+removed=${JSON.stringify(stray)}` });
  cmd(`fsutil file setCaseSensitiveInfo "${csParent}" disable`);
  for (let i = 0; i < 15 && existsSync(R); i++) {
    await fs.rm(R, { recursive: true, force: true }).catch(() => {});
    if (existsSync(R)) await delay(500);
  }
  if (existsSync(R)) cmd(`rmdir /s /q "\\\\?\\${R}"`);
  record({ id: 'cleanup-temp', pass: !existsSync(R), detail: R });
  await fs.writeFile(path.join(here, `live-mcp-audit2-${GROUPS.join('-')}.json`), JSON.stringify({ TAG, results }, null, 2));
  console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
}
