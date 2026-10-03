// AUDIT-2 config-loading overhead (monotonic performance.now). In-process: loadProjectConfig + resolveCliSettings,
// fresh child per sample (cold module cache) so the number is per CLI command. argv: <scratch> [child <scenario>]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const WT = path.resolve(HERE, '../../../../../../..');
const S = path.resolve(process.argv[2]);
if (process.argv[3] === 'child') {
  const CR = await import(pathToFileURL(path.join(WT, 'packages/capability-runtime/dist/index.js')).href);
  const CLI = await import(pathToFileURL(path.join(WT, 'packages/cli/dist/project-config-cli.js')).href);
  const cwd = process.cwd();
  const t0 = performance.now();
  let r, err = null;
  try { r = await CR.loadProjectConfig({ cwd, discover: true }); CLI.resolveCliSettings({ flags: {}, env: process.env, state: {}, config: r.config }); } catch (e) { err = e.message.slice(0, 60); }
  const ms = performance.now() - t0;
  console.log(JSON.stringify({ ms, status: r?.status, err }));
  process.exit(0);
}
fs.rmSync(S, { recursive: true, force: true });
const mk = (...p) => { const d = path.join(S, ...p); fs.mkdirSync(d, { recursive: true }); return d; };
const sc = {
  noFileNoBoundary: mk('nb', 'a', 'b', 'c'),
  repoNoFile: (() => { mk('r1', '.git'); return mk('r1', 'x', 'y'); })(),
  fileNoDownload: (() => { mk('r2', '.git'); fs.writeFileSync(path.join(S, 'r2', '.sutradhar.json'), JSON.stringify({ allowedDomains: ['a.test'], viewport: { width: 800, height: 600 } })); return mk('r2', 'x'); })(),
  fileWithDownload: (() => { mk('r3', '.git'); fs.writeFileSync(path.join(S, 'r3', '.sutradhar.json'), JSON.stringify({ downloadDir: './dl', allowedDownloadRoots: ['./d2'] })); return mk('r3', 'x'); })(),
  fileRefused: (() => { mk('r4', '.git'); fs.writeFileSync(path.join(S, 'r4', '.sutradhar.json'), JSON.stringify({ downloadDir: '../out' })); return mk('r4', 'x'); })(),
};
const out = {};
for (const [k, cwd] of Object.entries(sc)) {
  const xs = [];
  for (let i = 0; i < 15; i++) { const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), S, 'child'], { cwd, encoding: 'utf8', timeout: 60000, env: { ...process.env, SUTRADHAR_ALLOWED_DOWNLOAD_ROOTS: '' } }); try { xs.push(JSON.parse(r.stdout.trim()).ms); } catch {} }
  xs.sort((a, b) => a - b);
  out[k] = { n: xs.length, medianMs: +xs[Math.floor(xs.length / 2)].toFixed(2), p90Ms: +xs[Math.floor(xs.length * 0.9)].toFixed(2), maxMs: +xs.at(-1).toFixed(2) };
}
console.log(JSON.stringify(out, null, 1));
fs.writeFileSync(path.join(HERE, '..', 'perf-config.json'), JSON.stringify(out, null, 1));
