// AUDIT-2 F1-surface attack (function level, real dist code of CLI composition + MCP composition).
// Invariant: a DISCOVERED file whose download roots were refused must NEVER have those roots used,
// merged or fallen back to. Each case: refused, or effective download roots EXACTLY the higher layer value.
// argv[2] = scratch root, argv[3] = output json (optional).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
const WT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../../..');
const imp = (p) => import(pathToFileURL(path.join(WT, p)).href);
const CR = await imp('packages/capability-runtime/dist/index.js');
const CLI = await imp('packages/cli/dist/project-config-cli.js');
const MCP = await imp('packages/mcp-server/dist/server.js');
const S = path.resolve(process.argv[2]); fs.rmSync(S, { recursive: true, force: true }); fs.mkdirSync(S, { recursive: true });
const OUT = process.argv[3];
for (const k of Object.keys(process.env)) if (/^SUTRADHAR_/i.test(k)) delete process.env[k];
const NOHOME = path.join(S, 'nohome');
const DEF = path.join(os.tmpdir(), 'sutradhar-downloads');
const H = {};
async function hostile(name, values, extra) {
  const d = path.join(S, name); fs.mkdirSync(path.join(d, '.git', 'hooks'), { recursive: true }); fs.mkdirSync(path.join(d, 'sub'), { recursive: true });
  if (extra) extra(d);
  fs.writeFileSync(path.join(d, '.sutradhar.json'), JSON.stringify(values));
  const r = await CR.loadProjectConfig({ cwd: path.join(d, 'sub'), discover: true, homedir: NOHOME });
  if (r.status !== 'loaded') throw new Error('not loaded ' + name);
  H[name] = { dir: d, cfg: r.config };
}
fs.mkdirSync(path.join(S, 'outside'), { recursive: true });
await hostile('escDl', { downloadDir: '../outside' });
await hostile('escRoots', { allowedDownloadRoots: ['./ok', '../outside'] });
await hostile('gitHooks', { downloadDir: '.git/hooks' });
await hostile('mixed', { downloadDir: '../outside', allowedUploadRoots: ['./cup'], allowedDomains: ['c.test'] });
await hostile('absWin', { downloadDir: 'C:/Windows/Temp' });
await hostile('junc', { downloadDir: './jn' }, (d) => { fs.symlinkSync(path.join(S, 'outside'), path.join(d, 'jn'), 'junction'); });
for (const [n, h] of Object.entries(H)) if (!h.cfg.downloadRefusal) throw new Error('precondition: ' + n + ' has no downloadRefusal');
const rows = []; let pass = 0, fail = 0;
const norm = (a) => (a ?? []).map((x) => path.resolve(x).toLowerCase());
const SEP = path.sep;
const BAD = (x) => x.includes(SEP + 'outside') || x.includes('.git') || x.includes('windows' + SEP + 'temp') || x.endsWith(SEP + 'jn');
function judge(id, r, want) {
  let ok, why = '';
  const fileRoots = norm(H[r.h].cfg.resolved.allowedDownloadRoots);
  const leaked = r.dl ? norm(r.dl).filter((x) => fileRoots.includes(x) || BAD(x)) : [];
  const allowedLeak = want.dl ? norm(want.dl) : [];
  const realLeak = leaked.filter((x) => !allowedLeak.includes(x));
  if (want.refuse) ok = !!r.error && !r.dl;
  else ok = !r.error && JSON.stringify(norm(r.dl)) === JSON.stringify(norm(want.dl)) && (want.up === undefined || JSON.stringify(norm(r.up ?? [])) === JSON.stringify(norm(want.up ?? [])));
  if (realLeak.length) { ok = false; why = 'FILE ROOT LEAKED ' + realLeak.join(','); }
  rows.push({ id, ok, want, got: { error: r.error?.slice(0, 200), dl: r.dl, dlSrc: r.dlSrc, up: r.up }, why });
  ok ? pass++ : fail++;
}
const cliRun = (h, env, extra) => { try { const s = CLI.resolveCliSettings({ flags: {}, env, state: {}, config: H[h].cfg, extraDownloadRoots: extra }); const dl = [...s.fsRoots.allowedDownloadRoots, ...(extra ?? [])]; return { h, dl, dlSrc: s.fsRoots.sources.download, up: s.fsRoots.allowedUploadRoots }; } catch (e) { return { h, error: e.message }; } };
async function mcpRun(h, opts, env) {
  for (const k of Object.keys(process.env)) if (/^SUTRADHAR_/i.test(k)) delete process.env[k];
  Object.assign(process.env, env);
  const oe = console.error; console.error = () => {};
  try { const x = await MCP.createSutradharServer({ ...opts, projectConfig: H[h].cfg, disableAgent: true }); return { h, dl: x.runtime.actionEngine.allowedDownloadRoots, up: x.runtime.allowedUploadRoots }; }
  catch (e) { return { h, error: e.message }; } finally { console.error = oe; for (const k of Object.keys(process.env)) if (/^SUTRADHAR_/i.test(k)) delete process.env[k]; }
}
const NE = path.join(S, 'does-not-exist', 'x');
const ENVDL = path.join(S, 'envdl');
const ENVUP = path.join(S, 'envup');
const PARENT = S;
const DL = 'SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS', UL = 'SUTRADHAR_ALLOWED_UPLOAD_ROOTS';
const ENVCASES = [
  ['unset', undefined, { refuse: true }],
  ['empty', '', { refuse: true }],
  ['spaces', '   ', { refuse: true }],
  ['delims', ';;', { refuse: true }],
  ['delimSpaces', ' ; ; ', { refuse: true }],
  ['zero', '0', { refuse: true }],
  ['false', 'false', { refuse: true }],
  ['brackets', '[]', { refuse: true }],
  ['null', 'null', { refuse: true }],
  ['relOutside', '../outside', { refuse: true }],
  ['tildeUser', '~nobody', { refuse: true }],
  ['nonexistentAbs', NE, { dl: [NE] }],
  ['parentOfHostile', PARENT, { dl: [PARENT] }],
  ['abs', ENVDL, { dl: [ENVDL] }],
  ['absPlusEmpty', ENVDL + ';', { dl: [ENVDL] }],
];
for (const h of Object.keys(H)) {
  for (const [lab, v, want] of ENVCASES) {
    const env = v === undefined ? {} : { [DL]: v };
    judge(`CLI.${h}.env=${lab}`, cliRun(h, env), want);
    judge(`MCP.${h}.env=${lab}`, await mcpRun(h, {}, env), want);
  }
  judge(`CLI.${h}.uploadEnvOnly`, cliRun(h, { [UL]: ENVUP }), { refuse: true });
  judge(`MCP.${h}.uploadEnvOnly`, await mcpRun(h, {}, { [UL]: ENVUP }), { refuse: true });
  judge(`MCP.${h}.uploadOptOnly`, await mcpRun(h, { allowedUploadRoots: [ENVUP] }, {}), { refuse: true });
  judge(`MCP.${h}.opt=[]`, await mcpRun(h, { allowedDownloadRoots: [] }, {}), { refuse: true });
  judge(`MCP.${h}.opt=null`, await mcpRun(h, { allowedDownloadRoots: null }, {}), { refuse: true });
  judge(`MCP.${h}.opt=undefined`, await mcpRun(h, { allowedDownloadRoots: undefined }, {}), { refuse: true });
  judge(`MCP.${h}.opt=[]+envEmpty`, await mcpRun(h, { allowedDownloadRoots: [] }, { [DL]: '' }), { refuse: true });
  judge(`MCP.${h}.opt=[abs]`, await mcpRun(h, { allowedDownloadRoots: [ENVDL] }, {}), { dl: [ENVDL] });
  judge(`MCP.${h}.opt=[abs]+envAbs`, await mcpRun(h, { allowedDownloadRoots: [ENVDL] }, { [DL]: NE }), { dl: [ENVDL] });
  judge(`MCP.${h}.opt=[null]`, await mcpRun(h, { allowedDownloadRoots: [null] }, {}), { refuse: true });
  judge(`MCP.${h}.opt=str`, await mcpRun(h, { allowedDownloadRoots: 'C:/x' }, {}), { refuse: true });
  judge(`CLI.${h}.downloadDir=hostileDir`, cliRun(h, {}, [H[h].dir]), { dl: [DEF, H[h].dir] });
  judge(`CLI.${h}.downloadDir=abs`, cliRun(h, {}, [ENVDL]), { dl: [DEF, ENVDL] });
  judge(`CLI.${h}.downloadDir=abs+env`, cliRun(h, { [DL]: NE }, [ENVDL]), { dl: [NE, ENVDL] });
  judge(`CLI.${h}.downloadDir=[]`, cliRun(h, {}, []), { refuse: true });
  judge(`CLI.${h}.downloadDir=undefined`, cliRun(h, {}, undefined), { refuse: true });
  judge(`CLI.${h}.downloadDir+envBlank`, cliRun(h, { [DL]: ' ' }, [ENVDL]), { dl: [DEF, ENVDL] });
}
{
  const cup = path.join(H.mixed.dir, 'cup');
  judge('CLI.mixed.envDl+fileUp', cliRun('mixed', { [DL]: ENVDL }), { dl: [ENVDL], up: [cup] });
  judge('MCP.mixed.envDl+fileUp', await mcpRun('mixed', {}, { [DL]: ENVDL }), { dl: [ENVDL], up: [cup] });
  judge('MCP.mixed.optDl+fileUp', await mcpRun('mixed', { allowedDownloadRoots: [ENVDL] }, {}), { dl: [ENVDL], up: [cup] });
  judge('CLI.mixed.envUpOnly', cliRun('mixed', { [UL]: ENVUP }), { refuse: true });
}
{
  const f = path.join(H.escDl.dir, '.sutradhar.json');
  const add = (id, ok, got) => { rows.push({ id, ok, got }); ok ? pass++ : fail++; };
  const ex = await CR.loadProjectConfig({ cwd: NOHOME, discover: false, explicitPath: f, explicitOrigin: 'env', homedir: NOHOME });
  const c = ex.config;
  add('EXPLICIT.env.noRefusal', c.downloadRefusal === undefined && c.origin === 'env', { origin: c.origin, refusal: c.downloadRefusal ?? null });
  const s1 = CLI.resolveCliSettings({ flags: {}, env: {}, state: {}, config: c });
  add('EXPLICIT.usedWhenAlone', JSON.stringify(norm(s1.fsRoots.allowedDownloadRoots)) === JSON.stringify(norm([path.join(S, 'outside')])) && s1.fsRoots.sources.download === 'config', s1.fsRoots);
  const s2 = CLI.resolveCliSettings({ flags: {}, env: { [DL]: ENVDL }, state: {}, config: c });
  add('EXPLICIT.envStillBeatsIt', JSON.stringify(norm(s2.fsRoots.allowedDownloadRoots)) === JSON.stringify(norm([ENVDL])), s2.fsRoots.allowedDownloadRoots);
  const ex2 = await CR.loadProjectConfig({ cwd: NOHOME, discover: false, explicitPath: f, explicitOrigin: 'sdk', homedir: NOHOME }).catch((e) => ({ err: e.message }));
  add('EXPLICIT.sdk.noRefusal', !ex2.err && ex2.config.downloadRefusal === undefined, ex2.err ?? ex2.config.origin);
}
const summary = { pass, fail, total: pass + fail, failures: rows.filter((r) => !r.ok) };
if (OUT) fs.writeFileSync(OUT, JSON.stringify({ summary, rows }, null, 1));
console.log(JSON.stringify(summary, null, 1));
process.exit(0);
