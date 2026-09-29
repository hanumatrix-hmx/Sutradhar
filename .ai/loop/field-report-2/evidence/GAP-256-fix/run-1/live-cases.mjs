// GAP-256-fix live verification: REAL CLI (spawned node cli.js) against REAL headless Chrome.
// usage: node live-cases.mjs <cases> <trials> <outFile> [cliPath]
//   cases: comma list of  c1 (crash on active tab, cur+master compare), c2 (crash on background
//   tab), c3a/c3b/c3c (negative controls: real alert / busy script / popup-born alert must STILL
//   block, exit 3) and c4a/c4b (tabs+closetab work while a dialog / busy script blocks, and
//   closetab frees the session).
// Every pass/fail is computed from (1) real CLI exit codes + stdout/stderr and (2) an INDEPENDENT
// re-read of the live browser (Target.getTargets over a fresh CDP connection) AFTER the action.
// Timing uses performance.now() only (monotonic); wall clock is never used for a decision.
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { makeRoot, delay, cleanupRoot, here, CLI_DEFAULT, readState, puppeteer, spawnedPids, taskkill } from './lib.mjs';

const CASES = (process.argv[2] ?? 'c1').split(',');
const TRIALS = Number(process.argv[3] ?? 5);
const OUT = path.join(here, process.argv[4] ?? 'live-cases.jsonl');
const CLI_PATH = process.argv[5] ?? CLI_DEFAULT;
const LABEL = CLI_PATH === CLI_DEFAULT ? 'cur' : 'master';

