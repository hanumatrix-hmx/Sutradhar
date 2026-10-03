// AUDIT-3 per-command config-loading overhead (monotonic performance.now; cold child per sample).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const [REPO, S0] = process.argv.slice(2);
const S = path.join(S0, 'perf'); fs.rmSync(S, { recursive: true, force: true });
const mk = (n, cfg, git = true) => { const d = path.join(S, n); fs.mkdirSync(d, { recursive: true }); if (git) fs.mkdirSync(path.join(d, '.git')); if (cfg) fs.writeFileSync(path.join(d, '.sutradhar.json'), JSON.stringify(cfg)); return d; };
const dirs = { noFileNoGit: mk('nf', null, false), noFileGit: mk('ng', null), plain: mk('pl', { allowedDomains: ['a.com'], viewport: { width: 800, height: 600 } }), dlRoots: mk('dr', { downloadDir: './dl', allowedDownloadRoots: ['./out'] }), refused: mk('rf', { downloadDir: '../x' }) };
const child = "const t0=performance.now();const m=await import(process.argv[1]);const t1=performance.now();try{await m.loadProjectConfig({cwd:process.cwd(),discover:true})}catch{};const t2=performance.now();console.log(JSON.stringify({imp:t1-t0,load:t2-t1}))";
const crUrl = 'file:///' + path.join(REPO, 'packages/capability-runtime/dist/index.js').split(path.sep).join('/');
const med = (a) => { const s = [...a].sort((x, y) => x - y); return +s[Math.floor(s.length / 2)].toFixed(1); };
const out = { fn: {}, cli: {} };
for (const [k, d] of Object.entries(dirs)) {
  const loads = [];
  for (let i = 0; i < 15; i++) { const r = spawnSync(process.execPath, ['--input-type=module', '-e', child, crUrl], { cwd: d, encoding: 'utf8' }); loads.push(JSON.parse(r.stdout).load); }
  out.fn[k] = { medianMs: med(loads), maxMs: +Math.max(...loads).toFixed(1) };
}
const CLI = path.join(REPO, 'packages/cli/dist/cli.js');
for (const [k, d, cfgEnv] of [['dlRoots, SUTRADHAR_CONFIG=none', dirs.dlRoots, 'none'], ['dlRoots, discovered', dirs.dlRoots, ''], ['plain, discovered', dirs.plain, ''], ['noFileGit, discovered', dirs.noFileGit, '']]) {
  const ts = [];
  for (let i = 0; i < 15; i++) { const s = performance.now(); spawnSync(process.execPath, [CLI, 'close'], { cwd: d, env: { ...process.env, SUTRADHAR_CONFIG: cfgEnv, SUTRADHAR_CLI_STATE_DIR: path.join(S, 'st') }, encoding: 'utf8' }); ts.push(performance.now() - s); }
  out.cli[k] = { medianMs: med(ts) };
}
console.log(JSON.stringify(out, null, 1));
