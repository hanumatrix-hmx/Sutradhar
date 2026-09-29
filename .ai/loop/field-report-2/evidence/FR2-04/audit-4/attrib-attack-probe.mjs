// FR2-04 audit-4: attack fix-3's attributeDialogHolders ("newest leaf in the opener chain holds the
// dialog") with shapes it was NOT built for. Each trial = fresh CLI session + warden, then an
// observer (raw CDP) runs a scenario's steps (scripts in specific tabs, with userGesture where a
// popup needs one -- Chrome allows ONE popup per activation, found in the pilot run), records
// ground truth (which target really holds the dialog, by construction; creation order from
// browser-level Target.targetCreated), asks the warden what it attributes, then follows the CLI
// hint (`dialog accept`, repeated) and records WHICH target each one closed and whether the real
// holder is still blocked afterwards.
//
// usage: node attrib-attack-probe.mjs <scenario[,scenario]|all> [trials]
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import { makeRoot, makeCli, readState, readWarden, puppeteer, delay, cleanupRoot, here, idOf, metrics, procs, taskkill } from './lib.mjs';

const which = process.argv[2] ?? 'all';
const TRIALS = Number(process.argv[3] ?? 3);

// step kinds: {on, js, gesture?, noAwait?} | {wait} | {killWarden} | {closeTarget: label} | {cli: args}
const SCEN = {
  // control: the exact shape fix-3 was built for
  'single-sync': { steps: [{ on: 'O', js: `open('').alert('X')`, gesture: true }], H: 'P0' },
  // older sibling exists (tracked, no dialog); the NEWER one alerts synchronously on creation
  'older-sibling-newer-alerts': { steps: [{ on: 'O', js: `window.a=open('')`, gesture: true }, { wait: 1500 }, { on: 'O', js: `open('').alert('X')`, gesture: true }], H: 'P1' },
  // older sibling (tracked) alerts in the same task that creates a newer blank sibling
  'older-sibling-alerts-tracked': { steps: [{ on: 'O', js: `window.a=open('')`, gesture: true }, { wait: 1500 }, { on: 'O', js: `window.b=open('');a.alert('X')`, gesture: true }], H: 'P0' },
  // 3-target opener chain O -> A -> B; B (opened by A) alerts synchronously
  'chain-leaf-sync': { steps: [{ on: 'O', js: `window.a=open('')`, gesture: true }, { wait: 1500 }, { on: 'P0', js: `open('').alert('X')`, gesture: true }], H: 'P1' },
  // 3-target chain; the MIDDLE one (A, tracked) alerts after opening B in the same task
  'chain-middle-alerts': { steps: [{ on: 'O', js: `window.a=open('')`, gesture: true }, { wait: 1500 }, { on: 'P0', js: `window.b=open('');alert('X')`, gesture: true }], H: 'P0' },
  // the ORIGINAL tab alerts (tracked) while it has a same-renderer popup
  'opener-alerts-with-popup': { steps: [{ on: 'O', js: `window.a=open('')`, gesture: true }, { wait: 1500 }, { on: 'O', js: `setTimeout(()=>alert('X'),10)` }], H: 'O' },
  // rapid fire: two popups ~0ms apart (separate activations, not awaited); the second alerts sync
  'rapid2-newer-alerts': { steps: [{ on: 'O', js: `window.a=open('')`, gesture: true, noAwait: true }, { on: 'O', js: `open('').alert('X')`, gesture: true, noAwait: true }], H: 'P1' },
  // rapid fire x4: three quick popups, the 4th alerts
  'rapid4-last-alerts': { steps: [{ on: 'O', js: `open('')`, gesture: true, noAwait: true }, { on: 'O', js: `open('')`, gesture: true, noAwait: true }, { on: 'O', js: `open('')`, gesture: true, noAwait: true }, { on: 'O', js: `open('').alert('X')`, gesture: true, noAwait: true }], H: 'P3' },
  // rapid fire with small real gaps (0ms gaps collapse to one popup: Chrome's popup blocker)
  'rapid-gap30': { steps: [{ on: 'O', js: `window.a=open('')`, gesture: true }, { wait: 30 }, { on: 'O', js: `open('').alert('X')`, gesture: true }], H: 'P1' },
  'rapid-gap100': { steps: [{ on: 'O', js: `window.a=open('')`, gesture: true }, { wait: 100 }, { on: 'O', js: `open('').alert('X')`, gesture: true }], H: 'P1' },
  'rapid-gap0-awaited': { steps: [{ on: 'O', js: `window.a=open('')`, gesture: true }, { on: 'O', js: `open('').alert('X')`, gesture: true }], H: 'P1' },
  // opener chain broken: popup alerts synchronously, then the opener is closed (browser-level)
  'orphan': { steps: [{ on: 'O', js: `open('').alert('X')`, gesture: true }, { wait: 1500 }, { closeTarget: 'O' }], H: 'P0' },
  // warden down (killed by PID, ours) then the original tab alerts with a same-renderer popup open
  'warden-down-opener-alerts': { steps: [{ on: 'O', js: `window.a=open('')`, gesture: true }, { wait: 1500 }, { killWarden: true }, { wait: 500 }, { on: 'O', js: `setTimeout(()=>alert('X'),10)` }], H: 'O' },
  // warden down, older sibling exists, newest alerts synchronously (DirectCdpBroker has no discoveredAt)
  'warden-down-newer-sibling-alerts': { steps: [{ on: 'O', js: `window.a=open('')`, gesture: true }, { wait: 1500 }, { killWarden: true }, { wait: 500 }, { on: 'O', js: `open('').alert('X')`, gesture: true }], H: 'P1' },
  // warden down, the OLDER sibling (untracked now) alerts after a newer innocent sibling exists
  'warden-down-older-sibling-alerts': { steps: [{ on: 'O', js: `window.a=open('')`, gesture: true }, { wait: 800 }, { on: 'O', js: `window.b=open('')`, gesture: true }, { wait: 800 }, { killWarden: true }, { wait: 500 }, { on: 'O', js: `setTimeout(()=>a.alert('X'),10)` }], H: 'P0' },
  // warden down, chain O -> A -> B; the MIDDLE (A) alerts
  'warden-down-chain-middle-alerts': { steps: [{ on: 'O', js: `window.a=open('')`, gesture: true }, { wait: 800 }, { on: 'P0', js: `window.b=open('')`, gesture: true }, { wait: 800 }, { killWarden: true }, { wait: 500 }, { on: 'P0', js: `setTimeout(()=>alert('X'),10)` }], H: 'P0' },
  // noopener popups whose page alerts inline during parse: same-origin and cross-site (localhost)
  'noopener-same-origin': { steps: [{ on: 'O', js: `open(location.origin+'/alert-inline?n=a','_blank','noopener')`, gesture: true }], H: 'P0' },
  'noopener-cross-site': { steps: [{ on: 'O', js: `open(location.origin.replace('127.0.0.1','localhost')+'/alert-inline?n=a','_blank','noopener')`, gesture: true }], H: 'P0' },
  'opener-cross-site': { steps: [{ on: 'O', js: `open(location.origin.replace('127.0.0.1','localhost')+'/alert-inline?n=a')`, gesture: true }], H: 'P0' },
  'opener-same-origin-url': { steps: [{ on: 'O', js: `open(location.origin+'/alert-inline?n=a')`, gesture: true }], H: 'P0' },
  // second CLI tab on the same site (newtab); its blank popup alerts synchronously
  'two-tabs-same-site': { steps: [{ cli: ['newtab', '__BASE__/?n=second'] }, { wait: 800 }, { on: 'P0', js: `open('').alert('X')`, gesture: true }], H: 'P1' },
  // GAP-240 with a sibling: a same-renderer popup exists, the opener runs a 15s sync XHR (no dialog anywhere)
  'xhr-popup-manual': { steps: [{ on: 'O', js: `window.a=open('')`, gesture: true }, { wait: 1200 }, { on: 'O', js: `var x=new XMLHttpRequest();x.open('GET','/slow?ms=15000',false);x.send();`, noAwait: true }], H: 'NONE' },
  'xhr-popup-policy': { steps: [{ on: 'O', js: `window.a=open('')`, gesture: true }, { wait: 1200 }, { on: 'O', js: `var x=new XMLHttpRequest();x.open('GET','/slow?ms=15000',false);x.send();`, noAwait: true }], H: 'NONE', actions: [['snap', '--dialog', 'accept'], ['snap', '--dialog', 'dismiss']] },
  'xhr-isolated-manual': { steps: [{ on: 'O', js: `var x=new XMLHttpRequest();x.open('GET','/slow?ms=15000',false);x.send();`, noAwait: true }], H: 'NONE' },
  'xhr-isolated-policy': { steps: [{ on: 'O', js: `var x=new XMLHttpRequest();x.open('GET','/slow?ms=15000',false);x.send();`, noAwait: true }], H: 'NONE', actions: [['snap', '--dialog', 'accept'], ['snap', '--dialog', 'dismiss']] },
  // GAP-240 with a sibling, heavy native layout work instead of sync XHR (no dialog anywhere)
  'layout-popup-manual': { steps: [{ on: 'O', js: `window.a=open('')`, gesture: true }, { wait: 1200 }, { on: 'O', js: `setTimeout(()=>{const r=document.body;r.innerHTML='<div>'+'<p>y</p>'.repeat(60000)+'</div>';const t=Date.now();while(Date.now()-t<12000){r.style.width=(100+Math.random()*500)+'px';void r.offsetHeight;}},0)` }, { wait: 300 }], H: 'NONE' },
};

