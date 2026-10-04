// S11 item 8b: a real headless SDK page.waitFor run from the BUILT bundle (packages/sutradhar/dist/index.js).
// Run under the ISOLATION PREAMBLE (Git Bash form). Env in: SP (scratchpad root), WT (worktree root).
//   - asserts os.tmpdir() is under SP (exit 97 otherwise);
//   - imports { launch, ActionFailedError } from file:///<WT>/packages/sutradhar/dist/index.js (never from src);
//   - serves a page from its own 127.0.0.1 server. The page adds the text READY-0.6.1 ~500 ms AFTER the harness has started
//     page.waitFor(): the server only reports "armed" 500 ms (setTimeout in this process) after the harness called waitFor, and the page
//     polls /armed every 50 ms. (First version of this harness had the page add the text 500 ms after load; the SDK's goto itself
//     takes ~600 ms, so waitFor returned instantly and the check passed vacuously. The negative control below catches that.)
//   - page.waitFor({text:'READY-0.6.1', timeout:5000}) must resolve, and must take >= 400 ms measured with performance.now() around
//     the call, and its own result must say satisfiedAfterMs >= 400 (it cannot be satisfied before the server arms the page);
//   - page.waitFor({text:'NEVER-THERE', timeout:1000}) must throw ActionFailedError (after >= 900 ms, generous upper bound 8 s);
//   - browser.close(); an attribution query over the ISO basename must find Chrome processes while the browser is open (positive
//     control) and none after close. Watchdog 60 s (closes the browser, then exits 3).
//   - Negative control only: S11_PRE_ARM=1 arms the page BEFORE waitFor is called (the text is already there), so waitFor returns at
//     once and the ">= 400 ms" checks must FAIL.
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

const norm = (p) => path.resolve(p).split(path.sep).join('/').toLowerCase().replace(/[/]+$/, '');
const SP = process.env.SP, WT = process.env.WT;
if (!SP || !WT) { console.error('needs SP and WT env'); process.exit(2); }
const tmp = norm(os.tmpdir());
if (!tmp.startsWith(norm(SP) + '/')) { console.error(`ISOLATION GUARD (harness): os.tmpdir()=${tmp} not under ${norm(SP)}`); process.exit(97); }
console.log(`[harness-guard] tmpdir=${tmp} pid=${process.pid}`);

const results = []; let bad = 0;
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === '' ? '' : ' :: ' + detail}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const entry = path.join(WT, 'packages', 'sutradhar', 'dist', 'index.js');
console.log(`[harness] importing ${entry}`);
const mod = await import(pathToFileURL(entry).href);
const { launch, ActionFailedError, SUTRADHAR_VERSION } = mod;
check('built bundle exports launch + ActionFailedError', typeof launch === 'function' && typeof ActionFailedError === 'function');
check('SUTRADHAR_VERSION from the built bundle is 0.6.1', SUTRADHAR_VERSION === '0.6.1', String(SUTRADHAR_VERSION));

const PRE_ARM = process.env.S11_PRE_ARM === '1';
let armed = PRE_ARM; let armedAt = null; let served = false;
const PAGE = '<html><head><title>waitfor-s11</title></head><body><p id="s">loading</p><script>' +
  'var t=setInterval(function(){fetch("/armed").then(function(r){return r.text()}).then(function(v){if(v==="1"&&!document.getElementById("r")){' +
  'var p=document.createElement("p");p.id="r";p.textContent="READY-0.6.1";document.body.appendChild(p);clearInterval(t);}}).catch(function(){})},50);</script></body></html>';
