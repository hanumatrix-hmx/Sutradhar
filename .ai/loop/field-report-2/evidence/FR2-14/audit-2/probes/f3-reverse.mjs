// F3 residual: a link ABOVE home pointing INTO home (junction and symlink). Also the CLI doctor view. argv: <scratch>
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const WT = path.resolve(HERE, '../../../../../../..');
const CR = await import(pathToFileURL(path.join(WT, 'packages/capability-runtime/dist/index.js')).href);
const S = path.resolve(process.argv[2]); fs.rmSync(S, { recursive: true, force: true });
const top = path.join(S, 'top'); const home = path.join(top, 'home'); fs.mkdirSync(path.join(home, 'p'), { recursive: true });
fs.writeFileSync(path.join(top, '.sutradhar.json'), JSON.stringify({ allowedDomains: ['above-home.test'] }));
fs.symlinkSync(path.join(home, 'p'), path.join(top, 'jn'), 'junction');
let sym = true; try { fs.symlinkSync(path.join(home, 'p'), path.join(top, 'sl'), 'dir'); } catch { sym = false; }
const out = {};
for (const k of ['jn', ...(sym ? ['sl'] : [])]) {
  const r = await CR.loadProjectConfig({ cwd: path.join(top, k), discover: true, homedir: home });
  out[k] = { status: r.status, path: r.config?.path ?? null, stoppedAt: r.stoppedAt ?? null };
}
const d = spawnSync(process.execPath, [path.join(WT, 'packages/cli/dist/cli.js'), 'doctor'], { cwd: path.join(top, 'jn'), env: { ...process.env, USERPROFILE: home, HOME: home, TEMP: path.join(S, 't'), TMP: path.join(S, 't') }, encoding: 'utf8', timeout: 60000 });
out.cliDoctorJunction = (d.stdout || '').split(String.fromCharCode(10)).filter((l) => l.startsWith('Config')).map((l) => l.slice(0, 220));
out.controlInsideHome = await CR.loadProjectConfig({ cwd: path.join(home, 'p'), discover: true, homedir: home }).then((r) => ({ status: r.status, stoppedAt: r.stoppedAt }));
console.log(JSON.stringify(out, null, 1));
