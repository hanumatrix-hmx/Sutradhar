// Auditor probe: a runtime-marked Chrome whose user-data-dir is OUTSIDE tempRoot (row D: caller-supplied
// or named-profile dir) and whose owner is dead. Spec §2.8 rule 2 says: not in scope -> kept out-of-scope.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { mkdir, rm } from 'node:fs/promises';
import { makeScratch, runCli, CHROME, taskkill, isAlive } from './common.mjs';
const S = await makeScratch('fr2-03-adv-rtscope-');
const udd = path.join(S.R, 'my-own-profile'); await mkdir(udd);
const dead = spawn(process.execPath, ['-e', '']); await new Promise((r) => dead.on('close', r));
const c = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${udd}`, '--no-first-run',
  '--sutradhar-launch=runtime', `--sutradhar-owner-pid=${dead.pid}`, `--sutradhar-owner-start=${Date.now() - 60000}`, 'about:blank'], { detached: true, stdio: 'ignore' });
c.unref();
await new Promise((r) => setTimeout(r, 3000));
const dry = await runCli(['doctor', '--gc', '--dry-run', '--json'], S.env, S.cwd(1));
const j = JSON.parse(dry.stdout);
const kill = j.actions.find((a) => a.type === 'kill' && a.pid === c.pid);
const kept = j.kept.find((k) => k.pid === c.pid);
console.log(JSON.stringify({ chromeAlive: isAlive(c.pid), plannedKill: kill ?? null, kept: kept ?? null, tempRoot: j.scope.tempRoot }, null, 2));
taskkill(c.pid, true);
await new Promise((r) => setTimeout(r, 1500));
await rm(S.R, { recursive: true, force: true, maxRetries: 5 });