const server = http.createServer((req, res) => {
  if (req.url === '/ready') { served = true; res.setHeader('content-type', 'text/html'); res.end(PAGE); }
  else if (req.url === '/armed') { res.setHeader('content-type', 'text/plain'); res.setHeader('cache-control', 'no-store'); res.end(armed ? '1' : '0'); }
  else { res.statusCode = 404; res.end('nope'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/ready`;

let browser = null;
const finish = async (code) => { try { await browser?.close(); } catch { /* ignore */ } try { server.close(); } catch { /* ignore */ } process.exit(code); };
const watchdog = setTimeout(() => { console.error('WATCHDOG 60 s'); void finish(3); }, 60_000);

const attribution = () => {
  const r = spawnSync('powershell', ['-NoProfile', '-Command', "Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'chrome|msedge' -and $_.CommandLine -like ('*' + $env:PROBE_BASE + '*') } | Select-Object ProcessId,Name | ConvertTo-Json -Compress"], { env: { ...process.env, PROBE_BASE: path.basename(os.tmpdir()) }, encoding: 'utf-8', timeout: 30_000 });
  const out = (r.stdout ?? '').trim();
  if (r.status !== 0) return { error: `query failed status=${r.status} ${(r.stderr ?? '').slice(0, 200)}`, n: -1 };
  if (out === '') return { n: 0, out };
  const j = JSON.parse(out);
  return { n: Array.isArray(j) ? j.length : 1, out };
};

try {
  browser = await launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(url);
  check('server served the page', served);

  const open = attribution();
  check('positive control: attribution query finds our Chrome while the browser is open', open.n >= 1, JSON.stringify(open).slice(0, 160));

  // Let the page's 50 ms poll run once while NOT armed (in the normal run the text must not be there yet).
  await sleep(300);
  const t0 = performance.now();
  const waiting = page.waitFor({ text: 'READY-0.6.1', timeout: 5000 });
  waiting.catch(() => {}); // avoid an unhandled rejection if it fails before we await it
  if (!PRE_ARM) { await sleep(500); armed = true; armedAt = performance.now(); }
  let r;
  try { r = await waiting; } catch (e) { check('waitFor(READY-0.6.1) resolved', false, String(e?.message ?? e)); }
  const t1 = performance.now();
  if (r) {
    check('waitFor(READY-0.6.1) resolved with success', r.success === true, JSON.stringify({ success: r.success }));
    check('the call took >= 400 ms (performance.now() around the call)', t1 - t0 >= 400, `inWaitFor=${(t1 - t0).toFixed(1)}ms`);
    const sat = r.output?.satisfiedAfterMs;
    check('the result itself says satisfiedAfterMs >= 400', typeof sat === 'number' && sat >= 400, `satisfiedAfterMs=${sat} polls=${r.output?.polls}`);
    if (armedAt !== null) check('it resolved only after the page was armed (t1 >= armedAt)', t1 >= armedAt, `afterArm=${(t1 - armedAt).toFixed(1)}ms`);
    console.log('[harness] waitFor output:', JSON.stringify(r.output ?? null).slice(0, 400));
  }

  const n0 = performance.now(); let threw = null;
  try { await page.waitFor({ text: 'NEVER-THERE', timeout: 1000 }); } catch (e) { threw = e; }
  const dn = performance.now() - n0;
  check('waitFor(NEVER-THERE, 1000) throws ActionFailedError', threw instanceof ActionFailedError, threw ? `${threw.name}: ${String(threw.message).slice(0, 160)}` : 'did not throw');
  check('the failing wait took about its timeout (>= 900 ms, < 8000 ms)', dn >= 900 && dn < 8000, `${dn.toFixed(1)}ms`);

  await browser.close(); browser = null;
  let after = attribution();
  for (let i = 0; i < 20 && after.n > 0; i++) { await sleep(500); after = attribution(); }
  check('after browser.close(): no Chrome left that references the ISO dir', after.n === 0, JSON.stringify(after).slice(0, 160));
} catch (e) {
  check('harness ran without an unexpected error', false, String(e?.stack ?? e).slice(0, 600));
}
clearTimeout(watchdog);
console.log(JSON.stringify({ total: results.length, failed: bad }));
await finish(bad ? 1 : 0);
