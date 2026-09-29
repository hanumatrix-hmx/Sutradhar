// FR2-04 audit-5: new attacks against escalation-1's history-based design (confirmedResponsiveSince,
// proactive probe with 500ms delay for new targets / ~0ms for bootstrap targets, confirmedSafe
// pass-through in attributeDialogHolders, DirectCdpBroker refuse-always).
//
// Unlike audit-4's attrib-attack-probe.mjs, the observer here is a RAW CDP WebSocket (no
// puppeteer.connect), so it never sets Target.setAutoAttach({waitForDebuggerOnStart:true}) and
// never pauses a new target -- the warden's attach race is measured exactly as a real CLI user
// would hit it (only the warden's own Puppeteer auto-attach is in play).
//
// Each trial: fresh CLI session (first command `nav`), then scenario steps via the raw observer,
// then settle, then record: ground-truth labels (creation order), observer liveness of every
// label, the warden's own /v1/dialogs view (type, blockedBy, confirmedSafe), `sutradhar dialog`
// (stdout+stderr notes), then follow the hint (`dialog accept` up to 4x) recording WHICH label
// each one closed, then `snap`.
//
// usage: node a5-probe.mjs <scenario[,scenario]|group:<prefix>> [trials] [tag]
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import { makeRoot, makeCli, readState, readWarden, delay, cleanupRoot, here, procs, taskkill, wardensUnder } from './lib.mjs';

const which = process.argv[2] ?? 'all';
const TRIALS = Number(process.argv[3] ?? 3);
const tag = process.argv[4] ?? which.replace(/[,:]/g, '+').slice(0, 60);

// ---------------------------------------------------------------- raw CDP client
class Cdp {
  constructor(url) { this.url = url; this.id = 0; this.pending = new Map(); this.listeners = []; }
  async open() {
    this.ws = new WebSocket(this.url);
    await new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; });
    this.ws.onmessage = (m) => {
      const msg = JSON.parse(typeof m.data === 'string' ? m.data : m.data.toString());
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id); this.pending.delete(msg.id);
        if (msg.error) p.rej(new Error(msg.error.message)); else p.res(msg.result);
      } else if (msg.method) {
        for (const l of this.listeners) l(msg);
      }
    };
  }
  send(method, params = {}, sessionId, timeoutMs = 5000) {
    const id = ++this.id;
    const payload = { id, method, params }; if (sessionId) payload.sessionId = sessionId;
    return new Promise((res, rej) => {
      const t = setTimeout(() => { this.pending.delete(id); rej(new Error(`timed out: ${method}`)); }, timeoutMs);
      this.pending.set(id, { res: (v) => { clearTimeout(t); res(v); }, rej: (e) => { clearTimeout(t); rej(e); } });
      this.ws.send(JSON.stringify(payload));
    });
  }
  on(fn) { this.listeners.push(fn); }
  close() { try { this.ws.close(); } catch {} }
}

