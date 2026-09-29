// GAP-256-fix audit-1 live cases: REAL CLI child processes + REAL headless Chrome.
// usage: node acases.mjs <cases,comma> <trials> <outFile.jsonl> [cur|master]
// Every verdict = CLI exit codes/output + an INDEPENDENT re-read of the browser AFTER the action
// (fresh CDP connection, Target.getTargets). Monotonic clock (performance.now) only.
import path from 'node:path';
import fs from 'node:fs/promises';
import { makeRoot, makeCli, startServer, delay, cleanupRoot, here, CLI_CUR, CLI_MASTER, readState, readWarden,
  observer, liveTargets, rawSession, sendT, hexIds, taskkill, wardensUnder, clickAt } from './alib.mjs';

const CASES = process.argv[2].split(',');
const TRIALS = Number(process.argv[3] ?? 5);
const OUT = path.join(here, process.argv[4]);
const LABEL = process.argv[5] ?? 'cur';
const CLI = LABEL === 'master' ? CLI_MASTER : CLI_CUR;
const { server, BASE } = await startServer();
const root = await makeRoot(LABEL);
const cli = makeCli(root, CLI);
const dirs = [];
const short = (r) => ({ a: r.args.replaceAll(BASE, '<B>'), code: r.code, ms: r.ms, cap: r.cap, out: r.stdout.trim().slice(0, 600), err: r.stderr.trim().slice(0, 600) });

async function findTarget(dir, part) { return (await liveTargets(dir)).find((t) => t.url.includes(part)); }
// Crash a target from an independent connection and prove Chrome itself announced the crash.
async function crashTarget(dir, targetId, method) {
  const b = await observer(dir);
  let saw = false;
  try {
    b._connection.on('Target.targetCrashed', (e) => { if (e.targetId === targetId) saw = true; });
    await b._connection.send('Target.setDiscoverTargets', { discover: true });
    const s = await rawSession(b, targetId);
    s.send('Runtime.runIfWaitingForDebugger').catch(() => {});
    if (method === 'Page.crash') s.send('Page.crash').catch(() => {});
    else s.send('Page.navigate', { url: 'chrome://crash' }).catch(() => {});
    const t0 = performance.now();
    while (!saw && performance.now() - t0 < 5000) await delay(50);
  } finally { await b.disconnect().catch(() => {}); }
  return saw;
}
async function evalOn(dir, targetId, expression) {
  const b = await observer(dir);
  try { const s = await rawSession(b, targetId); s.send('Runtime.runIfWaitingForDebugger').catch(() => {}); s.send('Runtime.evaluate', { expression }).catch(() => {}); await delay(300); }
  finally { await b.disconnect().catch(() => {}); }
}
async function navOn(dir, targetId, url) {
  const b = await observer(dir);
  try { const s = await rawSession(b, targetId); s.send('Page.navigate', { url }).catch(() => {}); await delay(1500); }
  finally { await b.disconnect().catch(() => {}); }
}
const DIALOG_BLOCK = /dialog is open and blocking|dialogPending/;
const CRASH_NOTE = /renderer is gone/;

async function trial(name, t, body) {
  const dir = path.join(root.R, `${LABEL}-${name}-${t}`);
  dirs.push(dir);
  const rec = { case: name, cli: LABEL, trial: t, steps: [], checks: {}, info: {} };
  const run = async (args, cap) => { const r = await cli(args, dir, cap); rec.steps.push(short(r)); return r; };
  try { await body({ dir, rec, run }); } catch (e) { rec.error = String(e?.stack ?? e).slice(0, 500); }
  rec.pass = !rec.error && Object.values(rec.checks).every(Boolean);
  await fs.appendFile(OUT, JSON.stringify(rec) + '\n');
  console.log(JSON.stringify({ case: name, cli: LABEL, t, pass: rec.pass, failed: Object.entries(rec.checks).filter(([, v]) => !v).map(([k]) => k), err: rec.error?.slice(0, 200), codes: rec.steps.map((s) => `${s.a.split(' ')[0]}=${s.code}${s.cap ? '/CAP' : ''}(${s.ms})`).join(' '), info: rec.info }));
  await cli(['close'], dir, 30000);
}

