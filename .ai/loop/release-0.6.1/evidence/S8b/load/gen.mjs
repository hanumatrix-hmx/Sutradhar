// S8b load generator (plan-review-B F6): W = floor(cores/4) (<= half) busy workers, each SELF-TERMINATES after SELF_MS (<= 180 s);
// random marker only in the workers' argv; PIDs logged to PIDS_FILE; the controller exits at once.
import { spawn } from 'node:child_process'; import fs from 'node:fs'; import os from 'node:os'; import crypto from 'node:crypto';
const SELF_MS = Math.min(Number(process.env.SELF_MS ?? 180000), 180000);
const cores = os.cpus().length, W = Math.max(1, Math.floor(cores / 4));
const marker = 'S8BLOAD' + crypto.randomBytes(6).toString('hex'); fs.writeFileSync(process.env.MARKER_FILE, marker);
const code = 'const e=performance.now()+Number(process.argv[1]);let x=0;while(performance.now()<e){for(let i=0;i<2e6;i++)x+=Math.sqrt(i);}';
const pids = [];
for (let i = 0; i < W; i++) { const c = spawn(process.execPath, ['-e', code, String(SELF_MS), marker], { stdio: 'ignore', windowsHide: true, detached: true, env: { ...process.env, NODE_OPTIONS: '' } }); c.unref(); pids.push(c.pid); }
fs.writeFileSync(process.env.PIDS_FILE, pids.join('\n') + '\n');
console.log(`gen: cores=${cores} workers=${W} self-terminate-ms=${SELF_MS} pids=${pids.join(',')}`);
