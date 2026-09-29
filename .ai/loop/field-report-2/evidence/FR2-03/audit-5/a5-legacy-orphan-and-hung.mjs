// audit-5: two questions about GAP-194's probeLegacyChromeReachable fix, against a REAL Chrome.
//  (A) Spec §101/G12/D6: an unmarked legacy Chrome on a sutradhar-cli-* dir that NO state file
//      references is an orphan and must be killed once its process age >= 120s. A running orphan
//      Chrome still serves its own DevToolsActivePort -- so does fix-4's probe now protect every
//      real legacy orphan forever (under-kill regression)? Compared against the same snapshot with
//      legacyProbes emptied (== fix-3 behaviour).
//  (B) False-"unreachable": the GAP-194 scenario (legacy session, state.json unreadable) but the
//      live Chrome is momentarily unresponsive (>800ms; simulated by NtSuspendProcess on the
//      browser process only). Contrast: the SAME hung Chrome with a READABLE legacy state.
//  Also (L): probeLock (degraded-mode delete gate) against the live Chrome's profile dir.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, realpathSync } from 'node:fs';
import os from 'node:os'; import path from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)); const repo = path.resolve(here, '../../../../../..');
const CLI = path.join(repo, 'packages/cli/dist/cli.js');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), 'fr2-03-a5-legacy-'))); const T = path.join(R, 'temp'); const SR = path.join(R, 'sr');
mkdirSync(T); mkdirSync(SR);
process.env.TEMP = T; process.env.TMP = T; process.env.SUTRADHAR_CLI_STATE_ROOT = SR; delete process.env.SUTRADHAR_CLI_STATE_DIR;
const gc = await import(pathToFileURL(path.join(repo, 'packages/cli/dist/gc.js')).href);
const pc = await import(pathToFileURL(path.join(repo, 'packages/cli/dist/profile-cleanup.js')).href);
const ps = (cmd) => execFileSync('powershell.exe', ['-NoProfile', '-Command', cmd], { encoding: 'utf8' });
const NT = `Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public static class Nt{[DllImport("ntdll.dll")]public static extern int NtSuspendProcess(IntPtr h);[DllImport("ntdll.dll")]public static extern int NtResumeProcess(IntPtr h);}';`;
const suspend = (pid) => ps(`${NT} $p=Get-Process -Id ${pid}; [Nt]::NtSuspendProcess($p.Handle)`);
const resume = (pid) => ps(`${NT} $p=Get-Process -Id ${pid}; [Nt]::NtResumeProcess($p.Handle)`);
const mine = (plan) => ({
  actions: plan.actions.filter((a) => JSON.stringify(a).toLowerCase().includes(R.toLowerCase().replace(/\\/g, '\\\\')) || (a.type === 'kill' && a.pid === chrome.pid)),
  kept: plan.kept.filter((k) => (k.path && k.path.toLowerCase().startsWith(R.toLowerCase())) || k.pid === chrome.pid),
});
const udd = path.join(T, `sutradhar-cli-${Date.now()}-A5leg1`);
mkdirSync(udd);
const chrome = spawn(CHROME, [`--user-data-dir=${udd}`, '--remote-debugging-port=0', '--headless=new', '--no-first-run', '--no-default-browser-check', 'about:blank'], { detached: true, stdio: 'ignore' });
chrome.unref();
const res = { R, udd, chromePid: chrome.pid, t0: new Date().toISOString() };
let port;
for (let i = 0; i < 100 && !port; i++) { await sleep(200); try { [port] = readFileSync(path.join(udd, 'DevToolsActivePort'), 'utf8').trim().split(/\r?\n/); } catch {} }
res.port = port;
const ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
res.wsEndpoint = ver.webSocketDebuggerUrl;
try {
  // (L) degraded-mode lock probe against a LIVE Chrome
  res.L_lockfileExists = existsSync(path.join(udd, 'lockfile'));
  res.L_probeLockOnLiveChrome = await pc.probeLock(udd);
  console.log('chrome', chrome.pid, 'port', port, 'probeLock(live)=', res.L_probeLockOnLiveChrome, '; waiting 125s past grace...');
  await sleep(125_000);

  // (A) genuine orphan: no state file anywhere references it.
  const snapA = await gc.collectGcSnapshot();
  res.A_legacyProbes = snapA.legacyProbes;
  res.A_fix4Plan = mine(gc.planGc(snapA));
  res.A_withoutProbe_fix3Equivalent = mine(gc.planGc({ ...snapA, legacyProbes: {} }));
  const dry = JSON.parse(execFileSync(process.execPath, [CLI, 'doctor', '--gc', '--dry-run', '--json'], { env: process.env, cwd: R, encoding: 'utf8' }));
  res.A_realCliDryRun = mine(dry);

  // (B) GAP-194 scenario + a momentarily unresponsive (suspended) live Chrome.
  mkdirSync(path.join(SR, 'a5legacy'));
  const sf = path.join(SR, 'a5legacy', 'state.json');
  const legacyState = JSON.stringify({ sessionId: 'a5-legacy', wsEndpoint: res.wsEndpoint, chromePid: chrome.pid, lastUrl: 'about:blank' });
  // B0 baseline: readable legacy state, Chrome responsive
  writeFileSync(sf, legacyState);
  res.B0_readable_responsive = mine(gc.planGc(await gc.collectGcSnapshot()));
  // B1 garbled (GAP-194's own trigger), Chrome responsive -> fix-4 should protect
  writeFileSync(sf, '{"sessionId":"a5-legacy","wsEnd');
  res.B1_garbled_responsive = mine(gc.planGc(await gc.collectGcSnapshot()));
  // B2 garbled + suspended browser process (hung >800ms)
  suspend(chrome.pid);
  try {
    const t = Date.now();
    const snapB2 = await gc.collectGcSnapshot();
    res.B2_collectMs = Date.now() - t;
    res.B2_legacyProbes = snapB2.legacyProbes;
    res.B2_garbled_hung = mine(gc.planGc(snapB2));
    // B3 readable + suspended: the SAME hung Chrome with a readable state is protected ('unresponsive')
    writeFileSync(sf, legacyState);
    res.B3_readable_hung = mine(gc.planGc(await gc.collectGcSnapshot()));
  } finally {
    resume(chrome.pid);
  }
  await sleep(500);
  res.B_chromeStillReachableAfterResume = (await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.ok).catch(() => false));
} finally {
  try { execFileSync('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {}
  await sleep(1500);
  try { rmSync(R, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch (e) { res.cleanupError = String(e); }
  res.cleanup = { chromeAlive: (() => { try { process.kill(chrome.pid, 0); return true; } catch { return false; } })(), rootExists: existsSync(R) };
  writeFileSync(path.join(here, 'a5-legacy-orphan-and-hung.json'), JSON.stringify(res, null, 2));
  console.log(JSON.stringify(res, null, 2));
}
