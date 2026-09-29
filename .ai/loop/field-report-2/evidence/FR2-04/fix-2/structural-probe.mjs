// FR2-04 audit-2, question 2(b): was decision 1(a)'s structural layer ("see a new target before
// any of its script runs") actually achievable? fix-1 did NOT build it (dialog-warden.ts reuses
// Puppeteer's session, which Puppeteer releases with Runtime.runIfWaitingForDebugger in the same
// turn it attaches). This probe builds the real thing on a RAW CDP connection: browser-level
// Target.setAutoAttach{waitForDebuggerOnStart:true, flatten:true}; on each attachedToTarget it
// awaits Page.enable and only THEN sends Runtime.runIfWaitingForDebugger. It runs alongside the
// real product warden, and for each popup variant records (a) whether the raw client saw
// Page.javascriptDialogOpening, (b) what the product warden's /v1/dialogs reported
// (event type vs 'unknown' vs nothing), (c) what the next `snap` did.
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import { makeRoot, makeCli, readState, readWarden, puppeteer, delay, cleanupRoot, here, idOf, pageTargets, waitBlocked } from './lib.mjs';

const TRIALS = Number(process.argv[2] ?? 3);
const root = await makeRoot('struct');
const cli = makeCli(root);
const POP = (kind, dlg) => {
  const call = dlg === 'prompt' ? "prompt('S-'+N,'dv')" : `${dlg}('S-'+N)`;
  const body = kind === 'inline' ? call + ';' : kind === 'onload' ? `onload=function(){${call}};` : `setTimeout(function(){${call}},${kind.slice(1)});`;
  return `<!doctype html><title>pop</title><script>var N=new URLSearchParams(location.search).get('n');${body}</script><body>pop</body>`;
};
const OPENER = `<!doctype html><title>opener</title><body>opener <a id="blank" target="_blank">l</a></body>`;
const server = http.createServer((q, s) => {
  const u = new URL(q.url, 'http://x');
  s.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
  s.end(u.pathname === '/pop' ? POP(u.searchParams.get('kind'), u.searchParams.get('dlg')) : OPENER);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

class Raw {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.events = []; this.attached = new Map(); }
  static async open(url) {
    const ws = new WebSocket(url); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
    const c = new Raw(ws);
    ws.onmessage = (m) => c.onMsg(JSON.parse(m.data));
    return c;
  }
  send(method, params = {}, sessionId, timeoutMs = 3000) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((res, rej) => {
      const t = setTimeout(() => { this.pending.delete(id); rej(new Error('timeout ' + method)); }, timeoutMs);
      this.pending.set(id, { res: (v) => { clearTimeout(t); res(v); }, rej: (e) => { clearTimeout(t); rej(e); } });
    });
  }
  onMsg(m) {
    if (m.id && this.pending.has(m.id)) { const p = this.pending.get(m.id); this.pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); return; }
    if (m.method === 'Target.attachedToTarget') {
      const { sessionId, targetInfo, waitingForDebugger } = m.params;
      this.attached.set(sessionId, { targetId: targetInfo.targetId, type: targetInfo.type, waitingForDebugger, url: targetInfo.url });
      if (targetInfo.type !== 'page') { this.send('Runtime.runIfWaitingForDebugger', {}, sessionId).catch(() => {}); return; }
      const rec = this.attached.get(sessionId);
      const t0 = Date.now();
      // Page.enable FIRST, awaited (bounded), THEN release. Never leave a target paused.
      this.send('Page.enable', {}, sessionId, 2000).then(() => { rec.enableMs = Date.now() - t0; }, (e) => { rec.enableErr = e.message; })
        .finally(() => this.send('Runtime.runIfWaitingForDebugger', {}, sessionId).catch(() => {}));
      return;
    }
    if (m.method === 'Page.javascriptDialogOpening') {
      const a = this.attached.get(m.sessionId);
      this.events.push({ targetId: a?.targetId, type: m.params.type, message: m.params.message, at: Date.now() });
    }
  }
}

const VARIANTS = [];
for (const opener of ['open', 'open-noopener', 'link-blank']) for (const kind of ['inline', 'onload', 't0', 't50']) VARIANTS.push({ opener, kind, dlg: 'alert' });
VARIANTS.push({ opener: 'open', kind: 'inline', dlg: 'confirm' }, { opener: 'open', kind: 'inline', dlg: 'prompt' });
VARIANTS.push({ opener: 'blank-sync', kind: 'sync', dlg: 'alert' }, { opener: 'blank-write', kind: 'inline', dlg: 'alert' });

