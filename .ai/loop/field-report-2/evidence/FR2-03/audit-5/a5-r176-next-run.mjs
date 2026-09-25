// audit-5: independent check of fix-4's disclosed R176 regression claim ("the killed orphan's dir is
// reclaimed on the NEXT run once grace expires"). Uses a5r-regressions.mjs's own leftover scratch root.
// Runs a real GC immediately (dir age still < 120s by mtime -> expect kept 'grace'), then polls: a real
// GC every 20s until the dir is gone, recording the dir's mtime age at each run -- so any window
// LONGER than "first run after mtime+120s" would show up.
import { execFileSync } from 'node:child_process';
import { existsSync, statSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)); const repo = path.resolve(here, '../../../../../..');
const CLI = path.join(repo, 'packages/cli/dist/cli.js');
const R = process.argv[2]; const T = path.join(R, 'temp'); const SR = path.join(R, 'sr');
const orphanDir = path.join(T, process.argv[3]);
const env = { ...process.env, TEMP: T, TMP: T, SUTRADHAR_CLI_STATE_ROOT: SR }; delete env.SUTRADHAR_CLI_STATE_DIR;
const runs = [];
for (let i = 0; i < 12 && existsSync(orphanDir); i++) {
  const ageMs = Date.now() - statSync(orphanDir).mtimeMs;
  const real = JSON.parse(execFileSync(process.execPath, [CLI, 'doctor', '--gc', '--json'], { env, cwd: R, encoding: 'utf8' }));
  const act = real.actions.find((a) => a.type === 'deleteDir' && a.path === orphanDir);
  const kept = real.kept.find((k) => k.path === orphanDir);
  runs.push({ at: new Date().toISOString(), dirMtimeAgeMs: Math.round(ageMs), action: act ?? null, kept: kept ?? null, remaining: real.remaining, existsAfter: existsSync(orphanDir) });
  if (!existsSync(orphanDir)) break;
  await new Promise((r) => setTimeout(r, 20_000));
}
const res = { orphanDir, runs, reclaimed: !existsSync(orphanDir), leftoverInT: existsSync(T) ? readdirSync(T) : [] };
try { rmSync(R, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch (e) { res.cleanupError = String(e); }
res.scratchRootRemoved = !existsSync(R);
writeFileSync(path.join(here, 'a5-r176-next-run.json'), JSON.stringify(res, null, 2));
console.log(JSON.stringify(res, null, 2));