// ---------------------------------------------------------------- fixture server
let PORT;
const handler = (q, s) => {
  const u = new URL(q.url, 'http://x');
  const n = u.searchParams.get('n') ?? '';
  const ms = Number(u.searchParams.get('ms') || 0);
  if (u.pathname === '/slow') { setTimeout(() => { s.writeHead(200, { 'content-type': 'text/plain' }); s.end('ok'); }, ms || 5000); return; }
  s.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
  if (u.pathname === '/alert-inline') return s.end(`<!doctype html><title>inline ${n}</title><script>alert('inline-${n}')</script><body>inline</body>`);
  if (u.pathname === '/alert-delay') return s.end(`<!doctype html><title>delay ${n}</title><script>setTimeout(()=>alert('delay-${ms}-${n}'),${ms})</script><body>delay</body>`);
  if (u.pathname === '/busy-alert') return s.end(`<!doctype html><title>busy ${n}</title><script>{const t=Date.now();while(Date.now()-t<${ms}){}}alert('busy-${ms}-${n}')</script><body>busy</body>`);
  if (u.pathname === '/xhr-inline') return s.end(`<!doctype html><title>xhr ${n}</title><script>{const x=new XMLHttpRequest();x.open('GET','/slow?ms=${ms || 15000}',false);x.send();}</script><body>xhr</body>`);
  if (u.pathname === '/heavy') return s.end(`<!doctype html><title>heavy ${n}</title><body><script>{const r=document.body;r.innerHTML='<div>'+'<p>y</p>'.repeat(60000)+'</div>';const t=Date.now();while(Date.now()-t<${ms || 8000}){r.style.width=(100+Math.random()*500)+'px';void r.offsetHeight;}}</script></body>`);
  if (u.pathname === '/iframe-host') return s.end(`<!doctype html><title>host ${n}</title><body>host<iframe src="${u.searchParams.get('src')}"></iframe></body>`);
  if (u.pathname === '/xhr-then-alert') return s.end(`<!doctype html><title>xta ${n}</title><script>{const x=new XMLHttpRequest();x.open('GET','/slow?ms=${ms || 3000}',false);x.send();}alert('after-xhr-${n}')</script><body>xta</body>`);
  return s.end(`<!doctype html><title>page ${n}</title><body>page ${n}</body>`);
};
const server = http.createServer(handler);
await new Promise((r) => server.listen(0, '127.0.0.1', r));
PORT = server.address().port;
// audit-6: a THIRD site on the same port (127.0.0.2 is a different site from 127.0.0.1 and localhost)
const server3 = http.createServer(handler);
await new Promise((r) => server3.listen(PORT, '127.0.0.2', r));
const BASE = `http://127.0.0.1:${PORT}`;
const XS = `http://localhost:${PORT}`; // cross-site (different site than 127.0.0.1)
const S3 = `http://127.0.0.2:${PORT}`; // a third site

const G = true;
const sync15 = `var x=new XMLHttpRequest();x.open('GET','/slow?ms=15000',false);x.send();`;
const SCEN = {};
const add = (name, def) => { SCEN[name] = def; };