const C = {
  // Point 1: core repro, ACTIVE tab crashed with the CLI's own `nav chrome://crash`.
  async A1({ dir, rec, run }, t) {
    await run(['nav', `${BASE}/?n=keep${t}`]);
    await run(['newtab', `${BASE}/?n=victim${t}`]);
    await delay(1000);
    // independent crash witness armed BEFORE the CLI crashes the (CLI-)active tab; records WHICH target crashed
    const b = await observer(dir); const crashed = [];
    b._connection.on('Target.targetCrashed', (e) => crashed.push(e.targetId));
    await b._connection.send('Target.setDiscoverTargets', { discover: true });
    const crash = await run(['nav', 'chrome://crash']);
    const tw = performance.now(); while (crashed.length === 0 && performance.now() - tw < 5000) await delay(50);
    await b.disconnect().catch(() => {});
    rec.checks.crashWitnessed = crashed.length > 0;
    const all0 = await liveTargets(dir);
    const victim = all0.find((x) => x.id === crashed[0]) ?? { id: 'NONE' };
    rec.info.crashedTab = victim.url;
    rec.info.crashNavExit = crash.code;
    await delay(1000);
    const tabs = await run(['tabs'], 30000);
    rec.checks.tabsExit0 = tabs.code === 0;
    rec.checks.tabsFlagsVictimCrashed = tabs.stdout.split('\n').some((l) => l.includes(victim.id) && /\[crashed\]/.test(l));
    rec.checks.tabsNotDialog = !DIALOG_BLOCK.test(tabs.stdout + tabs.stderr);
    const cl = await run(['closetab', victim.id], 30000);
    rec.checks.closetabExit0 = cl.code === 0 && /Closed tab/.test(cl.stdout);
    const after = await liveTargets(dir);
    rec.checks.victimGone = !after.some((x) => x.id === victim.id);
    rec.checks.survivorStays = after.length === 1 && all0.some((x) => x.id === after[0].id);
    const nav = await run(['nav', `${BASE}/?n=after${t}`], 60000);
    rec.checks.navExit0 = nav.code === 0;
    const snap = await run(['snap'], 60000);
    rec.checks.snapExit0 = snap.code === 0 && new RegExp(`after${t}`).test(snap.stdout);
    const after2 = await liveTargets(dir);
    rec.checks.sameBrowserHasAfter = after2.some((x) => x.url.includes(`after${t}`)) && after2.length === 1 && after2[0].id === after[0].id;
    rec.info.selfHealed = /fresh session/.test(rec.steps.map((s) => s.err).join('\n'));
    rec.checks.noSelfHeal = !rec.info.selfHealed;
  },
  // Point 1: BACKGROUND tab crashed (method alternates Page.crash / Page.navigate chrome://crash).
  async A2({ dir, rec, run }, t) {
    const method = t % 2 === 0 ? 'Page.crash' : 'navigate-chrome-crash';
    rec.info.method = method;
    await run(['nav', `${BASE}/?n=keep${t}`]);
    await run(['newtab', `${BASE}/?n=victim${t}`]);
    await run(['newtab', `${BASE}/?n=third${t}`]);
    await delay(800);
    const victim = await findTarget(dir, `victim${t}`);
    rec.checks.crashWitnessed = await crashTarget(dir, victim.id, method);
    await delay(500);
    const snap0 = await run(['snap'], 25000); // gated verb on the HEALTHY active tab
    rec.info.snap0 = snap0.cap ? 'CAP(25s)' : `exit ${snap0.code} ${snap0.ms}ms`;
    rec.checks.gateNotExit3 = snap0.code !== 3 && !DIALOG_BLOCK.test(snap0.stdout + snap0.stderr);
    rec.checks.crashNoteNamesVictim = CRASH_NOTE.test(snap0.stderr) && snap0.stderr.includes(victim.id);
    const tabs = await run(['tabs'], 30000);
    rec.checks.tabsExit0 = tabs.code === 0 && !tabs.cap;
    rec.info.tabsFlagsVictimCrashed = tabs.stdout.split('\n').some((l) => l.includes(victim.id) && /\[crashed\]/.test(l));
    rec.info.tabsPath = /browser level/.test(tabs.stderr) ? 'browser-level' : 'normal';
    const cl = await run(['closetab', victim.id], 30000);
    rec.checks.closetabExit0 = cl.code === 0;
    const after = await liveTargets(dir);
    rec.checks.victimGoneOthersStay = !after.some((x) => x.id === victim.id) && after.some((x) => x.url.includes(`keep${t}`)) && after.some((x) => x.url.includes(`third${t}`));
    const nav = await run(['nav', `${BASE}/?n=after${t}`], 60000);
    rec.checks.navExit0 = nav.code === 0;
    const snap = await run(['snap'], 60000);
    rec.checks.snapExit0 = snap.code === 0 && new RegExp(`after${t}`).test(snap.stdout);
    rec.checks.noSelfHeal = !/fresh session/.test(rec.steps.map((s) => s.err).join('\n'));
  },
  // Point 2 negative control: a REAL alert (inline on load of a new tab) must still block, exit 3.
  async N1({ dir, rec, run }, t) {
    await run(['nav', `${BASE}/?n=keep${t}`]);
    await run(['newtab', `${BASE}/alert-inline?n=a${t}`]);
    await delay(1000);
    const snap = await run(['snap'], 30000);
    rec.checks.exit3 = snap.code === 3 && /alert dialog is open and blocking/.test(snap.stdout + snap.stderr);
    rec.checks.noCrashNote = !CRASH_NOTE.test(snap.stdout + snap.stderr);
    const nav = await run(['nav', `${BASE}/?n=x${t}`], 30000);
    rec.checks.navAlsoExit3 = nav.code === 3;
    const tabs = await run(['tabs'], 30000);
    rec.checks.tabsFlagsAlertNotCrashed = /\[blocked: alert dialog\]/.test(tabs.stdout) && !/\[crashed\]/.test(tabs.stdout);
    // observer: the alert target is genuinely still blocked (dialog not silently dismissed)
    const a = await findTarget(dir, `alert-inline?n=a${t}`);
    const b = await observer(dir);
    try { const s = await rawSession(b, a.id); rec.info.observerEval = await sendT(s, 'Runtime.evaluate', { expression: '1' }, 1500); } finally { await b.disconnect().catch(() => {}); }
    rec.checks.observerStillBlocked = rec.info.observerEval.r === 'TIMEOUT';
  },
  // Point 2: popup-born dialog (liveness-inferred unknown) must still block.
  async N2({ dir, rec, run }, t) {
    await run(['nav', `${BASE}/type-two-popups?t=${t}`]);
    await run(['type', '#in', 'ab']);
    await delay(1200);
    const snap = await run(['snap'], 30000);
    rec.checks.exit3 = snap.code === 3;
    rec.checks.noCrashNote = !CRASH_NOTE.test(snap.stdout + snap.stderr);
    const dlg = await run(['dialog'], 30000);
    rec.checks.dialogListsSomething = dlg.code === 0 && !/No dialog is open/.test(dlg.stdout);
    rec.checks.dialogNoCrashNote = !CRASH_NOTE.test(dlg.stderr);
    const tabs = await run(['tabs'], 30000);
    rec.checks.tabsNoCrashedFlag = !/\[crashed\]/.test(tabs.stdout);
  },
  // Point 2: popup whose opener writes into a blank popup then alert()s from it (same renderer:
  // opener is collaterally blocked). Neither the holder nor the collateral opener may be "crashed".
  async N2b({ dir, rec, run }, t) {
    await run(['nav', `${BASE}/popup-sync-alert?n=${t}`]);
    const op = await findTarget(dir, `popup-sync-alert?n=${t}`);
    { const b = await observer(dir); try { const s = await rawSession(b, op.id); await clickAt(s); await delay(1500); } finally { await b.disconnect(); } }
    const all = await liveTargets(dir);
    rec.checks.popupOpened = all.some((x) => x.openerId === op.id);
    const snap = await run(['snap'], 30000);
    rec.checks.exit3 = snap.code === 3;
    rec.checks.noCrashNote = !CRASH_NOTE.test(snap.stdout + snap.stderr);
    const tabs = await run(['tabs'], 30000);
    rec.checks.tabsNoCrashedFlag = !/\[crashed\]/.test(tabs.stdout);
    rec.info.tabs = tabs.stdout.slice(0, 400);
  },
  // Point 2: a busy (long synchronous script) tab must never be labelled crashed.
  async N3({ dir, rec, run }, t) {
    await run(['nav', `${BASE}/?n=keep${t}`]);
    await run(['newtab', `${BASE}/?n=busy${t}`]);
    await delay(800);
    const busy = await findTarget(dir, `busy${t}`);
    await evalOn(dir, busy.id, 'setTimeout(()=>{const e=performance.now()+25000;while(performance.now()<e);},0)');
    await delay(500);
    const dlg = await run(['dialog'], 30000);
    rec.checks.dialogNoCrashNote = !CRASH_NOTE.test(dlg.stderr + dlg.stdout);
    const tabs = await run(['tabs'], 40000);
    rec.checks.tabsNoCrashed = !/\[crashed\]/.test(tabs.stdout) && !CRASH_NOTE.test(tabs.stderr);
    rec.info.tabs = `exit ${tabs.code} ${tabs.ms}ms ${tabs.cap ? 'CAP' : ''} browserLevel=${/listed at the browser level/.test(tabs.stderr)}`;
    const snap = await run(['snap'], 60000);
    rec.checks.snapNoCrashNote = !CRASH_NOTE.test(snap.stderr + snap.stdout);
    rec.info.snap = `exit ${snap.code} ${snap.ms}ms`;
    // observer: was it still busy when checked? (Runtime.evaluate must time out while busy)
    const b = await observer(dir);
    try { const s = await rawSession(b, busy.id); rec.info.busyStillBusyAtEnd = await sendT(s, 'Runtime.evaluate', { expression: '1' }, 800); } finally { await b.disconnect().catch(() => {}); }
  },
  // Point 2/3 (auditor's shape): background tab crashes, THEN is reloaded (by an outside client)
  // into a page that alert()s on load. The crash record must not hide the real dialog.
  async N4({ dir, rec, run }, t) {
    await run(['nav', `${BASE}/?n=keep${t}`]);
    await run(['newtab', `${BASE}/?n=victim${t}`]);
    await run(['newtab', `${BASE}/?n=third${t}`]);
    await delay(800);
    const victim = await findTarget(dir, `victim${t}`);
    rec.checks.crashWitnessed = await crashTarget(dir, victim.id, 'Page.crash');
    await delay(700);
    if (t % 2 === 1) { const d0 = await run(['dialog'], 30000); rec.info.dialogBetween = d0.stderr.slice(0, 120); } // let the warden LIST it as crashed first on odd trials
    await navOn(dir, victim.id, `${BASE}/alert-inline?n=re${t}`);
    const b = await observer(dir);
    try { const s = await rawSession(b, victim.id); rec.info.observerEval = await sendT(s, 'Runtime.evaluate', { expression: '1' }, 1500); } finally { await b.disconnect().catch(() => {}); }
    rec.checks.alertReallyOpen = rec.info.observerEval.r === 'TIMEOUT';
    const snap = await run(['snap'], 40000);
    rec.info.snap = `exit ${snap.code} ${snap.ms}ms cap=${snap.cap}`;
    rec.checks.exit3 = snap.code === 3;
    rec.checks.noCrashNoteForIt = !(CRASH_NOTE.test(snap.stderr) && snap.stderr.includes(victim.id));
    const dlg = await run(['dialog'], 30000);
    rec.info.dialog = (dlg.stdout + ' || ' + dlg.stderr).slice(0, 300);
    rec.checks.dialogListsAlert = /alert/.test(dlg.stdout) && !/No dialog is open/.test(dlg.stdout);
  },
  async W2(ctx, t) { return C.W1(ctx, t, 'navigate-chrome-crash'); },
  // Point 6 residual: ACTIVE tab crashed by the CLI; then the gated verb WITHOUT closetab first.
  async R1({ dir, rec, run }, t) {
    await run(['nav', `${BASE}/?n=keep${t}`]);
    await run(['newtab', `${BASE}/?n=victim${t}`]);
    await delay(1000);
    const b = await observer(dir); const crashed = [];
    b._connection.on('Target.targetCrashed', (e) => crashed.push(e.targetId));
    await b._connection.send('Target.setDiscoverTargets', { discover: true });
    await run(['nav', 'chrome://crash']);
    const tw = performance.now(); while (crashed.length === 0 && performance.now() - tw < 5000) await delay(50);
    await b.disconnect().catch(() => {});
    rec.checks.crashWitnessed = crashed.length > 0;
    await delay(1000);
    const verb = t % 2 === 0 ? ['nav', `${BASE}/?n=after${t}`] : ['snap'];
    const r = await run(verb, 45000);
    rec.info.result = `${verb[0]} exit ${r.code} ${r.ms}ms cap=${r.cap}`;
    rec.info.noteNamesClosetab = /closetab/.test(r.stderr);
    rec.info.selfHeal = /fresh session/.test(r.stderr);
    const after = await liveTargets(dir).catch(() => []);
    rec.info.targetsAfter = after.map((x) => x.url.replace(BASE, '<B>'));
  },
  // Point 6 residual: BACKGROUND tab crashed (chrome://crash), then a gated verb on the healthy active tab.
  async R2({ dir, rec, run }, t) {
    await run(['nav', `${BASE}/?n=keep${t}`]);
    await run(['newtab', `${BASE}/?n=victim${t}`]);
    await run(['newtab', `${BASE}/?n=third${t}`]);
    await delay(800);
    const victim = await findTarget(dir, `victim${t}`);
    rec.checks.crashWitnessed = await crashTarget(dir, victim.id, t % 2 === 0 ? 'navigate-chrome-crash' : 'Page.crash');
    rec.info.method = t % 2 === 0 ? 'navigate-chrome-crash' : 'Page.crash';
    await delay(500);
    const r = await run(['snap'], 45000);
    rec.info.result = `snap exit ${r.code} ${r.ms}ms cap=${r.cap}`;
    rec.info.crashNote = CRASH_NOTE.test(r.stderr);
    rec.info.selfHeal = /fresh session/.test(r.stderr);
  },
  // Point 3: CLI warden killed, then a background crash -> what does the gate / tabs do?
  async W1({ dir, rec, run }, t, method = 'Page.crash') {
    rec.info.method = method;
    await run(['nav', `${BASE}/?n=keep${t}`]);
    await run(['newtab', `${BASE}/?n=victim${t}`]);
    await run(['newtab', `${BASE}/?n=third${t}`]);
    await delay(800);
    const wardens = wardensUnder(root).filter((w) => w.stateFile.includes(path.basename(dir)));
    rec.info.killedWardens = wardens.map((w) => w.pid);
    for (const w of wardens) taskkill(w.pid);
    await delay(500);
    const victim = await findTarget(dir, `victim${t}`);
    rec.checks.crashWitnessed = await crashTarget(dir, victim.id, method);
    await delay(500);
    const snap0 = await run(['snap'], 30000);
    rec.info.snap0 = `exit ${snap0.code} ${snap0.ms}ms cap=${snap0.cap} :: ${snap0.stderr.slice(0, 300)}`;
    rec.info.snap0SaysDialog = DIALOG_BLOCK.test(snap0.stdout + snap0.stderr) || snap0.code === 3;
    const tabs = await run(['tabs'], 30000);
    rec.checks.tabsExit0 = tabs.code === 0;
    rec.info.tabsBrowserLevel = /browser level/.test(tabs.stderr);
    const ids = hexIds(tabs.stdout);
    const cl = await run(['closetab', victim.id], 30000);
    rec.checks.closetabExit0 = cl.code === 0;
    const snap = await run(['snap'], 60000);
    rec.checks.recoversSnapExit0 = snap.code === 0;
    rec.info.wardenAfter = !!(await readWarden(dir));
  },
  // Point 4: closetab id handling.
  async T1({ dir, rec, run }, t) {
    await run(['nav', `${BASE}/?n=keep${t}`]);
    await run(['newtab', `${BASE}/?n=victim${t}`]);
    await run(['newtab', `${BASE}/?n=other${t}`]);
    await delay(800);
    // healthy session: normal tabs path (no browser-level note)
    const tabsH = await run(['tabs'], 30000);
    rec.checks.healthyTabsNormalPath = tabsH.code === 0 && !/browser level/.test(tabsH.stderr) && /\*/.test(tabsH.stdout);
    const all0 = await liveTargets(dir);
    const victim = all0.find((x) => x.url.includes(`victim${t}`)), other = all0.find((x) => x.url.includes(`other${t}`)), keep = all0.find((x) => x.url.includes(`keep${t}`));
    // raw id of a healthy tab in a healthy session -> closes exactly it
    const c1 = await run(['closetab', other.id], 30000);
    const a1 = await liveTargets(dir);
    rec.checks.rawIdClosesExactlyThat = c1.code === 0 && !a1.some((x) => x.id === other.id) && a1.some((x) => x.id === victim.id) && a1.some((x) => x.id === keep.id);
    rec.checks.crashWitnessed = await crashTarget(dir, victim.id, 'Page.crash');
    await delay(500);
    // nonexistent 32-hex id
    const bogus = 'ABCDEF0123456789ABCDEF0123456789';
    const c2 = await run(['closetab', bogus], 30000);
    rec.checks.bogusIdRefused = c2.code === 1 && /no tab with id/.test(c2.stdout);
    // normal tab_ style id while something is crashed
    const c3 = await run(['closetab', 'tab_sess_1_1_1'], 30000);
    rec.checks.tabStyleIdRefusedWithHint = c3.code === 1 && /browser target ids/.test(c3.stdout);
    // lowercase form of the crashed tab's id
    const c4 = await run(['closetab', victim.id.toLowerCase()], 30000);
    const a4 = await liveTargets(dir);
    rec.info.lowercase = `exit ${c4.code} :: ${c4.stdout.trim().slice(0, 160)} :: gone=${!a4.some((x) => x.id === victim.id)}`;
    rec.checks.lowercaseNoFalseSuccess = !(c4.code === 0 && a4.some((x) => x.id === victim.id));
    rec.checks.keepNeverClosed = a4.some((x) => x.id === keep.id);
    // too-short / injection-ish ids
    const c5 = await run(['closetab', victim.id.slice(0, 31)], 30000);
    rec.checks.shortIdRefused = c5.code === 1;
    const a5 = await liveTargets(dir);
    rec.checks.keepStillThere = a5.some((x) => x.id === keep.id);
    if (a5.some((x) => x.id === victim.id)) { const c6 = await run(['closetab', victim.id], 30000); rec.info.finalClose = c6.code; }
    const snap = await run(['snap'], 60000);
    rec.checks.snapExit0 = snap.code === 0;
  },
};

try {
  for (const c of CASES) for (let t = 0; t < TRIALS; t++) await trial(c, t, (ctx) => C[c](ctx, t));
} finally {
  server.close();
  const leftovers = await cleanupRoot(root, cli, dirs);
  console.log('leftovers', JSON.stringify(leftovers));
  await fs.appendFile(OUT, JSON.stringify({ leftovers }) + '\n');
  process.exit(0);
}
