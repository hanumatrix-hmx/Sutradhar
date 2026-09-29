// fix-2 live verification of GAP-185: a real, live custom-state-dir session (via
// SUTRADHAR_CLI_STATE_DIR) whose state.json is deliberately corrupted 3 ways (empty, garbage,
// truncated) must NEVER be planned for a kill/delete by `doctor --gc --dry-run` while the state
// file is in that corrupted condition -- liveness must read as UNKNOWN, not orphan.
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { makeScratch, runCli, isAlive } from './common.mjs';

const S = await makeScratch('fr2-03-fix2-gap185-');
const customDir = path.join(S.R, 'custom-state-dir');
await mkdir(customDir, { recursive: true });
const env = { ...S.env, SUTRADHAR_CLI_STATE_DIR: customDir };
const stateFile = path.join(customDir, 'state.json');
const gcEnv = { ...S.env };
delete gcEnv.SUTRADHAR_CLI_STATE_DIR;

const out = { cases: {} };
let chromePid;
try {
  const nav = await runCli(['nav', 'data:text/html,<title>gap185-fix2</title>'], env, S.cwd(1));
  out.navCode = nav.code;
  const raw = await readFile(stateFile, 'utf-8');
  const st = JSON.parse(raw);
  chromePid = st.chromePid;
  out.browserAliveBeforeCorruption = isAlive(chromePid);

  for (const [label, content] of [['empty', ''], ['garbage', '{not json at all'], ['truncated', raw.slice(0, 30)]]) {
    await writeFile(stateFile, content);
    const dry = await runCli(['doctor', '--gc', '--dry-run', '--json'], gcEnv, S.cwd(2));
    const dj = JSON.parse(dry.stdout);
    out.cases[label] = {
      killPlanned: dj.actions.some((a) => a.type === 'kill' && a.pid === chromePid),
      deletePlanned: dj.actions.some((a) => a.type === 'deleteDir' && a.path.toLowerCase() === (st.profileDir ?? '').toLowerCase()),
      keptUnreadable: dj.kept.some((k) => k.path && k.path.toLowerCase() === stateFile.toLowerCase() && k.reason === 'unreadable-state'),
      keptBrowserUnknown: dj.kept.some((k) => k.pid === chromePid && k.reason === 'unknown-liveness'),
    };
  }
  await writeFile(stateFile, raw); // restore, then confirm the session is genuinely unaffected
  const finalUse = await runCli(['eval', 'document.title'], env, S.cwd(1));
  out.finalUse = { code: finalUse.code, out: finalUse.stdout.trim() };
  out.browserAliveAfter = isAlive(chromePid);
  out.pass =
    out.browserAliveBeforeGc !== false &&
    Object.values(out.cases).every((c) => !c.killPlanned && !c.deletePlanned && c.keptUnreadable && c.keptBrowserUnknown) &&
    out.browserAliveAfter && out.finalUse.code === 0 && out.finalUse.out.includes('gap185-fix2');
} finally {
  if (chromePid) { try { process.kill(chromePid); } catch {} }
  await rm(S.R, { recursive: true, force: true }).catch(() => {});
}
console.log(JSON.stringify(out, null, 2));
