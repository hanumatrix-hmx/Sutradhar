// Exercises the CLI's post-spawn kill path: run with a parse-args bound widened (B15 harness mutant), so a 1e9
// viewport reaches Chrome and setDeviceMetricsOverride fails after spawn. Pass = exit 1 and no Chrome left. argv: <scratch>
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromePids } from './obs.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const WT = path.resolve(HERE, '../../../../../../..');
const S = path.resolve(process.argv[2]); fs.rmSync(S, { recursive: true, force: true });
const temp = path.join(S, 'temp'); const st = path.join(S, 'state'); const w = path.join(S, 'w');
for (const d of [temp, st, path.join(w, '.git')]) fs.mkdirSync(d, { recursive: true });
const env = { ...process.env, TEMP: temp, TMP: temp, SUTRADHAR_CLI_STATE_DIR: st };
const r = spawnSync(process.execPath, [path.join(WT, 'packages/cli/dist/cli.js'), 'nav', 'about:blank', '--viewport', '1000000000x800'], { cwd: w, env, encoding: 'utf8', timeout: 120000, windowsHide: true });
await new Promise((x) => setTimeout(x, 4000));
const left = await chromePids(temp);
const pass = r.status === 1 && Array.isArray(left) && left.length === 0;
console.log(JSON.stringify({ pass, fail: pass ? 0 : 1, code: r.status, err: (r.stderr || '').slice(0, 200), left, stateFile: fs.existsSync(path.join(st, 'state.json')) }));
