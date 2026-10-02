// AUDIT-1 fail-closed: every malformed/hostile shape in a PARENT directory, on every surface (CLI pkg+bundle,
// MCP pkg+bundle, SDK bundle). Asserts: refusal with a clear message and NO Chrome (no chrome.exe whose
// command line holds this case's TEMP, no sutradhar-cli-* dir, no state.json). Also cleanup verbs.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromePids } from './procs.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const WT = path.resolve(HERE, '../../../../../../..');
const S = path.resolve(process.argv[2], 'fc');
const OUT = path.join(HERE, '..', 'live-failclosed.jsonl'); fs.writeFileSync(OUT, '');
const BINS = { cliPkg: path.join(WT, 'packages/cli/dist/cli.js'), cliBundle: path.join(WT, 'packages/sutradhar/dist/cli-bin.js'), mcpPkg: path.join(WT, 'packages/mcp-server/dist/cli.js'), mcpBundle: path.join(WT, 'packages/sutradhar/dist/mcp-cli.js') };
const SDK = path.join(WT, 'packages/sutradhar/dist/index.js');
const SECRET = 'sk_live_SUPERSECRET_0123456789abcdef';
const B = String.fromCharCode(92);
const shapes = {
  emptyDomains: '{"allowedDomains":[]}', urlDomain: '{"allowedDomains":["https://x.com"]}', starDomain: '{"allowedDomains":["*"]}',
  badJson: '{"viewport":{"width":1,}}', nullTop: 'null', arrTop: '[]', idleStr: '{"idleTimeoutMs":"5000"}', idleNeg: '{"idleTimeoutMs":-1}', idleHuge: '{"idleTimeoutMs":99999999999}',
  nestedArr: '{"allowedDomains":[["a.com"]]}', dupKey: '{"viewport":{"width":5,"height":5},"viewport":{"width":6,"height":6}}', comment: '// x' + String.fromCharCode(10) + '{}',
  secretInvalid: '{"token":"' + SECRET + '" ,}', vpZero: '{"viewport":{"width":0,"height":5}}', dlgBad: '{"dialog":{"mode":"yes"}}', dlNull: '{"downloadDir":null}',
  escapeDl: '{"downloadDir":"../outside"}', gitHooks: '{"downloadDir":".git/hooks"}', gitHooksBs: '{"downloadDir":".git' + B + B + 'hooks"}', absDl: '{"allowedDownloadRoots":["C:/Windows/Temp"]}',
  utf16: 'UTF16', over64k: 'BIG', isDir: 'DIR', brokenLink: 'BROKEN', empty: '',
};
function writeShape(dir, k, v) {
  const f = path.join(dir, '.sutradhar.json');
  if (v === 'UTF16') fs.writeFileSync(f, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('{}', 'utf16le')]));
  else if (v === 'BIG') fs.writeFileSync(f, '{"zz":"' + 'a'.repeat(70000) + '"}');
  else if (v === 'DIR') fs.mkdirSync(f);
  else if (v === 'BROKEN') fs.symlinkSync(path.join(dir, 'nowhere'), f, 'junction');
  else fs.writeFileSync(f, v);
}
let pass = 0, fail = 0; const fails = [];
function rec(o) { fs.appendFileSync(OUT, JSON.stringify(o) + '\n'); if (o.pass) pass++; else { fail++; fails.push(o.id); } }
function run(cmd, args, cwd, env, ms) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const ch = spawn(cmd, args, { cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let so = '', se = ''; ch.stdout.on('data', (d) => { so += d; }); ch.stderr.on('data', (d) => { se += d; });
    const t = setTimeout(() => { try { ch.kill(); } catch {} }, ms);
    ch.on('close', (code) => { clearTimeout(t); resolve({ code, so, se, ms: Math.round(performance.now() - t0) }); });
  });
}
const sdkProbe = 'const m = await import(process.argv[1]); try { const b = await m.launch({ discoverConfig: true }); console.log("LAUNCHED"); await b.close(); } catch (e) { console.log("REJECT " + e.name + ": " + e.message); }';
for (const [k, v] of Object.entries(shapes)) {
  const root = path.join(S, k); const repo = path.join(root, 'repo'); const cwd = path.join(repo, 'a', 'b');
  fs.mkdirSync(path.join(repo, '.git', 'hooks'), { recursive: true }); fs.mkdirSync(cwd, { recursive: true });
  writeShape(repo, k, v);
  for (const surface of ['cliPkg', 'cliBundle', 'mcpPkg', 'mcpBundle', 'sdk']) {
    const temp = path.join(root, 'temp-' + surface); const st = path.join(root, 'st-' + surface);
    fs.mkdirSync(temp, { recursive: true });
    const env = { ...process.env, TEMP: temp, TMP: temp, SUTRADHAR_CLI_STATE_DIR: st };
    for (const e of Object.keys(env)) if (/^SUTRADHAR_(ALLOWED|CONFIG|IDLE)/i.test(e)) delete env[e];
    let r;
    if (surface.startsWith('cli')) r = await run(process.execPath, [BINS[surface], 'nav', 'http://127.0.0.1:9/never'], cwd, env, 60000);
    else if (surface.startsWith('mcp')) r = await run(process.execPath, [BINS[surface]], cwd, env, 10000);
    else r = await run(process.execPath, ['--input-type=module', '-e', sdkProbe, pathToFileURL(SDK).href], cwd, env, 60000);
    const pids = await chromePids(temp);
    const cliDirs = fs.readdirSync(temp).filter((n) => n.startsWith('sutradhar-cli-') || n.startsWith('puppeteer'));
    const stateFile = fs.existsSync(path.join(st, 'state.json'));
    const all = r.so + r.se;
    let refused;
    if (surface.startsWith('cli')) refused = r.code === 1 && /^Error: /m.test(r.se) && !/Fatal:/.test(r.se);
    else if (surface.startsWith('mcp')) refused = r.code === 1 && /\[sutradhar-mcp\] fatal:/.test(r.se);
    else refused = /REJECT ProjectConfigError/.test(r.so);
    const msg = (r.se.match(/(Error|fatal): .*/) || r.so.match(/REJECT .*/) || [''])[0].slice(0, 400);
    const noChrome = (pids ? pids.length === 0 : false) && cliDirs.length === 0 && !stateFile;
    const echoed = all.includes(SECRET) || all.includes('SUPERSECRET');
    rec({ id: k + '.' + surface, refused, noChrome, echoedSecret: echoed, code: r.code, ms: r.ms, msg, pass: refused && noChrome && !echoed });
  }
}
// cleanup verbs never blocked by a broken file; GAP-342 (flag cannot rescue); env escape hatch named by the message
{
  const root = path.join(S, 'emptyDomains'); const cwd = path.join(root, 'repo', 'a', 'b'); const temp = path.join(root, 'temp-verbs'); fs.mkdirSync(temp, { recursive: true });
  const env = { ...process.env, TEMP: temp, TMP: temp, SUTRADHAR_CLI_STATE_DIR: path.join(root, 'st-verbs') };
  for (const e of Object.keys(env)) if (/^SUTRADHAR_(ALLOWED|CONFIG|IDLE)/i.test(e)) delete env[e];
  for (const [nm, args, want] of [['doctor', ['doctor'], 0], ['close', ['close'], 0], ['dialog', ['dialog'], null], ['profileList', ['profile', 'list'], 0], ['help', ['--help'], 0]]) {
    const r = await run(process.execPath, [BINS.cliPkg, ...args], cwd, env, 60000);
    rec({ id: 'verbs.' + nm, code: r.code, out: (r.so + r.se).split(String.fromCharCode(10)).filter((l) => /Config|Error|INVALID/.test(l)).slice(0, 3), pass: want === null ? !/Invalid project config/.test(r.se) : (r.code === want && !/^Error: Invalid project config/m.test(r.se)) });
  }
  const g = await run(process.execPath, [BINS.cliPkg, 'nav', 'http://127.0.0.1:9/x', '--allowlist-domains', '127.0.0.1'], cwd, env, 60000);
  rec({ id: 'GAP-342.flagCannotRescueInvalidFile', code: g.code, pass: g.code === 1 && /Invalid project config/.test(g.se), note: 'by design (D7); documented' });
  const none = await run(process.execPath, [BINS.cliPkg, 'doctor'], cwd, { ...env, SUTRADHAR_CONFIG: 'none' }, 60000);
  rec({ id: 'SUTRADHAR_CONFIG=none.escape', pass: /disabled \(SUTRADHAR_CONFIG=none\)/.test(none.so), line: (none.so.match(/Config:.*/) || [''])[0] });
  const root2 = path.join(S, 'escapeDl'); const cwd2 = path.join(root2, 'repo', 'a', 'b'); const temp2 = path.join(root2, 'temp-envhatch'); fs.mkdirSync(temp2, { recursive: true }); fs.mkdirSync(path.join(root2, 'envroot'), { recursive: true });
  const env2 = { ...env, TEMP: temp2, TMP: temp2, SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS: path.join(root2, 'envroot') };
  const h = await run(process.execPath, [BINS.cliPkg, 'nav', 'http://127.0.0.1:9/x'], cwd2, env2, 60000);
  rec({ id: 'escapeHatch.envNamedInMessageActuallyWorks', code: h.code, msg: h.se.slice(0, 160), pass: !/outside this config.s directory/.test(h.se) });
  for (const [nm, cfgEnv] of [['rel', 'rel.json'], ['missing', path.join(S, 'missing.json')], ['tildeUser', '~bob/x.json']]) {
    for (const surface of ['cliPkg', 'mcpPkg']) {
      const r = surface === 'cliPkg' ? await run(process.execPath, [BINS.cliPkg, 'nav', 'http://127.0.0.1:9/x'], cwd, { ...env, SUTRADHAR_CONFIG: cfgEnv }, 60000) : await run(process.execPath, [BINS.mcpPkg], cwd, { ...env, SUTRADHAR_CONFIG: cfgEnv }, 10000);
      rec({ id: 'SUTRADHAR_CONFIG.' + nm + '.' + surface, code: r.code, msg: r.se.slice(0, 200), pass: r.code === 1 && /SUTRADHAR_CONFIG|does not exist|~user/.test(r.se) });
    }
  }
}
const summary = { pass, fail, fails }; fs.appendFileSync(OUT, JSON.stringify({ summary }) + '\n'); console.log(JSON.stringify(summary));
process.exit(0);
