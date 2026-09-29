// FR2-04 audit-3, point 7: attribute the per-command overhead. Times process start + module load
// (`help`, no session, no Chrome) for the branch CLI vs the pre-FR2-04 master CLI, and the
// per-module import cost on the branch.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs/promises';
import { here, repoRoot } from './lib.mjs';

const BR = path.join(repoRoot, 'packages/cli/dist/cli.js');
const MA = 'E:/HMX_Projects/Internal_Projects/PinchTab/packages/cli/dist/cli.js';
const N = Number(process.argv[2] ?? 12);
const stats = (a) => { const s = [...a].sort((x, y) => x - y); return { n: s.length, median: s[Math.floor(s.length / 2)], min: s[0], max: s.at(-1) }; };
function time(args, env = {}) { const t0 = performance.now(); spawnSync(process.execPath, args, { env: { ...process.env, ...env }, stdio: 'ignore', windowsHide: true }); return Math.round(performance.now() - t0); }
const out = {};
out.nodeBare = stats(Array.from({ length: N }, () => time(['-e', '0'])));
out.branchHelp = stats(Array.from({ length: N }, () => time([BR, 'help'])));
out.masterHelp = stats(Array.from({ length: N }, () => time([MA, 'help'])));
// import cost of individual workspace packages as the branch resolves them
const imp = (spec, from) => `import(${JSON.stringify(spec)}).then(()=>0)`;
const req = (pkgDir) => ['--input-type=module', '-e', `import { createRequire } from 'node:module'; const r = createRequire(${JSON.stringify(path.join(pkgDir, 'package.json'))}); const t0 = performance.now(); await import(r.resolve(process.argv[1])); console.log(Math.round(performance.now()-t0));`];
function importMs(pkgDir, spec) {
  const vals = [];
  for (let i = 0; i < 5; i++) { const r = spawnSync(process.execPath, [...req(pkgDir), spec], { encoding: 'utf-8', windowsHide: true }); vals.push(Number(r.stdout.trim())); }
  return stats(vals);
}
const brCli = path.join(repoRoot, 'packages/cli');
const maCli = 'E:/HMX_Projects/Internal_Projects/PinchTab/packages/cli';
out.importBranch = { browser: importMs(brCli, '@sutradhar/browser'), runtime: importMs(brCli, '@sutradhar/capability-runtime'), puppeteer: importMs(path.join(repoRoot, 'packages/browser'), 'puppeteer-core') };
out.importMaster = { browser: importMs(maCli, '@sutradhar/browser'), runtime: importMs(maCli, '@sutradhar/capability-runtime') };
console.log(JSON.stringify(out, null, 1));
await fs.writeFile(path.join(here, 'startup-probe.json'), JSON.stringify({ at: new Date().toISOString(), ...out }, null, 2));
