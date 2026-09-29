// FR2-04 audit-1: wall time of `snap` (gate+attach+snap) and `dialog` (gate-equivalent list only) on a clean page, n=10.
import { spawnSync, execSync } from 'node:child_process';
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)); const root = path.resolve(here, '../../../../../..');
const CLI = path.join(root, 'packages/cli/dist/cli.js'); const R = fs.mkdtempSync(path.join(os.tmpdir(), 'fr2-04-audit-t-'));
const env = { ...process.env, SUTRADHAR_CLI_STATE_DIR: path.join(R, 's'), TEMP: R, TMP: R };
const run = (a) => { const t = Date.now(); const r = spawnSync(process.execPath, [CLI, ...a], { env, encoding: 'utf-8' }); return { ms: Date.now() - t, code: r.status }; };
run(['nav', 'data:text/html,<title>t</title><p>x</p>']);
const snap = [], dlg = [];
for (let i = 0; i < 10; i++) { snap.push(run(['snap'])); dlg.push(run(['dialog'])); }
run(['close']);
const st = (a) => { const s = a.map((x) => x.ms).sort((x, y) => x - y); return { median: s[5], p90: s[9], all: s, codes: [...new Set(a.map((x) => x.code))] }; };
const out = { snap: st(snap), dialogStatus: st(dlg) };
fs.writeFileSync(path.join(here, 'gate-timing.json'), JSON.stringify(out, null, 2)); console.log(JSON.stringify(out));
try { fs.rmSync(R, { recursive: true, force: true }); } catch {}
