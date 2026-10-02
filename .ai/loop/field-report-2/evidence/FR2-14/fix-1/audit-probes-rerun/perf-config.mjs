// AUDIT-1 GAP-345 attribution: per-command cost of config discovery, measured the way the CLI pays it
// (a COLD node process each time, monotonic clock inside the child). N runs per scenario; median/p90.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const WT = path.resolve(HERE, '../../../../../../..');
const CR = pathToFileURL(path.join(WT, 'packages/capability-runtime/dist/index.js')).href;
const S = path.resolve(process.argv[2]); const N = Number(process.argv[3] || 15);
const deep = path.join(S, 'nogit', 'a', 'b', 'c', 'd', 'e', 'f'); fs.mkdirSync(deep, { recursive: true });
const repo = path.join(S, 'repo'); fs.mkdirSync(path.join(repo, '.git'), { recursive: true }); fs.mkdirSync(path.join(repo, 'x', 'y'), { recursive: true });
const repo2 = path.join(S, 'repo2'); fs.mkdirSync(path.join(repo2, '.git'), { recursive: true }); fs.mkdirSync(path.join(repo2, 'x'), { recursive: true });
fs.writeFileSync(path.join(repo, '.sutradhar.json'), JSON.stringify({ allowedDomains: ['a.com'], viewport: { width: 5, height: 5 } }));
fs.writeFileSync(path.join(repo2, '.sutradhar.json'), JSON.stringify({ downloadDir: './dl', allowedDownloadRoots: ['./o'] }));
const code = 'const t0=performance.now();const m=await import(process.argv[1]);const t1=performance.now();await m.loadProjectConfig({cwd:process.argv[2],discover:true});const t2=performance.now();console.log(JSON.stringify({importMs:t1-t0,loadMs:t2-t1}));';
const scen = { noConfigDeepNoBoundary: deep, noConfigRepoRoot: path.join(S, 'repo2', 'x'), configNoDownloadKeys: path.join(repo, 'x', 'y'), configWithDownloadRoots: path.join(repo2, 'x') };
fs.rmSync(path.join(repo2, '.sutradhar.json')); const res = {};
for (const [k, cwd] of Object.entries(scen)) {
  if (k === 'configWithDownloadRoots') fs.writeFileSync(path.join(repo2, '.sutradhar.json'), JSON.stringify({ downloadDir: './dl', allowedDownloadRoots: ['./o'] }));
  const xs = [];
  for (let i = 0; i < N; i++) { const r = spawnSync(process.execPath, ['--input-type=module', '-e', code, CR, cwd], { encoding: 'utf8' }); try { xs.push(JSON.parse(r.stdout).loadMs); } catch { xs.push(NaN); } }
  xs.sort((a, b) => a - b); res[k] = { n: N, medianMs: +xs[Math.floor(N / 2)].toFixed(2), p90Ms: +xs[Math.floor(N * 0.9)].toFixed(2), maxMs: +xs[N - 1].toFixed(2) };
}
fs.writeFileSync(path.join(HERE, '..', 'perf-config.json'), JSON.stringify(res, null, 1)); console.log(JSON.stringify(res, null, 1));