function triggerExpr(v, n) {
  const url = `${BASE}/pop?kind=${v.kind}&dlg=${v.dlg}&n=${n}`;
  switch (v.opener) {
    case 'open': return `void window.open(${JSON.stringify(url)})`;
    case 'open-noopener': return `void window.open(${JSON.stringify(url)},'_blank','noopener')`;
    case 'link-blank': return `(function(){var a=document.getElementById('blank');a.href=${JSON.stringify(url)};a.click();})()`;
    case 'blank-sync': return `(function(){var w=window.open('');w.alert('S-${n}');})()`;
    case 'blank-write': return `(function(){var w=window.open('');w.document.write('<script>alert("S-${n}")<\\/script>');})()`;
  }
}

const dirs = []; const rows = [];
try {
  const d = path.join(root.R, 'state-struct'); dirs.push(d);
  for (let trial = 0; trial < TRIALS; trial++) {
    for (const v of VARIANTS) {
      // fresh session per case so a missed dialog can't poison the next one
      const cd = path.join(root.R, `st-${trial}-${v.opener}-${v.kind}-${v.dlg}`); dirs.push(cd);
      const n = `${trial}${v.opener}${v.kind}${v.dlg}`.replace(/[^a-z0-9]/gi, '') + Date.now() % 100000;
      const nav = await cli(['nav', `${BASE}/?opener=${n}`], cd);
      if (nav.code !== 0) { rows.push({ ...v, trial, error: 'nav ' + nav.stderr.slice(0, 200) }); continue; }
      const st = await readState(cd); const wf = await readWarden(cd);
      const raw = await Raw.open(st.wsEndpoint);
      await raw.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true, filter: [{ type: 'page', exclude: false }] });
      await delay(300);
      const b = await puppeteer.connect({ browserWSEndpoint: st.wsEndpoint, defaultViewport: null });
      const before = new Set(pageTargets(b).map(idOf));
      const opener = pageTargets(b).find((t) => t.url().includes('opener='));
      const os_ = await opener.createCDPSession();
      await os_.send('Runtime.evaluate', { expression: triggerExpr(v, n), userGesture: true }, { timeout: 3000 }).catch((e) => ({}));
      await os_.detach().catch(() => {});
      let pop; for (let i = 0; i < 60 && !pop; i++) { pop = pageTargets(b).find((t) => !before.has(idOf(t))); if (!pop) await delay(100); }
      const ps = pop ? await pop.createCDPSession() : undefined;
      const blocked = ps ? await waitBlocked(ps, 5000) : false;
      await ps?.detach().catch(() => {});
      await delay(600);
      const popId = pop ? idOf(pop) : undefined;
      const rawSaw = raw.events.filter((e) => e.targetId === popId).map((e) => e.type);
      const rawAttach = [...raw.attached.values()].find((a) => a.targetId === popId);
      let wardenView;
      try { const r = await fetch(`http://127.0.0.1:${wf.port}/v1/dialogs`, { headers: { authorization: `Bearer ${wf.token}` }, signal: AbortSignal.timeout(5000) }); const j = await r.json(); wardenView = j.dialogs.filter((x) => x.targetId === popId).map((x) => x.type); } catch (e) { wardenView = 'ERR ' + e.message; }
      raw.ws.close();
      const snap = await cli(['snap'], cd, { capMs: 30000 });
      const row = { trial, ...v, popFound: !!pop, popUrl: pop?.url(), popBlocked: blocked, rawSaw, rawAttach, wardenView, snap: { code: snap.code, ms: snap.ms, killedAtCap: snap.killedAtCap, pending: (snap.stdout.match(/dialogPending: .*/g) || []).slice(0, 2), blankTab: /about:blank/.test(snap.stdout) } };
      rows.push(row);
      console.log(JSON.stringify({ t: trial, v: `${v.opener}/${v.kind}/${v.dlg}`, blocked, rawSaw, rawEnableMs: rawAttach?.enableMs, rawEnableErr: rawAttach?.enableErr, warden: wardenView, snap: `${snap.code}${snap.killedAtCap ? '(CAP-KILLED)' : ''}/${snap.ms}ms`, pending: row.snap.pending[0]?.slice(0, 80) }));
      await b.disconnect().catch(() => {});
      await cli(['close'], cd, { capMs: 30000 });
    }
  }
} catch (e) { console.error(e); rows.push({ error: String(e?.stack || e) }); }
finally {
  server.close();
  const leftovers = await cleanupRoot(root, cli, dirs);
  await fs.writeFile(path.join(here, 'structural-probe.json'), JSON.stringify({ at: new Date().toISOString(), rows, leftovers }, null, 2));
  console.log('leftovers', JSON.stringify(leftovers));
  process.exit(0);
}
