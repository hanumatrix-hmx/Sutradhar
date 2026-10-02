// AUDIT-1 independent precedence generator + oracle (function level, CLI + MCP composition code).
// Oracle rule (re-derived from the decided spec, not copied): for each key the surface's layers are
// ordered highest-first; the effective value is the FIRST layer that is present; never merged.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
const WT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../../..');
const imp = (p) => import(pathToFileURL(path.join(WT, p)).href);
const CR = await imp('packages/capability-runtime/dist/index.js');
const CLI = await imp('packages/cli/dist/project-config-cli.js');
const MCP = await imp('packages/mcp-server/dist/server.js');
const S = path.resolve(process.argv[2]); fs.mkdirSync(S, { recursive: true });
const subsets = (names) => { const r = []; for (let m = 0; m < 1 << names.length; m++) r.push(names.filter((_, i) => m & (1 << i))); return r; };
let pass = 0, fail = 0; const failures = []; const rows = [];
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function check(id, got, want) { const ok = eq(got, want); if (ok) pass++; else { fail++; failures.push({ id, got, want }); } rows.push({ id, ok }); }
let cfgN = 0;
async function makeCfg(values) {
  const d = path.join(S, 'cfg' + cfgN++); fs.mkdirSync(path.join(d, '.git'), { recursive: true });
  fs.writeFileSync(path.join(d, '.sutradhar.json'), JSON.stringify(values));
  const r = await CR.loadProjectConfig({ cwd: d, discover: true, homedir: path.join(S, 'nohome') });
  return { cfg: r.config, dir: d };
}
const ENVKEYS = ['SUTRADHAR_ALLOWED_DOMAINS', 'SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS', 'SUTRADHAR_ALLOWED_UPLOAD_ROOTS', 'SUTRADHAR_IDLE_TIMEOUT_MS', 'SUTRADHAR_CONFIG'];
const ENV0 = {}; for (const k of ENVKEYS) { ENV0[k] = process.env[k]; delete process.env[k]; }
const ABS = (n) => path.join(S, 'roots', n);
const L = {
  dom: { flag: ['f.test'], option: ['o.test'], env: 'e.test', config: ['c.test'] },
  vp: { flag: { width: 401, height: 301 }, state: { width: 402, height: 302 }, option: { width: 403, height: 303 }, call: { width: 404, height: 304 }, config: { width: 405, height: 305 } },
  dlg: { flag: 'dismiss', state: { action: 'accept', setAt: 'x' }, option: { mode: 'dismiss' }, config: { mode: 'accept', promptText: 'cfgtext' } },
  idle: { option: 4242, env: '5000', config: 6000 },
};
// ---------------- CLI composition (resolveCliSettings) ----------------
const CLI_LAYERS = { allowedDomains: ['flag', 'env', 'config'], download: ['env', 'config'], upload: ['env', 'config'], dialog: ['flag', 'state', 'config'], viewport: ['flag', 'state', 'config'] };
for (const key of Object.keys(CLI_LAYERS)) {
  const layers = CLI_LAYERS[key];
  for (const sub of subsets(layers)) {
    const has = (l) => sub.includes(l);
    const cfgVals = {};
    if (has('config')) {
      if (key === 'allowedDomains') cfgVals.allowedDomains = L.dom.config;
      if (key === 'download') cfgVals.downloadDir = './cdl';
      if (key === 'upload') cfgVals.allowedUploadRoots = ['./cup'];
      if (key === 'dialog') cfgVals.dialog = L.dlg.config;
      if (key === 'viewport') cfgVals.viewport = L.vp.config;
    }
    if (key !== 'viewport') cfgVals.viewport = { width: 999, height: 999 };
    const { cfg, dir } = await makeCfg(cfgVals);
    const env = {};
    if (has('env')) {
      if (key === 'allowedDomains') env.SUTRADHAR_ALLOWED_DOMAINS = L.dom.env;
      if (key === 'download') env.SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS = ABS('envdl');
      if (key === 'upload') env.SUTRADHAR_ALLOWED_UPLOAD_ROOTS = ABS('envup');
    }
    const flags = {}; const state = {};
    if (has('flag')) { if (key === 'allowedDomains') flags.allowlistDomains = L.dom.flag; if (key === 'dialog') flags.dialog = L.dlg.flag; if (key === 'viewport') flags.viewport = L.vp.flag; }
    if (has('state')) { if (key === 'dialog') state.dialogPolicy = L.dlg.state; if (key === 'viewport') state.viewport = L.vp.state; }
    const s = CLI.resolveCliSettings({ flags, env, state, config: cfg });
    const first = layers.find(has) ?? 'default';
    const id = 'CLI.' + key + '[' + (sub.join('+') || 'none') + ']';
    if (key === 'allowedDomains') check(id, [s.allowedDomains.value, s.allowedDomains.source], [{ flag: L.dom.flag, env: [L.dom.env], config: L.dom.config, default: undefined }[first], first]);
    if (key === 'download') check(id, [s.fsRoots.allowedDownloadRoots, s.fsRoots.sources.download], [{ env: [ABS('envdl')], config: [path.join(dir, 'cdl')], default: [path.join(os.tmpdir(), 'sutradhar-downloads')] }[first], first]);
    if (key === 'upload') check(id, [s.fsRoots.allowedUploadRoots, s.fsRoots.sources.upload], [{ env: [ABS('envup')], config: [path.join(dir, 'cup')], default: undefined }[first], first === 'default' ? 'unrestricted' : first]);
    if (key === 'dialog') check(id, [s.dialog.policy.mode, s.dialog.policy.promptText, s.dialog.source], [{ flag: 'dismiss', state: 'accept', config: 'accept', default: 'report' }[first], first === 'config' ? 'cfgtext' : undefined, first]);
    if (key === 'viewport') check(id, [s.viewport.value, s.viewport.source], [{ flag: L.vp.flag, state: L.vp.state, config: L.vp.config, default: undefined }[first], first]);
  }
}
// CLI odd values
{
  const { cfg } = await makeCfg({ allowedDomains: ['c.test'], viewport: { width: 405, height: 305 }, dialog: { mode: 'accept', promptText: 'cfgtext' } });
  const r = (o) => CLI.resolveCliSettings({ flags: {}, env: {}, state: {}, config: cfg, ...o });
  check('CLI.odd.envDomainsEmpty->config', r({ env: { SUTRADHAR_ALLOWED_DOMAINS: '' } }).allowedDomains.source, 'config');
  check('CLI.odd.envDomainsBlankCommas->config', r({ env: { SUTRADHAR_ALLOWED_DOMAINS: ' , ,' } }).allowedDomains.source, 'config');
  check('CLI.odd.envNameLowercase-ignored(fn-level; win32 env is case-insensitive at process level)', r({ env: { sutradhar_allowed_domains: 'e.test' } }).allowedDomains.source, 'config');
  check('CLI.odd.flagAcceptNoInheritPromptText', r({ flags: { dialog: 'accept' } }).dialog.policy, { mode: 'accept', promptText: undefined });
  check('CLI.odd.flagReportBeatsConfigAccept', r({ flags: { dialog: 'report' } }).dialog.policy.mode, 'report');
  check('CLI.odd.stateReportBeatsConfigAccept', r({ state: { dialogPolicy: { action: 'report', setAt: 'x' } } }).dialog.policy.mode, 'report');
  check('CLI.odd.malformedStateViewport->config', r({ state: { viewport: { width: 0, height: 5 } } }).viewport.source, 'config');
  check('CLI.odd.idleNotExposed', Object.keys(r({})).some((k) => /idle/i.test(k)), false);
  check('CLI.odd.envDownloadRelative-throws', (() => { try { r({ env: { SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS: 'rel' } }); return 'no-throw'; } catch { return 'throws'; } })(), 'throws');
}
// ---------------- MCP composition (createSutradharServer; the real runtime object is inspected) ----------------
async function mcp(opts, env) {
  for (const k of ENVKEYS) delete process.env[k];
  Object.assign(process.env, env);
  const origErr = console.error; const lines = []; console.error = (...a) => lines.push(a.join(' '));
  try { const h = await MCP.createSutradharServer({ ...opts, disableAgent: true }); return { rt: h.runtime, server: h.server, lines }; }
  catch (e) { return { error: e.message, lines }; }
  finally { console.error = origErr; }
}
const rtDl = (rt) => rt.actionEngine.allowedDownloadRoots;
const MCP_LAYERS = { allowedDomains: ['option', 'env', 'config'], download: ['option', 'env', 'config'], upload: ['option', 'env', 'config'], dialog: ['option', 'config'], idle: ['option', 'env', 'config'] };
for (const key of Object.keys(MCP_LAYERS)) {
  const layers = MCP_LAYERS[key];
  for (const sub of subsets(layers)) {
    const has = (l) => sub.includes(l);
    const cfgVals = { viewport: { width: 999, height: 999 } };
    if (has('config')) { if (key === 'allowedDomains') cfgVals.allowedDomains = L.dom.config; if (key === 'download') cfgVals.downloadDir = './cdl'; if (key === 'upload') cfgVals.allowedUploadRoots = ['./cup']; if (key === 'dialog') cfgVals.dialog = L.dlg.config; if (key === 'idle') cfgVals.idleTimeoutMs = L.idle.config; }
    const { cfg, dir } = await makeCfg(cfgVals);
    const env = {}; const opts = { projectConfig: cfg };
    if (has('env')) { if (key === 'allowedDomains') env.SUTRADHAR_ALLOWED_DOMAINS = L.dom.env; if (key === 'download') env.SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS = ABS('envdl'); if (key === 'upload') env.SUTRADHAR_ALLOWED_UPLOAD_ROOTS = ABS('envup'); if (key === 'idle') env.SUTRADHAR_IDLE_TIMEOUT_MS = L.idle.env; }
    if (has('option')) { if (key === 'allowedDomains') opts.allowedDomains = L.dom.option; if (key === 'download') opts.allowedDownloadRoots = [ABS('optdl')]; if (key === 'upload') opts.allowedUploadRoots = [ABS('optup')]; if (key === 'dialog') opts.dialogPolicy = L.dlg.option; if (key === 'idle') opts.idleTimeoutMs = L.idle.option; }
    const { rt, error } = await mcp(opts, env);
    const first = layers.find(has) ?? 'default';
    const id = 'MCP.' + key + '[' + (sub.join('+') || 'none') + ']';
    if (error) { check(id, 'ERROR ' + error, 'no error'); continue; }
    if (key === 'allowedDomains') check(id, rt.allowedDomains, { option: L.dom.option, env: [L.dom.env], config: L.dom.config, default: undefined }[first]);
    if (key === 'download') check(id, rtDl(rt), { option: [ABS('optdl')], env: [ABS('envdl')], config: [path.join(dir, 'cdl')], default: [path.join(os.tmpdir(), 'sutradhar-downloads')] }[first]);
    if (key === 'upload') check(id, rt.allowedUploadRoots, { option: [ABS('optup')], env: [ABS('envup')], config: [path.join(dir, 'cup')], default: undefined }[first]);
    if (key === 'dialog') check(id, rt.dialogPolicy, { option: L.dlg.option, config: L.dlg.config, default: undefined }[first]);
    if (key === 'idle') check(id, rt.sessionManager.idleTimeoutMs, { option: 4242, env: 5000, config: 6000, default: 1800000 }[first]);
  }
}
// MCP viewport: call arg > option defaultViewport > config > default, through the REGISTERED browser.launch handler
for (const sub of subsets(['call', 'option', 'config'])) {
  const has = (l) => sub.includes(l);
  const { cfg } = await makeCfg(has('config') ? { viewport: L.vp.config } : { allowedDomains: ['x.test'] });
  const calls = [];
  const fakeRt = { launch: async (a) => { calls.push(a); return { sessionId: 's', tabId: 't' }; } };
  const o = { runtime: fakeRt, projectConfig: cfg };
  if (has('option')) o.defaultViewport = L.vp.option;
  const { server, error } = await mcp(o, {});
  if (error) { check('MCP.viewport.err', error, ''); continue; }
  const tool = server._registeredTools['browser.launch'];
  await (tool.handler ?? tool.callback)(has('call') ? { viewport: L.vp.call } : {}, {});
  const first = ['call', 'option', 'config'].find(has) ?? 'default';
  check('MCP.viewport[' + (sub.join('+') || 'none') + ']', calls[0]?.launch?.viewport, { call: L.vp.call, option: L.vp.option, config: L.vp.config, default: undefined }[first]);
}
// MCP odd values: explicit falsy in a higher layer
{
  const { cfg } = await makeCfg({ allowedDomains: ['c.test'], idleTimeoutMs: 6000, dialog: { mode: 'dismiss' } });
  let r;
  r = await mcp({ projectConfig: cfg, idleTimeoutMs: 0 }, { SUTRADHAR_IDLE_TIMEOUT_MS: '5000' }); check('MCP.odd.option0-wins(disabled)', r.rt?.sessionManager.idleTimeoutMs, undefined);
  r = await mcp({ projectConfig: cfg }, { SUTRADHAR_IDLE_TIMEOUT_MS: '0' }); check('MCP.odd.env0-wins(disabled)', r.rt?.sessionManager.idleTimeoutMs, undefined);
  r = await mcp({ projectConfig: cfg }, { SUTRADHAR_IDLE_TIMEOUT_MS: '' }); check('MCP.odd.envEmpty->config', r.rt?.sessionManager.idleTimeoutMs, 6000);
  r = await mcp({ projectConfig: cfg }, { SUTRADHAR_IDLE_TIMEOUT_MS: 'abc' }); check('MCP.odd.envAbc-fails', !!r.error, true);
  r = await mcp({ projectConfig: cfg }, { SUTRADHAR_IDLE_TIMEOUT_MS: ' 5000' }); check('MCP.odd.envLeadingSpace-fails', !!r.error, true);
  r = await mcp({ projectConfig: cfg, allowedDomains: [] }, { SUTRADHAR_ALLOWED_DOMAINS: 'e.test' }); check('MCP.odd.optionEmptyArr->env', r.rt?.allowedDomains, ['e.test']);
  r = await mcp({ projectConfig: cfg, allowedDomains: [] }, {}); check('MCP.odd.optionEmptyArr->config', r.rt?.allowedDomains, ['c.test']);
  r = await mcp({ projectConfig: cfg, allowedDomains: null }, { SUTRADHAR_ALLOWED_DOMAINS: 'e.test' }); check('MCP.odd.optionNULL->env (master: null ?? env)', r.rt?.allowedDomains, ['e.test']);
  r = await mcp({ projectConfig: cfg, allowedDomains: null }, {}); check('MCP.odd.optionNULL->config', r.rt?.allowedDomains, ['c.test']);
  r = await mcp({ projectConfig: cfg, dialogPolicy: null }, {}); check('MCP.odd.dialogNULL->config', r.rt?.dialogPolicy, { mode: 'dismiss' });
  r = await mcp({ projectConfig: cfg }, { SUTRADHAR_ALLOWED_DOMAINS: ' , ' }); check('MCP.odd.envBlank->config', r.rt?.allowedDomains, ['c.test']);
  r = await mcp({ projectConfig: cfg, idleTimeoutMs: -5 }, {}); check('MCP.odd.optionNegative->disabled(lenient, documented)', r.rt?.sessionManager.idleTimeoutMs, undefined);
  r = await mcp({ projectConfig: cfg, allowedDownloadRoots: null }, {}); check('MCP.odd.optionDlNULL->default', r.rt ? r.rt.actionEngine.allowedDownloadRoots : r.error, [path.join(os.tmpdir(), 'sutradhar-downloads')]);
}
for (const k of ENVKEYS) { if (ENV0[k] === undefined) delete process.env[k]; else process.env[k] = ENV0[k]; }
const summary = { pass, fail, total: pass + fail, failures };
fs.writeFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'precedence-fn.json'), JSON.stringify({ summary, rows }, null, 1));
console.log(JSON.stringify(summary, null, 1));
process.exit(0);
