// FR2-01 audit-4: live, stochastic attempt at the K1 path (probe-a4-mock.mjs): a hidden wait on an
// element that NEVER hides, with the tab closed at a random moment. If the close lands between a
// pass's (fast) frame.$ and its (slow, layout-forcing) isHandleVisible evaluate, the evaluate
// rejects with a target/session-closed error, isHandleVisible's .catch(() => false) reports "not
// visible", and the wait can report success:true. The page keeps its layout permanently dirty on a
// large DOM so the visibility evaluate (getComputedStyle + getBoundingClientRect) is slow, which
// widens that window. Usage: node probe-a4-tabclose.mjs [trials]
import http from 'node:http'; import path from 'node:path'; import fs from 'node:fs'; import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)); const repoRoot = path.resolve(here, '../../../../../..');
const { SutradharRuntime } = await import(pathToFileURL(path.join(repoRoot, 'packages/capability-runtime/dist/index.js')));
const trials = Number(process.argv[2] ?? 40);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'text/html');
  res.end(`<div id="stays">stays</div><div id="big"></div><script>
const big=document.getElementById('big');let h='';for(let i=0;i<40000;i++)h+='<div class="c">'+i+'</div>';big.innerHTML=h;
let w=100;const tick=()=>{w=w===100?101:100;big.style.width=w+'%';requestAnimationFrame(tick)};tick();
setInterval(()=>{w=w===100?101:100;big.style.width=w+'%'},1);
</script>`);
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const rt = new SutradharRuntime();
const { sessionId: sid } = await rt.launch({ launch: { headless: true } });
const sess = rt.sessionManager.getSession(sid);
const rows = [];
let falseSuccess = 0;
for (let i = 0; i < trials; i++) {
  const t = await rt.createTab(sid, `http://127.0.0.1:${port}/?n=${Math.random()}`);
  const p = sess.getTab(t.id).page;
  await delay(600);
  if (i === 0) {
    const t0 = Date.now();
    await p.evaluate(() => { const e = document.getElementById('stays'); const s = getComputedStyle(e); const r = e.getBoundingClientRect(); return s.visibility + r.width; });
    rows.push({ calibration_visibilityEvaluateMs: Date.now() - t0 });
  }
  const closeAt = 200 + Math.floor(Math.random() * 1200);
  setTimeout(() => { p.close().catch(() => {}); }, closeAt);
  const t0 = Date.now();
  const r = await rt.waitForSelector(sid, '#stays', 5000, t.id, 'hidden');
  const row = { i, closeAt, success: r.success, retriesUsed: r.retriesUsed, output: r.output, error: r.error?.slice(0, 140), totalMs: Date.now() - t0 };
  if (r.success) falseSuccess++;
  rows.push(row);
  console.log('ROW ' + JSON.stringify(row));
}
const summary = { trials, falseSuccess };
console.log('RESULT ' + JSON.stringify(summary));
fs.writeFileSync(path.join(here, 'probe-a4-tabclose-results.json'), JSON.stringify({ summary, rows }, null, 2));
await rt.shutdown(sid).catch(() => {});
server.close();
process.exit(0);