// A. Premise attack: an OLDER, fresh (<500ms, never confirmed) target holds the untracked dialog,
//    triggered by the opener after a NEWER innocent sibling already exists.
for (const g of [0, 10, 30, 60, 120, 250, 600]) {
  add(`older-fresh-alerts-g${g}`, { steps: [{ on: 'O', js: `window.a=open('')`, gesture: G }, ...(g ? [{ wait: g }] : []), { on: 'O', js: `window.b=open('');a.alert('X')`, gesture: G }], H: 'P0' });
}
for (const g of [0, 30, 120, 600]) {
  add(`chain-middle-fresh-g${g}`, { steps: [{ on: 'O', js: `window.a=open('')`, gesture: G }, ...(g ? [{ wait: g }] : []), { on: 'P0', js: `window.b=open('');alert('X')`, gesture: G }], H: 'P0' });
}
for (const g of [0, 50, 200]) {
  add(`opener-alerts-fresh-g${g}`, { steps: [{ on: 'O', js: `window.a=open('')`, gesture: G }, ...(g ? [{ wait: g }] : []), { on: 'O', js: `alert('X')`, noAwait: true }], H: 'O' });
}
// B. Proactive-probe race: a real dialog around the 500ms proactive-confirm mark.
for (const t of [300, 450, 500, 550, 600, 700, 1000]) {
  add(`blank-timer-alert-${t}`, { steps: [{ on: 'O', js: `window.a=open('');setTimeout(()=>a.alert('T${t}'),${t})`, gesture: G }], H: 'P0' });
}
for (const t of [400, 500, 550, 600, 700]) {
  add(`url-delay-alert-${t}`, { steps: [{ on: 'O', js: `open(location.origin+'/alert-delay?n=p&ms=${t}')`, gesture: G }], H: 'P0' });
  add(`xsite-delay-alert-${t}`, { steps: [{ on: 'O', js: `open('${XS}/alert-delay?n=p&ms=${t}')`, gesture: G }], H: 'P0' });
}
for (const t of [400, 550, 700, 900]) {
  add(`url-busy-alert-${t}`, { steps: [{ on: 'O', js: `open(location.origin+'/busy-alert?n=p&ms=${t}')`, gesture: G }], H: 'P0' });
}
// C. Reactive path: /v1/dialogs (what every CLI gate calls) hit at the instant a popup appears.
//    listWithLiveness confirms ANY responsive+acked target immediately (no 500ms delay there).
const POLLS = [0, 5, 10, 15, 20, 30, 40, 60, 80, 120, 160, 220];
add('reactive-url-inline', { steps: [{ on: 'O', js: `open(location.origin+'/alert-inline?n=p')`, gesture: G, noAwait: true }, { pollWarden: POLLS }], H: 'P0' });
add('reactive-xsite-inline', { steps: [{ on: 'O', js: `open('${XS}/alert-inline?n=p')`, gesture: G, noAwait: true }, { pollWarden: POLLS }], H: 'P0' });
add('reactive-noopener-inline', { steps: [{ on: 'O', js: `open(location.origin+'/alert-inline?n=p','_blank','noopener')`, gesture: G, noAwait: true }, { pollWarden: POLLS }], H: 'P0' });
add('reactive-url-delay80', { steps: [{ on: 'O', js: `open(location.origin+'/alert-delay?n=p&ms=80')`, gesture: G, noAwait: true }, { pollWarden: POLLS }], H: 'P0' });
add('reactive-blank-timer40', { steps: [{ on: 'O', js: `window.a=open('');setTimeout(()=>a.alert('T40'),40)`, gesture: G, noAwait: true }, { pollWarden: POLLS }], H: 'P0' });
// D. Residual 1 (busy from creation): no dialog anywhere.
for (const g of [0, 100, 300, 450, 700]) {
  add(`xhr-popup-fresh-g${g}`, { steps: [{ on: 'O', js: `window.a=open('')`, gesture: G }, ...(g ? [{ wait: g }] : []), { on: 'O', js: sync15, noAwait: true }], H: 'NONE' });
}
add('popup-xhr-inline', { steps: [{ on: 'O', js: `open(location.origin+'/xhr-inline?n=p&ms=15000')`, gesture: G }], H: 'NONE' });
add('popup-xhr-inline-noopener', { steps: [{ on: 'O', js: `open(location.origin+'/xhr-inline?n=p&ms=15000','_blank','noopener')`, gesture: G }], H: 'NONE' });
add('popup-heavy-noopener', { steps: [{ on: 'O', js: `open(location.origin+'/heavy?n=p&ms=9000','_blank','noopener')`, gesture: G }, { wait: 300 }], H: 'NONE', settle: 600 });
add('popup-heavy-opener', { steps: [{ on: 'O', js: `open(location.origin+'/heavy?n=p&ms=9000')`, gesture: G }, { wait: 300 }], H: 'NONE', settle: 600 });
// E. Cross-site siblings: their shared opener is NOT blocked (different renderer), so no edge
//    connects them in attributeDialogHolders -- each fresh sibling is its own root/"holder".
for (const g of [100, 300]) {
  add(`xsite-siblings-newer-alerts-g${g}`, { steps: [{ on: 'O', js: `window.a=open('${XS}/?n=a')`, gesture: G }, { wait: g }, { on: 'O', js: `window.b=open('${XS}/alert-inline?n=b')`, gesture: G }], H: 'P1' });
}
add('xsite-siblings-older-alerts', { steps: [{ on: 'O', js: `window.a=open('${XS}/alert-delay?n=a&ms=150')`, gesture: G }, { wait: 30 }, { on: 'O', js: `window.b=open('${XS}/?n=b')`, gesture: G }], H: 'P0' });
// H. Warden down, trivially isolated single target (point 4b/5).
add('warden-down-isolated-alert', { steps: [{ killWarden: true }, { wait: 500 }, { on: 'O', js: `setTimeout(()=>alert('X'),10)` }], H: 'O', extraCli: [['snap'], ['tabs'], ['dialog', 'dismiss']] });
add('warden-down-isolated-xhr', { steps: [{ killWarden: true }, { wait: 500 }, { on: 'O', js: `var x=new XMLHttpRequest();x.open('GET','/slow?ms=9000',false);x.send();`, noAwait: true }], H: 'NONE' });
// I. OOPIF dialog on a confirmed-safe page.
add('oopif-alert', { steps: [{ wait: 800 }, { on: 'O', js: `document.body.insertAdjacentHTML('beforeend','<iframe src="${XS}/alert-inline?n=f"></iframe>')` }], H: 'O(frame)' });
// F. Point 3: bootstrap tab -- the session's FIRST command navigates straight to a page whose
//    dialog fires at T ms (the warden is spawned during that very command).
for (const t of [0, 150, 400, 800, 1500, 3000]) {
  add(`bootstrap-nav-timer-${t}`, { firstNav: `/alert-delay?ms=${t}`, steps: [{ wait: 200 }], H: 'O' });
}

