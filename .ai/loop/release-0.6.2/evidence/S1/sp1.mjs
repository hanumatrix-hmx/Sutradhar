// SP-1 / SP-2 spike harness (throwaway; run under the isolation preamble, ISO S2t).
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const SP = process.env.SP, WT = process.env.WT, EV = process.env.EV;
const norm = (p) => path.resolve(p).split(path.sep).join('/').toLowerCase().replace(/[/]+$/, '');
if (!norm(os.tmpdir()).startsWith(norm(SP) + '/')) { console.error('ISOLATION GUARD (sp1)'); process.exit(97); }
const BUNDLE = process.env.BUNDLE ?? `${WT}/packages/sutradhar/dist/index.js`;
const { SutradharRuntime } = await import(pathToFileURL(BUNDLE).href);
const { start } = await import(pathToFileURL(`${EV}/fixtures/fixture-server.mjs`).href);
const BOUND = Number(process.env.BOUND_MS ?? 30000); const f = await start();
const bound = (p, ms) => Promise.race([p.then((v) => ({ kind: 'resolved', v }), (e) => ({ kind: 'rejected', msg: String(e?.message ?? e), name: e?.name })), new Promise((r) => setTimeout(() => r({ kind: 'timeout', ms }), ms))]);
const rt = new SutradharRuntime({ dialogPolicy: { mode: 'dismiss' } });
const res = await rt.launch({ launch: { headless: true } });
const sid = res.sessionId;
const out = { hasRealBrowser: res.hasRealBrowser };
const here = async () => { try { return await rt.eval(sid, 'location.href'); } catch (e) { return 'EVAL-ERR ' + e.message; } };
try {
  await rt.navigate(sid, `${f.url}/hist/a`);
  await rt.navigate(sid, `${f.url}/beforeunload`);
  await rt.click(sid, '#arm-bu');
  out.armed = await rt.eval(sid, 'window.__armed === true && typeof window.onbeforeunload');
  const dh0 = rt.getDialogHistory(sid).length;
  const t0 = Date.now();
  const r1 = await bound(rt.reload(sid), BOUND);
  out.reload = { ...r1, v: r1.v ? { url: r1.v.url, verification: r1.v.verification?.verdict ?? r1.v.verification } : undefined, ms: Date.now() - t0, urlAfter: await here(), dialogs: rt.getDialogHistory(sid).slice(dh0) };
  // re-arm (reload may have replaced the document)
  out.armedAfterReload = await rt.eval(sid, 'typeof window.onbeforeunload');
  await rt.click(sid, '#arm-bu').catch((e) => { out.rearmErr = String(e.message); });
  out.armed2 = await rt.eval(sid, 'typeof window.onbeforeunload');
  const dh1 = rt.getDialogHistory(sid).length;
  const t1 = Date.now();
  const r2 = await bound(rt.goBack(sid), BOUND);
  out.goBack = { ...r2, v: r2.v ? { url: r2.v.url, verification: r2.v.verification?.verdict ?? r2.v.verification } : undefined, ms: Date.now() - t1, urlAfter: await here(), dialogs: rt.getDialogHistory(sid).slice(dh1) };
  // validity: accept policy shows a dialog on reload of an armed page
  rt.setDialogPolicy(sid, { mode: 'accept' });
  await rt.navigate(sid, `${f.url}/beforeunload`).catch(() => {});
  await rt.click(sid, '#arm-bu').catch(() => {});
  const dh2 = rt.getDialogHistory(sid).length;
  const r3 = await bound(rt.reload(sid), BOUND);
  out.reloadAccept = { kind: r3.kind, msg: r3.msg, dialogs: rt.getDialogHistory(sid).slice(dh2) };
  rt.setDialogPolicy(sid, { mode: 'dismiss' });
  // SP-2: PDF
  const long = await rt.navigate(sid, `${f.url}/long?n=10000`);
  const pdf = await rt.exportPdf(sid);
  const buf = Buffer.from(pdf.base64, 'base64');
  out.pdfBytes = buf.length; out.pdfHead = buf.subarray(0, 8).toString();
  f.setPdf(buf);
  const pn = await bound(rt.navigate(sid, `${f.url}/pdf`), 30000);
  out.pdfNav = { kind: pn.kind, msg: pn.msg };
  out.pdfContentType = await rt.eval(sid, 'document.contentType').catch((e) => 'EVAL-ERR ' + e.message);
  out.pdfUrl = await here();
} catch (e) { out.fatal = String(e?.stack ?? e); }
finally { await rt.shutdown(sid).catch((e) => { out.shutdownErr = String(e); }); await f.close(); }
console.log(JSON.stringify(out, null, 2));
process.exitCode = 0;
