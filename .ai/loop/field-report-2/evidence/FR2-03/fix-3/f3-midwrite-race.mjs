// audit-3 independent mid-write race (GAP-185), higher-power than audit-2/fix-2's version: in addition to real CLI
// commands rewriting state.json, a tight writer loop does exactly what writeState does (non-atomic writeFile of the same
// content) thousands of times/sec, so a large FRACTION of GC scans land mid-write. For each GC dry-run we record both
// "planned to kill the live Chrome" (must be 0) and "observed the state file as unreadable" (the race actually hit --
// the real denominator; a 0-kill result only means something if this is large). DRY-RUN ONLY.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)); const repo = path.resolve(here, '../../../../../..');
const CLI = path.join(repo, 'packages/cli/dist/cli.js');
const R = mkdtempSync(path.join(os.tmpdir(), 'fr2-03-a3-midw-')); const T = path.join(R, 'temp'); mkdirSync(T); mkdirSync(path.join(R, 'sr')); mkdirSync(path.join(R, 'custom'));
const env = { ...process.env, TEMP: T, TMP: T, SUTRADHAR_CLI_STATE_ROOT: path.join(R, 'sr'), SUTRADHAR_CLI_STATE_DIR: path.join(R, 'custom') };
const gcEnv = { ...env }; delete gcEnv.SUTRADHAR_CLI_STATE_DIR;
const run = (args, e) => new Promise(r => { const c = spawn(process.execPath, [CLI, ...args], { env: e, cwd: R }); let o = ''; c.stdout.on('data', d => o += d); c.on('close', code => r({ code, o })); });
await run(['nav', 'data:text/html,<title>a3midw</title>'], env);
const sf = path.join(R, 'custom', 'state.json'); const st = JSON.parse(readFileSync(sf, 'utf8'));
const DUR = Number(process.argv[2] ?? 180000); const end = Date.now() + DUR;
const tight = spawn(process.execPath, [path.join(here, "a3-writer.cjs"), sf, String(DUR)]); let tightWrites = ""; tight.stdout.on("data", d => tightWrites += d); const tightClosed = new Promise(r => tight.on("close", r));
let cliWrites = 0, gcs = 0, killPlans = 0, deletePlans = 0, sawUnreadable = 0, sawLive = 0, parseFail = 0; const hits = [];
const cliWriter = async () => { while (Date.now() < end) { await run(['eval', '1', '--viewport', `${900 + (cliWrites % 7)}x600`], env); cliWrites++; } };
const gcer = async () => { while (Date.now() < end) { const r = await run(['doctor', '--gc', '--dry-run', '--json'], gcEnv); gcs++;
  let j; try { j = JSON.parse(r.o); } catch { parseFail++; continue; }
  const cur = (() => { try { return JSON.parse(readFileSync(sf, 'utf8')).chromePid; } catch { return st.chromePid; } })();
  if (j.kept.some(k => k.reason === 'unreadable-state')) sawUnreadable++;
  if (j.kept.some(k => k.reason === 'live-session')) sawLive++;
  if (j.actions.some(a => a.type === 'kill' && a.pid === cur)) { killPlans++; hits.push({ at: new Date().toISOString(), cur, actions: j.actions }); }
  if (j.actions.some(a => a.type === 'deleteDir' && a.path.toLowerCase() === st.profileDir.toLowerCase())) deletePlans++; } };
await Promise.all([...(process.argv[4] === "nocli" ? [] : [cliWriter()]), gcer(), gcer()]);
await tightClosed;
const res = { R, chromePid: st.chromePid, durationMs: DUR, tightWrites: Number(tightWrites), cliWrites, gcDryRuns: gcs, gcJsonParseFailures: parseFail,
  gcRunsThatSawStateUnreadable_RACE_HIT: sawUnreadable, gcRunsThatSawSessionLive: sawLive,
  gcRunsPlanningToKillCurrentLiveChrome_MUST_BE_0: killPlans, gcRunsPlanningToDeleteLiveProfile_MUST_BE_0: deletePlans, hits: hits.slice(0, 5) };
writeFileSync(path.join(here, `midwrite-race-${process.argv[3] ?? 'run'}.json`), JSON.stringify(res, null, 2)); console.log(JSON.stringify({ ...res, hits: hits.length }));
await run(['close'], env);