// ================================================================ audit-6 NEW SHAPES
const xhr = (ms) => `var x=new XMLHttpRequest();x.open('GET','/slow?ms=${ms}',false);x.send();`;
// N1. newest-leaf premise vs cross-site siblings in REVERSE order: the OLDER popup holds an
//     untracked load-time alert (reactive-xsite-inline shows these are untracked), then the
//     (unblocked, other-process) opener opens NEWER innocent same-site popups that land in the
//     already-blocked renderer.
for (const g of [0, 50, 300, 1000]) {
  add(`N1-xs-older-holder-newer-innocent-g${g}`, { steps: [{ on: 'O', js: `window.a=open('${XS}/alert-inline?n=a')`, gesture: G }, ...(g ? [{ wait: g }] : []), { on: 'O', js: `window.b=open('${XS}/?n=b')`, gesture: G }], H: 'P0' });
}
add('N1-xs-older-holder-2newer-g300', { steps: [{ on: 'O', js: `window.a=open('${XS}/alert-inline?n=a')`, gesture: G }, { wait: 300 }, { on: 'O', js: `window.b=open('${XS}/?n=b')`, gesture: G }, { wait: 300 }, { on: 'O', js: `window.c=open('${XS}/?n=c')`, gesture: G }], H: 'P0' });
// N2. 4/5-level opener chains.
add('N2-chain5-blank-leaf-sync', { steps: [{ on: 'O', js: `window.a=open('')`, gesture: G }, { wait: 200 }, { on: 'P0', js: `window.b=open('')`, gesture: G }, { wait: 200 }, { on: 'P1', js: `window.c=open('')`, gesture: G }, { wait: 200 }, { on: 'P2', js: `window.d=open('');d.alert('X')`, gesture: G }], H: 'P3' });
add('N2-chain4-url-leaf-inline', { steps: [{ on: 'O', js: `open(location.origin+'/?n=a')`, gesture: G }, { wait: 500 }, { on: 'P0', js: `open(location.origin+'/?n=b')`, gesture: G }, { wait: 500 }, { on: 'P1', js: `open(location.origin+'/alert-inline?n=c')`, gesture: G }], H: 'P2' });
add('N2-chain4-xs-leaf-inline', { steps: [{ on: 'O', js: `open('${XS}/?n=a')`, gesture: G }, { wait: 500 }, { on: 'P0', js: `open('${S3}/?n=b')`, gesture: G }, { wait: 500 }, { on: 'P1', js: `open('${XS}/alert-inline?n=c')`, gesture: G }], H: 'P2' });
add('N2-chain5-blank-leaf-busy-g0', { steps: [{ on: 'O', js: `window.a=open('')`, gesture: G }, { wait: 200 }, { on: 'P0', js: `window.b=open('')`, gesture: G }, { wait: 200 }, { on: 'P1', js: `window.c=open('')`, gesture: G }, { wait: 200 }, { on: 'P2', js: `window.d=open('');${xhr(15000)}`, gesture: G, noAwait: true }], H: 'NONE' });
// N3. opener closed mid-sequence (GAP-252's anchor removed).
for (const g of [0, 10]) {
  add(`N3-type252-openerclosed-g${g}`, { steps: [{ on: 'O', js: `window.a=open('${XS}/?n=first-innocent')`, gesture: G }, ...(g ? [{ wait: g }] : []), { on: 'O', js: `window.b=open('${XS}/alert-inline?n=holder')`, gesture: G }, { wait: 1200 }, { closeTarget: 'O' }], H: 'P1' });
}
add('N3-three-xs-siblings-openerclosed', { steps: [{ on: 'O', js: `window.a=open('${XS}/?n=a')`, gesture: G }, { wait: 150 }, { on: 'O', js: `window.b=open('${XS}/?n=b')`, gesture: G }, { wait: 150 }, { on: 'O', js: `window.c=open('${XS}/alert-inline?n=c')`, gesture: G }, { wait: 1200 }, { closeTarget: 'O' }], H: 'P2' });
add('N3-three-blank-siblings-openerclosed', { steps: [{ on: 'O', js: `window.a=open('')`, gesture: G }, { wait: 150 }, { on: 'O', js: `window.b=open('')`, gesture: G }, { wait: 150 }, { on: 'O', js: `window.c=open('');c.alert('X')`, gesture: G, noAwait: true }, { wait: 1200 }, { closeTarget: 'O' }], H: 'P2' });
add('N3-xs-older-holder-newer-openerclosed', { steps: [{ on: 'O', js: `window.a=open('${XS}/alert-inline?n=a')`, gesture: G }, { wait: 300 }, { on: 'O', js: `window.b=open('${XS}/?n=b')`, gesture: G }, { wait: 1200 }, { closeTarget: 'O' }], H: 'P0' });
// N4. a real dialog on a target that was ALREADY confirmed-safe, after a (cross-process) navigation.
add('N4-confirmedO-nav-xs-inline', { steps: [{ wait: 900 }, { on: 'O', js: `setTimeout(()=>location='${XS}/alert-inline?n=o',50)` }], H: 'O' });
add('N4-confirmedO-nav-same-inline', { steps: [{ wait: 900 }, { on: 'O', js: `setTimeout(()=>location=location.origin+'/alert-inline?n=o',50)` }], H: 'O' });
add('N4-confirmedO-nav-s3-xhr-then-alert', { steps: [{ wait: 900 }, { on: 'O', js: `setTimeout(()=>location='${S3}/xhr-then-alert?n=o&ms=1500',50)` }], H: 'O' });
add('N4-popup-confirmed-nav-xs-inline', { steps: [{ on: 'O', js: `window.a=open(location.origin+'/?n=a')`, gesture: G }, { wait: 900 }, { on: 'P0', js: `setTimeout(()=>location='${XS}/alert-inline?n=p',50)` }], H: 'P0' });
add('N4-popup-confirmed-nav-s3-inline', { steps: [{ on: 'O', js: `window.a=open('${XS}/?n=a')`, gesture: G }, { wait: 900 }, { on: 'P0', js: `setTimeout(()=>location='${S3}/alert-inline?n=p',50)` }], H: 'P0' });
// N5. a crashed renderer (no dialog anywhere).
add('N5-crash-popup', { steps: [{ on: 'O', js: `window.a=open(location.origin+'/?n=a','_blank','noopener')`, gesture: G }, { wait: 900 }, { crash: 'P0' }], H: 'NONE' });
add('N5-crash-xs-popup', { steps: [{ on: 'O', js: `window.a=open('${XS}/?n=a')`, gesture: G }, { wait: 900 }, { crash: 'P0' }], H: 'NONE' });
// N6. confirmed-safe target that later hangs (sync XHR / infinite JS loop), then a real dialog on a DIFFERENT target of the same opener group.
add('N6-safe-then-xhr-then-s3-holder', { steps: [{ on: 'O', js: `window.a=open('${XS}/?n=a')`, gesture: G }, { wait: 900 }, { on: 'P0', js: xhr(20000), noAwait: true }, { wait: 300 }, { on: 'O', js: `window.b=open('${S3}/alert-inline?n=b')`, gesture: G }], H: 'P1' });
add('N6-safe-then-loop-then-s3-holder', { steps: [{ on: 'O', js: `window.a=open('${XS}/?n=a')`, gesture: G }, { wait: 900 }, { on: 'P0', js: `setTimeout(()=>{const t=Date.now();while(Date.now()-t<20000){}},0)` }, { wait: 300 }, { on: 'O', js: `window.b=open('${S3}/alert-inline?n=b')`, gesture: G }], H: 'P1' });
add('N6-safe-then-xhr-then-xs-newborn', { steps: [{ on: 'O', js: `window.a=open('${XS}/?n=a')`, gesture: G }, { wait: 900 }, { on: 'P0', js: xhr(20000), noAwait: true }, { wait: 300 }, { on: 'O', js: `window.b=open('${XS}/?n=b')`, gesture: G }], H: 'NONE' });
// N7. 3-generation multi-branch tree.
const tree = [{ on: 'O', js: `window.A=open('${XS}/?n=A')`, gesture: G }, { wait: 400 }, { on: 'O', js: `window.B=open('${S3}/?n=B')`, gesture: G }, { wait: 600 }, { on: 'P0', js: `window.A1=open(location.origin+'/?n=A1')`, gesture: G }, { wait: 400 }, { on: 'P1', js: `window.B1=open(location.origin+'/?n=B1')`, gesture: G }, { wait: 800 }];
add('N7-tree-A1-blank-holder', { steps: [...tree, { on: 'P2', js: `window.z=open('');z.alert('X')`, gesture: G, noAwait: true }], H: 'P4' });
add('N7-tree-crossbranch-holder', { steps: [...tree, { on: 'P0', js: `open('${S3}/alert-inline?n=Z')`, gesture: G }], H: 'P4' });
add('N7-tree-two-branch-holders', { steps: [...tree, { on: 'P2', js: `open(location.origin+'/alert-inline?n=Z1')`, gesture: G }, { wait: 300 }, { on: 'P3', js: `open(location.origin+'/alert-inline?n=Z2')`, gesture: G }], H: 'P4|P5' });
add('N7-tree-crossbranch-openerA-closed', { steps: [...tree, { on: 'P0', js: `open('${S3}/alert-inline?n=Z')`, gesture: G }, { wait: 1200 }, { closeTarget: 'P0' }], H: 'P4' });
// N8. the disclosed residual, measured (no dialog anywhere; any close is innocent).
for (const ms of [3000, 6000, 15000]) {
  add(`N8-popup-own-xhr-${ms}`, { steps: [{ on: 'O', js: `open(location.origin+'/xhr-inline?n=p&ms=${ms}')`, gesture: G }], H: 'NONE', settle: 600 });
  add(`N8-xs-popup-own-xhr-${ms}`, { steps: [{ on: 'O', js: `open('${XS}/xhr-inline?n=p&ms=${ms}')`, gesture: G }], H: 'NONE', settle: 600 });
}
add('N8-opener-xhr-after-open-g0', { steps: [{ on: 'O', js: `window.a=open('');${xhr(15000)}`, gesture: G, noAwait: true }], H: 'NONE' });
add('N8-opener-xhr-after-url-open-g0', { steps: [{ on: 'O', js: `window.a=open(location.origin+'/?n=a');${xhr(15000)}`, gesture: G, noAwait: true }], H: 'NONE' });