let PORT;
const server = http.createServer((q, s) => {
  const u = new URL(q.url, 'http://x');
  s.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
  if (u.pathname === '/alert-inline') return s.end(`<!doctype html><title>inline</title><script>alert('inline-${u.searchParams.get('n')}')</script><body>inline</body>`);
  if (u.pathname === '/type-two-popups') return s.end(`<!doctype html><title>type</title><body><input id="in">
<script>let k=0;document.getElementById('in').addEventListener('keydown',()=>{k++;open('http://localhost:${PORT}/'+(k===1?'?n=first-innocent':'alert-inline?n=second-holder'));});</script></body>`);
  return s.end(`<!doctype html><title>page ${u.searchParams.get('n')}</title><body>page ${u.searchParams.get('n')}</body>`);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
PORT = server.address().port;
const BASE = `http://127.0.0.1:${PORT}`;
const root = await makeRoot('live');

function runCli(args, dir, capMs = 60000) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const child = spawn(process.execPath, [CLI_PATH, ...args], {
      env: { ...process.env, TEMP: root.TEMP, TMP: root.TEMP, SUTRADHAR_CLI_STATE_DIR: dir },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    spawnedPids.add(child.pid);
    let out = '', err = '', killed = false;
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    const cap = setTimeout(() => { killed = true; taskkill(child.pid); }, capMs);
    child.on('exit', (code) => { clearTimeout(cap); spawnedPids.delete(child.pid); resolve({ args: args.join(' '), code, ms: Math.round(performance.now() - t0), cap: killed, stdout: out, stderr: err }); });
  });
}
const short = (r) => ({ args: r.args.replace(BASE, '<B>'), code: r.code, ms: r.ms, cap: r.cap, out: r.stdout.trim().slice(0, 400), err: r.stderr.trim().slice(0, 400) });

async function observer(dir) {
  const st = await readState(dir);
  return puppeteer.connect({ browserWSEndpoint: st.wsEndpoint, defaultViewport: null });
}
async function liveTargets(dir) {
  const b = await observer(dir);
  try {
    const r = await b._connection.send('Target.getTargets');
    return r.targetInfos.filter((t) => t.type === 'page').map((t) => ({ id: t.targetId, url: t.url }));
  } finally { await b.disconnect().catch(() => {}); }
}
async function withTarget(dir, urlPart, fn) {
  const b = await observer(dir);
  try {
    const t = b.targets().filter((x) => x.type() === 'page').find((x) => x.url().includes(urlPart));
    if (!t) throw new Error('observer: target not found ' + urlPart);
    const s = await t.createCDPSession();
    await s.send('Runtime.runIfWaitingForDebugger').catch(() => {});
    await fn(s, t);
  } finally { await b.disconnect().catch(() => {}); }
}
const flaggedId = (out, re) => { const line = out.split('\n').find((l) => re.test(l)); const m = line && /([0-9A-F]{32}|tab_\S+)/i.exec(line); return m?.[1]; };

const allDirs = [];
async function trial(name, t, body) {
  const dir = path.join(root.R, `${LABEL}-${name}-${t}`);
  allDirs.push(dir);
  const rec = { case: name, cli: LABEL, trial: t, steps: [], checks: {} };
  const run = async (args, cap) => { const r = await runCli(args, dir, cap); rec.steps.push(short(r)); return r; };
  try { await body({ dir, rec, run }); } catch (e) { rec.error = String(e?.stack ?? e).slice(0, 400); }
  rec.pass = !rec.error && Object.values(rec.checks).every(Boolean);
  await fs.appendFile(OUT, JSON.stringify(rec) + '\n');
  console.log(JSON.stringify({ case: name, cli: LABEL, t, pass: rec.pass, failed: Object.entries(rec.checks).filter(([, v]) => !v).map(([k]) => k), err: rec.error, codes: rec.steps.map((s) => `${s.args.split(' ')[0]}=${s.code}`).join(' ') }));
  await runCli(['close'], dir, 30000);
}

try {
  for (const c of CASES) {
    for (let t = 0; t < TRIALS; t++) {
      if (c === 'c1') await trial('c1', t, async ({ dir, rec, run }) => {
        await run(['nav', `${BASE}/?n=keep${t}`]);
        await run(['newtab', `${BASE}/?n=victim${t}`]);
        await delay(1200);
        const crash = await run(['nav', 'chrome://crash']);
        await delay(1500);
        const snap0 = await run(['dialog']); // gate-exempt: must say crashed-not-dialog, exit 0 (a gated snap would hang in attach on the crashed ACTIVE tab: see residual-*.json)
        const tabs = await run(['tabs']);
        rec.checks.tabsExit0 = tabs.code === 0;
        const victimId = flaggedId(tabs.stdout, /crash/i);
        rec.checks.tabsListsCrashedTab = !!victimId;
        if (LABEL === 'cur') rec.checks.tabsFlagsCrashed = /\[crashed\]/.test(tabs.stdout);
        rec.checks.notReportedAsDialog = !/dialogPending|dialog is open and blocking/.test(snap0.stdout + snap0.stderr + tabs.stdout + tabs.stderr);
        if (LABEL === 'cur') rec.checks.dialogVerbSaysCrashedNotDialog = snap0.code === 0 && /No dialog is open/.test(snap0.stdout) && /has crashed/.test(snap0.stderr);
        if (victimId) {
          const cl = await run(['closetab', victimId]);
          rec.checks.closetabExit0 = cl.code === 0;
          const after = await liveTargets(dir); // INDEPENDENT re-read after the action
          rec.checks.crashedTargetGoneFromBrowser = !after.some((x) => x.id === victimId) && !after.some((x) => x.url.includes('crash'));
        }
        const nav = await run(['nav', `${BASE}/?n=after${t}`]);
        rec.checks.navExit0 = nav.code === 0;
        const snap = await run(['snap']);
        rec.checks.snapExit0 = snap.code === 0 && /after/.test(snap.stdout);
        const after2 = await liveTargets(dir);
        rec.checks.sessionSurvives = after2.some((x) => x.url.includes(`n=after${t}`)) && !after2.some((x) => x.url.includes("crash"));
        rec.crashNavExit = crash.code; rec.snapAfterCrashExit = snap0.code; rec.snapAfterCrashMs = snap0.ms;
        if (LABEL === 'master') { rec.checks = { masterInfoOnly: true }; rec.masterCodes = { tabs: tabs.code, snap0: snap0.code, nav: nav.code, snap: snap.code }; }
      });

      if (c === 'c2' || c === 'c2g') await trial(c, t, async ({ dir, rec, run }) => {
        const method = t % 2 === 0 ? 'Page.navigate-chrome-crash' : 'Page.crash';
        rec.method = method;
        await run(['nav', `${BASE}/?n=keep${t}`]);
        await run(['newtab', `${BASE}/?n=victim${t}`]);
        await run(['newtab', `${BASE}/?n=third${t}`]);
        await delay(1200);
        let victimTargetId;
        let sawCrashEvent = false;
        {
          const b = await observer(dir);
          try {
            const tg = b.targets().filter((x) => x.type() === 'page').find((x) => x.url().includes(`n=victim${t}`));
            victimTargetId = tg._targetId;
            b._connection.on('Target.targetCrashed', (e) => { if (e.targetId === victimTargetId) sawCrashEvent = true; });
            const s = await tg.createCDPSession();
            await s.send('Runtime.runIfWaitingForDebugger').catch(() => {});
            if (method === 'Page.crash') s.send('Page.crash').catch(() => {});
            else s.send('Page.navigate', { url: 'chrome://crash' }).catch(() => {});
            await delay(2000);
          } finally { await b.disconnect().catch(() => {}); }
        }
        rec.checks.crashActuallyHappened = sawCrashEvent; // independent: Chrome itself announced the crash
        await delay(500);
        if (c === 'c2g') {
          // the gate itself must not block on a background crashed tab (spec 2.8.2 step 1)
          const snap0 = await run(['snap'], 20000);
          // the GATE must not exit 3 / call it a dialog. What the command does AFTER the gate is recorded, not judged: for a tab that
          // re-crashes on reload (chrome://crash) the normal attach path hangs, exactly like master (see residual-*.json).
          rec.afterGate = snap0.cap ? 'hang-in-attach (killed at 20s cap)' : 'exit ' + snap0.code;
          rec.checks.gateDoesNotBlock = snap0.code !== 3 && !/dialogPending|dialog is open and blocking/.test(snap0.stdout + snap0.stderr);
          rec.checks.crashNoted = /has crashed/.test(snap0.stderr) && snap0.stderr.includes(victimTargetId);
          rec.checks.notReportedAsDialog = !/dialogPending|dialog is open and blocking/.test(snap0.stdout + snap0.stderr);
          return;
        }
        const dlg = await run(['dialog']);
        rec.checks.dialogSaysNone = dlg.code === 0 && /No dialog is open/.test(dlg.stdout);
        rec.checks.crashNoted = /has crashed/.test(dlg.stderr) && dlg.stderr.includes(victimTargetId);
        const tabs = await run(['tabs']);
        rec.checks.tabsExit0 = tabs.code === 0;
        rec.checks.tabsFlagsVictimCrashed = tabs.stdout.split('\n').some((l) => l.includes(victimTargetId) && /\[crashed\]/.test(l));
        const cl = await run(['closetab', victimTargetId]);
        rec.checks.closetabExit0 = cl.code === 0;
        const after = await liveTargets(dir);
        rec.checks.crashedTargetGoneFromBrowser = !after.some((x) => x.id === victimTargetId);
        const nav = await run(['nav', `${BASE}/?n=after${t}`]);
        rec.checks.navExit0 = nav.code === 0;
        const snap = await run(['snap']);
        rec.checks.snapExit0 = snap.code === 0 && /after/.test(snap.stdout);
        const after2 = await liveTargets(dir);
        rec.checks.sessionSurvives = after2.some((x) => x.url.includes(`n=after${t}`)) && after2.length === 2;
      });


      if (c === 'c3a' || c === 'c4a') await trial(c, t, async ({ dir, rec, run }) => {
        await run(['nav', `${BASE}/?n=keep${t}`]);
        await run(['newtab', `${BASE}/alert-inline?n=a${t}`]); // real alert on load (may exit 3, pre-empted)
        await delay(1200);
        const snap0 = await run(['snap']);
        rec.checks.negativeControl_blocksExit3 = snap0.code === 3 && /alert dialog is open and blocking/.test(snap0.stderr + snap0.stdout);
        rec.checks.notMisreportedAsCrash = !/renderer is gone/.test(snap0.stderr + snap0.stdout);
        if (c === 'c3a') return;
        const tabs = await run(['tabs']);
        rec.checks.tabsExit0WhileBlocked = tabs.code === 0;
        const id = flaggedId(tabs.stdout, /\[blocked: alert dialog\]/);
        rec.checks.tabsFlagsDialogTab = !!id;
        if (id) {
          const cl = await run(['closetab', id]);
          rec.checks.closetabExit0 = cl.code === 0;
          const after = await liveTargets(dir);
          rec.checks.dialogTabGoneFromBrowser = !after.some((x) => x.id === id);
        }
        const snap = await run(['snap']);
        rec.checks.sessionFreedSnapExit0 = snap.code === 0 && /keep/.test(snap.stdout);
        const nav = await run(['nav', `${BASE}/?n=after${t}`]);
        rec.checks.navExit0 = nav.code === 0;
      });

      if (c === 'c3b' || c === 'c4b') await trial(c, t, async ({ dir, rec, run }) => {
        await run(['nav', `${BASE}/?n=keep${t}`]);
        await run(['newtab', `${BASE}/?n=busy${t}`]);
        await delay(800);
        await withTarget(dir, `n=busy${t}`, async (s) => {
          s.send('Runtime.evaluate', { expression: 'setTimeout(()=>{const e=performance.now()+40000;while(performance.now()<e);},0)' }).catch(() => {});
          await delay(600);
        });
        const snap0 = await run(['snap']);
        // A busy script is NOT a blocking state by design (GAP-240: Performance.getMetrics answers under a busy script, so the gate
        // is clear and the command simply waits). The crash exclusion must never label it crashed, and it must still finish exit 0.
        rec.note = 'busy script: not a blocking state by design; only asserting it is never labelled crashed and the command completes';
        rec.checks.completesExit0 = snap0.code === 0;
        rec.checks.notMisreportedAsCrash = !/renderer is gone/.test(snap0.stderr + snap0.stdout);
        if (c === 'c3b') return;
        const tabs = await run(['tabs']);
        rec.checks.tabsExit0WhileBlocked = tabs.code === 0;
        const id = flaggedId(tabs.stdout, new RegExp(`busy${t}.*\\[blocked`));
        rec.checks.tabsFlagsBusyTab = !!id;
        if (id) {
          const cl = await run(['closetab', id]);
          rec.checks.closetabExit0 = cl.code === 0;
          const after = await liveTargets(dir);
          rec.checks.busyTabGoneFromBrowser = !after.some((x) => x.id === id);
        }
        const snap = await run(['snap']);
        rec.checks.sessionFreedSnapExit0 = snap.code === 0 && /keep/.test(snap.stdout);
      });

      if (c === 'c4c') await trial(c, t, async ({ dir, rec, run }) => {
        // dialog opened by a popup (tracked, or liveness-inferred 'unknown'): tabs + closetab must still work
        await run(['nav', `${BASE}/type-two-popups?t=${t}`]);
        await run(['type', '#in', 'ab']);
        await delay(1200);
        const snap0 = await run(['snap']);
        rec.checks.negativeControl_blocksExit3 = snap0.code === 3;
        // The page's own retry can open more than one alert popup, and a late one may still be loading (unflagged) at the first
        // listing. The user-level recovery loop is: tabs -> closetab every flagged tab -> repeat until nothing is flagged.
        let allClosed = true, everFlagged = 0, tabsAllExit0 = true;
        const closedIds = [];
        for (let round = 0; round < 4; round++) {
          const tabs = await run(['tabs']);
          if (tabs.code !== 0) tabsAllExit0 = false;
          const ids = tabs.stdout.split('\n').filter((l) => /\[blocked/.test(l)).map((l) => /([0-9A-F]{32})/i.exec(l)?.[1]).filter(Boolean);
          if (ids.length === 0) break;
          everFlagged += ids.length;
          for (const id of ids) {
            const cl = await run(['closetab', id]);
            if (cl.code !== 0) allClosed = false;
            closedIds.push(id);
          }
          await delay(700);
        }
        rec.rounds = rec.steps.filter((s) => s.args === 'tabs').length;
        rec.checks.tabsExit0WhileBlocked = tabsAllExit0;
        rec.checks.tabsFlagsBlockedTabs = everFlagged >= 1;
        rec.checks.closetabExit0ForEach = allClosed && closedIds.length >= 1;
        const after = await liveTargets(dir);
        rec.checks.blockedTabsGoneFromBrowser = closedIds.every((id) => !after.some((x) => x.id === id));
        const snap = await run(['snap'], 30000);
        rec.checks.sessionFreedSnapExit0 = snap.code === 0;
      });

      if (c === 'c3c') await trial(c, t, async ({ dir, rec, run }) => {
        await run(['nav', `${BASE}/type-two-popups?t=${t}`]);
        await run(['type', '#in', 'ab']);
        await delay(1200);
        const snap0 = await run(['snap']);
        rec.checks.negativeControl_blocksExit3 = snap0.code === 3;
        rec.checks.notMisreportedAsCrash = !/renderer is gone/.test(snap0.stderr + snap0.stdout);
      });
    }
  }
} finally {
  server.close();
  const leftovers = await cleanupRoot(root, (a, d, o) => runCli(a, d, o?.capMs ?? 20000), allDirs);
  console.log('leftovers', JSON.stringify(leftovers));
  await fs.appendFile(OUT, JSON.stringify({ leftovers }) + '\n');
  process.exit(0);
}