const server = http.createServer((q, s) => {
  const u = new URL(q.url, 'http://x');
  if (u.pathname === '/slow') { setTimeout(() => { s.writeHead(200, { 'content-type': 'text/plain' }); s.end('ok'); }, Number(u.searchParams.get('ms') || 5000)); return; }
  s.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
  if (u.pathname === '/alert-inline') { s.end(`<!doctype html><title>inline</title><script>alert('inline-${u.searchParams.get('n')}')</script><body>inline</body>`); return; }
  s.end(`<!doctype html><title>opener ${u.searchParams.get('n')}</title><body>opener ${u.searchParams.get('n')}</body>`);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const root = await makeRoot('attrib');
const cli = makeCli(root);
const dirs = [];
const results = [];
const tag = process.argv[4] ?? which.replace(/,/g, '+');
const outFile = path.join(here, `attrib-attack-${tag}.json`);

async function wardenDialogs(cd) {
  const wf = await readWarden(cd);
  if (!wf) return { error: 'no warden.json' };
  try {
    const r = await fetch(`http://127.0.0.1:${wf.port}/v1/dialogs`, { headers: { authorization: `Bearer ${wf.token}` }, signal: AbortSignal.timeout(8000) });
    return (await r.json()).dialogs;
  } catch (e) { return { error: String(e).slice(0, 200) }; }
}

async function runTrial(name, trial) {
  const sc = SCEN[name];
  const holderLabel = sc.H;
  const n = `${name}-${trial}-${Date.now() % 100000}`;
  const cd = path.join(root.R, `s-${name}-${trial}`);
  dirs.push(cd);
  const rec = { scenario: name, trial, holderLabel };
  let b;
  try {
    const navR = await cli(['nav', `${BASE}/?n=${n}`], cd);
    rec.nav = { code: navR.code, ms: navR.ms };
    const st = await readState(cd);
    b = await puppeteer.connect({ browserWSEndpoint: st.wsEndpoint, defaultViewport: null });
    const bs = await b.target().createCDPSession();
    const created = [];
    bs.on('Target.targetCreated', (e) => { if (e.targetInfo.type === 'page') created.push(e.targetInfo.targetId); });
    await bs.send('Target.setDiscoverTargets', { discover: true });
    await delay(300);
    const pre = new Set(created.splice(0));
    const O = idOf(b.targets().find((x) => x.type() === 'page' && x.url().includes(n)));
    const labelOf = () => new Map([[O, 'O'], ...created.filter((id) => !pre.has(id) && id !== O).map((id, i) => [id, `P${i}`])]);
    const idFor = (lab) => [...labelOf().entries()].find(([, l]) => l === lab)?.[0];
    const sessions = new Map();
    async function sessionFor(lab) {
      const id = idFor(lab);
      if (sessions.has(id)) return sessions.get(id);
      const t = b.targets().find((x) => idOf(x) === id);
      const s = await t.createCDPSession();
      sessions.set(id, s);
      return s;
    }
    rec.stepLog = [];
    for (const step of sc.steps) {
      if (step.wait) { await delay(step.wait); continue; }
      if (step.killWarden) {
        const wf = await readWarden(cd);
        const list = procs();
        const p = list.find((x) => x.ProcessId === wf?.pid);
        const ours = p && /__dialog-warden/.test(p.CommandLine || '');
        if (ours) taskkill(wf.pid);
        rec.stepLog.push({ killWarden: wf?.pid, ours: !!ours });
        continue;
      }
      if (step.cli) {
        const r = await cli(step.cli.map((a) => a.replace('__BASE__', BASE)), cd, { capMs: 30000 });
        rec.stepLog.push({ cli: step.cli, code: r.code, out: r.stdout.trim().slice(0, 200) });
        continue;
      }
      if (step.closeTarget) {
        const id = idFor(step.closeTarget);
        const r = await bs.send('Target.closeTarget', { targetId: id }, { timeout: 5000 }).catch((e) => ({ error: String(e) }));
        rec.stepLog.push({ closeTarget: step.closeTarget, r });
        continue;
      }
      const s = await sessionFor(step.on);
      const p = s.send('Runtime.evaluate', { expression: step.js, userGesture: !!step.gesture }, { timeout: 1500 }).catch(() => {});
      if (!step.noAwait) await p;
    }
    await delay(2500);
    for (const s of sessions.values()) await s.detach().catch(() => {});
    const label = labelOf();
    const { targetInfos } = await bs.send('Target.getTargets');
    rec.targets = targetInfos.filter((t) => t.type === 'page' && label.has(t.targetId)).map((t) => ({ label: label.get(t.targetId), url: t.url, opener: t.openerId ? (label.get(t.openerId) ?? t.openerId) : null }));
    rec.popupCount = label.size - 1;
    async function blockedMap() {
      const m = {};
      for (const [id, l] of label) {
        const t = b.targets().find((x) => idOf(x) === id);
        if (!t) { m[l] = 'gone'; continue; }
        let s; try { s = await t.createCDPSession(); } catch { m[l] = 'gone'; continue; }
        m[l] = (await metrics(s, 600)).state;
        await s.detach().catch(() => {});
      }
      return m;
    }
    rec.before = await blockedMap();
    const wd = await wardenDialogs(cd);
    rec.warden = Array.isArray(wd) ? wd.map((d) => ({ label: label.get(d.targetId) ?? d.targetId, type: d.type, blockedBy: d.blockedBy ? (label.get(d.blockedBy) ?? d.blockedBy) : undefined })) : wd;
    const statusR = await cli(['dialog'], cd, { capMs: 30000 });
    rec.dialogStatus = { code: statusR.code, stdout: statusR.stdout.trim().slice(0, 800) };
    // follow the hint: `dialog accept`, up to 4 times, recording what each one closed
    rec.accepts = [];
    const actions = sc.actions ?? [['dialog', 'accept'], ['dialog', 'accept'], ['dialog', 'accept'], ['dialog', 'accept']];
    for (let i = 0; i < actions.length; i++) {
      const r = await cli(actions[i], cd, { capMs: 30000 });
      const closedId = /Tab (\S+?)(?:\s|\)|$)/.exec(r.stdout)?.[1];
      const isClose = /was closed/.test(r.stdout);
      const entry = { args: actions[i].join(' '), code: r.code, ms: r.ms, closed: isClose && closedId ? (label.get(closedId) ?? closedId) : null, stdout: r.stdout.trim().slice(0, 500), stderr: r.stderr.trim().slice(0, 300) };
      rec.accepts.push(entry);
      await delay(400);
      entry.after = await blockedMap();
      if (!sc.actions) {
        if (r.code !== 0) break;
        if (Object.values(entry.after).every((v) => v !== 'blocked')) break;
      }
    }
    const closedLabels = rec.accepts.map((a) => a.closed).filter(Boolean);
    rec.closedSequence = closedLabels;
    rec.innocentClosed = closedLabels.filter((l) => l !== holderLabel);
    rec.openerClosed = closedLabels.includes('O');
    const last = rec.accepts[rec.accepts.length - 1]?.after ?? {};
    rec.stillBlockedAfterAccepts = Object.entries(last).filter(([, v]) => v === 'blocked').map(([k]) => k);
    const snap = await cli(['snap'], cd, { capMs: 45000 });
    rec.snapAfter = { code: snap.code, ms: snap.ms, killedAtCap: snap.killedAtCap, head: snap.stdout.split('\n').slice(0, 2).join(' | ').slice(0, 200), err: snap.stderr.trim().slice(0, 300) };
    rec.end = await blockedMap();
    await bs.detach().catch(() => {});
  } catch (e) {
    rec.error = String(e?.stack ?? e).slice(0, 600);
  }
  try { await b?.disconnect(); } catch {}
  results.push(rec);
  await fs.writeFile(outFile, JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
  console.log(JSON.stringify({ scenario: name, trial, holder: holderLabel, popups: rec.popupCount, warden: rec.warden, closed: rec.closedSequence, innocentClosed: rec.innocentClosed, stillBlocked: rec.stillBlockedAfterAccepts, lastAccept: rec.accepts?.at(-1)?.code, snap: rec.snapAfter?.code, err: rec.error }));
  try { await cli(['close'], cd, { capMs: 20000 }); } catch {}
}

try {
  const names = which === 'all' ? Object.keys(SCEN) : which.split(',');
  for (const name of names) for (let i = 0; i < TRIALS; i++) await runTrial(name, i);
} finally {
  server.close();
  const leftovers = await cleanupRoot(root, cli, dirs);
  await fs.writeFile(outFile, JSON.stringify({ at: new Date().toISOString(), results, leftovers }, null, 2));
  console.log('leftovers', JSON.stringify(leftovers));
  process.exit(0);
}
