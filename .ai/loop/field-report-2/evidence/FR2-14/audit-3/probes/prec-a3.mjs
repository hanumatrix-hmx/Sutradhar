// AUDIT-3 precedence + F1 generator (own oracle, exhaustive per surface x key x layer kinds; seed only picks value spellings).
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const [REPO, S0] = process.argv.slice(2);
const imp = (p) => import(pathToFileURL(path.join(REPO, p)).href);
const cr = await imp('packages/capability-runtime/dist/index.js');
const cliPC = await imp('packages/cli/dist/project-config-cli.js');
const { parseArgs } = await imp('packages/cli/dist/parse-args.js');
const mcpServer = await imp('packages/mcp-server/dist/server.js');
const sdk = await imp('packages/sutradhar/dist/index.js');
const { Client } = await import(pathToFileURL(path.join(REPO, 'packages/mcp-server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js')).href);
const { InMemoryTransport } = await import(pathToFileURL(path.join(REPO, 'packages/mcp-server/node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.js')).href);
const SEP = path.sep;
function rng(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rnd = rng(0x5a3f0c14);
const tag = () => Math.floor(rnd() * 1e6).toString(36);

const S = path.join(S0, 'pg');
fs.rmSync(S, { recursive: true, force: true });
const HOME = path.join(S, 'home');
fs.mkdirSync(HOME, { recursive: true });
const ENV_ROOT = path.join(S, 'envroot' + tag());
const OPT_ROOT = path.join(S, 'optroot' + tag());
const EXTRA = path.join(S, 'extra' + tag());
// config dirs (each a git root so discovery stops there)
function mkcfg(name, obj) { const d = path.join(S, name); fs.mkdirSync(path.join(d, '.git'), { recursive: true }); fs.writeFileSync(path.join(d, '.sutradhar.json'), JSON.stringify(obj)); return d; }
const CFG_DOM = 'cfg' + tag() + '.test';
const dirs = {
  cfgVal: mkcfg('cv', { allowedDomains: [CFG_DOM], downloadDir: './dl', allowedUploadRoots: ['./up'], dialog: { mode: 'accept', promptText: 'cfgtext' }, idleTimeoutMs: 45000, viewport: { width: 405, height: 305 } }),
  cfgIdle0: mkcfg('ci0', { idleTimeoutMs: 0 }),
  cfgRefused: mkcfg('cr', { downloadDir: '../outside', allowedUploadRoots: ['./up'] }),
  cfgRefusedGit: mkcfg('cg', { allowedDownloadRoots: ['./.git/hooks'] }),
  cfgNone: (() => { const d = path.join(S, 'cn'); fs.mkdirSync(path.join(d, '.git'), { recursive: true }); return d; })(),
};
const loaded = {};
for (const [k, d] of Object.entries(dirs)) { const r = await cr.loadProjectConfig({ cwd: d, discover: true, homedir: HOME }); loaded[k] = r.status === 'loaded' ? r.config : undefined; }
loaded.cfgExplicitOutside = (await cr.loadProjectConfig({ cwd: dirs.cfgRefused, discover: false, explicitPath: path.join(dirs.cfgRefused, '.sutradhar.json'), explicitOrigin: 'env', homedir: HOME })).config;
const norm = (p) => path.resolve(p).toLowerCase();
const results = [];
let pass = 0, fail = 0;
function record(surface, key, combo, exp, got) {
  const ok = JSON.stringify(exp) === JSON.stringify(got);
  if (ok) pass++; else fail++;
  results.push({ surface, key, combo, ok, exp, got });
}
function product(lists) { return lists.reduce((acc, l) => acc.flatMap((a) => l.map((x) => [...a, x])), [[]]); }
// --- oracle: layers high -> low, each { name, kind, value }; kind in set|unset|error|refused
function oracle(layers, fallback) {
  for (const l of layers) {
    if (l.kind === 'error') return { error: true };
    if (l.kind === 'set') return { source: l.name, value: l.value };
    if (l.kind === 'refused') return { error: true };
  }
  return fallback;
}
// ========================= CLI =========================
const cfgKinds = (forKey) => ['none', 'val', ...(forKey === 'dl' ? ['refused', 'refusedGit', 'explicitOutside'] : forKey === 'ul' ? ['refused'] : forKey === 'dialog' ? ['auto'] : [])];
if (!loaded.cfgAuto) loaded.cfgAuto = (await cr.loadProjectConfig({ cwd: mkcfg('ca', { dialog: { mode: 'auto' } }), discover: true, homedir: HOME })).config;
const cfgOf = (k) => ({ none: undefined, val: loaded.cfgVal, refused: loaded.cfgRefused, refusedGit: loaded.cfgRefusedGit, explicitOutside: loaded.cfgExplicitOutside, auto: loaded.cfgAuto, idle0: loaded.cfgIdle0 })[k];
function cliRun(argvFlags, env, state, cfg, extra) {
  const pa = parseArgs(['nav', 'about:blank', ...argvFlags]);
  if (pa.allowlistDomainsGivenButEmpty || pa.viewportFlagGivenButInvalid || pa.dialogFlagGivenButInvalid) return { error: true };
  try {
    return { s: cliPC.resolveCliSettings({ flags: { allowlistDomains: pa.allowlistDomainsFlag, viewport: pa.viewportFlag, dialog: pa.dialogFlag, dialogText: pa.dialogTextFlag }, env, state, config: cfg, extraDownloadRoots: extra, homedir: HOME }) };
  } catch (e) { return { error: true, msg: e.message }; }
}
for (const [fk, ek, ck] of product([['absent', 'val', 'empty', 'commas'], ['absent', 'empty', 'blank', 'commas', 'zero', 'val'], cfgKinds('dom')])) {
  const flags = fk === 'val' ? ['--allowlist-domains', 'flag.test'] : fk === 'empty' ? ['--allowlist-domains', ''] : fk === 'commas' ? ['--allowlist-domains', ' , ,'] : [];
  const envV = { absent: undefined, empty: '', blank: '   ', commas: ',,', zero: '0', val: 'env.test' }[ek];
  const env = envV === undefined ? {} : { SUTRADHAR_ALLOWED_DOMAINS: envV };
  const layers = [
    { name: 'flag', kind: fk === 'val' ? 'set' : fk === 'absent' ? 'unset' : 'error', value: ['flag.test'] },
    { name: 'env', kind: ['val', 'zero'].includes(ek) ? 'set' : 'unset', value: [ek === 'zero' ? '0' : 'env.test'] },
    { name: 'config', kind: ck === 'val' ? 'set' : 'unset', value: [CFG_DOM] },
  ];
  const exp = oracle(layers, { source: 'default' });
  const r = cliRun(flags, env, undefined, cfgOf(ck));
  const got = r.error ? { error: true } : { source: r.s.allowedDomains.source, ...(r.s.allowedDomains.value ? { value: [...r.s.allowedDomains.value] } : {}) };
  record('cli', 'allowedDomains', { fk, ek, ck }, exp, got);
}
const dlEnv = { absent: undefined, empty: '', blank: '   ', delims: ';;', spacedDelims: ' ; ; ', zero: '0', false: 'false', rel: 'rel' + SEP + 'x', val: ENV_ROOT };
function dlConfigRoots(ck) { const c = cfgOf(ck); return c?.resolved.allowedDownloadRoots?.map(norm); }
for (const [ek, ck, xk] of product([Object.keys(dlEnv), cfgKinds('dl'), ['absent', 'val']])) {
  const env = dlEnv[ek] === undefined ? {} : { SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS: dlEnv[ek] };
  const refused = ck === 'refused' || ck === 'refusedGit';
  const envKind = ek === 'val' ? 'set' : ['zero', 'false', 'rel'].includes(ek) ? 'error' : 'unset';
  const cfgKind = ck === 'none' ? 'unset' : refused ? (xk === 'val' ? 'unset' : 'refused') : 'set';
  const exp0 = oracle([{ name: 'env', kind: envKind, value: [norm(ENV_ROOT)] }, { name: 'config', kind: cfgKind, value: dlConfigRoots(ck) }], { source: 'default' });
  const exp = exp0.error ? exp0 : { ...exp0, note: refused && (envKind === 'set' || xk === 'val') };
  const r = cliRun([], env, undefined, cfgOf(ck), xk === 'val' ? [EXTRA] : undefined);
  let got;
  if (r.error) got = { error: true };
  else {
    const src = r.s.fsRoots.sources.download;
    got = { source: src, ...(src === 'default' ? {} : { value: r.s.fsRoots.allowedDownloadRoots.map(norm) }), note: r.s.fsRoots.warnings.some((w) => w.includes('were refused')) };
    if (src === 'default' && r.s.fsRoots.allowedDownloadRoots.some((x) => (dlConfigRoots(ck) || []).includes(norm(x)))) got.refusedRootUsed = true;
  }
  record('cli', 'downloadRoots', { ek, ck, xk }, exp, got);
}
for (const [ek, ck] of product([['absent', 'empty', 'blank', 'delims', 'zero', 'val'], cfgKinds('ul')])) {
  const v = { absent: undefined, empty: '', blank: '   ', delims: ';;', zero: '0', val: ENV_ROOT }[ek];
  const env = v === undefined ? {} : { SUTRADHAR_ALLOWED_UPLOAD_ROOTS: v };
  if (ck === 'refused') env.SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS = OPT_ROOT;
  const c = cfgOf(ck);
  const exp = oracle([{ name: 'env', kind: ek === 'val' ? 'set' : ek === 'zero' ? 'error' : 'unset', value: [norm(ENV_ROOT)] }, { name: 'config', kind: c ? 'set' : 'unset', value: c?.resolved.allowedUploadRoots?.map(norm) }], { source: 'unrestricted' });
  const r = cliRun([], env, undefined, c);
  const got = r.error ? { error: true } : { source: r.s.fsRoots.sources.upload, ...(r.s.fsRoots.allowedUploadRoots ? { value: r.s.fsRoots.allowedUploadRoots.map(norm) } : {}) };
  record('cli', 'uploadRoots', { ek, ck }, exp, got);
}
for (const [fk, sk, ck] of product([['absent', 'dismiss', 'report', 'acceptText', 'bogus'], ['absent', 'accept'], cfgKinds('dialog')])) {
  const flags = fk === 'absent' ? [] : fk === 'acceptText' ? ['--dialog', 'accept', '--dialog-text', 'ft'] : ['--dialog', fk];
  const state = sk === 'accept' ? { dialogPolicy: { action: 'accept', promptText: 'st' } } : undefined;
  const cfgVal = ck === 'val' ? { mode: 'accept', promptText: 'cfgtext' } : ck === 'auto' ? { mode: 'report' } : undefined;
  const flagVal = fk === 'acceptText' ? { mode: 'accept', promptText: 'ft' } : { mode: fk };
  const exp = oracle([
    { name: 'flag', kind: fk === 'absent' ? 'unset' : fk === 'bogus' ? 'error' : 'set', value: flagVal },
    { name: 'state', kind: sk === 'absent' ? 'unset' : 'set', value: { mode: 'accept', promptText: 'st' } },
    { name: 'config', kind: cfgVal ? 'set' : 'unset', value: cfgVal },
  ], { source: 'default', value: { mode: 'report' } });
  const r = cliRun(flags, {}, state, cfgOf(ck));
  const pol = r.s?.dialog.policy;
  const got = r.error ? { error: true } : { source: r.s.dialog.source, value: pol.promptText !== undefined ? { mode: pol.mode, promptText: pol.promptText } : { mode: pol.mode } };
  record('cli', 'dialog', { fk, sk, ck }, exp, got);
}
for (const [fk, sk, ck] of product([['absent', 'val', 'zero', 'over', 'bogus', 'max'], ['absent', 'val', 'malformed'], cfgKinds('vp')])) {
  const flags = { absent: [], val: ['--viewport', '401x301'], zero: ['--viewport', '0x5'], over: ['--viewport', '10000001x5'], bogus: ['--viewport', 'wide'], max: ['--viewport', '10000000x10000000'] }[fk];
  const state = sk === 'val' ? { viewport: { width: 402, height: 302 } } : sk === 'malformed' ? { viewport: { width: 0, height: 302 } } : undefined;
  const exp = oracle([
    { name: 'flag', kind: fk === 'absent' ? 'unset' : ['val', 'max'].includes(fk) ? 'set' : 'error', value: fk === 'max' ? { width: 10000000, height: 10000000 } : { width: 401, height: 301 } },
    { name: 'state', kind: sk === 'val' ? 'set' : 'unset', value: { width: 402, height: 302 } },
    { name: 'config', kind: ck === 'val' ? 'set' : 'unset', value: { width: 405, height: 305 } },
  ], { source: 'default' });
  const r = cliRun(flags, {}, state, cfgOf(ck));
  const got = r.error ? { error: true } : { source: r.s.viewport.source, ...(r.s.viewport.value ? { value: r.s.viewport.value } : {}) };
  record('cli', 'viewport', { fk, sk, ck }, exp, got);
}
// ========================= MCP (real createSutradharServer composition, process.env, real tool schema via in-memory client) =========================
const DEF_DL = norm(cr.defaultDownloadRoot());
const MCP_ENV_KEYS = ['SUTRADHAR_ALLOWED_DOMAINS', 'SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS', 'SUTRADHAR_ALLOWED_UPLOAD_ROOTS', 'SUTRADHAR_IDLE_TIMEOUT_MS'];
const silentLogger = { info() {}, warn() {}, error() {}, debug() {}, child() { return silentLogger; } };
async function mcpRun(options, env) {
  const saved = {}; for (const k of MCP_ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  Object.assign(process.env, env);
  const errs = []; const oe = console.error; console.error = (...a) => errs.push(a.join(' '));
  try { const h = await mcpServer.createSutradharServer({ disableAgent: true, llmProvider: null, logger: silentLogger, ...options }); return { h, errs }; }
  catch (e) { return { error: true, msg: e.message, errs }; }
  finally { console.error = oe; for (const k of MCP_ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
}
const optKinds = (val) => ({ absent: undefined, null: null, empty: [], val });
for (const [ok_, ek, ck] of product([['absent', 'null', 'empty', 'val'], ['absent', 'empty', 'blank', 'commas', 'val'], ['none', 'val']])) {
  const env = ek === 'absent' ? {} : { SUTRADHAR_ALLOWED_DOMAINS: { empty: '', blank: '   ', commas: ',,', val: 'env.test' }[ek] };
  const opt = optKinds(['option.test'])[ok_];
  const exp = oracle([{ name: 'option', kind: ok_ === 'val' ? 'set' : 'unset', value: ['option.test'] }, { name: 'env', kind: ek === 'val' ? 'set' : 'unset', value: ['env.test'] }, { name: 'config', kind: ck === 'val' ? 'set' : 'unset', value: [CFG_DOM] }], { source: 'default' });
  const r = await mcpRun({ ...(ok_ === 'absent' ? {} : { allowedDomains: opt }), projectConfig: cfgOf(ck) }, env);
  const got = r.error ? { error: true } : r.h.runtime.allowedDomains ? { value: [...r.h.runtime.allowedDomains] } : {};
  record('mcp', 'allowedDomains', { ok: ok_, ek, ck }, exp.error ? exp : exp.value ? { value: exp.value } : {}, got);
}
for (const [ok_, ek, ck] of product([['absent', 'null', 'empty', 'val'], Object.keys(dlEnv), cfgKinds('dl')])) {
  const env = dlEnv[ek] === undefined ? {} : { SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS: dlEnv[ek] };
  const refused = ck === 'refused' || ck === 'refusedGit';
  const optKind = ok_ === 'val' ? 'set' : 'unset';
  const envKind = ek === 'val' ? 'set' : ['zero', 'false', 'rel'].includes(ek) ? 'error' : 'unset';
  const cfgKind = ck === 'none' ? 'unset' : refused ? 'refused' : 'set';
  const exp0 = oracle([{ name: 'option', kind: optKind, value: [norm(OPT_ROOT)] }, { name: 'env', kind: envKind, value: [norm(ENV_ROOT)] }, { name: 'config', kind: cfgKind, value: dlConfigRoots(ck) }], { source: 'default', value: [DEF_DL] });
  const exp = exp0.error ? exp0 : { value: exp0.value, note: refused && exp0.source !== 'default' && exp0.source !== 'config' };
  const r = await mcpRun({ ...(ok_ === 'absent' ? {} : { allowedDownloadRoots: optKinds([OPT_ROOT])[ok_] }), projectConfig: cfgOf(ck) }, env);
  const got = r.error ? { error: true } : { value: r.h.runtime.actionEngine.allowedDownloadRoots.map(norm), note: r.errs.some((w) => w.includes('were refused')) };
  record('mcp', 'downloadRoots', { ok: ok_, ek, ck }, exp, got);
}
for (const [ok_, ek, ck] of product([['absent', 'empty', 'val'], ['absent', 'empty', 'delims', 'zero', 'val'], cfgKinds('ul')])) {
  const v = { absent: undefined, empty: '', delims: ';;', zero: '0', val: ENV_ROOT }[ek];
  const env = v === undefined ? {} : { SUTRADHAR_ALLOWED_UPLOAD_ROOTS: v };
  if (ck === 'refused') env.SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS = OPT_ROOT;
  const c = cfgOf(ck);
  const exp0 = oracle([{ name: 'option', kind: ok_ === 'val' ? 'set' : 'unset', value: [norm(OPT_ROOT)] }, { name: 'env', kind: ek === 'val' ? 'set' : ek === 'zero' ? 'error' : 'unset', value: [norm(ENV_ROOT)] }, { name: 'config', kind: c ? 'set' : 'unset', value: c?.resolved.allowedUploadRoots?.map(norm) }], { source: 'unrestricted' });
  const r = await mcpRun({ ...(ok_ === 'absent' ? {} : { allowedUploadRoots: optKinds([OPT_ROOT])[ok_] }), projectConfig: c }, env);
  const got = r.error ? { error: true } : r.h.runtime.allowedUploadRoots ? { value: r.h.runtime.allowedUploadRoots.map(norm) } : {};
  record('mcp', 'uploadRoots', { ok: ok_, ek, ck }, exp0.error ? exp0 : exp0.value ? { value: exp0.value } : {}, got);
}
for (const [ok_, ck] of product([['absent', 'null', 'val'], cfgKinds('dialog')])) {
  const cfgVal = ck === 'val' ? { mode: 'accept', promptText: 'cfgtext' } : ck === 'auto' ? { mode: 'auto' } : undefined;
  const exp0 = oracle([{ name: 'option', kind: ok_ === 'val' ? 'set' : 'unset', value: { mode: 'dismiss' } }, { name: 'config', kind: cfgVal ? 'set' : 'unset', value: cfgVal }], { source: 'default' });
  const r = await mcpRun({ ...(ok_ === 'absent' ? {} : { dialogPolicy: ok_ === 'null' ? null : { mode: 'dismiss' } }), projectConfig: cfgOf(ck) }, {});
  const got = r.error ? { error: true } : r.h.runtime.dialogPolicy ? { value: r.h.runtime.dialogPolicy } : {};
  record('mcp', 'dialog', { ok: ok_, ck }, exp0.value ? { value: exp0.value } : {}, got);
}
for (const [ok_, ek, ck] of product([['absent', 'null', 'zero', 'val', 'nan'], ['absent', 'empty', 'blank', 'zero', 'val', 'bad'], ['none', 'val', 'idle0']])) {
  const env = ek === 'absent' ? {} : { SUTRADHAR_IDLE_TIMEOUT_MS: { empty: '', blank: '   ', zero: '0', val: '7000', bad: 'abc' }[ek] };
  const opt = { absent: undefined, null: null, zero: 0, val: 5000, nan: NaN }[ok_];
  const cfgV = ck === 'val' ? 45000 : ck === 'idle0' ? 0 : undefined;
  let exp;
  if (ok_ === 'nan' || ek === 'bad' || ek === 'blank') exp = { error: true };
  else {
    const e0 = oracle([{ name: 'option', kind: ['zero', 'val'].includes(ok_) ? 'set' : 'unset', value: opt }, { name: 'env', kind: ['zero', 'val'].includes(ek) ? 'set' : 'unset', value: ek === 'zero' ? 0 : 7000 }, { name: 'config', kind: cfgV !== undefined ? 'set' : 'unset', value: cfgV }], { source: 'default', value: 1800000 });
    exp = e0.value > 0 ? { value: e0.value } : {};
  }
  const r = await mcpRun({ ...(ok_ === 'absent' ? {} : { idleTimeoutMs: opt }), projectConfig: cfgOf(ck) }, env);
  const iv = r.h?.runtime.sessionManager.idleTimeoutMs;
  const got = r.error ? { error: true } : iv ? { value: iv } : {};
  record('mcp', 'idleTimeoutMs', { ok: ok_, ek, ck }, exp, got);
}
const callVp = { absent: undefined, val: { width: 404, height: 304 }, max: { width: 10000000, height: 10000000 }, zero: { width: 0, height: 304 }, neg: { width: -5, height: 304 }, over: { width: 10000001, height: 304 }, float: { width: 1.5, height: 304 }, nan: { width: NaN, height: 304 }, str: { width: '404', height: 304 }, big: { width: 1e9, height: 1e9 } };
const optVp = { absent: undefined, val: { width: 403, height: 303 }, malformed: { width: 0, height: 303 }, over: { width: 10000001, height: 303 } };
for (const [ak, ok_, ck] of product([Object.keys(callVp), Object.keys(optVp), ['none', 'val']])) {
  const r = await mcpRun({ ...(ok_ === 'absent' ? {} : { defaultViewport: optVp[ok_] }), projectConfig: cfgOf(ck) }, {});
  if (r.error) { record('mcp', 'viewport', { ak, ok: ok_, ck }, {}, { error: true, msg: r.msg }); continue; }
  let cap; r.h.runtime.launch = async (o) => { cap = o; return { sessionId: 'v', hasRealBrowser: false }; };
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await r.h.server.connect(st);
  const client = new Client({ name: 'a3', version: '1' });
  await client.connect(ct);
  let got;
  try {
    const res = await client.callTool({ name: 'browser.launch', arguments: { sessionId: 'v', ...(ak === 'absent' ? {} : { viewport: callVp[ak] }) } });
    got = cap ? (cap.launch?.viewport ? { value: cap.launch.viewport } : {}) : { error: true, isError: !!res.isError };
  } catch (e) { got = { error: true }; }
  await client.close().catch(() => {});
  const callKind = ak === 'absent' ? 'unset' : ['val', 'max'].includes(ak) ? 'set' : 'error';
  const e0 = oracle([{ name: 'call', kind: callKind, value: callVp[ak] }, { name: 'option', kind: ok_ === 'val' ? 'set' : 'unset', value: optVp.val }, { name: 'config', kind: ck === 'val' ? 'set' : 'unset', value: { width: 405, height: 305 } }], { source: 'default' });
  const exp = e0.error ? { error: true, isError: true } : e0.value ? { value: e0.value } : {};
  if (got.error && got.isError === undefined) got.isError = true;
  record('mcp', 'viewport', { ak, ok: ok_, ck }, exp, got);
}
// ========================= SDK (real launch(), runtime.launch intercepted; SUTRADHAR_* env set to prove it is ignored) =========================
let capRt, capOpts;
const origLaunch = sdk.SutradharRuntime.prototype.launch;
sdk.SutradharRuntime.prototype.launch = async function (o) { capRt = this; capOpts = o; throw new Error('A3-SENTINEL'); };
const cwd0 = process.cwd();
async function sdkRun(options, ck) {
  capRt = undefined; capOpts = undefined;
  const warns = []; const ow = console.warn; console.warn = (...a) => warns.push(a.join(' '));
  Object.assign(process.env, { SUTRADHAR_ALLOWED_DOMAINS: 'env.test', SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS: ENV_ROOT, SUTRADHAR_ALLOWED_UPLOAD_ROOTS: ENV_ROOT, SUTRADHAR_IDLE_TIMEOUT_MS: '7000' });
  const dir = { none: dirs.cfgNone, val: dirs.cfgVal, refused: dirs.cfgRefused, refusedGit: dirs.cfgRefusedGit, explicitOutside: dirs.cfgRefused, auto: path.join(S, 'ca'), idle0: dirs.cfgIdle0 }[ck];
  process.chdir(dir);
  try {
    await sdk.launch({ ...options, ...(ck === 'explicitOutside' ? { configFile: '.sutradhar.json' } : { discoverConfig: true }) });
    return { error: true, msg: 'no sentinel' };
  } catch (e) {
    if (e.message !== 'A3-SENTINEL') return { error: true, msg: e.message, warns };
    return { rt: capRt, o: capOpts, warns };
  } finally { console.warn = ow; process.chdir(cwd0); for (const k of MCP_ENV_KEYS) delete process.env[k]; }
}
for (const [ok_, ck] of product([['absent', 'null', 'empty', 'val'], ['none', 'val']])) {
  const e0 = oracle([{ name: 'option', kind: ok_ === 'val' ? 'set' : 'unset', value: ['option.test'] }, { name: 'config', kind: ck === 'val' ? 'set' : 'unset', value: [CFG_DOM] }], {});
  const r = await sdkRun(ok_ === 'absent' ? {} : { allowedDomains: optKinds(['option.test'])[ok_] }, ck);
  record('sdk', 'allowedDomains', { ok: ok_, ck }, e0.value ? { value: e0.value } : {}, r.error ? { error: true, msg: r.msg } : r.rt.allowedDomains ? { value: [...r.rt.allowedDomains] } : {});
}
for (const [ok_, ck] of product([['absent', 'null', 'empty', 'val'], cfgKinds('dl')])) {
  const refused = ck === 'refused' || ck === 'refusedGit';
  const e0 = oracle([{ name: 'option', kind: ok_ === 'val' ? 'set' : 'unset', value: [norm(OPT_ROOT)] }, { name: 'config', kind: ck === 'none' ? 'unset' : refused ? 'refused' : 'set', value: dlConfigRoots(ck) }], { source: 'default', value: [DEF_DL] });
  const exp = e0.error ? e0 : { value: e0.value, note: refused && e0.source === 'option' };
  const r = await sdkRun(ok_ === 'absent' ? {} : { allowedDownloadRoots: optKinds([OPT_ROOT])[ok_] }, ck);
  record('sdk', 'downloadRoots', { ok: ok_, ck }, exp, r.error ? { error: true } : { value: r.rt.actionEngine.allowedDownloadRoots.map(norm), note: r.warns.some((w) => w.includes('were refused')) });
}
for (const [ok_, ck] of product([['absent', 'empty', 'val'], ['none', 'val', 'refused']])) {
  const c = cfgOf(ck);
  const e0 = oracle([{ name: 'option', kind: ok_ === 'val' ? 'set' : 'unset', value: [norm(OPT_ROOT)] }, { name: 'config', kind: c ? 'set' : 'unset', value: c?.resolved.allowedUploadRoots?.map(norm) }], {});
  const opts = { ...(ok_ === 'absent' ? {} : { allowedUploadRoots: optKinds([OPT_ROOT])[ok_] }), ...(ck === 'refused' ? { allowedDownloadRoots: [OPT_ROOT] } : {}) };
  const r = await sdkRun(opts, ck);
  record('sdk', 'uploadRoots', { ok: ok_, ck }, e0.value ? { value: e0.value } : {}, r.error ? { error: true } : r.rt.allowedUploadRoots ? { value: r.rt.allowedUploadRoots.map(norm) } : {});
}
for (const [ok_, ck] of product([['absent', 'null', 'val'], ['none', 'val', 'auto']])) {
  const cfgVal = ck === 'val' ? { mode: 'accept', promptText: 'cfgtext' } : ck === 'auto' ? { mode: 'auto' } : undefined;
  const e0 = oracle([{ name: 'option', kind: ok_ === 'val' ? 'set' : 'unset', value: { mode: 'dismiss' } }, { name: 'config', kind: cfgVal ? 'set' : 'unset', value: cfgVal }], {});
  const r = await sdkRun(ok_ === 'absent' ? {} : { dialogPolicy: ok_ === 'null' ? null : { mode: 'dismiss' } }, ck);
  record('sdk', 'dialog', { ok: ok_, ck }, e0.value ? { value: e0.value, acceptWarn: ck === 'val' && ok_ !== 'val' } : {}, r.error ? { error: true, msg: r.msg } : r.rt.dialogPolicy ? { value: r.rt.dialogPolicy, acceptWarn: r.warns.some((w) => w.includes('accepted automatically')) } : {});
}
for (const [ok_, ck] of product([['absent', 'null', 'zero', 'val', 'nan'], ['none', 'val', 'idle0']])) {
  const opt = { absent: undefined, null: null, zero: 0, val: 5000, nan: NaN }[ok_];
  const cfgV = ck === 'val' ? 45000 : ck === 'idle0' ? 0 : undefined;
  let exp;
  if (ok_ === 'nan') exp = { error: true };
  else { const e0 = oracle([{ name: 'option', kind: ['zero', 'val'].includes(ok_) ? 'set' : 'unset', value: opt }, { name: 'config', kind: cfgV !== undefined ? 'set' : 'unset', value: cfgV }], {}); exp = e0.value > 0 ? { value: e0.value } : {}; }
  const r = await sdkRun(ok_ === 'absent' ? {} : { idleTimeoutMs: opt }, ck);
  const iv = r.rt?.sessionManager.idleTimeoutMs;
  record('sdk', 'idleTimeoutMs', { ok: ok_, ck }, exp, r.error ? { error: true } : iv ? { value: iv } : {});
}
for (const [ok_, ck] of product([Object.keys(optVp), ['none', 'val']])) {
  const e0 = oracle([{ name: 'option', kind: ok_ === 'val' ? 'set' : 'unset', value: optVp.val }, { name: 'config', kind: ck === 'val' ? 'set' : 'unset', value: { width: 405, height: 305 } }], {});
  const r = await sdkRun(ok_ === 'absent' ? {} : { viewport: optVp[ok_] }, ck);
  record('sdk', 'viewport', { ok: ok_, ck }, e0.value ? { value: e0.value } : {}, r.error ? { error: true } : r.o?.launch?.viewport ? { value: r.o.launch.viewport } : {});
}
sdk.SutradharRuntime.prototype.launch = origLaunch;
const by = {};
for (const r of results) { const k = r.surface + '/' + r.key; by[k] = by[k] || { pass: 0, fail: 0 }; by[k][r.ok ? 'pass' : 'fail']++; }
const out = { seed: '0x5a3f0c14', total: pass + fail, pass, fail, by, failures: results.filter((r) => !r.ok).slice(0, 60) };
fs.writeFileSync(path.join(S0, 't', 'prec-a3.json'), JSON.stringify({ ...out, results }, null, 1));
console.error(JSON.stringify(out, null, 1));
process.exit(0);
