// Diagnostic (not an AC): can the runtime read PDF text from (1) the bundled index.js, (2) the unbundled capability-runtime dist?
// Env: SP, WT, BUNDLE (abs path of a module exporting SutradharRuntime). Run under the isolation preamble.
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

const norm = (p) => path.resolve(p).split(path.sep).join('/').toLowerCase().replace(/[/]+$/, '');
const { SP, WT, BUNDLE } = process.env;
if (!norm(os.tmpdir()).startsWith(norm(SP) + '/')) { console.error('ISOLATION GUARD (diag)'); process.exit(97); }
const { SutradharRuntime } = await import(pathToFileURL(BUNDLE).href);
const child = spawn(process.execPath, [`${WT}/.ai/loop/release-0.6.2/evidence/S3a/fixture-main.mjs`], { env: { ...process.env, SP, WT }, stdio: ['pipe', 'pipe', 'inherit'] });
let buf = ''; const lines = []; let wake;
child.stdout.on('data', (d) => { buf += d.toString(); let i; while ((i = buf.indexOf('\n')) >= 0) { lines.push(buf.slice(0, i)); buf = buf.slice(i + 1); wake?.(); } });
const next = () => new Promise((r) => { const t = () => (lines.length ? r(lines.shift()) : (wake = t)); t(); });
const fx = JSON.parse(await next());
const rt = new SutradharRuntime();
const res = await rt.launch({ launch: { headless: true } });
const out = { bundle: BUNDLE };
try {
  await rt.navigate(res.sessionId, `${fx.url}/long?n=10000`);
  const pdf = Buffer.from((await rt.exportPdf(res.sessionId)).base64, 'base64');
  const file = `${os.tmpdir()}/diag.pdf`; writeFileSync(file, pdf);
  child.stdin.write(`pdf ${file}\n`); await next();
  await rt.navigate(res.sessionId, `${fx.url}/pdf`);
  out.contentType = await rt.eval(res.sessionId, 'document.contentType');
  if (typeof rt.readTextWindow === 'function') {
    try { const r = await rt.readTextWindow(res.sessionId); out.result = { source: r.source, totalChars: r.totalChars, returnedChars: r.returnedChars }; }
    catch (e) { out.error = { name: e.name, message: e.message }; }
  } else {
    const s = await rt.snapshot(res.sessionId); out.oldSnapshotPageTextLength = s.pageText.length;
  }
} finally { await rt.shutdown(res.sessionId).catch(() => {}); child.stdin.write('quit\n'); }
console.log('DIAG ' + JSON.stringify(out));
