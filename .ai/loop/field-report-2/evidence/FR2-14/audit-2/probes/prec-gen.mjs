// AUDIT-2 precedence generator + oracle (seeded, kind-per-layer). NOT derived from the resolvers: the oracle
// is the decided rule "first SET layer wins, whole value; null/undefined/[] and blank env are UNSET".
// Surfaces: CLI composition (real parseArgs for flags + resolveCliSettings), MCP composition (real
// createSutradharServer runtime object; viewport via the registered browser.launch handler).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
const WT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../../..');
const imp = (p) => import(pathToFileURL(path.join(WT, p)).href);
const CR = await imp('packages/capability-runtime/dist/index.js');
const CLI = await imp('packages/cli/dist/project-config-cli.js');
const PA = await imp('packages/cli/dist/parse-args.js');
const MCP = await imp('packages/mcp-server/dist/server.js');
const S = path.resolve(process.argv[2]); fs.rmSync(S, { recursive: true, force: true }); fs.mkdirSync(S, { recursive: true });
const OUT = process.argv[3];
let seed = 0x5eed2a14;
const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const used = new Set(); const uniq = (f) => { for (;;) { const v = f(); const k = JSON.stringify(v); if (!used.has(k)) { used.add(k); return v; } } };
for (const k of Object.keys(process.env)) if (/^SUTRADHAR_/i.test(k)) delete process.env[k];
const DEF_DL = path.join(os.tmpdir(), 'sutradhar-downloads');
const subsets = (a) => { const r = []; for (let m = 0; m < 1 << a.length; m++) r.push(a.filter((_, i) => m & (1 << i))); return r; };
const product = (lists) => lists.reduce((acc, l) => acc.flatMap((x) => l.map((y) => [...x, y])), [[]]);
const val = {
  dom: (l) => uniq(() => [`${l}-${ri(100, 999)}.test`]),
  vp: () => uniq(() => ({ width: ri(320, 1600), height: ri(240, 1200) })),
  idle: () => uniq(() => ri(1000, 99999)),
  root: (l) => uniq(() => path.join(S, 'roots', `${l}-${ri(100, 999)}`)),
};
let n = 0;
async function cfgWith(values) {
  const d = path.join(S, 'c' + n++); fs.mkdirSync(path.join(d, '.git'), { recursive: true });
  fs.writeFileSync(path.join(d, '.sutradhar.json'), JSON.stringify(values));
  const r = await CR.loadProjectConfig({ cwd: d, discover: true, homedir: path.join(S, 'nh') });
  return { cfg: r.config, dir: d };
}
const rows = []; let pass = 0, fail = 0;
const SEP = path.sep;
const canon = (v) => JSON.stringify(v, (k, x) => (typeof x === 'string' && x.includes(SEP) ? path.resolve(x).toLowerCase() : x));
function check(id, got, want) { const ok = canon(got) === canon(want); rows.push({ id, ok, got, want }); ok ? pass++ : fail++; }
function oracle(entries, dflt) {
  for (const e of entries) { if (e.error) return { error: true }; if (e.set) return { source: e.layer, value: e.value }; }
  return { source: 'default', value: dflt };
}
// ---------------- CLI ----------------
const CLI_SPEC = {
  allowedDomains: { layers: ['flag', 'env', 'config'], kinds: { flag: ['v'], env: ['v', 'empty', 'blank', 'zero'], config: ['v'] } },
  viewport: { layers: ['flag', 'state', 'config'], kinds: { flag: ['v', 'zeroWide', 'huge'], state: ['v', 'malformed', 'null'], config: ['v'] } },
  dialog: { layers: ['flag', 'state', 'config'], kinds: { flag: ['v'], state: ['v'], config: ['v'] } },
  download: { layers: ['env', 'config'], kinds: { env: ['v', 'empty', 'blank'], config: ['v'] } },
  upload: { layers: ['env', 'config'], kinds: { env: ['v', 'empty', 'blank'], config: ['v'] } },
};
function cliLayer(key, l, k, argv, env, state, cfgVals, exp) {
  if (key === 'allowedDomains') {
    const v = val.dom(l);
    if (l === 'flag') { argv.push('--allowlist-domains', v[0]); exp.push({ layer: l, set: true, value: v }); }
    if (l === 'env') { env.SUTRADHAR_ALLOWED_DOMAINS = { v: v[0], empty: '', blank: ' , ', zero: '0' }[k]; exp.push({ layer: l, set: k === 'v' || k === 'zero', value: k === 'zero' ? ['0'] : v }); }
    if (l === 'config') { cfgVals.allowedDomains = v; exp.push({ layer: l, set: true, value: v }); }
  }
  if (key === 'viewport') {
    const v = val.vp();
    if (l === 'flag') { argv.push('--viewport', { v: `${v.width}x${v.height}`, zeroWide: `0x${v.height}`, huge: `10000001x${v.height}` }[k]); exp.push({ layer: l, set: k === 'v', value: v }); }
    if (l === 'state') { state.viewport = { v, malformed: { width: -1, height: 5 }, null: null }[k]; exp.push({ layer: l, set: k === 'v', value: v }); }
    if (l === 'config') { cfgVals.viewport = v; exp.push({ layer: l, set: true, value: v }); }
  }
  if (key === 'dialog') {
    if (l === 'flag') { argv.push('--dialog', 'dismiss'); exp.push({ layer: l, set: true, value: 'dismiss' }); }
    if (l === 'state') { state.dialogPolicy = { action: 'accept', setAt: 'x' }; exp.push({ layer: l, set: true, value: 'accept' }); }
    if (l === 'config') { cfgVals.dialog = { mode: 'accept', promptText: 'P' + ri(1, 9999) }; exp.push({ layer: l, set: true, value: 'accept', pt: cfgVals.dialog.promptText }); }
  }
  if (key === 'download' || key === 'upload') {
    const E = key === 'download' ? 'SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS' : 'SUTRADHAR_ALLOWED_UPLOAD_ROOTS';
    if (l === 'env') { const v = val.root('env'); env[E] = { v, empty: '', blank: ' ; ' }[k]; exp.push({ layer: l, set: k === 'v', value: [v] }); }
    if (l === 'config') { const rel = 'cfg' + ri(100, 999); if (key === 'download') cfgVals.downloadDir = './' + rel; else cfgVals.allowedUploadRoots = ['./' + rel]; exp.push({ layer: l, set: true, rel }); }
  }
}
for (const [key, spec] of Object.entries(CLI_SPEC)) {
  for (const sub of subsets(spec.layers)) {
    for (const kinds of product(sub.map((l) => spec.kinds[l]))) {
      const K = Object.fromEntries(sub.map((l, i) => [l, kinds[i]]));
      const argv = ['nav', 'about:blank']; const env = {}; const state = {}; const cfgVals = {}; const exp = [];
      for (const l of spec.layers) if (l in K) cliLayer(key, l, K[l], argv, env, state, cfgVals, exp);
      // an invalid --viewport is an ERROR for the whole command (main() refuses before Chrome): oracle says error
      if (key === 'viewport' && K.flag && K.flag !== 'v') exp.unshift({ layer: 'flag', error: true });
      const dflt = { allowedDomains: undefined, viewport: undefined, dialog: 'report', download: [DEF_DL], upload: undefined }[key];
      const { cfg, dir } = Object.keys(cfgVals).length ? await cfgWith(cfgVals) : {};
      for (const e of exp) if (e.rel) e.value = [path.join(dir, e.rel)];
      const pa = PA.parseArgs(argv);
      const id = `CLI.${key}[${sub.map((l) => l + ':' + K[l]).join('+') || 'none'}]`;
      const want = oracle(exp, dflt);
      if (pa.viewportFlagGivenButInvalid || pa.allowlistDomainsGivenButEmpty) { check(id, { error: true }, want); continue; }
      let s; try { s = CLI.resolveCliSettings({ flags: { allowlistDomains: pa.allowlistDomainsFlag, viewport: pa.viewportFlag, dialog: pa.dialogFlag, dialogText: pa.dialogTextFlag }, env, state, config: cfg }); } catch (e) { check(id, 'THROW ' + e.message, want); continue; }
      if (key === 'allowedDomains') check(id, { source: s.allowedDomains.source, value: s.allowedDomains.value }, want);
      if (key === 'viewport') check(id, { source: s.viewport.source, value: s.viewport.value }, want);
      if (key === 'dialog') { const w = exp.find((e) => e.set && e.layer === want.source); check(id, { source: s.dialog.source, value: s.dialog.policy.mode, pt: s.dialog.policy.promptText }, { ...want, pt: w?.pt }); }
      if (key === 'download') check(id, { source: s.fsRoots.sources.download, value: s.fsRoots.allowedDownloadRoots }, want);
      if (key === 'upload') check(id, { source: s.fsRoots.sources.upload === 'unrestricted' ? 'default' : s.fsRoots.sources.upload, value: s.fsRoots.allowedUploadRoots }, want);
    }
  }
}
// CLI flag odd values via the real parser
{
  const p1 = PA.parseArgs(['nav', 'x', '--allowlist-domains', '']); check('CLI.flag.domains.empty->error', p1.allowlistDomainsGivenButEmpty, true);
  const p2 = PA.parseArgs(['nav', 'x', '--allowlist-domains', ' , ']); check('CLI.flag.domains.blank->error', p2.allowlistDomainsGivenButEmpty, true);
  const p3 = PA.parseArgs(['nav', 'x', '--viewport', '10000000x10000000']); check('CLI.flag.viewport.max-ok', p3.viewportFlag, { width: 10000000, height: 10000000 });
  const p4 = PA.parseArgs(['nav', 'x', '--viewport', '10000000x10000001']); check('CLI.flag.viewport.max+1->invalid', [p4.viewportFlag, p4.viewportFlagGivenButInvalid], [undefined, true]);
  const p5 = PA.parseArgs(['nav', 'x', '--viewport', '1x1']); check('CLI.flag.viewport.1x1-ok', p5.viewportFlag, { width: 1, height: 1 });
  const p6 = PA.parseArgs(['nav', 'x', '--viewport', '99999999999999999999x5']); check('CLI.flag.viewport.overflow->invalid', p6.viewportFlagGivenButInvalid, true);
}
// ---------------- MCP ----------------
async function mcp(opts, env) {
  for (const k of Object.keys(process.env)) if (/^SUTRADHAR_/i.test(k)) delete process.env[k];
  Object.assign(process.env, env);
  const oe = console.error; console.error = () => {};
  try { return await MCP.createSutradharServer({ ...opts, disableAgent: true }); } catch (e) { return { error: e.message }; }
  finally { console.error = oe; for (const k of Object.keys(process.env)) if (/^SUTRADHAR_/i.test(k)) delete process.env[k]; }
}
const MCP_SPEC = {
  allowedDomains: { layers: ['option', 'env', 'config'], kinds: { option: ['v', 'null', 'undef', 'empty'], env: ['v', 'empty', 'blank', 'zero'], config: ['v'] } },
  download: { layers: ['option', 'env', 'config'], kinds: { option: ['v', 'null', 'undef', 'empty'], env: ['v', 'empty', 'blank'], config: ['v'] } },
  upload: { layers: ['option', 'env', 'config'], kinds: { option: ['v', 'null', 'undef', 'empty'], env: ['v', 'empty', 'blank'], config: ['v'] } },
  idle: { layers: ['option', 'env', 'config'], kinds: { option: ['v', 'null', 'undef', 'zero'], env: ['v', 'empty', 'zero'], config: ['v', 'zero'] } },
  dialog: { layers: ['option', 'config'], kinds: { option: ['v', 'null', 'undef'], config: ['v'] } },
};
const OPTKEY = { allowedDomains: 'allowedDomains', download: 'allowedDownloadRoots', upload: 'allowedUploadRoots', idle: 'idleTimeoutMs', dialog: 'dialogPolicy' };
const ENVKEY = { allowedDomains: 'SUTRADHAR_ALLOWED_DOMAINS', download: 'SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS', upload: 'SUTRADHAR_ALLOWED_UPLOAD_ROOTS', idle: 'SUTRADHAR_IDLE_TIMEOUT_MS' };
for (const [key, spec] of Object.entries(MCP_SPEC)) {
  for (const sub of subsets(spec.layers)) {
    for (const kinds of product(sub.map((l) => spec.kinds[l]))) {
      const K = Object.fromEntries(sub.map((l, i) => [l, kinds[i]]));
      const opts = {}; const env = {}; const cfgVals = { viewport: { width: 7, height: 7 } }; const exp = [];
      for (const l of spec.layers) {
        if (!(l in K)) continue; const k = K[l];
        let v;
        if (key === 'allowedDomains') v = val.dom(l);
        if (key === 'download' || key === 'upload') v = [val.root(l)];
        if (key === 'idle') v = val.idle();
        if (key === 'dialog') v = { mode: ['accept', 'dismiss', 'auto'][ri(0, 2)] };
        if (l === 'option') {
          opts[OPTKEY[key]] = { v, null: null, undef: undefined, empty: [], zero: 0 }[k];
          exp.push({ layer: l, set: k === 'v' || k === 'zero', value: k === 'zero' ? 'DISABLED' : v });
        }
        if (l === 'env') {
          const raw = key === 'allowedDomains' ? v[0] : Array.isArray(v) ? v[0] : String(v);
          env[ENVKEY[key]] = { v: raw, empty: '', blank: key === 'allowedDomains' ? ' , ' : ' ; ', zero: '0' }[k];
          exp.push({ layer: l, set: k === 'v' || k === 'zero', value: k === 'zero' ? (key === 'idle' ? 'DISABLED' : ['0']) : v });
        }
        if (l === 'config') {
          if (key === 'allowedDomains') cfgVals.allowedDomains = v;
          if (key === 'download') { cfgVals.downloadDir = './d' + ri(100, 999); }
          if (key === 'upload') { cfgVals.allowedUploadRoots = ['./u' + ri(100, 999)]; }
          if (key === 'idle') cfgVals.idleTimeoutMs = k === 'zero' ? 0 : v;
          if (key === 'dialog') cfgVals.dialog = v;
          exp.push({ layer: l, set: true, value: key === 'idle' && k === 'zero' ? 'DISABLED' : v, cfgRel: key === 'download' ? cfgVals.downloadDir : key === 'upload' ? cfgVals.allowedUploadRoots[0] : undefined });
        }
      }
      const { cfg, dir } = await cfgWith(cfgVals);
      for (const e of exp) if (e.cfgRel) e.value = [path.join(dir, e.cfgRel)];
      const dflt = { allowedDomains: undefined, download: [DEF_DL], upload: undefined, idle: 1800000, dialog: undefined }[key];
      const want = oracle(exp, dflt);
      const wantV = want.value === 'DISABLED' ? undefined : want.value;
      const id = `MCP.${key}[${sub.map((l) => l + ':' + K[l]).join('+') || 'none'}]`;
      const r = await mcp({ ...opts, projectConfig: cfg }, env);
      if (r.error) { check(id, 'THROW ' + r.error, wantV); continue; }
      const rt = r.runtime;
      const got = { allowedDomains: rt.allowedDomains, download: rt.actionEngine.allowedDownloadRoots, upload: rt.allowedUploadRoots, idle: rt.sessionManager.idleTimeoutMs, dialog: rt.dialogPolicy }[key];
      check(id, got, wantV);
    }
  }
}
// MCP viewport: call > option(defaultViewport) > config > default, through the registered tool handler
for (const sub of subsets(['call', 'option', 'config'])) {
  for (const kinds of product(sub.map((l) => (l === 'option' ? ['v', 'null', 'huge'] : l === 'call' ? ['v'] : ['v'])))) {
    const K = Object.fromEntries(sub.map((l, i) => [l, kinds[i]]));
    const V = { call: val.vp(), option: val.vp(), config: val.vp() };
    const { cfg } = await cfgWith(K.config ? { viewport: V.config } : { allowedDomains: ['x.test'] });
    const calls = []; const fakeRt = { launch: async (a) => { calls.push(a); return { sessionId: 's', tabId: 't' }; } };
    const o = { runtime: fakeRt, projectConfig: cfg };
    if (K.option) o.defaultViewport = { v: V.option, null: null, huge: { width: 10000001, height: 5 } }[K.option];
    const r = await mcp(o, {});
    const id = `MCP.viewport[${sub.map((l) => l + ':' + K[l]).join('+') || 'none'}]`;
    if (r.error) { check(id, 'THROW ' + r.error, 'x'); continue; }
    const tool = r.server._registeredTools['browser.launch'];
    await (tool.handler ?? tool.callback)(K.call ? { viewport: V.call } : {}, {});
    const exp = [];
    if (K.call) exp.push({ layer: 'call', set: true, value: V.call });
    if (K.option) exp.push({ layer: 'option', set: K.option === 'v', value: V.option });
    if (K.config) exp.push({ layer: 'config', set: true, value: V.config });
    check(id, calls[0]?.launch?.viewport, oracle(exp, undefined).value);
  }
}
// FILE null rule: null for any key in the file is a load ERROR (fail closed), never "unset -> default"
for (const key of ['downloadDir', 'allowedDownloadRoots', 'allowedUploadRoots', 'allowedDomains', 'dialog', 'idleTimeoutMs', 'viewport']) {
  const d = path.join(S, 'null-' + key); fs.mkdirSync(path.join(d, '.git'), { recursive: true });
  fs.writeFileSync(path.join(d, '.sutradhar.json'), JSON.stringify({ [key]: null }));
  const r = await CR.loadProjectConfig({ cwd: d, discover: true, homedir: path.join(S, 'nh') }).then(() => 'LOADED', (e) => 'ERR ' + e.message.split(': ').slice(1).join(': ').slice(0, 90));
  check('FILE.null.' + key, r.startsWith('ERR'), true);
  rows[rows.length - 1].detail = r;
  for (const odd of ['', 0, false, [], {}]) {
    fs.writeFileSync(path.join(d, '.sutradhar.json'), JSON.stringify({ [key]: odd }));
    const r2 = await CR.loadProjectConfig({ cwd: d, discover: true, homedir: path.join(S, 'nh') }).then((x) => 'LOADED ' + JSON.stringify(x.config.values), (e) => 'ERR');
    const okLoad = key === 'idleTimeoutMs' && odd === 0;
    check('FILE.odd.' + key + '=' + JSON.stringify(odd), okLoad ? r2.startsWith('LOADED') : r2 === 'ERR', true);
    rows[rows.length - 1].detail = r2;
  }
}
// odd option values that are VALUES per the spec ('' / false / 0 win): record the runtime effect for A/B with master
const odd = {};
{
  const { cfg } = await cfgWith({ allowedDomains: ['c.test'], dialog: { mode: 'dismiss' } });
  for (const [lab, o] of [['dom-empty-string', { allowedDomains: '' }], ['dom-false', { allowedDomains: false }], ['dom-zero', { allowedDomains: 0 }], ['dlg-false', { dialogPolicy: false }], ['idle-false', { idleTimeoutMs: false }], ['idle-empty-string', { idleTimeoutMs: '' }]]) {
    const r = await mcp({ ...o, projectConfig: cfg }, { SUTRADHAR_ALLOWED_DOMAINS: 'e.test' });
    odd[lab] = r.error ? 'THROW ' + r.error.slice(0, 100) : { allowedDomains: r.runtime.allowedDomains ?? null, dialog: r.runtime.dialogPolicy ?? null, idle: r.runtime.sessionManager.idleTimeoutMs ?? null };
  }
}
const summary = { pass, fail, total: pass + fail, failures: rows.filter((r) => !r.ok) };
if (OUT) fs.writeFileSync(OUT, JSON.stringify({ summary, odd, rows }, null, 1));
console.log(JSON.stringify({ ...summary, failures: summary.failures.slice(0, 15), odd }, null, 1));
process.exit(0);
