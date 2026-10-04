// S6h CPU-load generator controller (plan-review-B F6). Spawns W = floor(cores/2) busy-loop worker processes that SELF-TERMINATE after
// SELF_MS (<= 5 min), logs every worker PID, writes a random marker (kept in argv of the workers only) to LOAD_MARKER_FILE, then exits.
// Never kills anything by image name; the stopper (s6h-load-stop.mjs) kills only the logged PIDs after a CIM CommandLine marker check.
import { spawn } from 'node:child_process'; import fs from 'node:fs'; import os from 'node:os'; import crypto from 'node:crypto';
const SELF_MS = Math.min(Number(process.env.LOAD_SELF_MS ?? 270_000), 300_000);
const cores = os.cpus().length, workers = Math.max(1, Math.floor(cores / 2));
const marker = 'S6HLOAD' + crypto.randomBytes(6).toString('hex');
fs.writeFileSync(process.env.LOAD_MARKER_FILE, marker);
const code = 'const end=performance.now()+Number(process.argv[1]);let x=0;while(performance.now()<end){for(let i=0;i<3e6;i++)x+=Math.sqrt(i);}';
const pids = [];
for (let i = 0; i < workers; i++) { const c = spawn(process.execPath, ['-e', code, String(SELF_MS), marker], { stdio: 'ignore', windowsHide: true, detached: true }); c.unref(); pids.push(c.pid); }
fs.writeFileSync(process.env.LOAD_PIDS_FILE, pids.join('\n') + '\n');
console.log(`loadgen: cores=${cores} workers=${workers} (<= half) self-terminate-after-ms=${SELF_MS} pids=${pids.join(',')} controller-pid=${process.pid}`);