// ---------------------------------------------------------------- harness
const root = await makeRoot('a6');
const cli = makeCli(root);
const dirs = [];
const results = [];
const outFile = path.join(here, `a6-${tag}.json`);

async function wardenGet(cd) {
  const wf = await readWarden(cd);
  if (!wf) return { error: 'no warden.json' };
  try {
    const r = await fetch(`http://127.0.0.1:${wf.port}/v1/dialogs`, { headers: { authorization: `Bearer ${wf.token}` }, signal: AbortSignal.timeout(8000) });
    return (await r.json()).dialogs;
  } catch (e) { return { error: String(e).slice(0, 160) }; }
}

async function runTrial(name, trial) {
  const sc = SCEN[name];
  const n = `${name}-${trial}-${Date.now() % 100000}`;
  const cd = path.join(root.R, `s-${trial}-${name}`.slice(0, 60));
  dirs.push(cd);
  const rec = { scenario: name, trial, holderLabel: sc.H };
  let c;
  try {
    const firstUrl = sc.firstNav ? `${BASE}${sc.firstNav}${sc.firstNav.includes('?') ? '&' : '?'}n=${n}` : `${BASE}/?n=${n}`;
    const t0nav = Date.now();
    const navR = await cli(['nav', firstUrl], cd, { capMs: 60000 });
    rec.nav = { code: navR.code, ms: navR.ms, out: navR.stdout.trim().slice(0, 300), err: navR.stderr.trim().slice(0, 300) };
    const st = await readState(cd);
    c = new Cdp(st.wsEndpoint);
    await c.open();
    const created = [];
    const createdAt = new Map();
    c.on((m) => {
      if (m.method === 'Target.targetCreated' && m.params.targetInfo.type === 'page') { created.push(m.params.targetInfo.targetId); createdAt.set(m.params.targetInfo.targetId, Date.now()); }
    });
    await c.send('Target.setDiscoverTargets', { discover: true });
    await delay(150);
    const { targetInfos: initial } = await c.send('Target.getTargets');
    const O = initial.find((t) => t.type === 'page' && t.url.includes(n))?.targetId;
    const pre = new Set(initial.map((t) => t.targetId));
    const labelOf = () => new Map([[O, 'O'], ...created.filter((id) => !pre.has(id) && id !== O).map((id, i) => [id, `P${i}`])]);
    const idFor = (lab) => [...labelOf().entries()].find(([, l]) => l === lab)?.[0];
    const sessions = new Map();
    async function sessionFor(lab) {
      const id = idFor(lab);
      if (!id) throw new Error(`no target for ${lab}`);
      if (sessions.has(id)) return sessions.get(id);
      const { sessionId } = await c.send('Target.attachToTarget', { targetId: id, flatten: true });
      sessions.set(id, sessionId);
      return sessionId;
    }
    rec.stepLog = [];
    const tScen = Date.now();
    for (const step of sc.steps) {
      if (step.wait) { await delay(step.wait); continue; }
      if (step.closeTarget) {
        // audit-6: simulate the user/page closing a tab (browser-level, never touches the renderer)
        const id = idFor(step.closeTarget);
        const r = await c.send('Target.closeTarget', { targetId: id }).then(() => 'ok', (e) => String(e.message));
        rec.stepLog.push({ closeTarget: step.closeTarget, r });
        await delay(300);
        continue;
      }
      if (step.crash) {
        // audit-6: crash the target's renderer (Page.crash on a throwaway observer session; no dialog involved)
        const sid = await sessionFor(step.crash);
        c.send('Page.crash', {}, sid, 1500).catch(() => {});
        rec.stepLog.push({ crash: step.crash });
        await delay(800);
        continue;
      }
      if (step.killWarden) {
        const wf = await readWarden(cd);
        // only a warden whose base64 payload's stateFile is under OUR temp root (never by image name)
        const ours = wf?.pid && wardensUnder(root, procs()).some((w) => w.pid === wf.pid);
        if (ours) taskkill(wf.pid);
        rec.stepLog.push({ killWarden: wf?.pid, ours: !!ours });
        continue;
      }
      if (step.pollWarden) {
        const tp = Date.now();
        const polls = await Promise.all(step.pollWarden.map((off) => delay(off).then(async () => {
          const at = Date.now() - tp;
          const d = await wardenGet(cd);
          const lab = labelOf();
          return { off, at, done: Date.now() - tp, view: Array.isArray(d) ? d.map((x) => `${lab.get(x.targetId) ?? '?'}:${x.type}${x.blockedBy ? `<${lab.get(x.blockedBy) ?? '?'}` : ''}${x.confirmedSafe ? ':SAFE' : ''}`) : d, labels: [...lab.values()] };
        })));
        rec.polls = polls;
        continue;
      }
      if (step.cli) {
        const r = await cli(step.cli, cd, { capMs: 30000 });
        rec.stepLog.push({ cli: step.cli, code: r.code, out: r.stdout.trim().slice(0, 200) });
        continue;
      }
      const sid = await sessionFor(step.on);
      const p = c.send('Runtime.evaluate', { expression: step.js, userGesture: !!step.gesture }, sid, 1500).catch(() => {});
      if (!step.noAwait) await p;
    }
    rec.scenMs = Date.now() - tScen;
    await delay(sc.settle ?? 2500);
    for (const sid of sessions.values()) await c.send('Target.detachFromTarget', { sessionId: sid }).catch(() => {});
    const label = labelOf();
    const { targetInfos } = await c.send('Target.getTargets');
    rec.targets = targetInfos.filter((t) => t.type === 'page' && label.has(t.targetId)).map((t) => ({ label: label.get(t.targetId), url: t.url.replace(BASE, 'B').replace(XS, 'XS'), opener: t.openerId ? (label.get(t.openerId) ?? 'ext') : null, createdMs: createdAt.has(t.targetId) ? createdAt.get(t.targetId) - tScen : null }));
    rec.popupCount = label.size - 1;
    async function blockedMap() {
      const m = {};
      const { targetInfos: now } = await c.send('Target.getTargets');
      await Promise.all([...label].map(async ([id, l]) => {
        if (!now.some((t) => t.targetId === id)) { m[l] = 'gone'; return; }
        let sid; try { ({ sessionId: sid } = await c.send('Target.attachToTarget', { targetId: id, flatten: true })); } catch { m[l] = 'gone'; return; }
        try { await c.send('Performance.getMetrics', {}, sid, 600); m[l] = 'responsive'; } catch (e) { m[l] = /timed out/.test(String(e.message)) ? 'blocked' : 'error'; }
        c.send('Target.detachFromTarget', { sessionId: sid }).catch(() => {});
      }));
      return m;
    }
    rec.before = await blockedMap();
    const wd = await wardenGet(cd);
    rec.warden = Array.isArray(wd) ? wd.map((d) => ({ label: label.get(d.targetId) ?? d.targetId, type: d.type, blockedBy: d.blockedBy ? (label.get(d.blockedBy) ?? d.blockedBy) : undefined, safe: d.confirmedSafe || undefined })) : wd;
    const statusR = await cli(['dialog'], cd, { capMs: 30000 });
    rec.dialogStatus = { code: statusR.code, stdout: statusR.stdout.trim().slice(0, 600), stderr: statusR.stderr.trim().slice(0, 900) };
    rec.accepts = [];
    const actions = sc.actions ?? [['dialog', 'accept'], ['dialog', 'accept'], ['dialog', 'accept'], ['dialog', 'accept']];
    for (let i = 0; i < actions.length; i++) {
      const r = await cli(actions[i], cd, { capMs: 30000 });
      const closedId = /Tab (\S+?)(?:\s|\)|$)/.exec(r.stdout)?.[1];
      const isClose = /was closed/.test(r.stdout);
      const entry = { args: actions[i].join(' '), code: r.code, ms: r.ms, closed: isClose && closedId ? (label.get(closedId) ?? closedId) : null, stdout: r.stdout.trim().slice(0, 500), stderr: r.stderr.trim().slice(0, 500) };
      rec.accepts.push(entry);
      await delay(400);
      entry.after = await blockedMap();
      if (!sc.actions) {
        if (r.code !== 0) break;
        if (Object.values(entry.after).every((v) => v !== 'blocked')) break;
      }
    }
    rec.closedSequence = rec.accepts.map((a) => a.closed).filter(Boolean);
    rec.innocentClosed = rec.closedSequence.filter((l) => !sc.H.split('|').includes(l));
    const last = rec.accepts[rec.accepts.length - 1]?.after ?? rec.before;
    rec.stillBlockedAfterAccepts = Object.entries(last).filter(([, v]) => v === 'blocked').map(([k]) => k);
    rec.extra = [];
    for (const args of sc.extraCli ?? []) {
      const r = await cli(args, cd, { capMs: 30000 });
      rec.extra.push({ args: args.join(' '), code: r.code, ms: r.ms, stdout: r.stdout.trim().slice(0, 400), stderr: r.stderr.trim().slice(0, 700) });
    }
    const snap = await cli(['snap'], cd, { capMs: 45000 });
    rec.snapAfter = { code: snap.code, ms: snap.ms, killedAtCap: snap.killedAtCap, head: snap.stdout.split('\n').slice(0, 2).join(' | ').slice(0, 200), err: snap.stderr.trim().slice(0, 300) };
    rec.end = await blockedMap();
  } catch (e) {
    rec.error = String(e?.stack ?? e).slice(0, 600);
  }
  try { c?.close(); } catch {}
  results.push(rec);
  await fs.writeFile(outFile, JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
  console.log(JSON.stringify({ s: name, t: trial, H: sc.H, pop: rec.popupCount, before: rec.before, warden: rec.warden, closed: rec.closedSequence, innocent: rec.innocentClosed, still: rec.stillBlockedAfterAccepts, lastAcc: rec.accepts?.at(-1)?.code, snap: rec.snapAfter?.code, err: rec.error?.slice(0, 200) }));
  try { await cli(['close'], cd, { capMs: 20000 }); } catch {}
}

try {
  const names = which === 'all' ? Object.keys(SCEN) : which.startsWith('group:') ? Object.keys(SCEN).filter((k) => which.slice(6).split('|').some((p) => k.startsWith(p))) : which.split(',');
  const unknown = names.filter((x) => !SCEN[x]);
  if (unknown.length) throw new Error(`unknown scenarios: ${unknown.join(',')}`);
  console.log('scenarios:', names.join(','));
  for (const name of names) for (let i = 0; i < TRIALS; i++) await runTrial(name, i);
} catch (e) {
  console.log('FATAL', String(e?.stack ?? e));
} finally {
  server.close(); server3.close();
  const leftovers = await cleanupRoot(root, cli, dirs);
  await fs.writeFile(outFile, JSON.stringify({ at: new Date().toISOString(), results, leftovers }, null, 2));
  console.log('leftovers', JSON.stringify(leftovers));
  process.exit(0);
}
